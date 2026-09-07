/**
 * DataverseClient — thin, runtime-agnostic wrapper over PPTB's `dataverseAPI`.
 *
 * Verified against PPTB desktop-app 1.2.5 (src/main/managers/dataverseManager.ts):
 *  - `queryData(path)` prepends `api/data/v9.2/` and returns the **full** response body
 *    (requested with `Prefer: odata.include-annotations="*"`), so `@odata.nextLink`,
 *    `@Microsoft.Dynamics.CRM.fetchxmlpagingcookie` and `...morerecords` are present.
 *  - Errors are plain `Error`s whose message is `HTTP <status>` or `<code>: <message>`;
 *    there is no status property, so throttling/permission failures are detected by text.
 *  - Function parameters passed through `execute()` are quoted when they are strings, which
 *    breaks Edm.Guid parameters; call functions through `queryOne()` with a hand-built URL.
 *
 * Responsibilities: bounded concurrency, retry with backoff on 429/503/network errors,
 * `@odata.nextLink` paging (converted back to a relative path), FetchXML paging cookies,
 * a per-run cache, cooperative cancellation and request counting.
 */
import type { Logger } from '../domain/model';

export type Row = Record<string, unknown>;

/** The subset of `DataverseAPI.API` this tool uses (satisfied by `window.dataverseAPI` and the headless global). */
export interface DataverseApiLike {
    queryData: (odataQuery: string) => Promise<unknown>;
    fetchXmlQuery: (fetchXml: string) => Promise<unknown>;
    getEntityMetadata: (entityLogicalName: string, searchByLogicalName: boolean, entityProperties?: string[]) => Promise<unknown>;
    getAllEntitiesMetadata: (entityProperties?: string[]) => Promise<unknown>;
    getEntityRelatedMetadata: (entityLogicalName: string, relatedPath: RelatedMetadataPath, relatedProperties?: string[]) => Promise<unknown>;
}

export type RelatedMetadataPath = 'Attributes' | 'Keys' | 'OneToManyRelationships' | 'ManyToOneRelationships' | 'ManyToManyRelationships' | 'Privileges';

export interface QueryOptions {
    /** Follow `@odata.nextLink` / paging cookies until exhausted. Default true. */
    pageAll?: boolean;
    /** Safety cap on pages followed. Default 100. */
    maxPages?: number;
    signal?: AbortSignal;
    /** Bypass the per-run cache. */
    noCache?: boolean;
}

export interface ClientStats {
    requests: number;
    retries: number;
    cacheHits: number;
}

export interface DataverseClient {
    /** Collection query, e.g. `workflows?$select=name&$filter=...`. Returns all rows across pages. */
    query(path: string, opts?: QueryOptions): Promise<Row[]>;
    /** Single-object query, e.g. `organizations(<id>)?$select=...` or a function URL. */
    queryOne(path: string, opts?: QueryOptions): Promise<Row>;
    /** Raw first page including annotations (`@odata.nextLink`, `@odata.count`, ...). */
    queryRaw(path: string, opts?: QueryOptions): Promise<Row>;
    entityMetadata(logicalName: string, props?: string[]): Promise<Row>;
    allEntities(props?: string[]): Promise<Row[]>;
    relatedMetadata(logicalName: string, path: RelatedMetadataPath, props?: string[]): Promise<Row[]>;
    /** FetchXML query with automatic paging via the paging cookie. */
    fetchXml(fetchXml: string, opts?: QueryOptions): Promise<Row[]>;
    readonly stats: ClientStats;
}

export interface ClientOptions {
    /** Max in-flight requests. Default 6. */
    concurrency?: number;
    /** Max retries on throttle/transient errors. Default 3. */
    maxRetries?: number;
    /** Base backoff in ms (doubles each retry). Default 800. */
    backoffMs?: number;
    signal?: AbortSignal;
    logger?: Logger;
    /** Injectable sleep for tests. */
    sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type DataverseErrorKind = 'permission' | 'throttle' | 'transient' | 'notfound' | 'badrequest' | 'aborted' | 'error';

export class DataverseRequestError extends Error {
    readonly kind: DataverseErrorKind;
    readonly path: string;
    constructor(message: string, kind: DataverseErrorKind, path: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'DataverseRequestError';
        this.kind = kind;
        this.path = path;
    }
    get isPermission(): boolean {
        return this.kind === 'permission';
    }
}

const PERMISSION_PATTERNS = [/HTTP 403/i, /0x80040220/i, /0x80048306/i, /privilege/i, /does not have .*access/i, /not authorized/i, /forbidden/i];
const THROTTLE_PATTERNS = [/HTTP 429/i, /0x80072322/i, /0x80072321/i, /0x80072326/i, /too many requests/i, /Number of requests exceeded/i];
const TRANSIENT_PATTERNS = [/HTTP 50[234]/i, /Request failed/i, /ECONNRESET/i, /ETIMEDOUT/i, /socket hang up/i, /network/i, /0x80044330/i];
const NOTFOUND_PATTERNS = [/HTTP 404/i, /0x80040217/i, /Does Not Exist/i, /Resource not found/i];
const BADREQUEST_PATTERNS = [/HTTP 400/i, /0x80060888/i, /Could not find a property named/i, /Syntax error/i];

/** Classify an error thrown by `dataverseAPI` by its message text (PPTB exposes no status codes). */
export function classifyError(err: unknown): DataverseErrorKind {
    if (err instanceof DataverseRequestError) return err.kind;
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (/abort/i.test(message) && !/HTTP/i.test(message)) return 'aborted';
    if (THROTTLE_PATTERNS.some((p) => p.test(message))) return 'throttle';
    if (PERMISSION_PATTERNS.some((p) => p.test(message))) return 'permission';
    if (NOTFOUND_PATTERNS.some((p) => p.test(message))) return 'notfound';
    if (BADREQUEST_PATTERNS.some((p) => p.test(message))) return 'badrequest';
    if (TRANSIENT_PATTERNS.some((p) => p.test(message))) return 'transient';
    return 'error';
}

export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err ?? 'Unknown error');
}

// ---------------------------------------------------------------------------
// Paging helpers (pure, unit-tested)
// ---------------------------------------------------------------------------

/**
 * Convert an absolute `@odata.nextLink` into the relative path `queryData` expects
 * (`workflows?$select=...&$skiptoken=...`). Already-relative links are returned unchanged.
 */
export function nextLinkToRelative(nextLink: string): string {
    const m = /\/api\/data\/v\d+(?:\.\d+)?\/(.*)$/i.exec(nextLink);
    if (m) return m[1];
    return nextLink.replace(/^\/+/, '');
}

/** Decode the `pagingcookie` attribute of a `@Microsoft.Dynamics.CRM.fetchxmlpagingcookie` value. */
export function extractPagingCookie(annotation: string | undefined | null): { pageNumber: number; cookie: string } | null {
    if (!annotation) return null;
    const attr = /pagingcookie="([^"]*)"/i.exec(annotation);
    const page = /pagenumber="(\d+)"/i.exec(annotation);
    if (!attr) return null;
    let cookie = attr[1];
    // The value is URL-encoded twice inside the XML attribute.
    for (let i = 0; i < 2; i++) {
        try {
            const decoded = decodeURIComponent(cookie);
            if (decoded === cookie) break;
            cookie = decoded;
        } catch {
            break;
        }
    }
    return { pageNumber: page ? Number(page[1]) : 1, cookie };
}

function escapeXmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Return the FetchXML with `page` and `paging-cookie` set on the `<fetch>` element (replacing existing values). */
export function withPaging(fetchXml: string, page: number, cookie?: string): string {
    const fetchTag = /<fetch\b[^>]*>/i.exec(fetchXml);
    if (!fetchTag) return fetchXml;
    let tag = fetchTag[0];
    tag = tag.replace(/\s+page="[^"]*"/i, '').replace(/\s+paging-cookie="[^"]*"/i, '');
    const attrs = ` page="${page}"` + (cookie ? ` paging-cookie="${escapeXmlAttr(cookie)}"` : '');
    tag = tag.replace(/(\/?>)$/, `${attrs}$1`);
    return fetchXml.replace(fetchTag[0], tag);
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

export class Pool {
    private active = 0;
    private readonly queue: Array<() => void> = [];
    constructor(private readonly limit: number) {}

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.active >= this.limit) {
            await new Promise<void>((resolve) => this.queue.push(resolve));
        }
        this.active++;
        try {
            return await task();
        } finally {
            this.active--;
            const next = this.queue.shift();
            if (next) next();
        }
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function throwIfAborted(signal: AbortSignal | undefined, path: string): void {
    if (signal?.aborted) throw new DataverseRequestError('Run cancelled', 'aborted', path);
}

function asRow(value: unknown): Row {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
}

export function createDataverseClient(api: DataverseApiLike, options: ClientOptions = {}): DataverseClient {
    const concurrency = options.concurrency ?? 6;
    const maxRetries = options.maxRetries ?? 3;
    const backoffMs = options.backoffMs ?? 800;
    const sleep = options.sleep ?? defaultSleep;
    const logger = options.logger;
    const pool = new Pool(concurrency);
    const cache = new Map<string, Promise<unknown>>();
    const stats: ClientStats = { requests: 0, retries: 0, cacheHits: 0 };

    function mergedSignal(local?: AbortSignal): AbortSignal | undefined {
        if (options.signal && local) {
            const controller = new AbortController();
            const abort = () => controller.abort();
            options.signal.addEventListener('abort', abort, { once: true });
            local.addEventListener('abort', abort, { once: true });
            if (options.signal.aborted || local.aborted) controller.abort();
            return controller.signal;
        }
        return options.signal ?? local;
    }

    async function execute<T>(key: string, path: string, call: () => Promise<T>, opts?: QueryOptions): Promise<T> {
        const signal = mergedSignal(opts?.signal);
        throwIfAborted(signal, path);
        if (!opts?.noCache) {
            const hit = cache.get(key);
            if (hit) {
                stats.cacheHits++;
                return hit as Promise<T>;
            }
        }
        const promise = pool.run(async () => {
            let attempt = 0;
            for (;;) {
                throwIfAborted(signal, path);
                stats.requests++;
                try {
                    return await call();
                } catch (err) {
                    const kind = classifyError(err);
                    const retryable = kind === 'throttle' || kind === 'transient';
                    if (retryable && attempt < maxRetries && !signal?.aborted) {
                        attempt++;
                        stats.retries++;
                        const delay = backoffMs * 2 ** (attempt - 1);
                        logger?.warn(`Retry ${attempt}/${maxRetries} after ${kind} on ${path.slice(0, 120)} (${errorMessage(err)})`);
                        await sleep(delay);
                        continue;
                    }
                    throw new DataverseRequestError(errorMessage(err), kind, path, { cause: err });
                }
            }
        });
        if (!opts?.noCache) {
            cache.set(key, promise);
            promise.catch(() => cache.delete(key));
        }
        return promise;
    }

    async function queryRaw(path: string, opts?: QueryOptions): Promise<Row> {
        const clean = path.replace(/^\/+/, '').replace(/^\?/, '');
        const result = await execute(`q:${clean}`, clean, () => api.queryData(clean), opts);
        return asRow(result);
    }

    async function query(path: string, opts?: QueryOptions): Promise<Row[]> {
        const pageAll = opts?.pageAll ?? true;
        const maxPages = opts?.maxPages ?? 100;
        const rows: Row[] = [];
        let next: string | undefined = path;
        let pages = 0;
        while (next && pages < maxPages) {
            const body = await queryRaw(next, opts);
            const value = Array.isArray(body.value) ? (body.value as Row[]) : [];
            rows.push(...value);
            pages++;
            const link = body['@odata.nextLink'];
            next = pageAll && typeof link === 'string' && link ? nextLinkToRelative(link) : undefined;
        }
        if (next) logger?.warn(`Stopped paging ${path.slice(0, 80)} after ${maxPages} pages`);
        return rows;
    }

    async function queryOne(path: string, opts?: QueryOptions): Promise<Row> {
        return queryRaw(path, opts);
    }

    async function fetchXml(fetchXmlText: string, opts?: QueryOptions): Promise<Row[]> {
        const pageAll = opts?.pageAll ?? true;
        const maxPages = opts?.maxPages ?? 100;
        const rows: Row[] = [];
        let page = 1;
        let cookie: string | undefined;
        for (;;) {
            const xml = page === 1 ? fetchXmlText : withPaging(fetchXmlText, page, cookie);
            const key = `fx:${xml}`;
            const body = asRow(await execute(key, 'fetchXml', () => api.fetchXmlQuery(xml), opts));
            const value = Array.isArray(body.value) ? (body.value as Row[]) : [];
            rows.push(...value);
            const more = body['@Microsoft.Dynamics.CRM.morerecords'] === true;
            const parsed = extractPagingCookie(body['@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'] as string | undefined);
            if (!pageAll || !more || !parsed || page >= maxPages) break;
            cookie = parsed.cookie;
            page++;
        }
        return rows;
    }

    async function entityMetadata(logicalName: string, props?: string[]): Promise<Row> {
        const key = `em:${logicalName}:${(props ?? []).join(',')}`;
        return asRow(await execute(key, `EntityDefinitions(LogicalName='${logicalName}')`, () => api.getEntityMetadata(logicalName, true, props)));
    }

    async function allEntities(props?: string[]): Promise<Row[]> {
        const key = `ae:${(props ?? []).join(',')}`;
        const body = asRow(await execute(key, 'EntityDefinitions', () => api.getAllEntitiesMetadata(props)));
        return Array.isArray(body.value) ? (body.value as Row[]) : [];
    }

    async function relatedMetadata(logicalName: string, path: RelatedMetadataPath, props?: string[]): Promise<Row[]> {
        const key = `rm:${logicalName}:${path}:${(props ?? []).join(',')}`;
        const body = asRow(await execute(key, `EntityDefinitions(LogicalName='${logicalName}')/${path}`, () => api.getEntityRelatedMetadata(logicalName, path, props)));
        return Array.isArray(body.value) ? (body.value as Row[]) : [];
    }

    return { query, queryOne, queryRaw, entityMetadata, allEntities, relatedMetadata, fetchXml, stats };
}

/** Resolve the `dataverseAPI` global in either the browser (window) or the headless Node runtime (globalThis). */
export function resolveDataverseApi(): DataverseApiLike {
    const g = globalThis as unknown as { dataverseAPI?: DataverseApiLike; window?: { dataverseAPI?: DataverseApiLike } };
    const api = g.dataverseAPI ?? g.window?.dataverseAPI;
    if (!api) throw new Error('dataverseAPI is not available. This tool must run inside Power Platform ToolBox.');
    return api;
}

/** Chunk an array (used to keep `$filter=... or ...` URLs under the length limit). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/** OData string literal escaping (single quotes doubled). */
export function odataString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

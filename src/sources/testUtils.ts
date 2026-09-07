/**
 * Test helpers for the source modules.
 *
 * `makeFakeClient(routes)` is an in-memory `DataverseClient`: every call is recorded (kind, path,
 * metadata property list) and answered by the first route whose substring / RegExp matches the
 * request path. Unmatched calls return an empty collection, so "table with nothing on it" tests
 * need no routes at all (pass `{ strict: true }` to throw instead).
 *
 * `makeCtx()` builds a `SourceContext` around a sample custom table (`contoso_project`).
 */
import type { ClientStats, DataverseClient, RelatedMetadataPath, Row } from '../data/client';
import type { BuildOptions, Logger, OrgSettings, TableFacts } from '../domain/model';
import type { SourceContext } from './types';

export type FakeCallKind = 'query' | 'queryOne' | 'queryRaw' | 'entityMetadata' | 'allEntities' | 'relatedMetadata' | 'fetchXml';

export interface FakeCall {
    kind: FakeCallKind;
    /** The request path as the source built it; metadata calls use `EntityDefinitions(LogicalName='<t>')/<path>`. */
    path: string;
    /** Property list of a metadata call (`undefined` = all properties). */
    props?: string[];
}

/** Rows (served as `{ value }` for collection calls), a single body, or a function computing either. */
export type FakeResponse = Row[] | Row | ((call: FakeCall) => Row[] | Row);

export interface FakeRoute {
    /** Substring or RegExp tested against the call path. */
    match: string | RegExp;
    response: FakeResponse;
}

/** Either an ordered route list or a `{ [substring]: response }` map. */
export type FakeRoutes = FakeRoute[] | Record<string, FakeResponse>;

export interface FakeClient extends DataverseClient {
    readonly calls: FakeCall[];
    /** Paths of all recorded calls, in call order. */
    readonly paths: string[];
    /** Calls of one kind (e.g. every `query`). */
    callsOf(kind: FakeCallKind): FakeCall[];
}

/** Path recorded for metadata calls (mirrors the path `DataverseClient` reports in errors). */
export function metadataPath(logicalName: string, related?: RelatedMetadataPath): string {
    const base = `EntityDefinitions(LogicalName='${logicalName}')`;
    return related ? `${base}/${related}` : base;
}

function toRouteList(routes: FakeRoutes): FakeRoute[] {
    return Array.isArray(routes) ? routes : Object.entries(routes).map(([match, response]) => ({ match, response }));
}

function routeMatches(route: FakeRoute, path: string): boolean {
    if (typeof route.match === 'string') return path.includes(route.match);
    route.match.lastIndex = 0;
    return route.match.test(path);
}

function toRows(body: Row[] | Row): Row[] {
    if (Array.isArray(body)) return body;
    return Array.isArray(body.value) ? (body.value as Row[]) : [];
}

function toBody(body: Row[] | Row): Row {
    return Array.isArray(body) ? { value: body } : body;
}

export function makeFakeClient(routes: FakeRoutes = [], options: { strict?: boolean } = {}): FakeClient {
    const list = toRouteList(routes);
    const calls: FakeCall[] = [];
    const stats: ClientStats = { requests: 0, retries: 0, cacheHits: 0 };

    const respond = async (call: FakeCall): Promise<Row[] | Row> => {
        calls.push(call);
        stats.requests++;
        const route = list.find((r) => routeMatches(r, call.path));
        if (!route) {
            if (options.strict) throw new Error(`No fake route matches ${call.kind} ${call.path}`);
            return [];
        }
        return typeof route.response === 'function' ? route.response(call) : route.response;
    };

    return {
        calls,
        get paths() {
            return calls.map((c) => c.path);
        },
        callsOf: (kind) => calls.filter((c) => c.kind === kind),
        stats,
        query: async (path) => toRows(await respond({ kind: 'query', path })),
        queryOne: async (path) => toBody(await respond({ kind: 'queryOne', path })),
        queryRaw: async (path) => toBody(await respond({ kind: 'queryRaw', path })),
        entityMetadata: async (logicalName, props) => toBody(await respond({ kind: 'entityMetadata', path: metadataPath(logicalName), props })),
        allEntities: async (props) => toRows(await respond({ kind: 'allEntities', path: 'EntityDefinitions', props })),
        relatedMetadata: async (logicalName, related, props) => toRows(await respond({ kind: 'relatedMetadata', path: metadataPath(logicalName, related), props })),
        fetchXml: async (xml) => toRows(await respond({ kind: 'fetchXml', path: xml })),
    };
}

// ---------------------------------------------------------------------------
// Sample context
// ---------------------------------------------------------------------------

/** A custom, user-owned table with auditing and duplicate detection switched on. */
export const SAMPLE_TABLE: TableFacts = {
    logicalName: 'contoso_project',
    schemaName: 'contoso_Project',
    entitySetName: 'contoso_projects',
    metadataId: '7a1d3c9e-5b2f-4e8a-9c6d-1f0e2a3b4c5d',
    displayName: 'Project',
    primaryIdAttribute: 'contoso_projectid',
    primaryNameAttribute: 'contoso_name',
    objectTypeCode: 10042,
    ownership: 'UserOwned',
    isActivity: false,
    isCustom: true,
    isCustomizable: true,
    isBpfEntity: false,
    audit: true,
    changeTracking: true,
    duplicateDetection: true,
    hasNotes: true,
    hasActivities: true,
};

export const SAMPLE_ENVIRONMENT_URL = 'https://contoso.crm.dynamics.com';

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export interface CtxOverrides {
    client?: DataverseClient;
    table?: Partial<TableFacts>;
    org?: OrgSettings;
    options?: BuildOptions;
    knownColumns?: Iterable<string>;
    customApiNames?: Iterable<string>;
    environmentUrl?: string;
    signal?: AbortSignal;
    logger?: Logger;
}

export function makeCtx(overrides: CtxOverrides = {}): SourceContext {
    return {
        client: overrides.client ?? makeFakeClient(),
        table: { ...SAMPLE_TABLE, ...overrides.table },
        org: overrides.org ?? {},
        options: overrides.options ?? {},
        knownColumns: new Set(overrides.knownColumns ?? []),
        customApiNames: new Set(overrides.customApiNames ?? []),
        environmentUrl: overrides.environmentUrl ?? SAMPLE_ENVIRONMENT_URL,
        logger: overrides.logger ?? silentLogger,
        signal: overrides.signal,
    };
}

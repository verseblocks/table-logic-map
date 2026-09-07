/// <reference types="@pptb/types" />
/**
 * Headless (MCP / agent) entry. Built to dist/headless.js (CommonJS) by vite.headless.config.ts.
 *
 * Runtime facts (PPTB desktop-app 1.2.5, src/main/mcp/headlessToolRuntime.ts):
 *  - Loaded in Node (Electron main) via `import(fileUrl)`; `invokeHeadless` is resolved from
 *    `module.exports.invokeHeadless` or `module.exports.default.invokeHeadless`.
 *  - `globalThis.dataverseAPI` / `globalThis.toolboxAPI` are installed before the import; there
 *    is no DOM, no `fileSystem`, no `openInConnectionBrowser`.
 *  - `context` = { toolId, toolName, invocationMode, authToken?, connectionId?, connectionUrl?,
 *    connectionName?, updateProgress(percent, message?), logger }.
 *  - The return value must be an object; for two-way calls it is validated against
 *    `invocation.returnTopic` (typed properties only, extra keys allowed).
 *
 * Inputs arrive from a language model, so they are validated before they reach Dataverse:
 * `entityName` must look like a table logical name (it is interpolated into an OData metadata
 * path) and `events` are normalised against the known event names, with unknown values reported
 * instead of silently producing an empty map.
 */
import { createDataverseClient, resolveDataverseApi, errorMessage, DataverseRequestError } from './data/client';
import { buildLogicMap } from './domain/buildLogicMap';
import { EVENT_ORDER, stripRaw, type EventName, type LogicMap, type Logger, type ProgressEvent } from './domain/model';
import { filterMap } from './domain/filterMap';
import { toMarkdown } from './export/markdown';
import { redactConfiguration } from './export/redact';

export interface HeadlessContext {
    toolId: string;
    toolName: string;
    invocationMode: 'one-way' | 'two-way';
    authToken?: string;
    connectionId?: string;
    connectionUrl?: string;
    connectionName?: string;
    updateProgress: (percent: number, message?: string) => void;
    logger: Logger;
}

export interface HeadlessInput {
    entityName?: unknown;
    includeSystemSteps?: unknown;
    events?: unknown;
    /** Optional: include Mermaid diagrams in the Markdown. */
    includeDiagrams?: unknown;
    /** Optional: threshold for the `too-many-sync` smell (the UI's `smells.maxSyncItems` setting). */
    maxSyncItems?: unknown;
}

/**
 * Threshold for the `too-many-sync` smell. The UI reads it from the `smells.maxSyncItems` setting;
 * an agent can pass it so a headless map's smells match what the user sees in the app. Anything
 * that is not a positive integer falls back to the classifier's default.
 */
export function normalizeMaxSyncItems(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const threshold = Math.floor(value);
    return threshold > 0 ? threshold : undefined;
}

/**
 * Dataverse entity logical names are lower-case, start with a letter and contain only letters,
 * digits and underscores (the publisher prefix uses the same charset); the platform limit is 64
 * characters. Anything else must be rejected here: `entityName` is interpolated verbatim into
 * `EntityDefinitions(LogicalName='<value>')` by PPTB's `getEntityMetadata`, so a value carrying
 * quotes, `/`, `?`, `#` or `&` would rewrite the request path rather than name a table.
 */
const LOGICAL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Normalise a caller-supplied table name; `undefined` when it is not a plausible logical name. */
export function normalizeEntityName(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const name = value.trim().toLowerCase();
    return LOGICAL_NAME_RE.test(name) ? name : undefined;
}

const WELL_KNOWN_EVENTS = new Map<string, EventName>(EVENT_ORDER.map((e) => [e.toLowerCase(), e as EventName]));

export interface NormalizedEvents {
    /** Accepted events, de-duplicated in caller order; `undefined` means "no event filter". */
    events?: EventName[];
    /** Values that match no known event; the caller must be told rather than handed an empty map. */
    unknown: string[];
}

/**
 * Normalise the `events` input. Well-known events are matched case-insensitively (`create` →
 * `Create`) because `filterItems` compares them exactly; `Custom:<name>` / `Message:<name>` keep
 * their message name verbatim (SDK message names are case-sensitive) and only the prefix is
 * normalised. Everything else is reported in `unknown`.
 */
export function normalizeEvents(value: unknown): NormalizedEvents {
    if (value === undefined || value === null) return { unknown: [] };
    const entries = Array.isArray(value) ? value : [value];
    const events: EventName[] = [];
    const seen = new Set<string>();
    const unknown: string[] = [];
    for (const entry of entries) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
            unknown.push(typeof entry === 'string' ? entry : JSON.stringify(entry) ?? String(entry));
            continue;
        }
        const text = entry.trim();
        const wellKnown = WELL_KNOWN_EVENTS.get(text.toLowerCase());
        const prefixed = /^(custom|message)\s*:\s*(.+)$/i.exec(text);
        let resolved: EventName | undefined;
        if (wellKnown) resolved = wellKnown;
        else if (prefixed) resolved = `${prefixed[1].toLowerCase() === 'custom' ? 'Custom' : 'Message'}:${prefixed[2].trim()}` as EventName;
        if (!resolved) {
            unknown.push(text);
            continue;
        }
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        events.push(resolved);
    }
    return { events: events.length ? events : undefined, unknown };
}

/** Message listing the accepted event names, used in the error returned for unknown values. */
export function unknownEventsError(unknown: string[]): string {
    return (
        `Unknown event(s): ${unknown.join(', ')}. ` +
        `Use one of ${EVENT_ORDER.join(', ')} (case-insensitive), ` +
        `or "Custom:<message>" / "Message:<message>" for custom API, action and other SDK messages.`
    );
}

/**
 * Prefix a build failure with the table that was being loaded. `buildLogicMap` rethrows the
 * `DataverseRequestError` from the metadata call verbatim, whose message is often a bare
 * `HTTP 404`; without the table name an assistant cannot tell that the name was the problem.
 */
export function tableError(entityName: string, err: unknown): Error {
    const prefix = `Unable to load table '${entityName}'`;
    if (err instanceof Error && err.message.startsWith('Unable to load table')) return err;
    const message = `${prefix}: ${errorMessage(err)}`;
    if (err instanceof DataverseRequestError) return new DataverseRequestError(message, err.kind, err.path, { cause: err });
    return new Error(message, { cause: err });
}

/**
 * Build the two-way payload. Redaction happens here so the MCP result follows the same policy as
 * the JSON export: a plugin step's unsecure configuration never leaves the tool (the secure
 * configuration is never fetched at all).
 */
export function twoWayResult(map: LogicMap, opts: { includeDiagrams?: boolean } = {}): { logicMap: LogicMap; markdown: string } {
    const safe = redactConfiguration(map);
    return { logicMap: safe, markdown: toMarkdown(safe, { includeDiagrams: opts.includeDiagrams === true }) };
}

export async function invokeHeadless(input: HeadlessInput, context: HeadlessContext): Promise<Record<string, unknown>> {
    const { updateProgress, logger, invocationMode } = context;

    const rawEntity = input?.entityName;
    if (rawEntity === undefined || rawEntity === null || (typeof rawEntity === 'string' && rawEntity.trim().length === 0)) {
        return { error: 'entityName is required (table logical name, e.g. "account")' };
    }
    const entityName = normalizeEntityName(rawEntity);
    if (!entityName) {
        return {
            error:
                `entityName must be a table logical name such as "account" or "contoso_project" ` +
                `(lower-case letters, digits and underscores, starting with a letter); received ${JSON.stringify(rawEntity)}`,
        };
    }

    const { events, unknown: unknownEvents } = normalizeEvents(input?.events);
    if (unknownEvents.length > 0) {
        return { error: unknownEventsError(unknownEvents) };
    }

    updateProgress(2, `resolving table ${entityName}`);
    let environment = { name: context.connectionName ?? '', url: context.connectionUrl ?? '' };
    try {
        const g = globalThis as unknown as { toolboxAPI?: { connections?: { getActiveConnection?: () => Promise<{ name?: string; url?: string } | null> } } };
        const conn = await g.toolboxAPI?.connections?.getActiveConnection?.();
        if (conn) environment = { name: conn.name ?? environment.name, url: conn.url ?? environment.url };
    } catch (err) {
        logger.warn(`Could not read the active connection: ${errorMessage(err)}`);
    }

    const client = createDataverseClient(resolveDataverseApi(), { logger });
    const progress = (e: ProgressEvent) => {
        updateProgress(2 + Math.round(e.percent * 0.95), `${e.source}: ${e.status}${e.message ? ` (${e.message})` : ''}`);
    };

    const includeSystemSteps = input?.includeSystemSteps === true;
    const maxSyncItems = normalizeMaxSyncItems(input?.maxSyncItems);
    let full: LogicMap;
    try {
        full = await buildLogicMap(client, entityName, {
            includeSystemSteps,
            events,
            maxSyncItems,
            environment,
            progress,
            logger,
        });
    } catch (err) {
        throw tableError(entityName, err);
    }
    // Same view filters the UI applies before export/returnData, so both paths return identical maps.
    const map = stripRaw(filterMap(full, { includeSystemSteps, events, maxSyncItems }));

    updateProgress(100, 'done');
    logger.info(`Table Logic Map built for ${entityName}: ${map.items.length} items, ${map.sourceErrors.length} source errors, ${map.stats.requests} requests`);

    if (invocationMode === 'one-way') {
        return { status: 'completed', entityName, items: map.items.length };
    }
    return twoWayResult(map, { includeDiagrams: input?.includeDiagrams === true });
}

export default { invokeHeadless };

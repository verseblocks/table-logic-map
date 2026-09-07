/**
 * Zustand store — the single integration point between the PPTB host APIs and the React UI.
 * All Dataverse work goes through `buildLogicMap` (UI-free); this file only orchestrates.
 */
import { create } from 'zustand';
import { createDataverseClient, errorMessage, resolveDataverseApi } from '../data/client';
import { buildLogicMap } from '../domain/buildLogicMap';
import { ALL_SOURCES, createEmptyMap, type EventName, type LogicKind, type LogicMap, type ProgressEvent, type SourceName, type SourceStatus, type TableFacts } from '../domain/model';
import { toHtml } from '../export/html';
import { toJson } from '../export/json';
import { itemToMarkdown, toMarkdown } from '../export/markdown';
import { label } from '../sources/types';
import { buildAgentPayload, deriveVisibleMap } from './visibleMap';

export type TabId = 'pipeline' | 'forms' | 'columns' | 'datarules' | 'touchedby' | 'everything' | 'raw';
export type ExportFormat = 'markdown' | 'json' | 'html';

const EXPORT_FORMATS: readonly ExportFormat[] = ['markdown', 'json', 'html'];

/** A stored `export.lastFormat` from an older build (or a hand-edited setting) must not break the menu. */
function asExportFormat(value: unknown): ExportFormat {
    return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value) ? (value as ExportFormat) : 'markdown';
}

export interface TableSummary {
    logicalName: string;
    displayName: string;
    schemaName: string;
    entitySetName: string;
    metadataId: string;
    isCustom: boolean;
    isActivity: boolean;
}

export interface RunState {
    status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
    progress: Record<SourceName, SourceStatus>;
    messages: Partial<Record<SourceName, string>>;
    error?: string;
    startedAt?: number;
    finishedAt?: number;
}

export interface Filters {
    event?: EventName;
    enabledOnly: boolean;
    showSystemSteps: boolean;
    search: string;
    kinds: LogicKind[];
}

export interface Notice {
    id: string;
    kind: 'info' | 'warning' | 'error';
    text: string;
}

export interface LaunchInfo {
    entityName?: string;
    includeSystemSteps?: boolean;
    events?: EventName[];
    expectsResponse: boolean;
    timeoutMs?: number;
    source?: string;
}

export interface AppState {
    theme: 'light' | 'dark';
    connection: ToolBoxAPI.Connection | null;
    tables: TableSummary[];
    tablesStatus: 'idle' | 'loading' | 'done' | 'error';
    tablesError?: string;
    selectedTable?: string;
    run: RunState;
    /** Full map (includes hidden system steps); use `visibleMap()` for display/export. */
    map?: LogicMap;
    filters: Filters;
    selectedItemId?: string;
    activeTab: TabId;
    recent: string[];
    maxSyncItems: number;
    exportLastFormat: ExportFormat;
    includeDiagrams: boolean;
    launch?: LaunchInfo;
    notices: Notice[];
    initialized: boolean;
    /** Detail pane: show the raw item JSON instead of the rendered details. */
    detailShowRaw: boolean;
    /** Detail pane collapsed to a slim strip (the selection is kept). */
    detailCollapsed: boolean;
    /** Source-error banners the user dismissed for the current run. */
    dismissedSourceErrors: SourceName[];

    // actions
    init: () => Promise<void>;
    loadTables: () => Promise<void>;
    selectTable: (logicalName: string | undefined) => void;
    runMap: (logicalName?: string) => Promise<void>;
    cancel: () => void;
    setFilters: (patch: Partial<Filters>) => void;
    selectItem: (itemId: string | undefined) => void;
    setTab: (tab: TabId) => void;
    exportAs: (format: ExportFormat) => Promise<void>;
    copyItemMarkdown: (itemId: string) => Promise<void>;
    copyText: (text: string) => Promise<void>;
    openUrl: (url: string) => Promise<void>;
    dismissNotice: (id: string) => void;
    setMaxSyncItems: (n: number) => void;
    setIncludeDiagrams: (v: boolean) => void;
    setDetailShowRaw: (v: boolean) => void;
    setDetailCollapsed: (v: boolean) => void;
    dismissSourceError: (source: SourceName) => void;
    /** Raw tab: save `map.raw` as a JSON fixture through the host file dialog. */
    saveRawFixture: () => Promise<void>;
    /** The map with view filters applied (system steps / enabled-only / event). */
    visibleMap: () => LogicMap | undefined;
}

const SETTINGS = {
    recent: (connectionId: string) => `ui.recentTables.${connectionId}`,
    showSystemSteps: 'ui.showSystemSteps',
    enabledOnly: 'ui.enabledOnly',
    exportLastFormat: 'export.lastFormat',
    includeDiagrams: 'export.includeDiagrams',
    maxSyncItems: 'smells.maxSyncItems',
};

const initialProgress = (): Record<SourceName, SourceStatus> => Object.fromEntries(ALL_SOURCES.map((s) => [s, 'pending'])) as Record<SourceName, SourceStatus>;

let abortController: AbortController | null = null;
let noticeSeq = 0;

/**
 * A windowed two-way MCP launch must hand a result back *before* the caller's own timeout fires,
 * otherwise the agent only sees a generic timeout. We return the latest partial map this many
 * milliseconds early (guide §10.2).
 */
const RETURN_MARGIN_MS = 2000;

function tb(): ToolBoxAPI.API | undefined {
    return typeof window !== 'undefined' ? window.toolboxAPI : undefined;
}

async function safeSetting<T>(key: string, fallback: T): Promise<T> {
    try {
        const v = await tb()?.settings.get(key);
        return v === undefined || v === null ? fallback : (v as T);
    } catch {
        return fallback;
    }
}

/** Minimal map returned to a two-way caller when the run failed before any source produced one. */
function emptyMapFor(table: string, tables: TableSummary[], environment: { name: string; url: string }): LogicMap {
    const summary = tables.find((t) => t.logicalName === table);
    const facts: TableFacts = {
        logicalName: table,
        entitySetName: summary?.entitySetName ?? '',
        metadataId: summary?.metadataId ?? '',
        displayName: summary?.displayName ?? table,
        schemaName: summary?.schemaName ?? '',
        ownership: '',
        isActivity: summary?.isActivity ?? false,
        isCustom: summary?.isCustom ?? false,
        isCustomizable: false,
        isBpfEntity: false,
        audit: false,
        changeTracking: false,
        duplicateDetection: false,
        hasNotes: false,
        hasActivities: false,
    };
    return createEmptyMap(facts, environment, new Date().toISOString());
}

function saveSetting(key: string, value: unknown): void {
    void tb()
        ?.settings.set(key, value)
        .catch(() => undefined);
}

export const useAppStore = create<AppState>()((set, get) => ({
    theme: 'light',
    connection: null,
    tables: [],
    tablesStatus: 'idle',
    run: { status: 'idle', progress: initialProgress(), messages: {} },
    filters: { enabledOnly: false, showSystemSteps: false, search: '', kinds: [] },
    activeTab: 'pipeline',
    recent: [],
    maxSyncItems: 5,
    exportLastFormat: 'markdown',
    includeDiagrams: false,
    notices: [],
    initialized: false,
    detailShowRaw: false,
    detailCollapsed: false,
    dismissedSourceErrors: [],

    init: async () => {
        if (get().initialized) return;
        set({ initialized: true });
        const api = tb();
        if (!api) {
            set({ notices: [{ id: 'no-host', kind: 'error', text: 'toolboxAPI is not available. Load this tool inside Power Platform ToolBox.' }] });
            return;
        }
        const notify = (kind: Notice['kind'], text: string) => set((s) => ({ notices: [...s.notices, { id: `n${++noticeSeq}`, kind, text }] }));

        const refreshTheme = async () => {
            try {
                const t = await api.utils.getCurrentTheme();
                set({ theme: t === 'dark' ? 'dark' : 'light' });
            } catch {
                /* keep current */
            }
        };
        const refreshConnection = async () => {
            try {
                const conn = await api.connections.getActiveConnection();
                set({ connection: conn });
                if (conn) {
                    const recent = await safeSetting<string[]>(SETTINGS.recent(conn.id), []);
                    set({ recent: Array.isArray(recent) ? recent : [] });
                }
                return conn;
            } catch (err) {
                notify('error', `Could not read the active connection: ${errorMessage(err)}`);
                return null;
            }
        };

        await refreshTheme();
        const [showSystemSteps, enabledOnly, exportLastFormat, includeDiagrams, maxSyncItems] = await Promise.all([
            safeSetting<boolean>(SETTINGS.showSystemSteps, false),
            safeSetting<boolean>(SETTINGS.enabledOnly, false),
            safeSetting<unknown>(SETTINGS.exportLastFormat, 'markdown'),
            safeSetting<boolean>(SETTINGS.includeDiagrams, false),
            safeSetting<number>(SETTINGS.maxSyncItems, 5),
        ]);
        set((s) => ({
            filters: { ...s.filters, showSystemSteps: !!showSystemSteps, enabledOnly: !!enabledOnly },
            exportLastFormat: asExportFormat(exportLastFormat),
            includeDiagrams: !!includeDiagrams,
            maxSyncItems: typeof maxSyncItems === 'number' && maxSyncItems > 0 ? maxSyncItems : 5,
        }));

        api.events.on((_event, payload) => {
            try {
                switch (payload?.event) {
                    case 'connection:updated':
                    case 'connection:created':
                    case 'connection:deleted':
                        get().cancel();
                        set({ map: undefined, selectedTable: undefined, selectedItemId: undefined, run: { status: 'idle', progress: initialProgress(), messages: {} } });
                        void refreshConnection().then(() => get().loadTables());
                        break;
                    case 'settings:updated':
                        void refreshTheme();
                        break;
                    case 'tool:unloaded':
                        get().cancel();
                        break;
                    default:
                        break;
                }
            } catch (err) {
                console.error('event handler failed', err);
            }
        });

        await refreshConnection();
        await get().loadTables();

        // Launched by another tool or the MCP server?
        try {
            const ctx = await api.invocation.getLaunchContext();
            if (ctx && typeof ctx === 'object') {
                const meta = (ctx.__pptb ?? {}) as { expectsResponse?: boolean; timeoutMs?: number; source?: string };
                const launch: LaunchInfo = {
                    entityName: typeof ctx.entityName === 'string' ? ctx.entityName.trim().toLowerCase() : undefined,
                    includeSystemSteps: ctx.includeSystemSteps === true,
                    events: Array.isArray(ctx.events) ? (ctx.events.filter((e) => typeof e === 'string') as EventName[]) : undefined,
                    expectsResponse: meta.expectsResponse === true,
                    timeoutMs: typeof meta.timeoutMs === 'number' ? meta.timeoutMs : undefined,
                    source: typeof meta.source === 'string' ? meta.source : undefined,
                };
                set({ launch });
                if (launch.includeSystemSteps) set((s) => ({ filters: { ...s.filters, showSystemSteps: true } }));
                if (launch.entityName) {
                    get().selectTable(launch.entityName);
                    void get().runMap(launch.entityName);
                }
            }
        } catch (err) {
            console.warn('getLaunchContext failed', err);
        }
    },

    loadTables: async () => {
        set({ tablesStatus: 'loading', tablesError: undefined });
        try {
            const api = resolveDataverseApi();
            const client = createDataverseClient(api, { concurrency: 2 });
            const rows = await client.allEntities(['LogicalName', 'DisplayName', 'SchemaName', 'EntitySetName', 'IsCustomEntity', 'IsActivity', 'MetadataId', 'IsIntersect', 'IsPrivate']);
            const tables: TableSummary[] = rows
                .filter((r) => r.IsIntersect !== true && r.IsPrivate !== true && typeof r.LogicalName === 'string')
                .map((r) => ({
                    logicalName: String(r.LogicalName),
                    displayName: label(r.DisplayName, String(r.LogicalName)),
                    schemaName: String(r.SchemaName ?? ''),
                    entitySetName: String(r.EntitySetName ?? ''),
                    metadataId: String(r.MetadataId ?? ''),
                    isCustom: r.IsCustomEntity === true,
                    isActivity: r.IsActivity === true,
                }))
                .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.logicalName.localeCompare(b.logicalName));
            set({ tables, tablesStatus: 'done' });
        } catch (err) {
            set({ tablesStatus: 'error', tablesError: errorMessage(err) });
        }
    },

    selectTable: (logicalName) => set({ selectedTable: logicalName }),

    runMap: async (logicalName) => {
        const table = (logicalName ?? get().selectedTable)?.trim().toLowerCase();
        if (!table) return;
        // Compare against the table the loaded map belongs to: the picker sets `selectedTable` before it runs.
        const tableChanged = get().map?.table.logicalName !== table;
        get().cancel();
        const controller = new AbortController();
        abortController = controller;
        const startedAt = Date.now();
        set((s) => ({
            selectedTable: table,
            selectedItemId: undefined,
            map: undefined,
            dismissedSourceErrors: [],
            // Per-view filters describe the *previous* table: an `Assign` pill or a kind the new
            // table has no items for would silently hide everything with nothing left to un-tick.
            // The persisted enabled-only / system-step switches are kept.
            filters: tableChanged ? { ...s.filters, event: undefined, search: '', kinds: [] } : s.filters,
            run: { status: 'running', progress: initialProgress(), messages: {}, startedAt },
        }));

        const conn = get().connection;
        const environment = { name: conn?.name ?? '', url: conn?.url ?? '' };
        const progress = (e: ProgressEvent) =>
            set((s) => ({
                run: {
                    ...s.run,
                    progress: { ...s.run.progress, [e.source]: e.status },
                    messages: e.message ? { ...s.run.messages, [e.source]: e.message } : s.run.messages,
                },
            }));

        // A windowed two-way launch must get *something* back on every terminal outcome - success,
        // failure, cancellation or the caller's timeout - or the agent waits for its own timeout
        // and never learns what went wrong.
        const launch = get().launch;
        const expectsResponse = launch?.expectsResponse === true;
        let responded = false;
        const respond = async (result: LogicMap | undefined, error?: string): Promise<void> => {
            if (!expectsResponse || responded) return;
            responded = true;
            const source = result ?? emptyMapFor(table, get().tables, environment);
            // Shape, view filters, `raw` stripping and the plugin-configuration redaction all live in
            // `buildAgentPayload` so the windowed payload cannot drift from the headless one.
            const payload = buildAgentPayload(source, {
                includeSystemSteps: launch?.includeSystemSteps,
                events: launch?.events,
                maxSyncItems: get().maxSyncItems,
                includeDiagrams: get().includeDiagrams,
                error,
            });
            try {
                await tb()?.invocation.returnData(payload);
            } catch (err) {
                console.warn('returnData failed', err);
            }
        };

        // Answer just before the caller's timeout with whatever the sources produced (guide 10.2).
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        if (expectsResponse && launch?.timeoutMs && launch.timeoutMs > 0) {
            const timeoutMs = launch.timeoutMs;
            timeoutTimer = setTimeout(
                () => {
                    if (abortController !== controller) return; // superseded: the newer run answers
                    void respond(get().map, `Timed out after ${timeoutMs} ms - returning the partial map; sourceErrors and stats.partial show what did not finish.`);
                    controller.abort();
                },
                Math.max(1000, timeoutMs - RETURN_MARGIN_MS),
            );
        }

        try {
            const client = createDataverseClient(resolveDataverseApi(), { signal: controller.signal, logger: console });
            const map = await buildLogicMap(client, table, {
                includeSystemSteps: true, // fetch everything; the view filter hides system steps
                maxSyncItems: get().maxSyncItems,
                environment,
                progress,
                onPartial: (partial) => {
                    if (abortController === controller) set({ map: partial });
                },
                signal: controller.signal,
                logger: console,
            });
            if (abortController !== controller) {
                // Cancelled while the last sources finished (abortController === null): the map is
                // complete, so still answer. If a newer run took over, that run answers instead.
                if (abortController === null) await respond(map);
                return;
            }
            set((s) => ({ map, run: { ...s.run, status: 'done', finishedAt: Date.now() } }));

            if (conn) {
                const recent = [table, ...get().recent.filter((t) => t !== table)].slice(0, 10);
                set({ recent });
                saveSetting(SETTINGS.recent(conn.id), recent);
            }

            await respond(map);
        } catch (err) {
            // `abortController === null` means this run was cancelled (by the user, a connection
            // event or the timeout above) and nothing newer is in flight - we still owe an answer.
            const superseded = abortController !== null && abortController !== controller;
            const cancelled = controller.signal.aborted;
            const partial = get().map;
            if (abortController === controller) {
                set((s) => ({ run: { ...s.run, status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : errorMessage(err), finishedAt: Date.now() } }));
            }
            if (!superseded) {
                await respond(partial, cancelled ? 'The run was cancelled before every source finished - this is a partial map.' : errorMessage(err));
            }
        } finally {
            if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
            if (abortController === controller) abortController = null;
        }
    },

    cancel: () => {
        if (abortController) {
            abortController.abort();
            abortController = null;
            set((s) => (s.run.status === 'running' ? { run: { ...s.run, status: 'cancelled', finishedAt: Date.now() } } : {}));
        }
    },

    setFilters: (patch) => {
        set((s) => ({ filters: { ...s.filters, ...patch } }));
        if (patch.showSystemSteps !== undefined) saveSetting(SETTINGS.showSystemSteps, patch.showSystemSteps);
        if (patch.enabledOnly !== undefined) saveSetting(SETTINGS.enabledOnly, patch.enabledOnly);
    },

    selectItem: (itemId) => set({ selectedItemId: itemId }),
    setTab: (tab) => set({ activeTab: tab }),

    exportAs: async (format) => {
        const map = get().visibleMap();
        if (!map) return;
        set({ exportLastFormat: format });
        saveSetting(SETTINGS.exportLastFormat, format);
        const api = tb();
        const base = `${map.table.logicalName}-logic-map`;
        try {
            if (format === 'json') {
                await api?.fileSystem.saveFile(`${base}.json`, toJson(map), [{ name: 'JSON', extensions: ['json'] }]);
            } else if (format === 'html') {
                // One self-contained document (inline CSS, inline SVG diagrams, no network): it opens in a
                // browser, in Word and prints to PDF from wherever the user saves it.
                await api?.fileSystem.saveFile(`${base}.html`, toHtml(map, { includeDiagrams: get().includeDiagrams }), [{ name: 'HTML', extensions: ['html'] }]);
            } else {
                await api?.fileSystem.saveFile(`${base}.md`, toMarkdown(map, { includeDiagrams: get().includeDiagrams }), [{ name: 'Markdown', extensions: ['md'] }]);
            }
        } catch (err) {
            await api?.utils.showNotification({ title: 'Export failed', body: errorMessage(err), type: 'error' });
        }
    },

    copyItemMarkdown: async (itemId) => {
        const map = get().map;
        const item = map?.items.find((i) => i.id === itemId) ?? map?.externalTouchers.find((i) => i.id === itemId);
        if (!map || !item) return;
        await get().copyText(itemToMarkdown(item, map));
    },

    copyText: async (text) => {
        const api = tb();
        try {
            await api?.utils.copyToClipboard(text);
            await api?.utils.showNotification({ title: 'Copied', body: 'Copied to clipboard', type: 'success', duration: 1500 });
        } catch (err) {
            await api?.utils.showNotification({ title: 'Copy failed', body: errorMessage(err), type: 'error' });
        }
    },

    openUrl: async (url) => {
        const api = tb();
        try {
            await api?.utils.openInConnectionBrowser(url);
        } catch (err) {
            await api?.utils.showNotification({ title: 'Could not open browser', body: errorMessage(err), type: 'error' });
        }
    },

    dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

    setMaxSyncItems: (n) => {
        set({ maxSyncItems: n });
        saveSetting(SETTINGS.maxSyncItems, n);
    },

    setIncludeDiagrams: (v) => {
        set({ includeDiagrams: v });
        saveSetting(SETTINGS.includeDiagrams, v);
    },

    setDetailShowRaw: (v) => set({ detailShowRaw: v }),
    setDetailCollapsed: (v) => set({ detailCollapsed: v }),
    dismissSourceError: (source) => set((s) => ({ dismissedSourceErrors: s.dismissedSourceErrors.includes(source) ? s.dismissedSourceErrors : [...s.dismissedSourceErrors, source] })),

    saveRawFixture: async () => {
        const map = get().map;
        const api = tb();
        if (!map?.raw) {
            await api?.utils.showNotification({ title: 'Nothing to save', body: 'Run a map first; raw sources are collected while the map is built.', type: 'warning' });
            return;
        }
        try {
            // `raw` is already redacted by the sources (no secure config, no full flow clientdata).
            const path = await api?.fileSystem.saveFile(`${map.table.logicalName}-raw-sources.json`, JSON.stringify(map.raw, null, 2), [{ name: 'JSON', extensions: ['json'] }]);
            if (path) await api?.utils.showNotification({ title: 'Fixture saved', body: path, type: 'success', duration: 2500 });
        } catch (err) {
            await api?.utils.showNotification({ title: 'Save failed', body: errorMessage(err), type: 'error' });
        }
    },

    visibleMap: () => {
        const { map, filters, maxSyncItems } = get();
        if (!map) return undefined;
        // Same derivation (and the same memo) the UI renders, so an export matches the screen.
        return deriveVisibleMap(map, { includeSystemSteps: filters.showSystemSteps, enabledOnly: filters.enabledOnly, maxSyncItems });
    },
}));

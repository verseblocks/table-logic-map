/**
 * Table Logic Map — domain model.
 *
 * Everything in this file is UI-free and runtime-agnostic (browser + Node headless).
 * The React UI, the Markdown/JSON/Mermaid exporters and the headless MCP entry all
 * consume the same `LogicMap`.
 */

export const SCHEMA_VERSION = 1 as const;

/** What kind of logic an item represents. */
export type LogicKind =
    | 'plugin'
    | 'customapi'
    | 'workflow'
    | 'action'
    | 'flow'
    | 'businessrule'
    | 'formscript'
    | 'pcf'
    | 'formcomponent'
    | 'bpf'
    | 'duplicaterule'
    | 'cascade'
    | 'key'
    | 'requiredcolumn'
    | 'formula'
    | 'rollup'
    | 'calculated'
    | 'autonumber'
    | 'fieldsecurity'
    | 'audit'
    | 'app';

/** Well-known platform events (SDK messages) plus form-time pseudo events. */
export type WellKnownEvent =
    | 'Create'
    | 'Update'
    | 'Delete'
    | 'Assign'
    | 'SetState'
    | 'Retrieve'
    | 'RetrieveMultiple'
    | 'Associate'
    | 'Disassociate'
    | 'Merge'
    | 'Share'
    | 'Unshare'
    | 'AddToQueue'
    | 'Qualify'
    | 'Win'
    | 'Lose'
    | 'FormLoad'
    | 'FormSave'
    | 'FieldChange'
    | 'Any';

/**
 * `Custom:<name>` = a custom API / action message bound to this table.
 * `Message:<name>` = any other SDK message (e.g. `Message:GrantAccess`).
 */
export type EventName = WellKnownEvent | `Custom:${string}` | `Message:${string}`;

/** Execution stage in the order the platform runs them. */
export type Stage =
    | 'client' // form-time: business rules, JS handlers, PCF
    | 'prevalidation' // 10
    | 'preoperation' // 20 (incl. real-time workflow "before")
    | 'mainoperation' // 30 (custom API implementation)
    | 'postoperation' // 40 sync (incl. real-time workflow "after")
    | 'postcommit' // async plugins, background workflows, cloud flows
    | 'always'; // data rules that are not stage-bound (keys, cascades, autonumber, formula)

export const STAGE_ORDER: readonly Stage[] = ['client', 'prevalidation', 'preoperation', 'mainoperation', 'postoperation', 'postcommit', 'always'];

export const STAGE_LABEL: Record<Stage, string> = {
    client: 'Client (form)',
    prevalidation: 'Pre-validation',
    preoperation: 'Pre-operation',
    mainoperation: 'Main operation',
    postoperation: 'Post-operation (sync)',
    postcommit: 'After commit (async)',
    always: 'Always (data rule)',
};

/** Display order for events; unknown/custom events sort after these, alphabetically. */
export const EVENT_ORDER: readonly WellKnownEvent[] = [
    'Create',
    'Update',
    'Delete',
    'Assign',
    'SetState',
    'Merge',
    'Share',
    'Unshare',
    'Associate',
    'Disassociate',
    'Retrieve',
    'RetrieveMultiple',
    'AddToQueue',
    'Qualify',
    'Win',
    'Lose',
    'FormLoad',
    'FormSave',
    'FieldChange',
    'Any',
];

export type Confidence = 'exact' | 'heuristic';

/** How the item executes; drives the mode badge in the UI. */
export type ExecutionMode = 'sync' | 'async' | 'realtime' | 'background' | 'client' | 'instant' | 'rule';

export interface LogicItem {
    /** GUID or synthetic id (`${kind}:${key}`). One event per item; multi-event registrations share `groupId`. */
    id: string;
    kind: LogicKind;
    name: string;
    event: EventName;
    /** Ties together items expanded from one registration (e.g. a plugin step on Create+Update). */
    groupId?: string;
    stage: Stage;
    /** Rank for plugin steps; undefined otherwise. */
    order?: number;
    /** Step enabled / process activated / handler enabled. */
    enabled: boolean;
    mode?: ExecutionMode;
    /** Columns that trigger it (Update filtering attributes, JS onchange attribute, flow filtering attributes). */
    filteringAttributes?: string[];
    /** Columns it reads/writes (heuristic where noted by `confidence`). */
    touchesColumns?: string[];
    confidence: Confidence;
    /** Kind-specific details (assembly, type, images, form, library, function, connector, message ...). */
    details: Record<string, unknown>;
    /** URLs suitable for `toolboxAPI.utils.openInConnectionBrowser`. */
    links?: { maker?: string; record?: string };
    /** Where the item came from: the Dataverse table (e.g. `sdkmessageprocessingstep`) and record id. */
    source: { table: string; id?: string };
    /** Smell ids (see `LogicMap.smells`) attached by the classifier. */
    smells?: string[];
}

export interface ColumnInfo {
    logicalName: string;
    displayName: string;
    /** AttributeType (e.g. String, Lookup, Picklist, DateTime, Money). */
    type: string;
    required: boolean;
    secured: boolean;
    audited: boolean;
    sourceType: 'simple' | 'calculated' | 'rollup' | 'formula';
    autoNumber?: string;
    isCustom: boolean;
    /** Item ids whose `filteringAttributes` include this column. */
    triggers: string[];
    /** Item ids whose `touchesColumns` include this column. */
    touchedBy: string[];
}

export interface FormInfo {
    id: string;
    name: string;
    /** systemform.type label (Main, Quick Create, Quick View, Card, ...). */
    type: string;
    typeCode: number;
    /** Active / Inactive. */
    state: string;
    isDefault: boolean;
    isManaged: boolean;
    /** systemform.description, when set. */
    description?: string;
    libraries: string[];
    /** `formscript` items on this form. */
    handlers: LogicItem[];
    /** `pcf` items on this form. */
    pcf: LogicItem[];
    /** `formcomponent` items (web resources, iframes, subgrids, quick view forms, ...). */
    components: LogicItem[];
    /** Item ids of business rules scoped to this form (or entity-wide rules). */
    businessRules: string[];
}

export interface AppInfo {
    id: string;
    name: string;
    uniqueName: string;
    isManaged: boolean;
    state: string;
}

export interface DependencyInfo {
    componentType: number;
    componentTypeName?: string;
    objectId: string;
    name?: string;
    /** True when the object id matches an item we already produced. */
    classified: boolean;
    itemId?: string;
    /** dependency.dependencytype (0 None, 1 Solution Internal, 2 Published), when returned. */
    dependencyType?: number;
    dependencyTypeName?: string;
}

export type SmellCode =
    | 'update-no-filter' // Update steps with no filtering attributes (sync plugins, real-time workflows, flows)
    | 'too-many-sync' // More than N sync items on one event/stage
    | 'disabled-clutter' // Disabled/draft items that still exist
    | 'realtime-plus-plugin' // Real-time workflow + sync plugin on the same message
    | 'flow-update-unfiltered' // Flow on Update with no filtering attributes and no filter expression
    | 'cascade-chain' // Cascade delete chains >= 2 levels
    | 'br-plus-js'; // Entity-scoped business rule plus JS on the same field

export interface Smell {
    /** Stable id, e.g. `smell:update-no-filter:<itemId>`. */
    id: string;
    code: SmellCode;
    severity: 'info' | 'warning';
    /** One line shown as a badge tooltip / in the header. */
    message: string;
    /** Why it matters. */
    explanation: string;
    itemIds: string[];
    event?: EventName;
    stage?: Stage;
}

export type SourceName =
    | 'tableMeta'
    | 'orgSettings'
    | 'columns'
    | 'keys'
    | 'relationships'
    | 'forms'
    | 'processes'
    | 'flows'
    | 'pluginSteps'
    | 'customApis'
    | 'duplicateRules'
    | 'fieldSecurity'
    | 'apps'
    | 'dependencies'
    | 'views';

export const ALL_SOURCES: readonly SourceName[] = [
    'tableMeta',
    'orgSettings',
    'columns',
    'keys',
    'relationships',
    'forms',
    'processes',
    'flows',
    'pluginSteps',
    'customApis',
    'duplicateRules',
    'fieldSecurity',
    'apps',
    'dependencies',
    'views',
];

export interface SourceError {
    source: SourceName;
    message: string;
    /** `permission` when the failure looks like a 403 / missing privilege. */
    kind: 'permission' | 'error' | 'aborted';
}

export interface TableRef {
    logicalName: string;
    entitySetName: string;
    metadataId: string;
    displayName: string;
    primaryIdAttribute?: string;
    primaryNameAttribute?: string;
    /** Object type code, when known (used for classic maker URLs). */
    objectTypeCode?: number;
}

export interface TableFacts extends TableRef {
    schemaName: string;
    ownership: string;
    isActivity: boolean;
    isCustom: boolean;
    isCustomizable: boolean;
    isBpfEntity: boolean;
    audit: boolean;
    changeTracking: boolean;
    duplicateDetection: boolean;
    hasNotes: boolean;
    hasActivities: boolean;
}

export interface OrgSettings {
    /** organizations.isauditenabled */
    auditEnabled?: boolean;
    /** organizations.isduplicatedetectionenabled */
    duplicateDetectionEnabled?: boolean;
    /** organizations.isduplicatedetectionenabledforonlinecreateupdate */
    duplicateDetectionOnCreateUpdate?: boolean;
}

export interface RelationshipSummary {
    schemaName: string;
    kind: 'OneToMany' | 'ManyToOne' | 'ManyToMany';
    /** The other table. */
    relatedTable: string;
    /** Lookup column (on the child) for 1:N / N:1. */
    referencingAttribute?: string;
    cascade?: Record<string, string>;
    isCustom: boolean;
}

export type Pipeline = Record<string, Record<Stage, LogicItem[]>>;

export interface LogicMapStats {
    requests: number;
    durationMs: number;
    /** Sources that completed (done or error). */
    sourcesDone: SourceName[];
    /** True while sources are still running (partial map from progressive rendering). */
    partial: boolean;
}

export interface LogicMap {
    schemaVersion: typeof SCHEMA_VERSION;
    generatedAt: string;
    environment: { name: string; url: string };
    table: TableFacts;
    org: OrgSettings;
    items: LogicItem[];
    /** Derived from `items`: pipeline[event][stage] sorted by order then name. */
    pipeline: Pipeline;
    columns: Record<string, ColumnInfo>;
    forms: FormInfo[];
    relationships: RelationshipSummary[];
    /** Flows/actions that read or write this table but are not triggered by it. */
    externalTouchers: LogicItem[];
    apps: AppInfo[];
    dependencies: DependencyInfo[];
    views: { total: number; quickFind: number; names: string[] };
    smells: Smell[];
    sourceErrors: SourceError[];
    stats: LogicMapStats;
    /**
     * Redacted raw source data for the Raw tab / fixtures, keyed by source. Excluded from
     * JSON/Markdown exports and from the headless return payload (see `stripRaw`).
     */
    raw?: Partial<Record<SourceName, unknown>>;
}

/** Return a copy of the map without the `raw` payload (used by exports and the headless entry). */
export function stripRaw(map: LogicMap): LogicMap {
    if (!map.raw) return map;
    const { raw: _raw, ...rest } = map;
    return rest;
}

// ---------------------------------------------------------------------------
// Build options / progress
// ---------------------------------------------------------------------------

export type SourceStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface ProgressEvent {
    source: SourceName;
    status: SourceStatus;
    message?: string;
    /** 0..100 across the whole run. */
    percent: number;
}

export interface Logger {
    debug: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
}

export interface BuildOptions {
    /** Include hidden Microsoft/system plugin steps (`ishidden`). Default false. */
    includeSystemSteps?: boolean;
    /** Restrict the pipeline/items to these events (items on other events are dropped). */
    events?: EventName[];
    /** Threshold for the `too-many-sync` smell. Default 5. */
    maxSyncItems?: number;
    /** Environment shown in the header/export. */
    environment?: { name: string; url: string };
    progress?: (event: ProgressEvent) => void;
    /** Called with a re-classified partial map after each source completes (progressive rendering). */
    onPartial?: (map: LogicMap) => void;
    signal?: AbortSignal;
    logger?: Logger;
    /** Injectable clock for deterministic tests. */
    now?: () => Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isCustomEvent(event: EventName): event is `Custom:${string}` {
    return event.startsWith('Custom:');
}

export function isMessageEvent(event: EventName): event is `Message:${string}` {
    return event.startsWith('Message:');
}

/** Sort key for events: well-known first (in EVENT_ORDER), then Custom:, then Message:, alphabetically. */
export function eventSortKey(event: EventName): string {
    const idx = EVENT_ORDER.indexOf(event as WellKnownEvent);
    if (idx >= 0) return `0${String(idx).padStart(3, '0')}`;
    if (isCustomEvent(event)) return `1${event}`;
    return `2${event}`;
}

export function compareEvents(a: EventName, b: EventName): number {
    return eventSortKey(a).localeCompare(eventSortKey(b));
}

/** Stable, deterministic item comparison: order (rank) then name then id. */
export function compareItems(a: LogicItem, b: LogicItem): number {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return a.id.localeCompare(b.id);
}

export function emptyPipelineRow(): Record<Stage, LogicItem[]> {
    return {
        client: [],
        prevalidation: [],
        preoperation: [],
        mainoperation: [],
        postoperation: [],
        postcommit: [],
        always: [],
    };
}

export function createEmptyMap(table: TableFacts, environment: { name: string; url: string }, generatedAt: string): LogicMap {
    return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt,
        environment,
        table,
        org: {},
        items: [],
        pipeline: {},
        columns: {},
        forms: [],
        relationships: [],
        externalTouchers: [],
        apps: [],
        dependencies: [],
        views: { total: 0, quickFind: 0, names: [] },
        smells: [],
        sourceErrors: [],
        stats: { requests: 0, durationMs: 0, sourcesDone: [], partial: true },
    };
}

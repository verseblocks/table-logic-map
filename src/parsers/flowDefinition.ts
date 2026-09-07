/**
 * Cloud flow definition parser (design guide §5.7, docs/verified.md #6).
 *
 * `workflow.clientdata` of a cloud flow (category 5) is the Logic Apps workflow definition wrapped as
 * `{ properties: { connectionReferences, definition }, schemaVersion }`. This module extracts only
 * what the logic map needs — which table triggers the flow and which tables its actions touch — and
 * never copies action parameters into the summary (they may embed hard-coded secrets).
 *
 * Pure function: no Dataverse access, no DOM. Never throws on malformed input.
 */
import { DATAVERSE_CONNECTOR_IDS, FLOW_TABLE_OPERATIONS } from '../domain/codes';
import { splitAttributeList } from '../sources/types';

export interface FlowTrigger {
    /**
     * `row`: "When a row is added, modified or deleted" (`subscriptionRequest/*` parameters).
     * `action`: "When an action is performed" (custom API / action message).
     * `rowSelected`: "When a row is selected" (instant flow from a grid/form).
     * `other`: any other trigger (manual, recurrence, non-Dataverse connector, ...).
     */
    kind: 'row' | 'action' | 'rowSelected' | 'other';
    /** Trigger key in `definition.triggers` (the designer-visible name with `_` for spaces). */
    name: string;
    operationId?: string;
    /** Table logical name (`subscriptionRequest/entityname` or `entityname`). `none` = unbound action. */
    entityName?: string;
    /** `subscriptionRequest/message`: 1 Create, 2 Delete, 3 Update, 4 Create+Update, 5 Create+Delete, 6 Update+Delete, 7 all. */
    message?: number;
    /** Sorted, lower-cased, de-duplicated `subscriptionRequest/filteringattributes`; undefined when the parameter is absent. */
    filteringAttributes?: string[];
    /** `subscriptionRequest/scope`: 1 User, 2 Business Unit, 3 Parent: Child BUs, 4 Organization. */
    scope?: number;
    /** `subscriptionRequest/filterexpression` (OData filter evaluated server-side before the flow runs). */
    filterExpression?: string;
    /** `subscriptionRequest/runas`: 1 Flow owner, 2 Row owner, 3 Modifying user (raw value kept). */
    runAs?: number | string;
    /** SDK message name of an action-performed trigger (`sdkMessageName`). */
    sdkMessageName?: string;
    /** True when the trigger uses the Dataverse connector (current or legacy). */
    isDataverse?: boolean;
    /** Connector api name, e.g. `shared_commondataserviceforapps`, `shared_office365`. */
    connector?: string;
}

export interface FlowTableAction {
    /** Container path joined by `/`, e.g. `Scope_Notify/Condition_budget/else/List_tasks`. */
    path: string;
    /** Action key in its `actions` map. */
    name: string;
    operationId: string;
    /** Current connector: the ENTITY SET name (`contoso_projects`); legacy connector: the `table` parameter. */
    entityName: string;
    kind: 'read' | 'write';
    /** `parameters.actionName` of a `PerformBoundAction`. */
    actionName?: string;
    /** Designer label of the operation (from `FLOW_TABLE_OPERATIONS`). */
    label?: string;
    /** Connector api name that served the action. */
    connector?: string;
}

export interface FlowConnectionReference {
    /** Key in `properties.connectionReferences` (also the `host.connectionName` used by actions). */
    key: string;
    /** `api.name`, e.g. `shared_commondataserviceforapps`. */
    apiName?: string;
    /** `connection.connectionReferenceLogicalName` (solution connection reference). */
    logicalName?: string;
}

export interface FlowDefinitionSummary {
    triggers: FlowTrigger[];
    /** Dataverse actions that touch a table, in document order (depth-first). */
    actionsOnTables: FlowTableAction[];
    /** Sorted, unique connection reference keys. */
    connectionReferences: string[];
    /** Number of actions of any type at any depth (containers included). */
    actionCount: number;
    /** Sorted by `key`. */
    connectionReferenceDetails?: FlowConnectionReference[];
}

type JsonObject = Record<string, unknown>;

/** Normalised connection-reference lookup shared by the trigger and action walkers. */
interface ParseContext {
    /** Lower-cased key → reference. */
    refs: ReadonlyMap<string, FlowConnectionReference>;
    /** `host.connectionName` values encountered (fallback when `connectionReferences` is absent). */
    connectionNames: Set<string>;
    actionCount: number;
    actionsOnTables: FlowTableAction[];
}

const SUBSCRIPTION_PREFIX = 'subscriptionrequest/';

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function asObject(value: unknown): JsonObject | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function asString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

/** Numbers arrive as JSON numbers from the designer but as strings from some solution exports. */
function asNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)) return Number(value);
    return undefined;
}

/** Parameter lookup tolerant of key casing (`entityname` vs `entityName`, `subscriptionRequest/...`). */
function param(params: JsonObject, key: string): unknown {
    if (Object.hasOwn(params, key)) return params[key];
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(params)) if (k.toLowerCase() === lower) return v;
    return undefined;
}

function hasParam(params: JsonObject, key: string): boolean {
    const lower = key.toLowerCase();
    return Object.keys(params).some((k) => k.toLowerCase() === lower);
}

/** Drop `undefined` members so JSON output stays compact and deterministic. */
function compact<T extends object>(value: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
    return out as T;
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Connector detection
// ---------------------------------------------------------------------------

/** Last path segment of an api id such as `/providers/Microsoft.PowerApps/apis/shared_office365`. */
function apiNameFromId(apiId: string): string {
    const segments = apiId.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? apiId;
}

/** True for the current (`shared_commondataserviceforapps`) and legacy (`shared_commondataservice`) connector ids, with optional `_1`-style suffix. */
function isDataverseApiName(name: string | undefined): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return DATAVERSE_CONNECTOR_IDS.some((id) => lower === id || lower.startsWith(`${id}_`) || lower.startsWith(`${id}-`));
}

interface ConnectorInfo {
    isDataverse: boolean;
    connector?: string;
}

/**
 * Identify the connector behind `inputs.host`: by `apiId` when present, otherwise by resolving
 * `connectionName` through `properties.connectionReferences` (solution exports omit `apiId`).
 */
function detectConnector(host: JsonObject | undefined, ctx: ParseContext): ConnectorInfo {
    const apiId = asString(host?.apiId);
    const connectionName = asString(host?.connectionName);
    if (connectionName) ctx.connectionNames.add(connectionName);
    const ref = connectionName ? ctx.refs.get(connectionName.toLowerCase()) : undefined;
    const fromApiId = apiId ? apiNameFromId(apiId) : undefined;
    const connector = fromApiId ?? ref?.apiName ?? connectionName;
    const isDataverse =
        isDataverseApiName(fromApiId) ||
        isDataverseApiName(ref?.apiName) ||
        // Bare definitions: the connection name itself is usually the api name.
        (!ref?.apiName && isDataverseApiName(connectionName));
    return { isDataverse, connector };
}

function parseConnectionReferences(properties: JsonObject | undefined): FlowConnectionReference[] {
    const map = asObject(properties?.connectionReferences) ?? {};
    const out: FlowConnectionReference[] = [];
    for (const [key, raw] of Object.entries(map)) {
        const ref = asObject(raw);
        const api = asObject(ref?.api);
        const connection = asObject(ref?.connection);
        const apiId = asString(api?.id);
        out.push(
            compact({
                key,
                apiName: asString(api?.name) ?? (apiId ? apiNameFromId(apiId) : undefined),
                logicalName: asString(connection?.connectionReferenceLogicalName),
            }),
        );
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

function parseTrigger(name: string, raw: unknown, ctx: ParseContext): FlowTrigger {
    const trigger = asObject(raw) ?? {};
    const inputs = asObject(trigger.inputs);
    const host = asObject(inputs?.host);
    const params = asObject(inputs?.parameters) ?? {};
    const operationId = asString(host?.operationId);
    const { isDataverse, connector } = detectConnector(host, ctx);
    const base = { name, operationId, isDataverse, connector };

    // "When a row is added, modified or deleted": all inputs live under `subscriptionRequest/*`.
    if (hasParam(params, 'subscriptionRequest/entityname')) {
        const filtering = param(params, 'subscriptionRequest/filteringattributes');
        const runAsRaw = param(params, 'subscriptionRequest/runas');
        return compact({
            ...base,
            kind: 'row',
            entityName: asString(param(params, 'subscriptionRequest/entityname')),
            message: asNumber(param(params, 'subscriptionRequest/message')),
            filteringAttributes: filtering === undefined ? undefined : splitAttributeList(filtering),
            scope: asNumber(param(params, 'subscriptionRequest/scope')),
            filterExpression: asString(param(params, 'subscriptionRequest/filterexpression')),
            runAs: asNumber(runAsRaw) ?? asString(runAsRaw),
        });
    }

    // "When an action is performed": keys matched by presence (docs/verified.md #6).
    if (hasParam(params, 'sdkMessageName') || hasParam(params, 'catalogId') || hasParam(params, 'categoryId')) {
        return compact({
            ...base,
            kind: 'action',
            sdkMessageName: asString(param(params, 'sdkMessageName')),
            entityName: asString(param(params, 'entityname')),
        });
    }

    // "When a row is selected": a Dataverse trigger with a bare `entityname` and no subscription request.
    const hasSubscriptionKeys = Object.keys(params).some((k) => k.toLowerCase().startsWith(SUBSCRIPTION_PREFIX));
    const looksSelected = hasParam(params, 'entityname') || /selected/i.test(operationId ?? '');
    if (isDataverse && !hasSubscriptionKeys && looksSelected) {
        return compact({ ...base, kind: 'rowSelected', entityName: asString(param(params, 'entityname')) });
    }

    return compact({ ...base, kind: 'other' });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Return a table action when this is a Dataverse operation from `FLOW_TABLE_OPERATIONS` with a table parameter. */
function toTableAction(name: string, path: string, action: JsonObject, ctx: ParseContext): FlowTableAction | undefined {
    const inputs = asObject(action.inputs);
    const host = asObject(inputs?.host);
    const operationId = asString(host?.operationId);
    // Connector must be resolved even for non-table operations so connection names are collected.
    const { isDataverse, connector } = detectConnector(host, ctx);
    if (!operationId || !Object.hasOwn(FLOW_TABLE_OPERATIONS, operationId)) return undefined;
    // SharePoint and others reuse ids like `GetItem`/`GetItems`/`PatchItem`; only Dataverse ones count.
    if (!isDataverse) return undefined;
    const op = FLOW_TABLE_OPERATIONS[operationId];
    const params = asObject(inputs?.parameters) ?? {};
    const entityName = asString(param(params, op.entityParam));
    if (!entityName) return undefined;
    return compact({
        path,
        name,
        operationId,
        entityName,
        kind: op.kind,
        actionName: operationId === 'PerformBoundAction' ? asString(param(params, 'actionName')) : undefined,
        label: op.label,
        connector,
    });
}

/**
 * Depth-first walk over an `actions` map in document order. Containers: `Scope`, `Foreach`, `Until`
 * and the true branch of `If` carry `actions`; `If.else`, `Switch.cases[*]` and `Switch.default`
 * nest their own `actions` map. The path gains `else`, the case name or `default` for those.
 */
function walkActions(actions: unknown, prefix: readonly string[], ctx: ParseContext): void {
    const map = asObject(actions);
    if (!map) return;
    for (const [name, raw] of Object.entries(map)) {
        const action = asObject(raw);
        if (!action) continue;
        ctx.actionCount++;
        const path = [...prefix, name];
        const tableAction = toTableAction(name, path.join('/'), action, ctx);
        if (tableAction) ctx.actionsOnTables.push(tableAction);

        walkActions(action.actions, path, ctx);
        const elseBranch = asObject(action.else);
        if (elseBranch) walkActions(elseBranch.actions, [...path, 'else'], ctx);
        const cases = asObject(action.cases);
        if (cases) for (const [caseName, c] of Object.entries(cases)) walkActions(asObject(c)?.actions, [...path, caseName], ctx);
        const defaultCase = asObject(action.default);
        if (defaultCase) walkActions(defaultCase.actions, [...path, 'default'], ctx);
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function emptySummary(): FlowDefinitionSummary {
    return { triggers: [], actionsOnTables: [], connectionReferences: [], actionCount: 0, connectionReferenceDetails: [] };
}

function looksLikeDefinition(value: JsonObject | undefined): value is JsonObject {
    return !!value && (asObject(value.triggers) !== undefined || asObject(value.actions) !== undefined);
}

/** Locate the workflow definition: `properties.definition` (possibly as a JSON string), `definition`, or the root itself. */
function findDefinition(root: JsonObject, properties: JsonObject | undefined): JsonObject | undefined {
    const candidates: unknown[] = [properties?.definition, root.definition];
    for (const candidate of candidates) {
        const obj = asObject(candidate) ?? (typeof candidate === 'string' ? asObject(parseJson(candidate)) : undefined);
        if (looksLikeDefinition(obj)) return obj;
    }
    return looksLikeDefinition(root) ? root : undefined;
}

/**
 * Summarise a cloud flow `clientdata` (JSON string or already-parsed object). Also accepts a bare
 * workflow definition (`{ triggers, actions }`). Invalid JSON or a missing definition yields an
 * empty summary; the function never throws.
 */
export function parseFlowDefinition(clientData: string | Record<string, unknown> | null | undefined): FlowDefinitionSummary {
    const root = typeof clientData === 'string' ? asObject(parseJson(clientData)) : asObject(clientData);
    if (!root) return emptySummary();
    const properties = asObject(root.properties);
    const definition = findDefinition(root, properties);
    if (!definition) return emptySummary();

    const details = parseConnectionReferences(properties);
    const ctx: ParseContext = {
        refs: new Map(details.map((ref) => [ref.key.toLowerCase(), ref])),
        connectionNames: new Set(),
        actionCount: 0,
        actionsOnTables: [],
    };

    const triggers = Object.entries(asObject(definition.triggers) ?? {}).map(([name, raw]) => parseTrigger(name, raw, ctx));
    walkActions(definition.actions, [], ctx);

    // Without a `connectionReferences` block (bare definitions) fall back to the connection names actually used.
    const connectionReferenceDetails = details.length > 0 ? details : [...ctx.connectionNames].sort().map((key) => ({ key }));

    return {
        triggers,
        actionsOnTables: ctx.actionsOnTables,
        connectionReferences: [...new Set(connectionReferenceDetails.map((ref) => ref.key))].sort(),
        actionCount: ctx.actionCount,
        connectionReferenceDetails,
    };
}

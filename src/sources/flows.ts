/**
 * Cloud flows (`workflow` rows with `category` 5 / `type` 1) that are triggered by the table or
 * touch it through Dataverse connector actions.
 *
 * Dataverse semantics used here (design guide §5.6/§5.7, docs/verified.md #6):
 *  - A cloud flow's `primaryentity` is usually `none`, so every cloud flow in the environment is
 *    loaded (paged) and its `clientdata` (Logic Apps definition) is parsed by
 *    `parsers/flowDefinition.ts`. The definition may embed hard-coded secrets in action parameters,
 *    so it is NEVER copied into items or the raw output — only the summary is kept.
 *  - "When a row is added, modified or deleted" fires after commit through the async service:
 *    `message` 1..7 encodes Create/Update/Delete combinations, `filteringattributes` narrow Update,
 *    `filterexpression` is evaluated server-side, `scope` and `runas` mirror workflow settings.
 *  - "When an action is performed" hooks a custom API / action message (`Custom:<sdkMessageName>`);
 *    "When a row is selected" is an instant flow started from a grid or form.
 *  - Actions name tables by ENTITY SET name (`contoso_projects`), the trigger by logical name.
 *  - Flows not triggered by the table but with actions on it become `externalTouchers`.
 */
import type { Row } from '../data/client';
import { FLOW_MESSAGE_TO_EVENTS, FLOW_RUN_AS_LABEL, FLOW_SCOPE_LABEL, WORKFLOW_CATEGORY, WORKFLOW_STATE_LABEL, WORKFLOW_TYPE_DEFINITION } from '../domain/codes';
import { compareItems, type Confidence, type EventName, type LogicItem, type TableRef } from '../domain/model';
import { parseFlowDefinition, type FlowDefinitionSummary, type FlowTableAction, type FlowTrigger } from '../parsers/flowDefinition';
import type { Source, SourceContext, SourceResult } from './types';
import { recordUrl, str } from './types';

// Code table lives in domain/codes.ts; re-exported so existing consumers keep working.
export { FLOW_RUN_AS_LABEL };
// workflow.statecode 1 = Activated (flow is "on")
const WORKFLOW_STATE_ACTIVATED = 1;

export const FLOWS_SELECT = 'workflowid,name,statecode,statuscode,clientdata,_ownerid_value,modifiedon,ismanaged,description,uniquename';

export function flowsQuery(): string {
    return `workflows?$select=${FLOWS_SELECT}&$filter=category eq ${WORKFLOW_CATEGORY.CloudFlow} and type eq ${WORKFLOW_TYPE_DEFINITION}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Drop `undefined` members so items compare cleanly and JSON output stays compact. */
function compact<T extends object>(value: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
    return out as T;
}

function byNameThenId(a: Row, b: Row): number {
    return String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.workflowid ?? '').localeCompare(String(b.workflowid ?? ''));
}

/** Actions name the entity set (`contoso_projects`); the legacy connector's `table` usually does too. */
function isThisTable(entityName: string, table: TableRef): boolean {
    const lower = entityName.toLowerCase();
    return lower === table.entitySetName.toLowerCase() || lower === table.logicalName.toLowerCase();
}

export interface TableActionSummary {
    path: string;
    name: string;
    operationId: string;
    kind: 'read' | 'write';
    actionName?: string;
    label?: string;
}

function tableActionSummary(action: FlowTableAction): TableActionSummary {
    return compact({ path: action.path, name: action.name, operationId: action.operationId, kind: action.kind, actionName: action.actionName, label: action.label });
}

function triggerSummary(trigger: FlowTrigger): Record<string, unknown> {
    return compact({
        name: trigger.name,
        kind: trigger.kind,
        entityName: trigger.entityName,
        message: trigger.message,
        sdkMessageName: trigger.sdkMessageName,
        operationId: trigger.operationId,
        connector: trigger.connector,
    });
}

/** One-line trigger description for the Touched-by views (`row:contoso_task`, `action:contoso_Close`, `Recurrence`). */
function triggerLabel(trigger: FlowTrigger): string {
    switch (trigger.kind) {
        case 'row':
            return `row:${trigger.entityName ?? '?'}`;
        case 'action':
            return `action:${trigger.sdkMessageName ?? trigger.entityName ?? '?'}`;
        case 'rowSelected':
            return `rowSelected:${trigger.entityName ?? '?'}`;
        default:
            return trigger.name;
    }
}

function runAsLabel(runAs: number | string | undefined): string | undefined {
    if (typeof runAs === 'number') return FLOW_RUN_AS_LABEL[runAs] ?? String(runAs);
    return runAs;
}

/** Facts shared by every item built from one flow row. */
interface FlowFacts {
    id: string;
    name: string;
    enabled: boolean;
    details: Record<string, unknown>;
    links: NonNullable<LogicItem['links']>;
    source: LogicItem['source'];
}

function flowFacts(row: Row, ctx: SourceContext): FlowFacts | undefined {
    const id = str(row.workflowid);
    if (!id) return undefined;
    const state = num(row.statecode);
    return {
        id,
        name: str(row.name) ?? str(row.uniquename) ?? id,
        enabled: state === WORKFLOW_STATE_ACTIVATED,
        details: compact({
            category: 'Cloud Flow',
            uniqueName: str(row.uniquename),
            owner: str(row['_ownerid_value@OData.Community.Display.V1.FormattedValue']) ?? str(row._ownerid_value),
            ownerId: str(row._ownerid_value),
            modifiedOn: str(row.modifiedon),
            isManaged: row.ismanaged === true,
            state: state === undefined ? undefined : (WORKFLOW_STATE_LABEL[state] ?? String(state)),
            description: str(row.description),
        }),
        links: { record: recordUrl(ctx.environmentUrl, 'workflow', id) },
        source: { table: 'workflow', id },
    };
}

// ---------------------------------------------------------------------------
// Trigger matching
// ---------------------------------------------------------------------------

interface TriggerMatch {
    events: EventName[];
    confidence: Confidence;
    instant?: boolean;
}

/** Decide whether a trigger fires for this table and which events it maps to. */
export function matchTrigger(trigger: FlowTrigger, ctx: Pick<SourceContext, 'table' | 'customApiNames'>): TriggerMatch | undefined {
    const table = ctx.table.logicalName.toLowerCase();
    const entity = trigger.entityName?.toLowerCase();
    switch (trigger.kind) {
        case 'row': {
            if (entity !== table) return undefined;
            const events = trigger.message === undefined ? undefined : FLOW_MESSAGE_TO_EVENTS[trigger.message];
            return { events: events ?? ['Any'], confidence: 'exact' };
        }
        case 'action': {
            // Bound to the table by `entityname`, or a custom API / action known to be bound to it.
            const known = trigger.sdkMessageName !== undefined && ctx.customApiNames.has(trigger.sdkMessageName);
            if (entity !== table && !known) return undefined;
            return { events: [trigger.sdkMessageName ? `Custom:${trigger.sdkMessageName}` : 'Any'], confidence: 'heuristic' };
        }
        case 'rowSelected':
            return entity === table ? { events: ['Any'], confidence: 'exact', instant: true } : undefined;
        default:
            return undefined;
    }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function triggeredItems(facts: FlowFacts, summary: FlowDefinitionSummary, onThisTable: TableActionSummary[], ctx: SourceContext): LogicItem[] {
    const items: LogicItem[] = [];
    for (const trigger of summary.triggers) {
        const match = matchTrigger(trigger, ctx);
        if (!match) continue;
        // `subscriptionRequest/filteringattributes` narrows the *Modified* half of a Dataverse
        // trigger only: a "created or modified" trigger (message 4/6/7) still fires on every Create
        // / Delete. The list is kept in `details` for reference but attached to the Update item only.
        const filtering = trigger.filteringAttributes && trigger.filteringAttributes.length > 0 ? trigger.filteringAttributes : undefined;
        const details = compact({
            ...facts.details,
            trigger: trigger.kind,
            triggerName: trigger.name,
            triggerKind: trigger.kind,
            triggerOperationId: trigger.operationId,
            message: trigger.message,
            messageLabel: trigger.kind === 'row' ? match.events.join(', ') : undefined,
            sdkMessageName: trigger.sdkMessageName,
            scope: trigger.scope === undefined ? undefined : (FLOW_SCOPE_LABEL[trigger.scope] ?? String(trigger.scope)),
            scopeCode: trigger.scope,
            filterExpression: trigger.filterExpression,
            runAs: runAsLabel(trigger.runAs),
            connectionReferences: summary.connectionReferences,
            actionCount: summary.actionCount,
            actionsOnThisTable: onThisTable,
            // Same list under the key the exporters / Touched-by views read.
            actionsOnTable: onThisTable,
            instant: match.instant ? true : undefined,
            triggerFilteringAttributes: filtering,
        });
        for (const event of match.events) {
            items.push(
                compact({
                    id: `${facts.id}:${event}`,
                    kind: 'flow',
                    name: facts.name,
                    event,
                    groupId: facts.id,
                    stage: 'postcommit',
                    enabled: facts.enabled,
                    mode: match.instant ? 'instant' : 'async',
                    filteringAttributes: event === 'Update' ? filtering : undefined,
                    confidence: match.confidence,
                    details,
                    links: facts.links,
                    source: facts.source,
                }),
            );
        }
    }
    return items;
}

function toucherItem(facts: FlowFacts, summary: FlowDefinitionSummary, onThisTable: TableActionSummary[]): LogicItem {
    const kinds = new Set(onThisTable.map((a) => a.kind));
    const access = kinds.has('read') && kinds.has('write') ? 'read/write' : kinds.has('write') ? 'write' : 'read';
    return compact({
        id: `${facts.id}:touches`,
        kind: 'flow',
        name: facts.name,
        event: 'Any',
        groupId: facts.id,
        stage: 'postcommit',
        enabled: facts.enabled,
        mode: 'async',
        confidence: 'exact',
        details: compact({
            ...facts.details,
            access,
            actions: onThisTable,
            actionsOnTable: onThisTable,
            trigger: summary.triggers.map(triggerLabel).join(', ') || undefined,
            triggers: summary.triggers.map(triggerSummary),
            connectionReferences: summary.connectionReferences,
            actionCount: summary.actionCount,
        }),
        links: facts.links,
        source: facts.source,
    });
}

/** Raw-tab copy of a flow row: scalar columns plus the parsed summary, never `clientdata`. */
function rawRow(row: Row, summary: FlowDefinitionSummary): Row {
    return {
        workflowid: row.workflowid,
        name: row.name,
        statecode: row.statecode,
        statuscode: row.statuscode,
        uniquename: row.uniquename,
        ismanaged: row.ismanaged,
        modifiedon: row.modifiedon,
        _ownerid_value: row._ownerid_value,
        triggers: summary.triggers.map(triggerSummary),
        tableActions: summary.actionsOnTables.map((a) => ({ path: a.path, operationId: a.operationId, entityName: a.entityName, kind: a.kind })),
        actionCount: summary.actionCount,
    };
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export const flowsSource: Source = {
    name: 'flows',
    // `customApis` AND `processes` populate ctx.customApiNames (custom API messages and classic
    // Action unique names respectively), so action-performed triggers are matched by message name
    // the same way on every run. Without the `processes` dependency the mapping depended on which
    // source happened to finish first.
    after: ['customApis', 'processes'],
    async run(ctx: SourceContext): Promise<SourceResult> {
        const rows = await ctx.client.query(flowsQuery(), { signal: ctx.signal });
        const sorted = rows.filter((r) => str(r.workflowid)).sort(byNameThenId);

        const items: LogicItem[] = [];
        const externalTouchers: LogicItem[] = [];
        const raw: Row[] = [];
        let unreadable = 0;
        for (const row of sorted) {
            const facts = flowFacts(row, ctx);
            if (!facts) continue;
            // Never throws: invalid or missing clientdata yields an empty summary (no triggers, no actions).
            const summary = parseFlowDefinition(str(row.clientdata));
            if (summary.triggers.length === 0 && summary.actionCount === 0) unreadable++;
            raw.push(rawRow(row, summary));

            const onThisTable = summary.actionsOnTables.filter((a) => isThisTable(a.entityName, ctx.table)).map(tableActionSummary);
            const triggered = triggeredItems(facts, summary, onThisTable, ctx);
            if (triggered.length > 0) items.push(...triggered);
            else if (onThisTable.length > 0) externalTouchers.push(toucherItem(facts, summary, onThisTable));
        }

        const seen = new Set<string>();
        const unique = items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true))).sort(compareItems);
        externalTouchers.sort(compareItems);
        return {
            items: unique,
            externalTouchers,
            raw,
            warnings: unreadable > 0 ? [`${unreadable} cloud flow(s) could not be parsed (empty or invalid flow JSON) and were skipped`] : undefined,
        };
    },
};

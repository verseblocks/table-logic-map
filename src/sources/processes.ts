/**
 * Processes on the table: `workflow` definitions (`type` 1) whose `primaryentity` is the table —
 * classic workflows, actions, business rules and business process flows. Cloud, desktop and AI
 * flows (categories 5–7) are handled by `flows.ts` because their `primaryentity` is usually `none`.
 *
 * Dataverse semantics used here (design guide §5.6, docs/verified.md #3/#4):
 *  - Classic workflows (category 0) fire on `triggeroncreate` / `triggerondelete` /
 *    `triggeronupdateattributelist` (comma list of columns; `ownerid` or `statecode` in that list
 *    means the workflow also fires on Assign / SetState). Real-time workflows (`mode` 1) run
 *    synchronously in the stage chosen in the designer (`createstage` / `updatestage` /
 *    `deletestage`: 20 before, 40 after); background workflows run through the async service after
 *    commit. `ondemand` workflows can also be started manually; `subprocess` ones by other processes.
 *  - Actions (category 3) are SDK messages (`Custom:<uniquename>`): invoked, never triggered.
 *  - Business rules (category 2) run on the form (FormLoad + FieldChange). `formid` (an `Edm.Guid`
 *    property, not a lookup) scopes a rule to one form; `scope` 2 means entity scope, which also
 *    runs server-side on Create/Update. Should an environment reject `formid`/`rank` in `$select`,
 *    the query is retried without them.
 *  - BPFs (category 4) belong to a primary entity but their stages can span other tables, so a
 *    second query looks for BPFs on other tables that include this one in a stage.
 *  - `xaml` / `clientdata` are parsed by `src/parsers` and never copied into items or raw output.
 */
import { classifyError, errorMessage, odataString, type Row } from '../data/client';
import { BUSINESS_RULE_SCOPE_ENTITY, WORKFLOW_CATEGORY, WORKFLOW_CATEGORY_LABEL, WORKFLOW_MODE, WORKFLOW_RUN_AS_LABEL, WORKFLOW_SCOPE_LABEL, WORKFLOW_STAGE_TO_STAGE, WORKFLOW_STATE_LABEL, WORKFLOW_TYPE_DEFINITION } from '../domain/codes';
import { STAGE_LABEL, compareItems, type EventName, type ExecutionMode, type LogicItem, type Stage } from '../domain/model';
import { parseBpfDefinition, type BpfSummary } from '../parsers/bpfDefinition';
import { parseBusinessRuleXaml } from '../parsers/businessRuleXaml';
import { parseWorkflowXaml } from '../parsers/workflowXaml';
import type { Source, SourceContext, SourceResult } from './types';
import { recordUrl, splitAttributeList, str } from './types';

// Code tables live in domain/codes.ts; re-exported so existing consumers keep working.
export { WORKFLOW_RUN_AS_LABEL, BUSINESS_RULE_SCOPE_ENTITY };
// workflow.statecode 1 = Activated
const WORKFLOW_STATE_ACTIVATED = 1;
export const FORMID_WARNING = 'workflow.formid not available; business-rule form scoping unknown';
export const SERVER_SIDE_NOTE = 'Entity-scoped business rules also run server-side';

const SELECT_HEAD =
    'workflowid,name,category,type,primaryentity,statecode,statuscode,mode,scope,uniquename,description,ismanaged,ondemand,subprocess,triggeroncreate,triggerondelete,triggeronupdateattributelist,createstage,updatestage,deletestage,runas,asyncautodelete,rendererobjecttypecode,clientdata,xaml,_ownerid_value';

/**
 * Columns dropped by the retry when a request comes back 400. `formid` is an `Edm.Guid` property
 * on `workflow` (NOT a lookup: there is no `_formid_value`, docs/verified.md #3), and `rank` is the
 * real-time workflow's Execution order. Both are read directly from the row.
 */
const OPTIONAL_SELECT = ['formid', 'rank'];

/** Main query; `withFormId: false` is the retry shape used when `formid`/`rank` are rejected. */
export function processesQuery(table: string, options: { withFormId?: boolean; withOptional?: boolean } = {}): string {
    const includeOptional = options.withOptional ?? options.withFormId ?? true;
    const select = [SELECT_HEAD, ...(includeOptional ? OPTIONAL_SELECT : []), 'modifiedon'].join(',');
    return `workflows?$select=${select}&$filter=type eq ${WORKFLOW_TYPE_DEFINITION} and primaryentity eq ${odataString(table)}`;
}

/** BPFs whose primary entity is another table (they may still include this table in a stage). */
export function otherEntityBpfQuery(table: string): string {
    return `workflows?$select=workflowid,name,statecode,primaryentity,uniquename,xaml,clientdata,ismanaged&$filter=category eq ${WORKFLOW_CATEGORY.BusinessProcessFlow} and type eq ${WORKFLOW_TYPE_DEFINITION} and primaryentity ne ${odataString(table)}`;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function codeLabel(table: Record<number, string>, value: unknown): string | undefined {
    const code = num(value);
    return code === undefined ? undefined : (table[code] ?? String(code));
}

/** Drop `undefined` members so items compare cleanly and JSON output stays compact. */
function compact<T extends object>(value: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v;
    return out as T;
}

const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

/** A GUID column value, or `undefined` when it is absent / the all-zero GUID. */
function guidOrUndefined(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const id = value.replace(/[{}]/g, '').trim();
    return id.length === 0 || id.toLowerCase() === EMPTY_GUID ? undefined : id;
}

function uniqueSorted(values: Iterable<string>): string[] {
    return [...new Set(values)].sort();
}

function byNameThenId(a: Row, b: Row): number {
    return String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.workflowid ?? '').localeCompare(String(b.workflowid ?? ''));
}

/** Raw-tab copy of a row: everything except the (large, possibly sensitive) definitions. */
function redactRow(row: Row): Row {
    const { xaml: _xaml, clientdata: _clientdata, ...rest } = row;
    return rest;
}

/** Facts shared by every item built from one workflow row. */
interface RowFacts {
    id: string;
    name: string;
    enabled: boolean;
    details: Record<string, unknown>;
    links: NonNullable<LogicItem['links']>;
    source: LogicItem['source'];
}

function rowFacts(row: Row, ctx: SourceContext): RowFacts | undefined {
    const id = str(row.workflowid);
    if (!id) return undefined;
    const category = num(row.category);
    return {
        id,
        name: str(row.name) ?? str(row.uniquename) ?? id,
        enabled: num(row.statecode) === WORKFLOW_STATE_ACTIVATED,
        details: compact({
            category: category === undefined ? undefined : (WORKFLOW_CATEGORY_LABEL[category] ?? String(category)),
            uniqueName: str(row.uniquename),
            // The formatted-value annotation carries the owner's name when annotations are returned.
            owner: str(row['_ownerid_value@OData.Community.Display.V1.FormattedValue']) ?? str(row._ownerid_value),
            ownerId: str(row._ownerid_value),
            modifiedOn: str(row.modifiedon),
            isManaged: row.ismanaged === true,
            state: codeLabel(WORKFLOW_STATE_LABEL, row.statecode),
            description: str(row.description),
        }),
        links: { record: recordUrl(ctx.environmentUrl, 'workflow', id) },
        source: { table: 'workflow', id },
    };
}

// ---------------------------------------------------------------------------
// Classic workflows (category 0)
// ---------------------------------------------------------------------------

export function workflowItems(row: Row, facts: RowFacts, ctx: SourceContext): LogicItem[] {
    const realtime = num(row.mode) === WORKFLOW_MODE.RealTime;
    // Execution order of a real-time workflow (`workflow.rank`): Dataverse runs it inside the
    // synchronous pipeline like a plugin step of that rank (docs/verified.md #10). Background
    // workflows run after commit, where rank is meaningless, so they carry no order.
    const rank = realtime ? num(row.rank) : undefined;
    const parsed = parseWorkflowXaml(str(row.xaml), ctx.knownColumns, { primaryEntity: ctx.table.logicalName });
    const updateAttributes = splitAttributeList(row.triggeronupdateattributelist);
    const triggerOnCreate = row.triggeroncreate === true;
    const triggerOnDelete = row.triggerondelete === true;
    const onDemand = row.ondemand === true;
    const subprocess = row.subprocess === true;

    // Real-time: the designer's before/after choice (20/40); background: always after commit.
    // Delete can only run before the operation, hence its fallback.
    const stageFor = (code: unknown, fallback: Stage): Stage => (realtime ? (WORKFLOW_STAGE_TO_STAGE[num(code) ?? -1] ?? fallback) : 'postcommit');
    const createStage = stageFor(row.createstage, 'postoperation');
    const updateStage = stageFor(row.updatestage, 'postoperation');
    const deleteStage = stageFor(row.deletestage, 'preoperation');

    const details = compact({
        ...facts.details,
        workflowMode: realtime ? 'Real-time' : 'Background',
        scope: codeLabel(WORKFLOW_SCOPE_LABEL, row.scope),
        runAs: codeLabel(WORKFLOW_RUN_AS_LABEL, row.runas),
        asyncAutoDelete: row.asyncautodelete === true,
        onDemand,
        subprocess,
        triggerOnCreate,
        triggerOnDelete,
        triggerOnUpdateAttributes: updateAttributes,
        createStage: triggerOnCreate ? STAGE_LABEL[createStage] : undefined,
        updateStage: updateAttributes.length > 0 ? STAGE_LABEL[updateStage] : undefined,
        deleteStage: triggerOnDelete ? STAGE_LABEL[deleteStage] : undefined,
        steps: parsed.stepLabels ?? parsed.steps,
        activities: parsed.activities,
        reads: parsed.reads,
        writes: parsed.writes,
        createsEntities: parsed.createsEntities,
    });
    const touches = parsed.touchesColumns;
    const make = (event: EventName, stage: Stage, extra: Record<string, unknown> = {}, mode: ExecutionMode = realtime ? 'realtime' : 'background'): LogicItem =>
        compact({
            id: `${facts.id}:${event}`,
            kind: 'workflow',
            name: facts.name,
            event,
            groupId: facts.id,
            stage,
            order: rank,
            enabled: facts.enabled,
            mode,
            touchesColumns: touches.length > 0 ? touches : undefined,
            confidence: touches.length > 0 ? 'heuristic' : 'exact',
            details: { ...details, ...extra },
            links: facts.links,
            source: facts.source,
        });

    const items: LogicItem[] = [];
    if (triggerOnCreate) items.push(make('Create', createStage));
    if (updateAttributes.length > 0) {
        items.push({ ...make('Update', updateStage), filteringAttributes: updateAttributes });
        // Assign and SetState are Update triggers in disguise: the designer adds ownerid / statecode to the list.
        if (updateAttributes.includes('ownerid')) items.push(make('Assign', updateStage, { derivedFrom: 'ownerid in triggeronupdateattributelist' }));
        if (updateAttributes.includes('statecode')) items.push(make('SetState', updateStage, { derivedFrom: 'statecode in triggeronupdateattributelist' }));
    }
    if (triggerOnDelete) items.push(make('Delete', deleteStage));
    if (onDemand || items.length === 0) {
        // Started by a user (on demand), by a parent process (child workflow) or not at all.
        const note = onDemand ? 'On demand: runs when a user or another process starts it' : subprocess ? 'Child process: started by other processes' : 'No automatic trigger configured';
        const mode: ExecutionMode = onDemand ? 'instant' : realtime ? 'realtime' : 'background';
        items.push(make('Any', realtime ? 'mainoperation' : 'postcommit', { note }, mode));
    }
    return items;
}

// ---------------------------------------------------------------------------
// Actions (category 3)
// ---------------------------------------------------------------------------

export function actionItem(row: Row, facts: RowFacts, ctx: SourceContext): LogicItem {
    const uniqueName = str(row.uniquename) ?? facts.name;
    const parsed = parseWorkflowXaml(str(row.xaml), ctx.knownColumns, { primaryEntity: ctx.table.logicalName });
    const touches = parsed.touchesColumns;
    return compact({
        id: facts.id,
        kind: 'action',
        name: facts.name,
        event: `Custom:${uniqueName}`,
        stage: 'mainoperation',
        enabled: facts.enabled,
        mode: 'sync',
        touchesColumns: touches.length > 0 ? touches : undefined,
        confidence: touches.length > 0 ? 'heuristic' : 'exact',
        details: compact({
            ...facts.details,
            uniqueName,
            note: 'Invoked, not triggered',
            scope: codeLabel(WORKFLOW_SCOPE_LABEL, row.scope),
            runAs: codeLabel(WORKFLOW_RUN_AS_LABEL, row.runas),
            steps: parsed.stepLabels ?? parsed.steps,
            activities: parsed.activities,
            reads: parsed.reads,
            writes: parsed.writes,
            createsEntities: parsed.createsEntities,
        }),
        links: facts.links,
        source: facts.source,
    });
}

// ---------------------------------------------------------------------------
// Business rules (category 2)
// ---------------------------------------------------------------------------

export type BusinessRuleScope = 'form' | 'allforms' | 'entity';

/** `_formid_value` → one form; `scope` 2 → entity (server-side too); another scope code → all forms. */
export function businessRuleScope(formId: string | undefined, scopeCode: number | undefined): BusinessRuleScope {
    if (formId) return 'form';
    if (scopeCode === BUSINESS_RULE_SCOPE_ENTITY || scopeCode === undefined) return 'entity';
    return 'allforms';
}

export function businessRuleItems(row: Row, facts: RowFacts, ctx: SourceContext, formIdAvailable: boolean): LogicItem[] {
    const parsed = parseBusinessRuleXaml(str(row.xaml), ctx.knownColumns);
    // `workflow.formid` is a plain Edm.Guid column; `_formid_value` is only read as a defensive
    // fallback in case an environment ever exposes the same fact as a lookup annotation. An
    // all-zero GUID means "no form" just like null.
    const formId = guidOrUndefined(str(row.formid) ?? str(row._formid_value));
    const scopeCode = num(row.scope);
    const scope = businessRuleScope(formId, scopeCode);
    const details = compact({
        ...facts.details,
        // `formId` null = not scoped to a single form (the classifier attaches such rules to every form).
        formId: formId ?? null,
        scope,
        scopeCode: scopeCode ?? null,
        actions: parsed.actions,
        conditionColumns: parsed.conditionColumns,
        branches: parsed.branches,
        steps: parsed.stepLabels,
        note: formIdAvailable ? undefined : FORMID_WARNING,
    });
    const shared = {
        kind: 'businessrule' as const,
        name: facts.name,
        groupId: facts.id,
        enabled: facts.enabled,
        touchesColumns: parsed.touchesColumns.length > 0 ? parsed.touchesColumns : undefined,
        confidence: 'heuristic' as const,
        links: facts.links,
        source: facts.source,
    };
    const items: LogicItem[] = [
        compact({ ...shared, id: `${facts.id}:FormLoad`, event: 'FormLoad', stage: 'client', mode: 'client', details }),
        compact({
            ...shared,
            id: `${facts.id}:FieldChange`,
            event: 'FieldChange',
            stage: 'client',
            mode: 'client',
            filteringAttributes: parsed.conditionColumns.length > 0 ? parsed.conditionColumns : undefined,
            details,
        }),
    ];
    if (scope === 'entity') {
        // Entity-scoped rules are also evaluated by the server on Create/Update (before the operation).
        const serverDetails = { ...details, serverSide: true, note: SERVER_SIDE_NOTE };
        for (const event of ['Create', 'Update'] as const) {
            items.push(compact({ ...shared, id: `${facts.id}:${event}`, event, stage: 'preoperation', mode: 'sync', details: serverDetails }));
        }
    }
    return items;
}

// ---------------------------------------------------------------------------
// Business process flows (category 4)
// ---------------------------------------------------------------------------

export function bpfItem(row: Row, facts: RowFacts, ctx: SourceContext, parsed: BpfSummary, role: 'primary' | 'stage'): LogicItem {
    const table = ctx.table.logicalName;
    const stagesHere = parsed.stages.filter((s) => !s.entity || s.entity === table);
    const fields = uniqueSorted(stagesHere.flatMap((s) => s.fields ?? [])).filter((c) => ctx.knownColumns.size === 0 || ctx.knownColumns.has(c));
    return compact({
        id: facts.id,
        kind: 'bpf',
        name: facts.name,
        event: 'Any',
        stage: 'client',
        enabled: facts.enabled,
        mode: 'client',
        touchesColumns: fields.length > 0 ? fields : undefined,
        confidence: parsed.confidence,
        details: compact({
            ...facts.details,
            role,
            primaryEntity: str(row.primaryentity),
            stages: parsed.stages,
            stagesOnThisTable: stagesHere.map((s) => s.name),
            entities: parsed.entities,
            relationships: parsed.relationships ?? [],
            fields: parsed.fields ?? [],
        }),
        links: facts.links,
        source: facts.source,
    });
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface LoadedProcesses {
    rows: Row[];
    formIdAvailable: boolean;
    warnings: string[];
}

/**
 * Main query with the optional-column retry. The happy path selects `formid` and `rank`, which both
 * exist on `workflow`; the retry is a safety net for environments that reject them. PPTB surfaces
 * 400s as plain `HTTP 400` (often without the offending property name), so any bad request triggers
 * one retry without those columns; a second failure propagates as usual.
 */
async function loadProcesses(ctx: SourceContext): Promise<LoadedProcesses> {
    const table = ctx.table.logicalName;
    const opts = { signal: ctx.signal };
    try {
        return { rows: await ctx.client.query(processesQuery(table), opts), formIdAvailable: true, warnings: [] };
    } catch (err) {
        if (classifyError(err) !== 'badrequest') throw err;
        ctx.logger.warn(`processes: query rejected (${errorMessage(err)}); retrying without formid/rank`);
    }
    const rows = await ctx.client.query(processesQuery(table, { withOptional: false }), opts);
    return { rows, formIdAvailable: false, warnings: [FORMID_WARNING] };
}

/** BPFs on other tables; a failure here degrades to a warning rather than losing every process. */
async function loadOtherEntityBpfs(ctx: SourceContext, warnings: string[]): Promise<Row[]> {
    try {
        return await ctx.client.query(otherEntityBpfQuery(ctx.table.logicalName), { signal: ctx.signal });
    } catch (err) {
        if (classifyError(err) === 'aborted') throw err;
        warnings.push(`Business process flows on other tables could not be loaded: ${errorMessage(err)}`);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export const processesSource: Source = {
    name: 'processes',
    async run(ctx: SourceContext): Promise<SourceResult> {
        const warnings: string[] = [];
        const [primary, otherBpfRows] = await Promise.all([loadProcesses(ctx), loadOtherEntityBpfs(ctx, warnings)]);
        warnings.push(...primary.warnings);
        const table = ctx.table.logicalName;

        const items: LogicItem[] = [];
        const customApiNames = new Set<string>();
        const rows = primary.rows.filter((r) => str(r.workflowid)).sort(byNameThenId);
        for (const row of rows) {
            const facts = rowFacts(row, ctx);
            if (!facts) continue;
            switch (num(row.category)) {
                case WORKFLOW_CATEGORY.Workflow:
                    items.push(...workflowItems(row, facts, ctx));
                    break;
                case WORKFLOW_CATEGORY.BusinessRule:
                    items.push(...businessRuleItems(row, facts, ctx, primary.formIdAvailable));
                    break;
                case WORKFLOW_CATEGORY.Action: {
                    const item = actionItem(row, facts, ctx);
                    items.push(item);
                    const uniqueName = str(row.uniquename);
                    if (uniqueName) customApiNames.add(uniqueName);
                    break;
                }
                case WORKFLOW_CATEGORY.BusinessProcessFlow:
                    items.push(bpfItem(row, facts, ctx, parseBpfDefinition(str(row.clientdata), str(row.xaml)), 'primary'));
                    break;
                default:
                    // Dialogs (1) are retired; cloud/desktop/AI flows (5–7) belong to `flows`.
                    break;
            }
        }

        // BPFs owned by another table that walk through this one in a stage.
        const includedBpfs: Row[] = [];
        for (const row of otherBpfRows.filter((r) => str(r.workflowid)).sort(byNameThenId)) {
            const facts = rowFacts(row, ctx);
            if (!facts) continue;
            const parsed = parseBpfDefinition(str(row.clientdata), str(row.xaml));
            if (!parsed.entities.includes(table)) continue;
            includedBpfs.push(row);
            items.push(bpfItem(row, facts, ctx, parsed, 'stage'));
        }

        const seen = new Set<string>();
        const unique = items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true))).sort(compareItems);
        return {
            items: unique,
            customApiNames: [...customApiNames].sort(),
            warnings: warnings.length > 0 ? warnings : undefined,
            raw: { workflows: rows.map(redactRow), bpfsOnOtherTables: includedBpfs.map(redactRow) },
        };
    },
};

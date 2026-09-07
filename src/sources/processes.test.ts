import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataverseRequestError, type Row } from '../data/client';
import type { LogicItem } from '../domain/model';
import { FORMID_WARNING, SERVER_SIDE_NOTE, businessRuleScope, otherEntityBpfQuery, processesQuery, processesSource } from './processes';
import { SAMPLE_ENVIRONMENT_URL, makeCtx, makeFakeClient, type FakeRoute } from './testUtils';

const WORKFLOW_XAML = readFileSync(join(__dirname, '../fixtures/workflow.realtime.xaml'), 'utf8');
const BUSINESS_RULE_XAML = readFileSync(join(__dirname, '../fixtures/businessrule.form.xaml'), 'utf8');
const BPF_XAML = readFileSync(join(__dirname, '../fixtures/bpf.leadtoopportunity.xaml'), 'utf8');

const OWNER = 'u1000000-0000-4000-8000-000000000001';
const FORM_ID = 'f1000000-0000-4000-8000-000000000001';
const IDS = {
    realtime: 'a1000000-0000-4000-8000-000000000001',
    background: 'a2000000-0000-4000-8000-000000000002',
    brForm: 'b1000000-0000-4000-8000-000000000001',
    brEntity: 'b2000000-0000-4000-8000-000000000002',
    brAllForms: 'b3000000-0000-4000-8000-000000000003',
    action: 'c1000000-0000-4000-8000-000000000001',
    bpfPrimary: 'd1000000-0000-4000-8000-000000000001',
    bpfOther: 'd2000000-0000-4000-8000-000000000002',
    bpfUnrelated: 'd3000000-0000-4000-8000-000000000003',
    cloudFlow: 'e1000000-0000-4000-8000-000000000001',
};

/** A `workflows` row as returned with annotations; `xaml`/`clientdata` null unless overridden. */
function workflowRow(overrides: Row): Row {
    return {
        '@odata.etag': 'W/"1"',
        workflowid: '',
        name: '',
        category: 0,
        type: 1,
        primaryentity: 'contoso_project',
        statecode: 1,
        statuscode: 2,
        mode: 0,
        scope: 4,
        uniquename: null,
        description: null,
        ismanaged: false,
        ondemand: false,
        subprocess: false,
        triggeroncreate: false,
        triggerondelete: false,
        triggeronupdateattributelist: null,
        createstage: null,
        updatestage: null,
        deletestage: null,
        runas: 0,
        asyncautodelete: false,
        rendererobjecttypecode: null,
        clientdata: null,
        xaml: null,
        _ownerid_value: OWNER,
        '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Alex Admin',
        formid: null,
        rank: null,
        modifiedon: '2026-08-01T10:00:00Z',
        ...overrides,
    };
}

const REALTIME = workflowRow({
    workflowid: IDS.realtime,
    name: 'Validate budget',
    mode: 1,
    triggeronupdateattributelist: 'contoso_status,ownerid',
    updatestage: 20,
    createstage: 40,
    description: 'Flags large projects',
    xaml: WORKFLOW_XAML,
});
const BACKGROUND = workflowRow({ workflowid: IDS.background, name: 'Create kickoff tasks', mode: 0, triggeroncreate: true, ondemand: true, statecode: 0, scope: 2, runas: 1 });
const BR_FORM = workflowRow({ workflowid: IDS.brForm, name: 'Default region', category: 2, scope: 1, formid: FORM_ID, xaml: BUSINESS_RULE_XAML });
const BR_ENTITY = workflowRow({ workflowid: IDS.brEntity, name: 'Lock budget', category: 2, scope: 2, xaml: BUSINESS_RULE_XAML });
const BR_ALL_FORMS = workflowRow({ workflowid: IDS.brAllForms, name: 'Show region', category: 2, scope: 1, xaml: BUSINESS_RULE_XAML });
const ACTION = workflowRow({ workflowid: IDS.action, name: 'Close Project', category: 3, uniquename: 'contoso_CloseProject', mode: 1 });
const CLOUD_FLOW = workflowRow({ workflowid: IDS.cloudFlow, name: 'Notify PM', category: 5, clientdata: '{"properties":{"definition":{"triggers":{}}}}' });

const KNOWN = ['contoso_budget', 'contoso_flagged', 'contoso_status', 'contoso_region', 'contoso_progress', 'ownerid'];

function byId(items: LogicItem[], id: string): LogicItem {
    const item = items.find((i) => i.id === id);
    if (!item) throw new Error(`item ${id} not found in ${items.map((i) => i.id).join(', ')}`);
    return item;
}

async function run(rows: Row[], overrides: Parameters<typeof makeCtx>[0] = {}) {
    const client = makeFakeClient({ "primaryentity eq 'contoso_project'": rows });
    const result = await processesSource.run(makeCtx({ client, knownColumns: KNOWN, ...overrides }));
    return { client, result };
}

describe('processesSource queries', () => {
    it('selects every column the guide lists and filters on type 1 + primaryentity', async () => {
        const { client } = await run([]);
        expect(client.paths).toEqual([processesQuery('contoso_project'), otherEntityBpfQuery('contoso_project')]);
        expect(client.paths[0]).toBe(
            "workflows?$select=workflowid,name,category,type,primaryentity,statecode,statuscode,mode,scope,uniquename,description,ismanaged,ondemand,subprocess,triggeroncreate,triggerondelete,triggeronupdateattributelist,createstage,updatestage,deletestage,runas,asyncautodelete,rendererobjecttypecode,clientdata,xaml,_ownerid_value,formid,rank,modifiedon&$filter=type eq 1 and primaryentity eq 'contoso_project'",
        );
        expect(client.paths[1]).toBe("workflows?$select=workflowid,name,statecode,primaryentity,uniquename,xaml,clientdata,ismanaged&$filter=category eq 4 and type eq 1 and primaryentity ne 'contoso_project'");
    });

    it('escapes quotes in the table name', () => {
        expect(processesQuery("o'brien")).toContain("primaryentity eq 'o''brien'");
        expect(processesQuery('x', { withFormId: false })).not.toContain('formid');
        expect(processesQuery('x', { withOptional: false })).not.toContain('rank');
    });

    // `workflow.formid` is an Edm.Guid property, not a lookup: asking for `_formid_value` made
    // Dataverse reject the whole processes query with a 400 on every run (docs/verified.md #3).
    it('selects the primitive formid column (never the non-existent _formid_value lookup) and rank', () => {
        const q = processesQuery('contoso_project');
        expect(q).not.toContain('_formid_value');
        expect(q).toContain(',formid,rank,modifiedon');
    });

    it('returns an empty result for a table without processes', async () => {
        const { result } = await run([]);
        expect(result.items).toEqual([]);
        expect(result.customApiNames).toEqual([]);
        expect(result.warnings).toBeUndefined();
        expect(result.raw).toEqual({ workflows: [], bpfsOnOtherTables: [] });
    });
});

describe('classic workflows', () => {
    it('expands a real-time workflow on update of status/owner into Update + Assign at the designer stage', async () => {
        const { result } = await run([REALTIME]);
        expect(result.items.map((i) => i.id).sort()).toEqual([`${IDS.realtime}:Assign`, `${IDS.realtime}:Update`]);

        const update = byId(result.items, `${IDS.realtime}:Update`);
        expect(update).toMatchObject({
            kind: 'workflow',
            name: 'Validate budget',
            event: 'Update',
            groupId: IDS.realtime,
            stage: 'preoperation',
            enabled: true,
            mode: 'realtime',
            filteringAttributes: ['contoso_status', 'ownerid'],
            touchesColumns: ['contoso_budget', 'contoso_flagged'],
            confidence: 'heuristic',
            links: { record: `${SAMPLE_ENVIRONMENT_URL}/main.aspx?pagetype=entityrecord&etn=workflow&id=${IDS.realtime}` },
            source: { table: 'workflow', id: IDS.realtime },
        });
        expect(update.details).toMatchObject({
            category: 'Workflow',
            workflowMode: 'Real-time',
            scope: 'Organization',
            runAs: 'Owner',
            asyncAutoDelete: false,
            owner: 'Alex Admin',
            ownerId: OWNER,
            modifiedOn: '2026-08-01T10:00:00Z',
            isManaged: false,
            state: 'Activated',
            description: 'Flags large projects',
            triggerOnUpdateAttributes: ['contoso_status', 'ownerid'],
            updateStage: 'Pre-operation',
            onDemand: false,
            createsEntities: ['email', 'task'],
        });
        expect(update.details.steps).toEqual(['If budget is large', 'Update Project', 'Assign to finance', 'Create review task', 'Deactivate', 'Notify owner']);
        expect(update.details.activities).toEqual(expect.arrayContaining(['UpdateEntity', 'AssignEntity', 'SetState']));
        expect(update.details.reads).toContain('contoso_budget');
        expect(update.details.writes).toContain('contoso_flagged');
        expect(update.details).not.toHaveProperty('createStage');
        expect(update.details).not.toHaveProperty('xaml');

        const assign = byId(result.items, `${IDS.realtime}:Assign`);
        expect(assign).toMatchObject({ event: 'Assign', stage: 'preoperation', mode: 'realtime', groupId: IDS.realtime, touchesColumns: ['contoso_budget', 'contoso_flagged'] });
        expect(assign.filteringAttributes).toBeUndefined();
        expect(assign.details.derivedFrom).toBe('ownerid in triggeronupdateattributelist');
    });

    // Real-time workflows run inside the synchronous pipeline at `workflow.rank`; without it the
    // classifier assumed rank 1 and ordered them before higher-ranked plugin steps.
    it('reads the execution order (rank) of a real-time workflow and leaves background workflows without an order', async () => {
        const realtime = workflowRow({ workflowid: IDS.realtime, name: 'Late validator', mode: 1, rank: 100, triggeroncreate: true, createstage: 20 });
        const background = workflowRow({ workflowid: IDS.background, name: 'Async worker', mode: 0, rank: 100, triggeroncreate: true });
        const { result } = await run([realtime, background]);
        expect(byId(result.items, `${IDS.realtime}:Create`).order).toBe(100);
        expect(byId(result.items, `${IDS.background}:Create`).order).toBeUndefined();
    });

    it('leaves the order unset when rank was not returned (retry path / older environment)', async () => {
        const { result } = await run([workflowRow({ workflowid: IDS.realtime, name: 'No rank', mode: 1, triggeroncreate: true })]);
        expect(byId(result.items, `${IDS.realtime}:Create`).order).toBeUndefined();
    });

    it('puts a background workflow after commit and adds an instant Any item when it is on demand', async () => {
        const { result } = await run([BACKGROUND]);
        expect(result.items.map((i) => i.id).sort()).toEqual([`${IDS.background}:Any`, `${IDS.background}:Create`]);
        const create = byId(result.items, `${IDS.background}:Create`);
        expect(create).toMatchObject({ event: 'Create', stage: 'postcommit', mode: 'background', enabled: false, confidence: 'exact' });
        expect(create.touchesColumns).toBeUndefined();
        expect(create.details).toMatchObject({ workflowMode: 'Background', scope: 'Business Unit', runAs: 'Calling User', state: 'Draft', createStage: 'After commit (async)', onDemand: true, steps: [] });
        const any = byId(result.items, `${IDS.background}:Any`);
        expect(any).toMatchObject({ event: 'Any', stage: 'postcommit', mode: 'instant' });
        expect(any.details.onDemand).toBe(true);
        expect(any.details.note).toMatch(/on demand/i);
    });

    it('emits SetState for statecode in the update list, Delete before the operation, and a single Any item for child workflows', async () => {
        const rows = [
            workflowRow({ workflowid: IDS.realtime, name: 'Deactivate handler', mode: 1, triggeronupdateattributelist: 'statecode', updatestage: 40, triggerondelete: true, deletestage: 20 }),
            workflowRow({ workflowid: IDS.background, name: 'Child', subprocess: true }),
        ];
        const { result } = await run(rows);
        expect(byId(result.items, `${IDS.realtime}:SetState`)).toMatchObject({ stage: 'postoperation', mode: 'realtime' });
        expect(byId(result.items, `${IDS.realtime}:Update`)).toMatchObject({ stage: 'postoperation', filteringAttributes: ['statecode'] });
        expect(byId(result.items, `${IDS.realtime}:Delete`)).toMatchObject({ stage: 'preoperation' });
        const child = byId(result.items, `${IDS.background}:Any`);
        expect(child).toMatchObject({ stage: 'postcommit', mode: 'background' });
        expect(child.details.subprocess).toBe(true);
        expect(result.items.filter((i) => i.groupId === IDS.background)).toHaveLength(1);
    });
});

describe('business rules', () => {
    it('maps a form-scoped rule to FormLoad + FieldChange only', async () => {
        const { result } = await run([BR_FORM]);
        expect(result.items.map((i) => i.id).sort()).toEqual([`${IDS.brForm}:FieldChange`, `${IDS.brForm}:FormLoad`]);
        const fieldChange = byId(result.items, `${IDS.brForm}:FieldChange`);
        expect(fieldChange).toMatchObject({
            kind: 'businessrule',
            name: 'Default region',
            event: 'FieldChange',
            groupId: IDS.brForm,
            stage: 'client',
            mode: 'client',
            enabled: true,
            filteringAttributes: ['contoso_status'],
            touchesColumns: ['contoso_budget', 'contoso_progress', 'contoso_region', 'contoso_status'],
            confidence: 'heuristic',
        });
        expect(fieldChange.details).toMatchObject({
            category: 'Business Rule',
            formId: FORM_ID,
            scope: 'form',
            scopeCode: 1,
            conditionColumns: ['contoso_status'],
            state: 'Activated',
            isManaged: false,
            branches: 2,
        });
        expect((fieldChange.details.actions as Array<{ type: string }>).map((a) => a.type)).toEqual(['SetVisibility', 'SetRequiredLevel', 'SetDefaultValue', 'LockUnlock', 'ShowErrorMessage', 'SetValue']);
        const formLoad = byId(result.items, `${IDS.brForm}:FormLoad`);
        expect(formLoad.filteringAttributes).toBeUndefined();
        expect(formLoad.details).toEqual(fieldChange.details);
    });

    it('adds server-side Create/Update items for an entity-scoped rule', async () => {
        const { result } = await run([BR_ENTITY]);
        expect(result.items.map((i) => i.id).sort()).toEqual([`${IDS.brEntity}:Create`, `${IDS.brEntity}:FieldChange`, `${IDS.brEntity}:FormLoad`, `${IDS.brEntity}:Update`]);
        const create = byId(result.items, `${IDS.brEntity}:Create`);
        expect(create).toMatchObject({ kind: 'businessrule', event: 'Create', stage: 'preoperation', mode: 'sync', groupId: IDS.brEntity, confidence: 'heuristic' });
        expect(create.details).toMatchObject({ formId: null, scope: 'entity', scopeCode: 2, serverSide: true, note: SERVER_SIDE_NOTE });
        expect(byId(result.items, `${IDS.brEntity}:Update`)).toMatchObject({ stage: 'preoperation', mode: 'sync' });
        expect(byId(result.items, `${IDS.brEntity}:FormLoad`).details).not.toHaveProperty('serverSide');
    });

    // Dataverse returns an unset Edm.Guid column as null, but an all-zero GUID must not read as
    // "scoped to a form" either.
    it('treats an empty formid GUID as no form scope', async () => {
        const { result } = await run([workflowRow({ workflowid: IDS.brAllForms, name: 'Zeroed', category: 2, scope: 1, formid: '00000000-0000-0000-0000-000000000000', xaml: BUSINESS_RULE_XAML })]);
        expect(byId(result.items, `${IDS.brAllForms}:FormLoad`).details).toMatchObject({ formId: null, scope: 'allforms' });
    });

    it('treats a rule without form id and with a form scope code as "all forms" (client only)', async () => {
        const { result } = await run([BR_ALL_FORMS]);
        expect(result.items).toHaveLength(2);
        expect(byId(result.items, `${IDS.brAllForms}:FormLoad`).details).toMatchObject({ formId: null, scope: 'allforms', scopeCode: 1 });
        expect(businessRuleScope(undefined, undefined)).toBe('entity');
        expect(businessRuleScope(FORM_ID, 2)).toBe('form');
    });
});

describe('actions', () => {
    it('maps an action to a Custom event in the main operation and reports its unique name', async () => {
        const { result } = await run([ACTION]);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            id: IDS.action,
            kind: 'action',
            name: 'Close Project',
            event: 'Custom:contoso_CloseProject',
            stage: 'mainoperation',
            mode: 'sync',
            enabled: true,
            confidence: 'exact',
            source: { table: 'workflow', id: IDS.action },
        });
        expect(result.items[0].details).toMatchObject({ category: 'Action', uniqueName: 'contoso_CloseProject', note: 'Invoked, not triggered', owner: 'Alex Admin' });
        expect(result.customApiNames).toEqual(['contoso_CloseProject']);
    });
});

describe('business process flows', () => {
    const leadCtx = { table: { logicalName: 'lead', entitySetName: 'leads', displayName: 'Lead' }, knownColumns: ['budgetstatus', 'parentcontactid', 'estimatedclosedate'] };

    it('maps the primary BPF and BPFs on other tables that include this table in a stage', async () => {
        const client = makeFakeClient({
            "primaryentity eq 'lead'": [workflowRow({ workflowid: IDS.bpfPrimary, name: 'Lead to Opportunity', category: 4, primaryentity: 'lead', uniquename: 'contoso_leadtoopp', xaml: BPF_XAML })],
            "primaryentity ne 'lead'": [
                { workflowid: IDS.bpfOther, name: 'Opportunity sales process', statecode: 1, primaryentity: 'opportunity', uniquename: 'contoso_oppsales', xaml: BPF_XAML, clientdata: null, ismanaged: true },
                { workflowid: IDS.bpfUnrelated, name: 'Account onboarding', statecode: 1, primaryentity: 'account', uniquename: 'contoso_acct', xaml: null, clientdata: null, ismanaged: false },
            ],
        });
        const result = await processesSource.run(makeCtx({ client, ...leadCtx }));
        expect(client.paths).toEqual([processesQuery('lead'), otherEntityBpfQuery('lead')]);
        expect(result.items.map((i) => i.id).sort()).toEqual([IDS.bpfPrimary, IDS.bpfOther].sort());

        const primary = byId(result.items, IDS.bpfPrimary);
        expect(primary).toMatchObject({ kind: 'bpf', name: 'Lead to Opportunity', event: 'Any', stage: 'client', mode: 'client', enabled: true, confidence: 'exact', touchesColumns: ['budgetstatus', 'parentcontactid'] });
        expect(primary.details).toMatchObject({ role: 'primary', primaryEntity: 'lead', uniqueName: 'contoso_leadtoopp', state: 'Activated', isManaged: false, entities: ['lead', 'opportunity'], stagesOnThisTable: ['Lead / Walk In'] });
        expect((primary.details.stages as Array<{ name: string }>).map((s) => s.name)).toEqual(['Lead / Walk In', 'Discover Needs', 'Vehicles Of Interest', 'Test Drive', 'Develop Proposal', 'Close']);
        expect(primary.details.relationships).toHaveLength(1);
        expect(primary.groupId).toBeUndefined();

        const other = byId(result.items, IDS.bpfOther);
        expect(other.details).toMatchObject({ role: 'stage', primaryEntity: 'opportunity', isManaged: true });
        const raw = result.raw as { workflows: Row[]; bpfsOnOtherTables: Row[] };
        expect(raw.bpfsOnOtherTables.map((r) => r.workflowid)).toEqual([IDS.bpfOther]);
        for (const r of [...raw.workflows, ...raw.bpfsOnOtherTables]) {
            expect(r).not.toHaveProperty('xaml');
            expect(r).not.toHaveProperty('clientdata');
        }
    });

    it('degrades to a warning when the other-table BPF query fails', async () => {
        const client = makeFakeClient([
            { match: "primaryentity ne 'contoso_project'", response: () => { throw new Error('HTTP 403'); } },
            { match: "primaryentity eq 'contoso_project'", response: [ACTION] },
        ]);
        const result = await processesSource.run(makeCtx({ client }));
        expect(result.items).toHaveLength(1);
        expect(result.warnings).toEqual([expect.stringContaining('Business process flows on other tables could not be loaded')]);
    });
});

describe('formid / rank fallback and filtering', () => {
    it('retries without formid/rank on a bad request and warns', async () => {
        const rowWithoutFormId = (() => {
            const { formid: _f, rank: _r, ...rest } = BR_FORM;
            return rest;
        })();
        const routes: FakeRoute[] = [
            {
                match: 'formid,rank',
                response: (call) => {
                    throw new DataverseRequestError("HTTP 400: Could not find a property named 'formid' on type 'Microsoft.Dynamics.CRM.workflow'", 'badrequest', call.path);
                },
            },
            { match: "primaryentity eq 'contoso_project'", response: [rowWithoutFormId] },
        ];
        const client = makeFakeClient(routes);
        const result = await processesSource.run(makeCtx({ client, knownColumns: KNOWN }));
        const queries = client.callsOf('query').map((c) => c.path);
        expect(queries).toHaveLength(3);
        expect(queries[0]).toContain('formid,rank');
        expect(queries[2]).toBe(processesQuery('contoso_project', { withOptional: false }));
        expect(queries[2]).not.toContain('formid');
        expect(result.warnings).toEqual([FORMID_WARNING]);
        // Without the form id the rule is scoped by its scope code only (1 = form scope → all forms).
        expect(byId(result.items, `${IDS.brForm}:FormLoad`).details).toMatchObject({ formId: null, scope: 'allforms', note: FORMID_WARNING });
    });

    it('propagates errors that are not bad requests', async () => {
        const client = makeFakeClient([{ match: "primaryentity eq 'contoso_project'", response: () => { throw new Error('HTTP 403'); } }]);
        await expect(processesSource.run(makeCtx({ client }))).rejects.toThrow('HTTP 403');
        expect(client.callsOf('query').filter((c) => c.path.includes('primaryentity eq'))).toHaveLength(1);
    });

    it('ignores cloud flow rows, keeps definitions out of raw and sorts items deterministically', async () => {
        const rows = [CLOUD_FLOW, ACTION, REALTIME, BR_FORM];
        const { result } = await run(rows);
        expect(result.items.some((i) => i.groupId === IDS.cloudFlow || i.id === IDS.cloudFlow)).toBe(false);
        expect(result.items.map((i) => i.id)).toEqual([...result.items].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((i) => i.id));
        const raw = result.raw as { workflows: Row[] };
        expect(raw.workflows.map((r) => r.workflowid)).toEqual([IDS.action, IDS.brForm, IDS.cloudFlow, IDS.realtime]);
        const text = JSON.stringify(result);
        expect(text).not.toContain('ActivityReference');
        expect(text).not.toContain('"xaml"');
        expect(text).not.toContain('clientdata');
        const again = await run(rows);
        expect(again.result).toEqual(result);
    });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Row } from '../data/client';
import type { LogicItem } from '../domain/model';
import { flowsQuery, flowsSource, matchTrigger } from './flows';
import { SAMPLE_ENVIRONMENT_URL, makeCtx, makeFakeClient } from './testUtils';

const fixture = (name: string) => readFileSync(join(__dirname, `../fixtures/${name}`), 'utf8');
const CREATE_JSON = fixture('flow.clientdata.create.json');
const UPDATE_FILTER_JSON = fixture('flow.clientdata.update-filter.json');
const ACTION_PERFORMED_JSON = fixture('flow.clientdata.action-performed.json');
const ROW_SELECTED_JSON = fixture('flow.clientdata.row-selected.json');

const OWNER = 'u1000000-0000-4000-8000-000000000001';
const IDS = {
    notify: 'f1000000-0000-4000-8000-000000000001',
    taskSync: 'f2000000-0000-4000-8000-000000000002',
    broken: 'f3000000-0000-4000-8000-000000000003',
    closeAction: 'f4000000-0000-4000-8000-000000000004',
    selected: 'f5000000-0000-4000-8000-000000000005',
    digest: 'f6000000-0000-4000-8000-000000000006',
    review: 'f7000000-0000-4000-8000-000000000007',
    unrelated: 'f8000000-0000-4000-8000-000000000008',
};

const DATAVERSE_HOST = (operationId: string) => ({
    apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
    connectionName: 'shared_commondataserviceforapps',
    operationId,
});

/** Hand-built clientdata: a trigger on another table plus Dataverse actions. */
function clientData(triggerParams: Record<string, unknown>, actions: Record<string, unknown>): string {
    return JSON.stringify({
        properties: {
            connectionReferences: { shared_commondataserviceforapps: { api: { name: 'shared_commondataserviceforapps' } } },
            definition: {
                triggers: { When_a_task_changes: { type: 'OpenApiConnectionWebhook', inputs: { host: DATAVERSE_HOST('SubscribeWebhookTrigger'), parameters: triggerParams } } },
                actions,
            },
        },
        schemaVersion: '1.0.0.0',
    });
}

const TASK_TRIGGER = { 'subscriptionRequest/message': 1, 'subscriptionRequest/entityname': 'contoso_task', 'subscriptionRequest/scope': 4 };

function flowRow(overrides: Row): Row {
    return {
        '@odata.etag': 'W/"1"',
        workflowid: '',
        name: '',
        statecode: 1,
        statuscode: 2,
        clientdata: null,
        _ownerid_value: OWNER,
        '_ownerid_value@OData.Community.Display.V1.FormattedValue': 'Alex Admin',
        modifiedon: '2026-08-01T10:00:00Z',
        ismanaged: false,
        description: null,
        uniquename: null,
        ...overrides,
    };
}

const ROWS: Row[] = [
    flowRow({ workflowid: IDS.notify, name: 'Notify PM', clientdata: CREATE_JSON, uniquename: 'contoso_notifypm', description: 'Emails the owner' }),
    flowRow({
        workflowid: IDS.taskSync,
        name: 'Task sync',
        clientdata: clientData(TASK_TRIGGER, {
            Update_project: { type: 'OpenApiConnection', inputs: { host: DATAVERSE_HOST('UpdateRecord'), parameters: { entityName: 'contoso_projects', recordId: '@triggerOutputs()?[\'body/_contoso_projectid_value\']', 'item/contoso_progress': 10 } } },
        }),
    }),
    flowRow({ workflowid: IDS.broken, name: 'Broken flow', clientdata: '{"properties":{"definition":{"triggers":{' }),
    flowRow({ workflowid: IDS.closeAction, name: 'On close project', clientdata: ACTION_PERFORMED_JSON, statecode: 0 }),
    flowRow({ workflowid: IDS.selected, name: 'Post tasks to Teams', clientdata: ROW_SELECTED_JSON }),
    flowRow({
        workflowid: IDS.digest,
        name: 'Weekly digest',
        clientdata: clientData(TASK_TRIGGER, {
            List_projects: { type: 'OpenApiConnection', inputs: { host: DATAVERSE_HOST('ListRecords'), parameters: { entityName: 'contoso_projects', $top: 10 } } },
            Scope: {
                type: 'Scope',
                actions: { Get_project: { type: 'OpenApiConnection', inputs: { host: DATAVERSE_HOST('GetItem'), parameters: { entityName: 'contoso_projects', recordId: 'x' } } } },
            },
        }),
    }),
    flowRow({ workflowid: IDS.review, name: 'Review project', clientdata: UPDATE_FILTER_JSON, ismanaged: true }),
    flowRow({ workflowid: IDS.unrelated, name: 'Unrelated', clientdata: clientData(TASK_TRIGGER, { Compose: { type: 'Compose', inputs: 'x' } }) }),
];

function byId(items: LogicItem[], id: string): LogicItem {
    const item = items.find((i) => i.id === id);
    if (!item) throw new Error(`item ${id} not found in ${items.map((i) => i.id).join(', ')}`);
    return item;
}

describe('flowsSource', () => {
    const client = makeFakeClient({ 'category eq 5': ROWS });
    const resultPromise = flowsSource.run(makeCtx({ client, knownColumns: ['contoso_budget', 'contoso_status'] }));

    it('loads every cloud flow definition with one paged query', async () => {
        await resultPromise;
        expect(client.paths).toEqual([flowsQuery()]);
        expect(client.paths[0]).toBe('workflows?$select=workflowid,name,statecode,statuscode,clientdata,_ownerid_value,modifiedon,ismanaged,description,uniquename&$filter=category eq 5 and type eq 1');
        expect(flowsSource.after).toEqual(['customApis', 'processes']);
    });

    it('expands a Create+Update trigger on the table into two items with the actions on this table', async () => {
        const result = await resultPromise;
        const create = byId(result.items, `${IDS.notify}:Create`);
        const update = byId(result.items, `${IDS.notify}:Update`);
        for (const item of [create, update]) {
            expect(item).toMatchObject({
                kind: 'flow',
                name: 'Notify PM',
                groupId: IDS.notify,
                stage: 'postcommit',
                mode: 'async',
                enabled: true,
                confidence: 'exact',
                links: { record: `${SAMPLE_ENVIRONMENT_URL}/main.aspx?pagetype=entityrecord&etn=workflow&id=${IDS.notify}` },
                source: { table: 'workflow', id: IDS.notify },
            });
        }
        expect(create.event).toBe('Create');
        expect(update.event).toBe('Update');

        // Dataverse filtering attributes narrow the Modified half of the trigger only: the flow
        // still runs on every Create, so only the Update item may carry them as a column filter.
        expect(update.filteringAttributes).toEqual(['contoso_budget', 'contoso_status']);
        expect(create.filteringAttributes).toBeUndefined();
        for (const item of [create, update]) expect(item.details.triggerFilteringAttributes).toEqual(['contoso_budget', 'contoso_status']);
        expect(update.details).toMatchObject({
            category: 'Cloud Flow',
            trigger: 'row',
            triggerName: 'When_a_project_is_created_or_updated',
            triggerKind: 'row',
            message: 4,
            messageLabel: 'Create, Update',
            scope: 'Organization',
            scopeCode: 4,
            filterExpression: 'statecode eq 0',
            runAs: 'Flow owner',
            connectionReferences: ['shared_commondataserviceforapps', 'shared_office365'],
            actionCount: 12,
            owner: 'Alex Admin',
            ownerId: OWNER,
            state: 'Activated',
            uniqueName: 'contoso_notifypm',
            isManaged: false,
            modifiedOn: '2026-08-01T10:00:00Z',
            description: 'Emails the owner',
        });
        expect(update.details).not.toHaveProperty('instant');
        const actions = update.details.actionsOnThisTable as Array<Record<string, unknown>>;
        expect(actions).toEqual([
            { path: 'Scope_Notify/Condition_budget/Update_project_flag', name: 'Update_project_flag', operationId: 'UpdateRecord', kind: 'write', label: 'Update a row' },
            { path: 'Switch_status/Case_closed/Perform_close_action', name: 'Perform_close_action', operationId: 'PerformBoundAction', kind: 'write', actionName: 'contoso_CloseProject', label: 'Perform a bound action' },
        ]);
        expect(update.details.actionsOnTable).toEqual(actions);
    });

    it('attaches trigger filtering attributes to the Update item only for a create/update/delete trigger', async () => {
        const row = flowRow({
            workflowid: IDS.notify,
            name: 'All events',
            clientdata: clientData({ 'subscriptionRequest/message': 7, 'subscriptionRequest/entityname': 'contoso_project', 'subscriptionRequest/filteringattributes': 'contoso_status' }, {}),
        });
        const client = makeFakeClient({ 'category eq 5': [row] });
        const result = await flowsSource.run(makeCtx({ client, knownColumns: ['contoso_status'] }));
        expect(result.items.map((i) => [i.event, i.filteringAttributes])).toEqual([
            ['Create', undefined],
            ['Delete', undefined],
            ['Update', ['contoso_status']],
        ]);
    });

    it('maps an Update-only trigger without filtering attributes (no filteringAttributes property)', async () => {
        const result = await resultPromise;
        const review = byId(result.items, `${IDS.review}:Update`);
        expect(review.filteringAttributes).toBeUndefined();
        expect(review.details).toMatchObject({ message: 3, messageLabel: 'Update', scope: 'Business Unit', runAs: 'Row owner', filterExpression: 'contoso_status eq 2 and statecode eq 0', isManaged: true });
        expect(result.items.filter((i) => i.groupId === IDS.review)).toHaveLength(1);
    });

    it('maps action-performed and row-selected triggers', async () => {
        const result = await resultPromise;
        const close = byId(result.items, `${IDS.closeAction}:Custom:contoso_CloseProject`);
        expect(close).toMatchObject({ event: 'Custom:contoso_CloseProject', stage: 'postcommit', mode: 'async', enabled: false, confidence: 'heuristic' });
        expect(close.details).toMatchObject({ triggerKind: 'action', sdkMessageName: 'contoso_CloseProject', state: 'Draft' });
        expect((close.details.actionsOnThisTable as Array<{ operationId: string }>).map((a) => a.operationId)).toEqual(['GetItem']);

        const selected = byId(result.items, `${IDS.selected}:Any`);
        expect(selected).toMatchObject({ event: 'Any', mode: 'instant', confidence: 'exact' });
        expect(selected.details).toMatchObject({ triggerKind: 'rowSelected', instant: true, actionsOnThisTable: [] });
    });

    it('reports flows triggered elsewhere that read or write the table as external touchers with their access', async () => {
        const result = await resultPromise;
        expect(result.externalTouchers?.map((i) => i.id)).toEqual([`${IDS.taskSync}:touches`, `${IDS.digest}:touches`]);
        expect(result.items.some((i) => i.groupId === IDS.taskSync || i.groupId === IDS.digest)).toBe(false);

        const sync = byId(result.externalTouchers ?? [], `${IDS.taskSync}:touches`);
        expect(sync).toMatchObject({ kind: 'flow', name: 'Task sync', event: 'Any', groupId: IDS.taskSync, stage: 'postcommit', mode: 'async', enabled: true, confidence: 'exact' });
        expect(sync.details).toMatchObject({
            access: 'write',
            actions: [{ path: 'Update_project', name: 'Update_project', operationId: 'UpdateRecord', kind: 'write', label: 'Update a row' }],
            trigger: 'row:contoso_task',
            triggers: [{ name: 'When_a_task_changes', kind: 'row', entityName: 'contoso_task', message: 1, operationId: 'SubscribeWebhookTrigger', connector: 'shared_commondataserviceforapps' }],
            owner: 'Alex Admin',
            state: 'Activated',
            connectionReferences: ['shared_commondataserviceforapps'],
            actionCount: 1,
        });
        expect(sync.details.actionsOnTable).toEqual(sync.details.actions);

        const digest = byId(result.externalTouchers ?? [], `${IDS.digest}:touches`);
        expect(digest.details.access).toBe('read');
        expect((digest.details.actions as Array<{ path: string }>).map((a) => a.path)).toEqual(['List_projects', 'Scope/Get_project']);
    });

    it('skips flows with unreadable clientdata and flows that never touch the table, with a warning', async () => {
        const result = await resultPromise;
        const ids = [...result.items, ...(result.externalTouchers ?? [])].map((i) => i.groupId);
        expect(ids).not.toContain(IDS.broken);
        expect(ids).not.toContain(IDS.unrelated);
        expect(result.warnings).toEqual(['1 cloud flow(s) could not be parsed (empty or invalid flow JSON) and were skipped']);
    });

    it('never leaks the definition, action parameters or clientdata into the result', async () => {
        const result = await resultPromise;
        const text = JSON.stringify(result);
        expect(text).not.toContain('definition');
        expect(text).not.toContain('emailMessage');
        expect(text).not.toContain('hard-coded-secret-value');
        expect(text).not.toContain('clientdata');
        const raw = result.raw as Row[];
        expect(raw).toHaveLength(ROWS.length);
        expect(raw.map((r) => r.workflowid)).toEqual([...ROWS].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((r) => r.workflowid));
        expect(raw[0]).toMatchObject({ name: 'Broken flow', statecode: 1, triggers: [], tableActions: [], actionCount: 0 });
        expect(Object.keys(raw[0])).not.toContain('clientdata');
    });

    it('is deterministic across runs and returns empty collections for an environment without flows', async () => {
        const first = await resultPromise;
        const second = await flowsSource.run(makeCtx({ client: makeFakeClient({ 'category eq 5': ROWS }), knownColumns: ['contoso_budget', 'contoso_status'] }));
        expect(second).toEqual(first);
        const empty = await flowsSource.run(makeCtx({ client: makeFakeClient() }));
        expect(empty).toEqual({ items: [], externalTouchers: [], raw: [] });
    });
});

describe('matchTrigger', () => {
    const ctx = { table: makeCtx().table, customApiNames: new Set(['contoso_RecalculateProject']) };

    it('maps row triggers by message code and falls back to Any for unknown codes', () => {
        expect(matchTrigger({ kind: 'row', name: 't', entityName: 'contoso_project', message: 7 }, ctx)).toEqual({ events: ['Create', 'Update', 'Delete'], confidence: 'exact' });
        expect(matchTrigger({ kind: 'row', name: 't', entityName: 'CONTOSO_PROJECT', message: 99 }, ctx)).toEqual({ events: ['Any'], confidence: 'exact' });
        expect(matchTrigger({ kind: 'row', name: 't', entityName: 'contoso_task', message: 1 }, ctx)).toBeUndefined();
    });

    it('matches action triggers by entity or by a known custom API name', () => {
        expect(matchTrigger({ kind: 'action', name: 't', entityName: 'none', sdkMessageName: 'contoso_RecalculateProject' }, ctx)).toEqual({ events: ['Custom:contoso_RecalculateProject'], confidence: 'heuristic' });
        expect(matchTrigger({ kind: 'action', name: 't', entityName: 'none', sdkMessageName: 'contoso_Other' }, ctx)).toBeUndefined();
        expect(matchTrigger({ kind: 'action', name: 't', entityName: 'contoso_project' }, ctx)).toEqual({ events: ['Any'], confidence: 'heuristic' });
    });

    it('ignores other triggers', () => {
        expect(matchTrigger({ kind: 'other', name: 'Recurrence' }, ctx)).toBeUndefined();
        expect(matchTrigger({ kind: 'rowSelected', name: 't', entityName: 'account' }, ctx)).toBeUndefined();
    });
});

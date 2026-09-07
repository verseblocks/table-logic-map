import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFlowDefinition, type FlowDefinitionSummary, type FlowTableAction } from './flowDefinition';

function fixture(name: string): string {
    return fs.readFileSync(path.join(__dirname, '../fixtures', name), 'utf8');
}

const brief = (a: FlowTableAction) => [a.entityName, a.operationId, a.kind] as const;

const EMPTY: FlowDefinitionSummary = { triggers: [], actionsOnTables: [], connectionReferences: [], actionCount: 0, connectionReferenceDetails: [] };

describe('parseFlowDefinition — create/update trigger with nested containers', () => {
    const summary = parseFlowDefinition(fixture('flow.clientdata.create.json'));

    it('parses the row trigger', () => {
        expect(summary.triggers).toHaveLength(1);
        const trigger = summary.triggers[0];
        expect(trigger.kind).toBe('row');
        expect(trigger.name).toBe('When_a_project_is_created_or_updated');
        expect(trigger.operationId).toBe('SubscribeWebhookTrigger');
        expect(trigger.isDataverse).toBe(true);
        expect(trigger.connector).toBe('shared_commondataserviceforapps');
        expect(trigger.message).toBe(4);
        expect(trigger.entityName).toBe('contoso_project');
        // Comma list is normalised: trimmed, lower-cased, sorted, de-duplicated.
        expect(trigger.filteringAttributes).toEqual(['contoso_budget', 'contoso_status']);
        expect(trigger.scope).toBe(4);
        expect(trigger.filterExpression).toBe('statecode eq 0');
        expect(trigger.runAs).toBe(1);
        expect(trigger.sdkMessageName).toBeUndefined();
    });

    it('lists Dataverse table actions in document order with read/write classification', () => {
        expect(summary.actionsOnTables.map(brief)).toEqual([
            ['systemusers', 'GetItem', 'read'],
            ['contoso_projects', 'UpdateRecord', 'write'],
            ['contoso_tasks', 'ListRecords', 'read'],
            ['contoso_tasks', 'DeleteRecord', 'write'],
            ['contoso_projects', 'PerformBoundAction', 'write'],
            ['annotations', 'CreateRecord', 'write'],
        ]);
    });

    it('builds container paths for If / else / Foreach / Switch / Until', () => {
        const byOp = (op: string) => summary.actionsOnTables.filter((a) => a.operationId === op);
        expect(byOp('GetItem')[0].path).toBe('Get_owner');
        expect(byOp('UpdateRecord')[0].path).toBe('Scope_Notify/Condition_budget/Update_project_flag');
        expect(byOp('ListRecords')[0].path).toContain('/else/');
        expect(byOp('ListRecords')[0].path).toBe('Scope_Notify/Condition_budget/else/List_tasks');
        expect(byOp('DeleteRecord')[0].path).toContain('Apply_to_each_task');
        expect(byOp('DeleteRecord')[0].path).toBe('Scope_Notify/Condition_budget/else/Apply_to_each_task/Delete_task');
        expect(byOp('PerformBoundAction')[0].path).toBe('Switch_status/Case_closed/Perform_close_action');
        expect(byOp('CreateRecord')[0].path).toBe('Switch_status/default/Do_until_synced/Create_account_note');
    });

    it('records the bound action name and operation labels', () => {
        const bound = summary.actionsOnTables.find((a) => a.operationId === 'PerformBoundAction');
        expect(bound?.actionName).toBe('contoso_CloseProject');
        expect(bound?.name).toBe('Perform_close_action');
        expect(bound?.label).toBe('Perform a bound action');
        expect(bound?.connector).toBe('shared_commondataserviceforapps');
        expect(summary.actionsOnTables.find((a) => a.operationId === 'GetItem')?.actionName).toBeUndefined();
    });

    it('counts every action at any depth and excludes non-Dataverse actions from the table list', () => {
        expect(summary.actionCount).toBe(12);
        expect(summary.actionsOnTables.some((a) => a.name === 'Send_an_email' || a.operationId === 'SendEmailV2')).toBe(false);
    });

    it('lists connection references sorted with details', () => {
        expect(summary.connectionReferences).toEqual(['shared_commondataserviceforapps', 'shared_office365']);
        expect(summary.connectionReferenceDetails).toEqual([
            { key: 'shared_commondataserviceforapps', apiName: 'shared_commondataserviceforapps', logicalName: 'contoso_sharedcommondataserviceforapps_1a2b3' },
            { key: 'shared_office365', apiName: 'shared_office365', logicalName: 'contoso_sharedoffice365_4c5d6' },
        ]);
    });

    it('never copies action parameters (email body, recipients, filters) into the summary', () => {
        const json = JSON.stringify(summary);
        expect(json).not.toContain('emailMessage');
        expect(json).not.toContain('Large project');
        expect(json).not.toContain('internalemailaddress');
        expect(json).not.toContain('_contoso_projectid_value eq');
        expect(json).not.toContain('objectid_contoso_project');
    });

    it('accepts an already-parsed object and yields the same summary', () => {
        const parsed = JSON.parse(fixture('flow.clientdata.create.json')) as Record<string, unknown>;
        expect(parseFlowDefinition(parsed)).toEqual(summary);
    });

    it('is deterministic across runs', () => {
        expect(JSON.stringify(parseFlowDefinition(fixture('flow.clientdata.create.json')))).toBe(JSON.stringify(summary));
    });
});

describe('parseFlowDefinition — update trigger with filter expression only', () => {
    const summary = parseFlowDefinition(fixture('flow.clientdata.update-filter.json'));

    it('parses the Update trigger without filtering attributes', () => {
        expect(summary.triggers).toHaveLength(1);
        const trigger = summary.triggers[0];
        expect(trigger.kind).toBe('row');
        expect(trigger.message).toBe(3);
        expect(trigger.entityName).toBe('contoso_project');
        expect(trigger.filteringAttributes).toBeUndefined();
        expect(trigger.filterExpression).toBe('contoso_status eq 2 and statecode eq 0');
        expect(trigger.scope).toBe(2);
        expect(trigger.runAs).toBe(2);
    });

    it('lists the UpdateRecord action and counts the Compose action', () => {
        expect(summary.actionsOnTables.map(brief)).toEqual([['contoso_projects', 'UpdateRecord', 'write']]);
        expect(summary.actionsOnTables[0].path).toBe('Update_project');
        expect(summary.actionCount).toBe(2);
        expect(summary.connectionReferences).toEqual(['shared_commondataserviceforapps']);
    });

    it('does not leak hard-coded parameter values', () => {
        const json = JSON.stringify(summary);
        expect(json).not.toContain('hard-coded-secret-value');
        expect(json).not.toContain('contoso_apikey');
        expect(json).not.toContain('was reviewed');
    });
});

describe('parseFlowDefinition — "When an action is performed" trigger', () => {
    const summary = parseFlowDefinition(fixture('flow.clientdata.action-performed.json'));

    it('classifies the trigger as an action trigger with the SDK message name', () => {
        expect(summary.triggers).toHaveLength(1);
        const trigger = summary.triggers[0];
        expect(trigger.kind).toBe('action');
        expect(trigger.sdkMessageName).toBe('contoso_CloseProject');
        expect(trigger.entityName).toBe('contoso_project');
        expect(trigger.isDataverse).toBe(true);
        expect(trigger.message).toBeUndefined();
    });

    it('keeps GetItem but not PerformUnboundAction or ReturnResponse (no table)', () => {
        expect(summary.actionsOnTables.map(brief)).toEqual([['contoso_projects', 'GetItem', 'read']]);
        expect(summary.actionCount).toBe(3);
        expect(JSON.stringify(summary)).not.toContain('contoso_RecalculateBudgets');
    });
});

describe('parseFlowDefinition — "When a row is selected" trigger', () => {
    const summary = parseFlowDefinition(fixture('flow.clientdata.row-selected.json'));

    it('classifies the trigger as rowSelected', () => {
        expect(summary.triggers).toHaveLength(1);
        const trigger = summary.triggers[0];
        expect(trigger.kind).toBe('rowSelected');
        expect(trigger.entityName).toBe('contoso_project');
        expect(trigger.operationId).toBe('GetOnNewSelectedRecord');
        expect(trigger.isDataverse).toBe(true);
    });

    it('lists the ListRecords action, counts the If container and skips the Teams action', () => {
        expect(summary.actionsOnTables.map(brief)).toEqual([['contoso_tasks', 'ListRecords', 'read']]);
        expect(summary.actionCount).toBe(3);
        expect(summary.connectionReferences).toEqual(['shared_commondataserviceforapps', 'shared_teams']);
        expect(JSON.stringify(summary)).not.toContain('messageBody');
    });

    it('detects a row-selected trigger by operationId when only the trigger host is present', () => {
        const summaryByOp = parseFlowDefinition({
            triggers: {
                Selected: { type: 'OpenApiConnection', inputs: { host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps', operationId: 'GetOnNewSelectedRecordTrigger' }, parameters: {} } },
            },
            actions: {},
        });
        expect(summaryByOp.triggers[0].kind).toBe('rowSelected');
    });
});

describe('parseFlowDefinition — legacy connector (shared_commondataservice)', () => {
    const summary = parseFlowDefinition(fixture('flow.clientdata.legacy.json'));

    it('resolves the connector through connectionReferences when apiId is absent', () => {
        expect(summary.triggers).toHaveLength(1);
        const trigger = summary.triggers[0];
        expect(trigger.kind).toBe('other');
        expect(trigger.operationId).toBe('GetOnNewItems');
        expect(trigger.isDataverse).toBe(true);
        expect(trigger.connector).toBe('shared_commondataservice');
    });

    it('uses the `table` parameter for legacy operations and ignores SharePoint GetItem', () => {
        expect(summary.actionsOnTables.map(brief)).toEqual([
            ['contoso_tasks', 'GetItems', 'read'],
            ['contoso_projects', 'PatchItem', 'write'],
        ]);
        expect(summary.actionsOnTables.map((a) => a.connector)).toEqual(['shared_commondataservice', 'shared_commondataservice']);
        expect(summary.actionCount).toBe(3);
        expect(summary.connectionReferences).toEqual(['shared_commondataservice', 'shared_sharepointonline']);
    });

    it('does not copy the environment/dataset parameter', () => {
        const json = JSON.stringify(summary);
        expect(json).not.toContain('org12345.crm');
        expect(json).not.toContain('sharepoint.com');
    });
});

describe('parseFlowDefinition — malformed and minimal inputs', () => {
    it('returns an empty summary for invalid JSON, empty and null input', () => {
        expect(parseFlowDefinition('{ not json')).toEqual(EMPTY);
        expect(parseFlowDefinition('')).toEqual(EMPTY);
        expect(parseFlowDefinition(null)).toEqual(EMPTY);
        expect(parseFlowDefinition(undefined)).toEqual(EMPTY);
        expect(parseFlowDefinition('[1,2,3]')).toEqual(EMPTY);
        expect(parseFlowDefinition('"text"')).toEqual(EMPTY);
    });

    it('returns an empty summary when the definition is missing', () => {
        expect(parseFlowDefinition('{}')).toEqual(EMPTY);
        expect(parseFlowDefinition({ properties: { connectionReferences: {} } })).toEqual(EMPTY);
        expect(parseFlowDefinition({ properties: { definition: 'garbage' } })).toEqual(EMPTY);
    });

    it('tolerates a definition without triggers or with non-object entries', () => {
        const summary = parseFlowDefinition({ properties: { definition: { actions: { Bad: 'not-an-object', Compose: { type: 'Compose', inputs: 1 } } } } });
        expect(summary.triggers).toEqual([]);
        expect(summary.actionCount).toBe(1);
        expect(summary.actionsOnTables).toEqual([]);
    });

    it('accepts a bare definition and falls back to used connection names', () => {
        const summary = parseFlowDefinition({
            triggers: {
                Manual: { type: 'Request', kind: 'Button', inputs: { schema: {} } },
            },
            actions: {
                Get_row: {
                    type: 'OpenApiConnection',
                    inputs: {
                        host: { connectionName: 'shared_commondataserviceforapps', operationId: 'GetItem' },
                        parameters: { entityName: 'contoso_projects', recordId: '00000000-0000-0000-0000-000000000000' },
                    },
                },
                Send: {
                    type: 'OpenApiConnection',
                    inputs: { host: { connectionName: 'shared_office365', operationId: 'SendEmailV2' }, parameters: { 'emailMessage/To': 'someone@example.com' } },
                },
            },
        });
        expect(summary.triggers).toEqual([{ kind: 'other', name: 'Manual', isDataverse: false }]);
        expect(summary.actionsOnTables.map(brief)).toEqual([['contoso_projects', 'GetItem', 'read']]);
        expect(summary.connectionReferences).toEqual(['shared_commondataserviceforapps', 'shared_office365']);
        expect(summary.connectionReferenceDetails).toEqual([{ key: 'shared_commondataserviceforapps' }, { key: 'shared_office365' }]);
        expect(JSON.stringify(summary)).not.toContain('someone@example.com');
    });

    it('accepts numeric strings for message/scope and a string runAs', () => {
        const summary = parseFlowDefinition({
            properties: {
                definition: {
                    triggers: {
                        T: {
                            inputs: {
                                host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps' },
                                parameters: {
                                    'subscriptionRequest/message': '7',
                                    'subscriptionRequest/entityname': 'account',
                                    'subscriptionRequest/scope': '4',
                                    'subscriptionRequest/filteringattributes': ' Name, telephone1,name ',
                                    'subscriptionRequest/runas': 'owner',
                                },
                            },
                        },
                    },
                },
            },
        });
        expect(summary.triggers[0]).toEqual({
            kind: 'row',
            name: 'T',
            isDataverse: true,
            connector: 'shared_commondataserviceforapps',
            entityName: 'account',
            message: 7,
            filteringAttributes: ['name', 'telephone1'],
            scope: 4,
            runAs: 'owner',
        });
    });

    it('skips Dataverse table operations without a table parameter', () => {
        const summary = parseFlowDefinition({
            actions: {
                Broken: { inputs: { host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps', operationId: 'ListRecords' }, parameters: {} } },
            },
        });
        expect(summary.actionsOnTables).toEqual([]);
        expect(summary.actionCount).toBe(1);
    });
});

import { describe, expect, it } from 'vitest';
import type { Row } from '../data/client';
import { customApisQuery, customApisSource } from './customApis';
import { SAMPLE_ENVIRONMENT_URL, makeCtx, makeFakeClient } from './testUtils';

/** `customapis?$select=...&$filter=boundentitylogicalname eq 'contoso_project'` rows (annotations included). */
const CUSTOM_APIS: Row[] = [
    {
        '@odata.etag': 'W/"2001"',
        customapiid: 'd2000000-0000-4000-8000-000000000002',
        name: 'contoso_RecalculateProject',
        uniquename: 'contoso_RecalculateProject',
        displayname: 'Recalculate Project',
        bindingtype: 1,
        'bindingtype@OData.Community.Display.V1.FormattedValue': 'Entity',
        isfunction: false,
        isprivate: false,
        allowedcustomprocessingsteptype: 2,
        executeprivilegename: 'prvWritecontoso_project',
        boundentitylogicalname: 'contoso_project',
        _plugintypeid_value: 'e1000000-0000-4000-8000-000000000001',
        '_plugintypeid_value@OData.Community.Display.V1.FormattedValue': 'Contoso.Plugins.RecalculateProject',
        '_plugintypeid_value@Microsoft.Dynamics.CRM.lookuplogicalname': 'plugintype',
    },
    {
        '@odata.etag': 'W/"2002"',
        customapiid: 'd1000000-0000-4000-8000-000000000001',
        name: 'contoso_GetProjectSummary',
        uniquename: 'contoso_GetProjectSummary',
        displayname: 'Get Project Summary',
        bindingtype: 1,
        isfunction: true,
        isprivate: true,
        allowedcustomprocessingsteptype: 0,
        executeprivilegename: null,
        boundentitylogicalname: 'contoso_project',
        _plugintypeid_value: null,
    },
];

describe('customApisSource', () => {
    it('filters on boundentitylogicalname and maps items sorted by unique name', async () => {
        const client = makeFakeClient({ customapis: CUSTOM_APIS });
        const result = await customApisSource.run(makeCtx({ client }));

        expect(client.paths).toEqual([customApisQuery('contoso_project')]);
        expect(client.paths[0]).toContain("$filter=boundentitylogicalname eq 'contoso_project'");
        expect(client.paths[0]).toContain('$select=customapiid,name,uniquename,displayname,bindingtype,isfunction,isprivate,allowedcustomprocessingsteptype,executeprivilegename,boundentitylogicalname,_plugintypeid_value');
        expect(result.customApiNames).toEqual(['contoso_GetProjectSummary', 'contoso_RecalculateProject']);
        expect(result.items).toEqual([
            {
                id: 'd1000000-0000-4000-8000-000000000001',
                kind: 'customapi',
                name: 'Get Project Summary',
                event: 'Custom:contoso_GetProjectSummary',
                stage: 'mainoperation',
                enabled: true,
                mode: 'sync',
                confidence: 'exact',
                details: {
                    uniqueName: 'contoso_GetProjectSummary',
                    displayName: 'Get Project Summary',
                    bindingType: 'Entity',
                    isFunction: true,
                    isPrivate: true,
                    allowedStepType: 'None',
                    executePrivilegeName: null,
                    implementation: 'none (flow/none)',
                    pluginTypeId: null,
                    pluginType: null,
                },
                links: { record: `${SAMPLE_ENVIRONMENT_URL}/main.aspx?pagetype=entityrecord&etn=customapi&id=d1000000-0000-4000-8000-000000000001` },
                source: { table: 'customapi', id: 'd1000000-0000-4000-8000-000000000001' },
            },
            {
                id: 'd2000000-0000-4000-8000-000000000002',
                kind: 'customapi',
                name: 'Recalculate Project',
                event: 'Custom:contoso_RecalculateProject',
                stage: 'mainoperation',
                enabled: true,
                mode: 'sync',
                confidence: 'exact',
                details: {
                    uniqueName: 'contoso_RecalculateProject',
                    displayName: 'Recalculate Project',
                    bindingType: 'Entity',
                    isFunction: false,
                    isPrivate: false,
                    allowedStepType: 'Sync and Async',
                    executePrivilegeName: 'prvWritecontoso_project',
                    implementation: 'plugin',
                    pluginTypeId: 'e1000000-0000-4000-8000-000000000001',
                    pluginType: 'Contoso.Plugins.RecalculateProject',
                },
                links: { record: `${SAMPLE_ENVIRONMENT_URL}/main.aspx?pagetype=entityrecord&etn=customapi&id=d2000000-0000-4000-8000-000000000002` },
                source: { table: 'customapi', id: 'd2000000-0000-4000-8000-000000000002' },
            },
        ]);
        const raw = result.raw as Row[];
        expect(raw.map((r) => r.uniquename)).toEqual(['contoso_GetProjectSummary', 'contoso_RecalculateProject']);
        expect(Object.keys(raw[1])).toEqual(['customapiid', 'name', 'uniquename', 'displayname', 'bindingtype', 'isfunction', 'isprivate', 'allowedcustomprocessingsteptype', 'executeprivilegename', 'boundentitylogicalname', '_plugintypeid_value']);
    });

    it('escapes quotes in the table name', () => {
        expect(customApisQuery("o'brien")).toContain("boundentitylogicalname eq 'o''brien'");
    });

    it('returns an empty result when no custom API is bound to the table', async () => {
        const result = await customApisSource.run(makeCtx({ client: makeFakeClient() }));
        expect(result).toEqual({ items: [], customApiNames: [], raw: [] });
    });
});

/**
 * Custom APIs bound to the table (`customapi.boundentitylogicalname`).
 *
 * A custom API is its own SDK message (`Custom:<uniquename>`); its implementation (a plugin type,
 * or nothing when a flow / no-op handles it) runs in the main operation stage. Plugin steps
 * registered on the message are picked up by `pluginSteps`, which maps message names to
 * `Custom:` events through `ctx.customApiNames` (fed by `customApiNames` in this result).
 * Global custom APIs have no bound table and therefore never appear here.
 */
import { odataString } from '../data/client';
import { CUSTOM_API_BINDING_LABEL, CUSTOM_API_STEP_TYPE_LABEL } from '../domain/codes';
import type { Row } from '../data/client';
import type { LogicItem } from '../domain/model';
import type { Source, SourceResult } from './types';
import { codeLabel, recordUrl, str } from './types';

// Label tables live in domain/codes.ts (single place for numeric-code interpretation); re-exported for consumers.
export { CUSTOM_API_BINDING_LABEL, CUSTOM_API_STEP_TYPE_LABEL };

const SELECT = 'customapiid,name,uniquename,displayname,bindingtype,isfunction,isprivate,allowedcustomprocessingsteptype,executeprivilegename,boundentitylogicalname,_plugintypeid_value';

export function customApisQuery(table: string): string {
    return `customapis?$select=${SELECT}&$filter=boundentitylogicalname eq ${odataString(table)}`;
}

export function customApiItem(environmentUrl: string, row: Row): LogicItem {
    const id = str(row.customapiid) ?? '';
    const uniqueName = str(row.uniquename) ?? str(row.name) ?? id;
    const pluginTypeId = str(row._plugintypeid_value);
    // The formatted-value annotation carries the plugin type name when annotations are returned.
    const pluginType = str(row['_plugintypeid_value@OData.Community.Display.V1.FormattedValue']);
    return {
        id,
        kind: 'customapi',
        name: str(row.displayname) ?? str(row.name) ?? uniqueName,
        event: `Custom:${uniqueName}`,
        stage: 'mainoperation',
        enabled: true,
        mode: 'sync',
        confidence: 'exact',
        details: {
            uniqueName,
            displayName: str(row.displayname) ?? '',
            bindingType: codeLabel(CUSTOM_API_BINDING_LABEL, row.bindingtype),
            isFunction: row.isfunction === true,
            isPrivate: row.isprivate === true,
            allowedStepType: codeLabel(CUSTOM_API_STEP_TYPE_LABEL, row.allowedcustomprocessingsteptype),
            executePrivilegeName: str(row.executeprivilegename) ?? null,
            implementation: pluginTypeId ? 'plugin' : 'none (flow/none)',
            pluginTypeId: pluginTypeId ?? null,
            pluginType: pluginType ?? null,
        },
        links: { record: recordUrl(environmentUrl, 'customapi', id) },
        source: { table: 'customapi', id },
    };
}

function compactRow(row: Row): Row {
    return {
        customapiid: row.customapiid,
        name: row.name,
        uniquename: row.uniquename,
        displayname: row.displayname,
        bindingtype: row.bindingtype,
        isfunction: row.isfunction,
        isprivate: row.isprivate,
        allowedcustomprocessingsteptype: row.allowedcustomprocessingsteptype,
        executeprivilegename: row.executeprivilegename,
        boundentitylogicalname: row.boundentitylogicalname,
        _plugintypeid_value: row._plugintypeid_value,
    };
}

export const customApisSource: Source = {
    name: 'customApis',
    async run(ctx): Promise<SourceResult> {
        const rows = await ctx.client.query(customApisQuery(ctx.table.logicalName), { signal: ctx.signal });
        const sorted = rows.filter((r) => str(r.customapiid)).sort((a, b) => String(a.uniquename ?? '').localeCompare(String(b.uniquename ?? '')) || String(a.customapiid).localeCompare(String(b.customapiid)));
        const items = sorted.map((r) => customApiItem(ctx.environmentUrl, r));
        const customApiNames = [...new Set(sorted.map((r) => str(r.uniquename)).filter((n): n is string => n !== undefined))].sort();
        return { items, customApiNames, raw: sorted.map(compactRow) };
    },
};

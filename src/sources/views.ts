/**
 * System views (`savedquery`) of the table — header context only ("14 views, 3 quick find").
 * No logic items: views shape what users see, they do not run on events.
 */
import { odataString } from '../data/client';
import type { Row } from '../data/client';
import type { Source, SourceResult } from './types';

export function savedQueriesQuery(table: string): string {
    return `savedqueries?$select=savedqueryid,name,querytype,isdefault,isquickfindquery&$filter=returnedtypecode eq ${odataString(table)}`;
}

function compactRow(row: Row): Row {
    return { savedqueryid: row.savedqueryid, name: row.name, querytype: row.querytype, isdefault: row.isdefault, isquickfindquery: row.isquickfindquery };
}

export const viewsSource: Source = {
    name: 'views',
    async run(ctx): Promise<SourceResult> {
        const rows = await ctx.client.query(savedQueriesQuery(ctx.table.logicalName), { signal: ctx.signal });
        const names = rows.map((r) => (typeof r.name === 'string' ? r.name : '')).filter(Boolean).sort((a, b) => a.localeCompare(b));
        const quickFind = rows.filter((r) => r.isquickfindquery === true).length;
        return { items: [], views: { total: rows.length, quickFind, names }, raw: rows.map(compactRow) };
    },
};

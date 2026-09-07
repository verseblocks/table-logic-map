/**
 * Model-driven apps that include the table.
 *
 * `appmodulecomponent` rows with `componenttype` 1 (Entity) and `objectid` = the table's MetadataId
 * point at the apps; the app rows are then fetched in chunks of 20 ids. Context only — no items.
 *
 * Dataverse semantics: `appmodulecomponent` has exactly one app lookup, the single-valued
 * navigation property `appmoduleid`, whose lookup value is exposed as `_appmoduleidunique_value`
 * (there is no `_appmoduleid_value`; selecting it fails the request with a 400). That value is the
 * app's `appmoduleidunique` — the alternate key the navigation property references — and NOT the
 * `appmodule` primary key, so the second hop filters `appmodules` on `appmoduleidunique`.
 * `appmoduleid` is still selected there because links and ids use the primary key.
 */
import { chunk } from '../data/client';
import type { Row } from '../data/client';
import { APP_STATE_LABEL } from '../domain/codes';
import type { AppInfo } from '../domain/model';
import type { Source, SourceResult } from './types';
import { str } from './types';

export const APP_CHUNK_SIZE = 20;

/** `objectid` is an Edm.Guid: the literal is unquoted. */
export function appComponentsQuery(tableMetadataId: string): string {
    return `appmodulecomponents?$select=_appmoduleidunique_value,componenttype,objectid&$filter=componenttype eq 1 and objectid eq ${tableMetadataId}`;
}

/** Ids here are `appmoduleidunique` values (see the module comment), not `appmoduleid`. */
export function appModulesQuery(appUniqueIds: readonly string[]): string {
    return `appmodules?$select=appmoduleid,appmoduleidunique,name,uniquename,ismanaged,statecode&$filter=${appUniqueIds.map((id) => `appmoduleidunique eq ${id}`).join(' or ')}`;
}

export function toAppInfo(row: Row): AppInfo {
    // `appmoduleid` is the primary key used for links; fall back to the unique id when it is absent.
    const id = str(row.appmoduleid) ?? str(row.appmoduleidunique) ?? '';
    return {
        id,
        name: str(row.name) ?? str(row.uniquename) ?? id,
        uniqueName: str(row.uniquename) ?? '',
        isManaged: row.ismanaged === true,
        state: typeof row.statecode === 'number' ? (APP_STATE_LABEL[row.statecode] ?? String(row.statecode)) : 'Unknown',
    };
}

export const appsSource: Source = {
    name: 'apps',
    async run(ctx): Promise<SourceResult> {
        const metadataId = ctx.table.metadataId.replace(/[{}]/g, '');
        if (!metadataId) return { items: [], apps: [] };
        const components = await ctx.client.query(appComponentsQuery(metadataId), { signal: ctx.signal });
        const appIds = [...new Set(components.map((c) => str(c._appmoduleidunique_value)?.toLowerCase()).filter((id): id is string => id !== undefined))].sort();
        const pages = await Promise.all(chunk(appIds, APP_CHUNK_SIZE).map((ids) => ctx.client.query(appModulesQuery(ids), { signal: ctx.signal })));
        const appRows = pages.flat().filter((r) => str(r.appmoduleid) ?? str(r.appmoduleidunique));
        const apps = appRows.map(toAppInfo).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return {
            items: [],
            apps,
            raw: {
                components: components.map((c) => ({ _appmoduleidunique_value: c._appmoduleidunique_value, componenttype: c.componenttype, objectid: c.objectid })),
                apps: appRows.map((r) => ({ appmoduleid: r.appmoduleid, appmoduleidunique: r.appmoduleidunique, name: r.name, uniquename: r.uniquename, ismanaged: r.ismanaged, statecode: r.statecode })),
            },
        };
    },
};

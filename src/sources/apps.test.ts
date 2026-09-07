import { describe, expect, it } from 'vitest';
import type { Row } from '../data/client';
import { APP_CHUNK_SIZE, appComponentsQuery, appModulesQuery, appsSource, toAppInfo } from './apps';
import { SAMPLE_TABLE, makeCtx, makeFakeClient } from './testUtils';

const SALES_APP = '8a000000-0000-4000-8000-0000000000a1';
const SALES_UNIQUE = '8a000000-0000-4000-8000-0000000000u1';
const PROJECTS_APP = '8b000000-0000-4000-8000-0000000000b2';
const PROJECTS_UNIQUE = '8b000000-0000-4000-8000-0000000000u2';

/**
 * `appmodulecomponents?$select=_appmoduleidunique_value,componenttype,objectid&$filter=componenttype eq 1 and objectid eq <MetadataId>`.
 * The app lookup value is the app's `appmoduleidunique`, not its `appmoduleid` (there is no
 * `_appmoduleid_value` on `appmodulecomponent`).
 */
const COMPONENTS: Row[] = [
    { appmodulecomponentid: '90000000-0000-4000-8000-000000000001', _appmoduleidunique_value: SALES_UNIQUE, componenttype: 1, objectid: SAMPLE_TABLE.metadataId },
    { appmodulecomponentid: '90000000-0000-4000-8000-000000000002', _appmoduleidunique_value: PROJECTS_UNIQUE, componenttype: 1, objectid: SAMPLE_TABLE.metadataId },
    // The same app can reference the table twice (e.g. after a solution upgrade); ids are de-duplicated.
    { appmodulecomponentid: '90000000-0000-4000-8000-000000000003', _appmoduleidunique_value: PROJECTS_UNIQUE.toUpperCase(), componenttype: 1, objectid: SAMPLE_TABLE.metadataId },
];

/** `appmodules?$select=appmoduleid,appmoduleidunique,name,uniquename,ismanaged,statecode&$filter=appmoduleidunique eq ... or ...`. */
const APPS: Row[] = [
    { appmoduleid: SALES_APP, appmoduleidunique: SALES_UNIQUE, name: 'Sales Hub', uniquename: 'msdynce_saleshub', ismanaged: true, statecode: 0 },
    { appmoduleid: PROJECTS_APP, appmoduleidunique: PROJECTS_UNIQUE, name: 'Contoso Projects', uniquename: 'contoso_projects', ismanaged: false, statecode: 1 },
];

describe('appsSource', () => {
    it('joins components to apps through appmoduleidunique and lists the apps sorted by name', async () => {
        const client = makeFakeClient({ appmodulecomponents: COMPONENTS, appmodules: APPS });
        const result = await appsSource.run(makeCtx({ client }));

        expect(client.paths).toEqual([appComponentsQuery(SAMPLE_TABLE.metadataId), appModulesQuery([SALES_UNIQUE, PROJECTS_UNIQUE])]);
        expect(client.paths[0]).toContain(`$filter=componenttype eq 1 and objectid eq ${SAMPLE_TABLE.metadataId}`);
        expect(client.paths[1]).toContain('$select=appmoduleid,appmoduleidunique,name,uniquename,ismanaged,statecode');
        expect(client.paths[1]).toContain(`$filter=appmoduleidunique eq ${SALES_UNIQUE} or appmoduleidunique eq ${PROJECTS_UNIQUE}`);

        expect(result.items).toEqual([]);
        expect(result.apps).toEqual([
            { id: PROJECTS_APP, name: 'Contoso Projects', uniqueName: 'contoso_projects', isManaged: false, state: 'Inactive' },
            { id: SALES_APP, name: 'Sales Hub', uniqueName: 'msdynce_saleshub', isManaged: true, state: 'Active' },
        ]);
        expect(result.raw).toEqual({
            components: COMPONENTS.map((c) => ({ _appmoduleidunique_value: c._appmoduleidunique_value, componenttype: 1, objectid: SAMPLE_TABLE.metadataId })),
            apps: APPS,
        });
    });

    // `appmodulecomponent` exposes no `_appmoduleid_value`; selecting it made Dataverse reject the
    // whole request with a 400, so the Apps list was empty on every run.
    it('never asks for properties that do not exist on appmodulecomponent / appmodule', () => {
        expect(appComponentsQuery(SAMPLE_TABLE.metadataId)).not.toContain('_appmoduleid_value');
        expect(appModulesQuery([SALES_UNIQUE])).not.toContain('appmoduleid eq');
        expect(appModulesQuery([SALES_UNIQUE])).toContain('appmoduleidunique eq');
    });

    it('reports the app primary key (appmoduleid), not the unique id, as the app id', () => {
        expect(toAppInfo(APPS[0]!).id).toBe(SALES_APP);
    });

    it('fetches app modules in chunks of 20 ids', async () => {
        const components = Array.from({ length: 41 }, (_, i) => ({ _appmoduleidunique_value: `8c000000-0000-4000-8000-${String(i).padStart(12, '0')}`, componenttype: 1, objectid: SAMPLE_TABLE.metadataId }));
        const client = makeFakeClient({ appmodulecomponents: components, appmodules: (call) => [{ appmoduleid: call.path.slice(-36), name: call.path.slice(-36) }] });
        const result = await appsSource.run(makeCtx({ client }));
        const appCalls = client.paths.filter((p) => p.startsWith('appmodules'));
        expect(appCalls.map((p) => p.split(' or ').length)).toEqual([APP_CHUNK_SIZE, APP_CHUNK_SIZE, 1]);
        expect(result.apps).toHaveLength(3);
    });

    it('returns no apps without a metadata id or without components', async () => {
        const noId = await appsSource.run(makeCtx({ client: makeFakeClient(), table: { metadataId: '' } }));
        expect(noId).toEqual({ items: [], apps: [] });

        const client = makeFakeClient();
        const empty = await appsSource.run(makeCtx({ client }));
        expect(client.paths).toEqual([appComponentsQuery(SAMPLE_TABLE.metadataId)]);
        expect(empty).toEqual({ items: [], apps: [], raw: { components: [], apps: [] } });
    });
});

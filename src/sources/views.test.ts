import { describe, expect, it } from 'vitest';
import type { Row } from '../data/client';
import { savedQueriesQuery, viewsSource } from './views';
import { makeCtx, makeFakeClient } from './testUtils';

/** `savedqueries?$select=savedqueryid,name,querytype,isdefault,isquickfindquery&$filter=returnedtypecode eq 'contoso_project'`. */
const VIEWS: Row[] = [
    { savedqueryid: 'a0000000-0000-4000-8000-000000000001', name: 'My Active Projects', querytype: 0, isdefault: false, isquickfindquery: false },
    { savedqueryid: 'a0000000-0000-4000-8000-000000000002', name: 'Active Projects', querytype: 0, isdefault: true, isquickfindquery: false },
    { savedqueryid: 'a0000000-0000-4000-8000-000000000003', name: 'Quick Find Active Projects', querytype: 4, isdefault: false, isquickfindquery: true },
    { savedqueryid: 'a0000000-0000-4000-8000-000000000004', name: 'Project Lookup View', querytype: 64, isdefault: true, isquickfindquery: false },
];

describe('viewsSource', () => {
    it('counts views and quick find views and lists names sorted', async () => {
        const client = makeFakeClient({ savedqueries: VIEWS });
        const result = await viewsSource.run(makeCtx({ client }));

        expect(client.paths).toEqual([savedQueriesQuery('contoso_project')]);
        expect(client.paths[0]).toContain("$filter=returnedtypecode eq 'contoso_project'");
        expect(client.paths[0]).toContain('$select=savedqueryid,name,querytype,isdefault,isquickfindquery');
        expect(result).toEqual({
            items: [],
            views: { total: 4, quickFind: 1, names: ['Active Projects', 'My Active Projects', 'Project Lookup View', 'Quick Find Active Projects'] },
            raw: VIEWS,
        });
    });

    it('returns zero counts for a table without views', async () => {
        const result = await viewsSource.run(makeCtx({ client: makeFakeClient() }));
        expect(result).toEqual({ items: [], views: { total: 0, quickFind: 0, names: [] }, raw: [] });
    });
});

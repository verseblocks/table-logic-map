import { describe, expect, it } from 'vitest';
import { ORG_SETTINGS_QUERY, auditNote, orgSettingsSource } from './orgSettings';
import { makeCtx, makeFakeClient } from './testUtils';

// Shape of `organizations?$select=...` — the id is always returned alongside the selected columns.
const ORG_ROW = {
    '@odata.etag': 'W/"1234567"',
    organizationid: 'c0a80101-0000-4000-8000-00000000abcd',
    isauditenabled: true,
    isduplicatedetectionenabled: true,
    isduplicatedetectionenabledforonlinecreateupdate: false,
};

describe('orgSettingsSource', () => {
    it('queries the three org flags and reports effective auditing for an audited table', async () => {
        const client = makeFakeClient({ organizations: [ORG_ROW] });
        const result = await orgSettingsSource.run(makeCtx({ client, table: { audit: true } }));

        expect(client.paths).toEqual([ORG_SETTINGS_QUERY]);
        expect(client.paths[0]).toContain('$select=isauditenabled,isduplicatedetectionenabled,isduplicatedetectionenabledforonlinecreateupdate');
        expect(result.org).toEqual({ auditEnabled: true, duplicateDetectionEnabled: true, duplicateDetectionOnCreateUpdate: false });
        expect(result.items).toEqual([
            {
                id: 'audit:contoso_project',
                kind: 'audit',
                name: 'Auditing',
                event: 'Any',
                stage: 'always',
                enabled: true,
                mode: 'rule',
                confidence: 'exact',
                details: { orgEnabled: true, tableEnabled: true, effective: true, note: auditNote(true, true) },
                source: { table: 'organization', id: ORG_ROW.organizationid },
            },
        ]);
        expect(result.raw).toEqual([
            {
                organizationid: ORG_ROW.organizationid,
                isauditenabled: true,
                isduplicatedetectionenabled: true,
                isduplicatedetectionenabledforonlinecreateupdate: false,
            },
        ]);
    });

    it('is not effective when the org audits but the table does not', async () => {
        const client = makeFakeClient({ organizations: [ORG_ROW] });
        const result = await orgSettingsSource.run(makeCtx({ client, table: { audit: false } }));
        expect(result.items[0].enabled).toBe(false);
        expect(result.items[0].details).toMatchObject({ orgEnabled: true, tableEnabled: false, effective: false });
    });

    it('is not effective when the table audits but the org does not', async () => {
        const client = makeFakeClient({ organizations: [{ ...ORG_ROW, isauditenabled: false }] });
        const result = await orgSettingsSource.run(makeCtx({ client, table: { audit: true } }));
        expect(result.items[0].enabled).toBe(false);
        expect(result.items[0].details.note).toBe(auditNote(false, true));
        expect(result.org?.auditEnabled).toBe(false);
    });

    it('yields an empty org and a disabled audit item when nothing comes back', async () => {
        const client = makeFakeClient();
        const result = await orgSettingsSource.run(makeCtx({ client }));
        expect(result.org).toEqual({});
        expect(result.items).toHaveLength(1);
        expect(result.items[0].enabled).toBe(false);
        expect(result.items[0].source).toEqual({ table: 'organization', id: undefined });
        expect(result.raw).toEqual([]);
    });
});

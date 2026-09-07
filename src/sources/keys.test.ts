import { describe, expect, it } from 'vitest';
import type { Row } from '../data/client';
import { KEY_PROPS, keysSource } from './keys';
import { makeCtx, makeFakeClient, metadataPath } from './testUtils';

const displayName = (text: string) => ({ LocalizedLabels: [{ Label: text, LanguageCode: 1033 }], UserLocalizedLabel: { Label: text, LanguageCode: 1033 } });

/** EntityKeyMetadata rows (`EntityDefinitions(...)/Keys?$select=...`). */
const KEYS: Row[] = [
    {
        MetadataId: 'b2e1c0d9-1111-4aaa-9bbb-000000000002',
        SchemaName: 'contoso_project_externalkey',
        LogicalName: 'contoso_project_externalkey',
        DisplayName: displayName('External Key'),
        KeyAttributes: ['contoso_sourcesystem', 'contoso_externalid'],
        EntityKeyIndexStatus: 'Pending',
    },
    {
        MetadataId: 'a1d0b9c8-1111-4aaa-9bbb-000000000001',
        SchemaName: 'contoso_project_code',
        LogicalName: 'contoso_project_code',
        DisplayName: displayName('Project Code'),
        KeyAttributes: ['contoso_code'],
        EntityKeyIndexStatus: 'Active',
    },
];

describe('keysSource', () => {
    it('requests the key properties and emits Create + Update items per key, sorted by schema name', async () => {
        const client = makeFakeClient({ '/Keys': KEYS });
        const result = await keysSource.run(makeCtx({ client }));

        expect(client.calls).toEqual([{ kind: 'relatedMetadata', path: metadataPath('contoso_project', 'Keys'), props: KEY_PROPS }]);
        expect(KEY_PROPS).toEqual(['SchemaName', 'DisplayName', 'KeyAttributes', 'EntityKeyIndexStatus', 'LogicalName', 'MetadataId']);
        expect(result.items).toEqual([
            {
                id: 'key:a1d0b9c8-1111-4aaa-9bbb-000000000001:Create',
                kind: 'key',
                name: 'Project Code',
                event: 'Create',
                groupId: 'a1d0b9c8-1111-4aaa-9bbb-000000000001',
                stage: 'always',
                enabled: true,
                mode: 'rule',
                touchesColumns: ['contoso_code'],
                confidence: 'exact',
                details: { schemaName: 'contoso_project_code', displayName: 'Project Code', status: 'Active', logicalName: 'contoso_project_code', attributes: ['contoso_code'] },
                source: { table: 'entitykey', id: 'a1d0b9c8-1111-4aaa-9bbb-000000000001' },
            },
            {
                id: 'key:a1d0b9c8-1111-4aaa-9bbb-000000000001:Update',
                kind: 'key',
                name: 'Project Code',
                event: 'Update',
                groupId: 'a1d0b9c8-1111-4aaa-9bbb-000000000001',
                stage: 'always',
                enabled: true,
                mode: 'rule',
                touchesColumns: ['contoso_code'],
                confidence: 'exact',
                details: { schemaName: 'contoso_project_code', displayName: 'Project Code', status: 'Active', logicalName: 'contoso_project_code', attributes: ['contoso_code'] },
                source: { table: 'entitykey', id: 'a1d0b9c8-1111-4aaa-9bbb-000000000001' },
            },
            {
                id: 'key:b2e1c0d9-1111-4aaa-9bbb-000000000002:Create',
                kind: 'key',
                name: 'External Key',
                event: 'Create',
                groupId: 'b2e1c0d9-1111-4aaa-9bbb-000000000002',
                stage: 'always',
                enabled: false,
                mode: 'rule',
                touchesColumns: ['contoso_externalid', 'contoso_sourcesystem'],
                confidence: 'exact',
                details: { schemaName: 'contoso_project_externalkey', displayName: 'External Key', status: 'Pending', logicalName: 'contoso_project_externalkey', attributes: ['contoso_externalid', 'contoso_sourcesystem'] },
                source: { table: 'entitykey', id: 'b2e1c0d9-1111-4aaa-9bbb-000000000002' },
            },
            {
                id: 'key:b2e1c0d9-1111-4aaa-9bbb-000000000002:Update',
                kind: 'key',
                name: 'External Key',
                event: 'Update',
                groupId: 'b2e1c0d9-1111-4aaa-9bbb-000000000002',
                stage: 'always',
                enabled: false,
                mode: 'rule',
                touchesColumns: ['contoso_externalid', 'contoso_sourcesystem'],
                confidence: 'exact',
                details: { schemaName: 'contoso_project_externalkey', displayName: 'External Key', status: 'Pending', logicalName: 'contoso_project_externalkey', attributes: ['contoso_externalid', 'contoso_sourcesystem'] },
                source: { table: 'entitykey', id: 'b2e1c0d9-1111-4aaa-9bbb-000000000002' },
            },
        ]);
        expect(result.raw).toEqual([
            { MetadataId: 'a1d0b9c8-1111-4aaa-9bbb-000000000001', SchemaName: 'contoso_project_code', LogicalName: 'contoso_project_code', DisplayName: 'Project Code', KeyAttributes: ['contoso_code'], EntityKeyIndexStatus: 'Active' },
            { MetadataId: 'b2e1c0d9-1111-4aaa-9bbb-000000000002', SchemaName: 'contoso_project_externalkey', LogicalName: 'contoso_project_externalkey', DisplayName: 'External Key', KeyAttributes: ['contoso_externalid', 'contoso_sourcesystem'], EntityKeyIndexStatus: 'Pending' },
        ]);
    });

    it('returns an empty result for a table without keys', async () => {
        const result = await keysSource.run(makeCtx({ client: makeFakeClient() }));
        expect(result).toEqual({ items: [], raw: [] });
    });
});

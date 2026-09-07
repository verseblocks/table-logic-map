import { describe, expect, it } from 'vitest';
import type { Row } from '../data/client';
import { fieldPermissionsQuery, fieldSecuritySource } from './fieldSecurity';
import { SAMPLE_ENVIRONMENT_URL, makeCtx, makeFakeClient } from './testUtils';

const FINANCE = '5a000000-0000-4000-8000-00000000f1a1';
const ADMIN = '5b000000-0000-4000-8000-00000000ad01';

/** `fieldpermissions?...&$filter=entityname eq 'contoso_project'&$expand=fieldsecurityprofileid($select=name,fieldsecurityprofileid)`. */
const PERMISSIONS: Row[] = [
    {
        fieldpermissionid: '60000000-0000-4000-8000-000000000001',
        attributelogicalname: 'contoso_budget',
        canread: 4,
        cancreate: 4,
        canupdate: 4,
        canreadunmasked: 3,
        _fieldsecurityprofileid_value: FINANCE,
        '_fieldsecurityprofileid_value@OData.Community.Display.V1.FormattedValue': 'Finance',
        fieldsecurityprofileid: { name: 'Finance', fieldsecurityprofileid: FINANCE },
    },
    {
        fieldpermissionid: '60000000-0000-4000-8000-000000000002',
        attributelogicalname: 'contoso_margin',
        canread: 4,
        cancreate: 0,
        canupdate: 0,
        canreadunmasked: 0,
        _fieldsecurityprofileid_value: FINANCE,
        fieldsecurityprofileid: { name: 'Finance', fieldsecurityprofileid: FINANCE },
    },
    {
        fieldpermissionid: '60000000-0000-4000-8000-000000000003',
        attributelogicalname: 'contoso_budget',
        canread: 4,
        cancreate: 4,
        canupdate: 4,
        canreadunmasked: 1,
        _fieldsecurityprofileid_value: ADMIN,
        fieldsecurityprofileid: { name: 'Administrators', fieldsecurityprofileid: ADMIN },
    },
];

describe('fieldSecuritySource', () => {
    it('filters on entityname, expands the profile and groups permissions per profile', async () => {
        const client = makeFakeClient({ fieldpermissions: PERMISSIONS });
        const result = await fieldSecuritySource.run(makeCtx({ client }));

        expect(client.paths).toEqual([fieldPermissionsQuery('contoso_project')]);
        expect(client.paths[0]).toContain("$filter=entityname eq 'contoso_project'");
        expect(client.paths[0]).toContain('$expand=fieldsecurityprofileid($select=name,fieldsecurityprofileid)');
        expect(client.paths[0]).toContain('$select=fieldpermissionid,attributelogicalname,canread,cancreate,canupdate,canreadunmasked,_fieldsecurityprofileid_value');

        expect(result.items).toEqual([
            {
                id: `fieldsecurity:${ADMIN}`,
                kind: 'fieldsecurity',
                name: 'Administrators',
                event: 'Any',
                stage: 'always',
                enabled: true,
                mode: 'rule',
                touchesColumns: ['contoso_budget'],
                confidence: 'exact',
                details: {
                    profileId: ADMIN,
                    profileName: 'Administrators',
                    permissions: [{ attribute: 'contoso_budget', canRead: 'Allowed', canCreate: 'Allowed', canUpdate: 'Allowed', canReadUnmasked: 'One Record' }],
                },
                links: { record: `${SAMPLE_ENVIRONMENT_URL}/main.aspx?pagetype=entityrecord&etn=fieldsecurityprofile&id=${ADMIN}` },
                source: { table: 'fieldsecurityprofile', id: ADMIN },
            },
            {
                id: `fieldsecurity:${FINANCE}`,
                kind: 'fieldsecurity',
                name: 'Finance',
                event: 'Any',
                stage: 'always',
                enabled: true,
                mode: 'rule',
                touchesColumns: ['contoso_budget', 'contoso_margin'],
                confidence: 'exact',
                details: {
                    profileId: FINANCE,
                    profileName: 'Finance',
                    permissions: [
                        { attribute: 'contoso_budget', canRead: 'Allowed', canCreate: 'Allowed', canUpdate: 'Allowed', canReadUnmasked: 'All Records' },
                        { attribute: 'contoso_margin', canRead: 'Allowed', canCreate: 'Not Allowed', canUpdate: 'Not Allowed', canReadUnmasked: 'Not Allowed' },
                    ],
                },
                links: { record: `${SAMPLE_ENVIRONMENT_URL}/main.aspx?pagetype=entityrecord&etn=fieldsecurityprofile&id=${FINANCE}` },
                source: { table: 'fieldsecurityprofile', id: FINANCE },
            },
        ]);
        expect(result.raw).toEqual([
            { fieldpermissionid: '60000000-0000-4000-8000-000000000001', attributelogicalname: 'contoso_budget', canread: 4, cancreate: 4, canupdate: 4, canreadunmasked: 3, profileId: FINANCE, profileName: 'Finance' },
            { fieldpermissionid: '60000000-0000-4000-8000-000000000002', attributelogicalname: 'contoso_margin', canread: 4, cancreate: 0, canupdate: 0, canreadunmasked: 0, profileId: FINANCE, profileName: 'Finance' },
            { fieldpermissionid: '60000000-0000-4000-8000-000000000003', attributelogicalname: 'contoso_budget', canread: 4, cancreate: 4, canupdate: 4, canreadunmasked: 1, profileId: ADMIN, profileName: 'Administrators' },
        ]);
    });

    it('falls back to the formatted value / id when the expansion is missing', async () => {
        const rows: Row[] = [
            { attributelogicalname: 'contoso_budget', canread: 4, cancreate: 0, canupdate: 0, canreadunmasked: 0, _fieldsecurityprofileid_value: FINANCE, '_fieldsecurityprofileid_value@OData.Community.Display.V1.FormattedValue': 'Finance (annotation)' },
            { attributelogicalname: 'contoso_margin', canread: 0, cancreate: 0, canupdate: 0, canreadunmasked: 0, _fieldsecurityprofileid_value: ADMIN },
            { attributelogicalname: 'orphan', canread: 4, cancreate: 4, canupdate: 4, canreadunmasked: 0, _fieldsecurityprofileid_value: null },
        ];
        const result = await fieldSecuritySource.run(makeCtx({ client: makeFakeClient({ fieldpermissions: rows }) }));
        expect(result.items.map((i) => [i.id, i.name])).toEqual([
            [`fieldsecurity:${ADMIN}`, ADMIN],
            [`fieldsecurity:${FINANCE}`, 'Finance (annotation)'],
        ]);
    });

    it('returns an empty result when the table has no secured columns', async () => {
        const result = await fieldSecuritySource.run(makeCtx({ client: makeFakeClient() }));
        expect(result).toEqual({ items: [], raw: [] });
    });
});

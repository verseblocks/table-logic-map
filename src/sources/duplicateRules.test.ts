import { describe, expect, it } from 'vitest';
import type { Row } from '../data/client';
import { CONDITION_CHUNK_SIZE, duplicateRuleConditionsQuery, duplicateRulesQuery, duplicateRulesSource } from './duplicateRules';
import { SAMPLE_ENVIRONMENT_URL, makeCtx, makeFakeClient } from './testUtils';

const RULE_A = 'f1000000-0000-4000-8000-00000000000a';
const RULE_B = 'f2000000-0000-4000-8000-00000000000b';

/** `duplicaterules?...&$filter=baseentityname eq 'contoso_project' or matchingentityname eq 'contoso_project'`. */
const RULES: Row[] = [
    {
        '@odata.etag': 'W/"3001"',
        duplicateruleid: RULE_B,
        name: 'Projects with the same code',
        statecode: 1,
        statuscode: 2,
        baseentityname: 'contoso_project',
        matchingentityname: 'contoso_project',
        description: 'Blocks a second project with the same code',
        ismanaged: false,
    },
    {
        '@odata.etag': 'W/"3002"',
        duplicateruleid: RULE_A,
        name: 'Account name matches project customer',
        statecode: 0,
        statuscode: 0,
        baseentityname: 'account',
        matchingentityname: 'contoso_project',
        description: null,
        ismanaged: true,
    },
];

/** `duplicateruleconditions?...&$filter=_regardingobjectid_value eq <guid> or ...`. */
const CONDITIONS: Row[] = [
    { duplicateruleconditionid: '01000000-0000-4000-8000-000000000001', _regardingobjectid_value: RULE_B, baseattributename: 'contoso_code', matchingattributename: 'contoso_code', operatorcode: 0, operatorparam: null, ignoreblankvalues: true },
    { duplicateruleconditionid: '01000000-0000-4000-8000-000000000002', _regardingobjectid_value: RULE_B, baseattributename: 'contoso_customerid', matchingattributename: 'contoso_customerid', operatorcode: 0, operatorparam: null, ignoreblankvalues: false },
    { duplicateruleconditionid: '01000000-0000-4000-8000-000000000003', _regardingobjectid_value: RULE_A.toUpperCase(), baseattributename: 'name', matchingattributename: 'contoso_customername', operatorcode: 1, operatorparam: 10, ignoreblankvalues: false },
];

describe('duplicateRulesSource', () => {
    it('queries rules and their conditions, then emits Create + Update items per rule', async () => {
        const client = makeFakeClient({ duplicaterules: RULES, duplicateruleconditions: CONDITIONS });
        const result = await duplicateRulesSource.run(makeCtx({ client, org: { duplicateDetectionEnabled: true } }));

        expect(client.paths).toEqual([duplicateRulesQuery('contoso_project'), duplicateRuleConditionsQuery([RULE_A, RULE_B])]);
        expect(client.paths[0]).toContain("$filter=baseentityname eq 'contoso_project' or matchingentityname eq 'contoso_project'");
        expect(client.paths[0]).toContain('$select=duplicateruleid,name,statecode,statuscode,baseentityname,matchingentityname,description,ismanaged');
        expect(client.paths[1]).toContain('$select=baseattributename,matchingattributename,operatorcode,operatorparam,ignoreblankvalues,_regardingobjectid_value');
        expect(client.paths[1]).toContain(`$filter=_regardingobjectid_value eq ${RULE_A} or _regardingobjectid_value eq ${RULE_B}`);

        expect(result.items.map((i) => [i.id, i.event, i.enabled])).toEqual([
            [`dup:${RULE_A}:Create`, 'Create', false],
            [`dup:${RULE_A}:Update`, 'Update', false],
            [`dup:${RULE_B}:Create`, 'Create', true],
            [`dup:${RULE_B}:Update`, 'Update', true],
        ]);
        expect(result.items[2]).toEqual({
            id: `dup:${RULE_B}:Create`,
            kind: 'duplicaterule',
            name: 'Projects with the same code',
            event: 'Create',
            groupId: RULE_B,
            stage: 'preoperation',
            enabled: true,
            mode: 'sync',
            touchesColumns: ['contoso_code', 'contoso_customerid'],
            confidence: 'exact',
            details: {
                name: 'Projects with the same code',
                description: 'Blocks a second project with the same code',
                baseTable: 'contoso_project',
                matchingTable: 'contoso_project',
                status: 'Published',
                isManaged: false,
                conditions: [
                    { base: 'contoso_code', matching: 'contoso_code', operator: 'Exact Match', param: null, ignoreBlank: true },
                    { base: 'contoso_customerid', matching: 'contoso_customerid', operator: 'Exact Match', param: null, ignoreBlank: false },
                ],
                tableDuplicateDetection: true,
                orgDuplicateDetection: true,
            },
            links: { record: `${SAMPLE_ENVIRONMENT_URL}/main.aspx?pagetype=entityrecord&etn=duplicaterule&id=${RULE_B}` },
            source: { table: 'duplicaterule', id: RULE_B },
        });
        // This table is the *matching* side of rule A → its matching attributes are the touched columns (case-insensitive id match).
        expect(result.items[0]).toMatchObject({
            touchesColumns: ['contoso_customername'],
            details: {
                baseTable: 'account',
                matchingTable: 'contoso_project',
                status: 'Unpublished',
                isManaged: true,
                description: '',
                conditions: [{ base: 'name', matching: 'contoso_customername', operator: 'Same First Characters', param: 10, ignoreBlank: false }],
            },
        });
        expect(result.raw).toEqual({
            rules: [
                { duplicateruleid: RULE_A, name: 'Account name matches project customer', statecode: 0, statuscode: 0, baseentityname: 'account', matchingentityname: 'contoso_project', ismanaged: true },
                { duplicateruleid: RULE_B, name: 'Projects with the same code', statecode: 1, statuscode: 2, baseentityname: 'contoso_project', matchingentityname: 'contoso_project', ismanaged: false },
            ],
            conditions: CONDITIONS.map((c) => ({
                _regardingobjectid_value: c._regardingobjectid_value,
                baseattributename: c.baseattributename,
                matchingattributename: c.matchingattributename,
                operatorcode: c.operatorcode,
                operatorparam: c.operatorparam,
                ignoreblankvalues: c.ignoreblankvalues,
            })),
        });
    });

    it('fetches conditions in chunks of 20 rule ids', async () => {
        const rules = Array.from({ length: 45 }, (_, i) => ({ duplicateruleid: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `Rule ${String(i).padStart(2, '0')}`, statuscode: 2, baseentityname: 'contoso_project', matchingentityname: 'contoso_project' }));
        const client = makeFakeClient({ duplicaterules: rules });
        const result = await duplicateRulesSource.run(makeCtx({ client }));
        const conditionCalls = client.paths.filter((p) => p.startsWith('duplicateruleconditions'));
        expect(conditionCalls).toHaveLength(3);
        expect(conditionCalls.map((p) => p.split(' or ').length)).toEqual([CONDITION_CHUNK_SIZE, CONDITION_CHUNK_SIZE, 5]);
        expect(result.items).toHaveLength(90);
        expect(result.items.every((i) => i.touchesColumns?.length === 0)).toBe(true);
    });

    it('returns an empty result (and no condition query) when the table has no rules', async () => {
        const client = makeFakeClient();
        const result = await duplicateRulesSource.run(makeCtx({ client }));
        expect(client.paths).toEqual([duplicateRulesQuery('contoso_project')]);
        expect(result).toEqual({ items: [], raw: { rules: [], conditions: [] } });
    });
});

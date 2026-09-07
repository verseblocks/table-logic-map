import { describe, expect, it, vi } from 'vitest';
import type { Row } from '../data/client';
import { REQUIRED_LEVEL_NOTE, columnsSource, isShadowAttribute, requiredLevel, toColumnInfo } from './columns';
import { makeCtx, makeFakeClient, metadataPath } from './testUtils';

// The real parser is developed separately; a deterministic stand-in keeps this test self-contained.
vi.mock('../parsers/formula', () => ({
    extractFormulaColumns: (formula: string | null | undefined, known: ReadonlySet<string>) => {
        const found = new Set<string>();
        for (const token of (formula ?? '').match(/[a-z][a-z0-9_]+/gi) ?? []) if (known.has(token.toLowerCase())) found.add(token.toLowerCase());
        return [...found].sort();
    },
}));

const displayName = (text: string) => ({ LocalizedLabels: [{ Label: text, LanguageCode: 1033 }], UserLocalizedLabel: { Label: text, LanguageCode: 1033 } });
const managed = (value: unknown, name: string) => ({ Value: value, CanBeChanged: true, ManagedPropertyLogicalName: name });
const required = (level: string) => managed(level, 'canmodifyrequirementlevelsettings');
const audited = (on: boolean) => managed(on, 'canmodifyauditsettings');

/** AttributeMetadata rows as returned by `EntityDefinitions(...)/Attributes` without `$select` (subset of properties). */
function attribute(overrides: Row): Row {
    return {
        '@odata.type': '#Microsoft.Dynamics.CRM.StringAttributeMetadata',
        MetadataId: `00000000-0000-0000-0000-${String(overrides.LogicalName).length.toString().padStart(12, '0')}`,
        AttributeOf: null,
        AttributeType: 'String',
        RequiredLevel: required('None'),
        IsSecured: false,
        IsAuditEnabled: audited(false),
        IsCustomAttribute: true,
        IsValidForCreate: true,
        IsValidForUpdate: true,
        SourceType: 0,
        AutoNumberFormat: null,
        FormulaDefinition: null,
        ...overrides,
    };
}

const ATTRIBUTES: Row[] = [
    attribute({ LogicalName: 'statecode', SchemaName: 'statecode', DisplayName: displayName('Status'), AttributeType: 'State', RequiredLevel: required('SystemRequired'), IsCustomAttribute: false }),
    attribute({ LogicalName: 'statecodename', SchemaName: 'statecodename', AttributeOf: 'statecode', AttributeType: 'Virtual', IsCustomAttribute: false, SourceType: null }),
    attribute({ LogicalName: 'contoso_name', SchemaName: 'contoso_Name', DisplayName: displayName('Project Name'), RequiredLevel: required('ApplicationRequired'), IsAuditEnabled: audited(true) }),
    attribute({ LogicalName: 'contoso_projectid', SchemaName: 'contoso_ProjectId', DisplayName: displayName('Project'), AttributeType: 'Uniqueidentifier', RequiredLevel: required('SystemRequired') }),
    attribute({ LogicalName: 'contoso_code', SchemaName: 'contoso_Code', DisplayName: displayName('Project Code'), AutoNumberFormat: 'PRJ-{SEQNUM:5}' }),
    attribute({ LogicalName: 'contoso_budget', SchemaName: 'contoso_Budget', DisplayName: displayName('Budget'), AttributeType: 'Money', RequiredLevel: required('Recommended'), IsSecured: true }),
    attribute({ LogicalName: 'contoso_budget_base', SchemaName: 'contoso_Budget_Base', DisplayName: displayName('Budget (Base)'), AttributeOf: 'contoso_budget', AttributeType: 'Money' }),
    attribute({ LogicalName: 'contoso_rate', SchemaName: 'contoso_Rate', DisplayName: displayName('Rate'), AttributeType: 'Decimal' }),
    attribute({ LogicalName: 'contoso_totalcost', SchemaName: 'contoso_TotalCost', DisplayName: displayName('Total Cost'), AttributeType: 'Money', SourceType: 3, FormulaDefinition: 'contoso_budget * contoso_rate' }),
    attribute({ LogicalName: 'contoso_daysopen', SchemaName: 'contoso_DaysOpen', DisplayName: displayName('Days Open'), AttributeType: 'Integer', SourceType: 1, FormulaDefinition: '<?xml version="1.0"?><CalculatedField><Formula>DiffInDays(createdon, Now())</Formula></CalculatedField>' }),
    attribute({ LogicalName: 'contoso_taskcount', SchemaName: 'contoso_TaskCount', DisplayName: displayName('Task Count'), AttributeType: 'Integer', SourceType: 2, FormulaDefinition: '<?xml version="1.0"?><RollupField><Source>contoso_task</Source><Aggregate>COUNT</Aggregate></RollupField>' }),
    attribute({ LogicalName: 'createdon', SchemaName: 'CreatedOn', DisplayName: displayName('Created On'), AttributeType: 'DateTime', IsCustomAttribute: false }),
];

describe('columnsSource', () => {
    it('requests all attribute properties (no property list) and maps columns sorted by logical name', async () => {
        const client = makeFakeClient({ '/Attributes': ATTRIBUTES });
        const result = await columnsSource.run(makeCtx({ client }));

        expect(client.calls).toEqual([{ kind: 'relatedMetadata', path: metadataPath('contoso_project', 'Attributes'), props: undefined }]);
        expect(result.columns?.map((c) => c.logicalName)).toEqual(['contoso_budget', 'contoso_code', 'contoso_daysopen', 'contoso_name', 'contoso_projectid', 'contoso_rate', 'contoso_taskcount', 'contoso_totalcost', 'createdon', 'statecode']);
        expect(result.columns?.find((c) => c.logicalName === 'contoso_name')).toEqual({
            logicalName: 'contoso_name',
            displayName: 'Project Name',
            type: 'String',
            required: true,
            secured: false,
            audited: true,
            sourceType: 'simple',
            isCustom: true,
            triggers: [],
            touchedBy: [],
        });
        expect(result.columns?.find((c) => c.logicalName === 'contoso_budget')).toMatchObject({ required: false, secured: true, type: 'Money' });
        expect(result.columns?.find((c) => c.logicalName === 'contoso_code')).toMatchObject({ autoNumber: 'PRJ-{SEQNUM:5}' });
        expect(result.columns?.find((c) => c.logicalName === 'contoso_totalcost')).toMatchObject({ sourceType: 'formula' });
        expect(result.columns?.find((c) => c.logicalName === 'contoso_daysopen')).toMatchObject({ sourceType: 'calculated' });
        expect(result.columns?.find((c) => c.logicalName === 'contoso_taskcount')).toMatchObject({ sourceType: 'rollup' });
        expect(result.columns?.find((c) => c.logicalName === 'statecode')).toMatchObject({ required: true, isCustom: false, sourceType: 'simple' });
    });

    it('produces formula/calculated/rollup, autonumber and requiredcolumn items', async () => {
        const client = makeFakeClient({ '/Attributes': ATTRIBUTES });
        const result = await columnsSource.run(makeCtx({ client }));
        const ids = result.items.map((i) => i.id);
        expect(ids).toEqual([
            'autonumber:contoso_project:contoso_code',
            'calculated:contoso_project:contoso_daysopen',
            'requiredcolumn:contoso_project:contoso_name',
            'rollup:contoso_project:contoso_taskcount',
            'formula:contoso_project:contoso_totalcost',
            'requiredcolumn:contoso_project:statecode',
        ]);

        const source = (name: string) => ({ table: 'attribute', id: `00000000-0000-0000-0000-${String(name.length).padStart(12, '0')}` });
        expect(result.items.find((i) => i.kind === 'formula')).toEqual({
            id: 'formula:contoso_project:contoso_totalcost',
            kind: 'formula',
            name: 'Total Cost',
            event: 'Any',
            stage: 'always',
            enabled: true,
            mode: 'rule',
            confidence: 'heuristic',
            touchesColumns: ['contoso_budget', 'contoso_rate'],
            details: { column: 'contoso_totalcost', displayName: 'Total Cost', formula: 'contoso_budget * contoso_rate', sourceType: 'formula' },
            source: source('contoso_totalcost'),
        });
        expect(result.items.find((i) => i.kind === 'calculated')).toMatchObject({ confidence: 'heuristic', touchesColumns: ['createdon'], details: { sourceType: 'calculated' } });
        const rollup = result.items.find((i) => i.kind === 'rollup');
        expect(rollup).toMatchObject({ confidence: 'exact', enabled: true, details: { column: 'contoso_taskcount', sourceType: 'rollup' } });
        expect(rollup?.touchesColumns).toBeUndefined();

        expect(result.items.find((i) => i.kind === 'autonumber')).toEqual({
            id: 'autonumber:contoso_project:contoso_code',
            kind: 'autonumber',
            name: 'Project Code',
            event: 'Create',
            stage: 'preoperation',
            enabled: true,
            mode: 'rule',
            confidence: 'exact',
            touchesColumns: ['contoso_code'],
            details: { column: 'contoso_code', displayName: 'Project Code', format: 'PRJ-{SEQNUM:5}' },
            source: source('contoso_code'),
        });
        expect(result.items.find((i) => i.id === 'requiredcolumn:contoso_project:contoso_name')).toEqual({
            id: 'requiredcolumn:contoso_project:contoso_name',
            kind: 'requiredcolumn',
            name: 'Project Name',
            event: 'FormSave',
            stage: 'client',
            enabled: true,
            mode: 'client',
            confidence: 'exact',
            touchesColumns: ['contoso_name'],
            details: { column: 'contoso_name', displayName: 'Project Name', level: 'ApplicationRequired', note: REQUIRED_LEVEL_NOTE },
            source: source('contoso_name'),
        });
        expect(result.items.find((i) => i.id === 'requiredcolumn:contoso_project:statecode')?.details.level).toBe('SystemRequired');
    });

    it('keeps raw compact and skips shadow attributes', async () => {
        const client = makeFakeClient({ '/Attributes': ATTRIBUTES });
        const result = await columnsSource.run(makeCtx({ client }));
        const raw = result.raw as Row[];
        expect(raw).toHaveLength(10);
        expect(raw.find((r) => r.LogicalName === 'contoso_totalcost')).toEqual({
            LogicalName: 'contoso_totalcost',
            AttributeType: 'Money',
            RequiredLevel: 'None',
            IsSecured: false,
            IsAuditEnabled: false,
            SourceType: 3,
            AutoNumberFormat: null,
            hasFormula: true,
        });
        expect(raw.some((r) => r.LogicalName === 'contoso_budget_base')).toBe(false);
        expect(raw.some((r) => 'FormulaDefinition' in r)).toBe(false);
    });

    it('returns an empty result for a table without attributes', async () => {
        const result = await columnsSource.run(makeCtx({ client: makeFakeClient() }));
        expect(result).toEqual({ items: [], columns: [], raw: [] });
    });

    it('helpers tolerate missing managed properties', () => {
        expect(requiredLevel({})).toBe('None');
        expect(requiredLevel({ RequiredLevel: { Value: 'SystemRequired' } })).toBe('SystemRequired');
        expect(isShadowAttribute({ AttributeOf: null })).toBe(false);
        expect(isShadowAttribute({ AttributeOf: 'ownerid' })).toBe(true);
        expect(toColumnInfo({ LogicalName: 'x' })).toEqual({ logicalName: 'x', displayName: 'x', type: 'Unknown', required: false, secured: false, audited: false, sourceType: 'simple', isCustom: false, triggers: [], touchedBy: [] });
    });
});

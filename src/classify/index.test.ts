import { describe, expect, it } from 'vitest';
import type { ColumnInfo, DependencyInfo, FormInfo, LogicItem, LogicMap, TableFacts } from '../domain/model';
import { createEmptyMap } from '../domain/model';
import type { SourceResult } from '../sources/types';
import { NOTE_AFTER_COMMIT, NOTE_SAME_RANK, buildPipeline, classify, compareItemsForDisplay, detectSmells, expandSynonyms, indexColumns, rederive, sortItems, stageOrderNote, type ClassifyInput } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABLE: TableFacts = {
    logicalName: 'vb_widget',
    entitySetName: 'vb_widgets',
    metadataId: 'meta-1',
    displayName: 'Widget',
    schemaName: 'vb_Widget',
    ownership: 'UserOwned',
    isActivity: false,
    isCustom: true,
    isCustomizable: true,
    isBpfEntity: false,
    audit: false,
    changeTracking: false,
    duplicateDetection: false,
    hasNotes: true,
    hasActivities: false,
};

const ENV = { name: 'Dev', url: 'https://org.crm.dynamics.com' };
const NOW = '2026-01-01T00:00:00.000Z';

function makeItem(over: Partial<LogicItem> & { id: string }): LogicItem {
    return {
        kind: 'plugin',
        name: over.id,
        event: 'Update',
        stage: 'preoperation',
        enabled: true,
        mode: 'sync',
        confidence: 'exact',
        details: {},
        source: { table: 'sdkmessageprocessingstep' },
        ...over,
    };
}

function makeColumn(logicalName: string): ColumnInfo {
    return { logicalName, displayName: logicalName, type: 'String', required: false, secured: false, audited: false, sourceType: 'simple', isCustom: true, triggers: [], touchedBy: [] };
}

function makeForm(id: string, name: string, extra: Partial<FormInfo> = {}): FormInfo {
    return { id, name, type: 'Main', typeCode: 2, state: 'Active', isDefault: false, isManaged: false, libraries: [], handlers: [], pcf: [], components: [], businessRules: [], ...extra };
}

function makeMap(items: LogicItem[] = [], extra: Partial<LogicMap> = {}): LogicMap {
    return { ...createEmptyMap(TABLE, ENV, NOW), items, ...extra };
}

function makeInput(results: Array<{ name: ClassifyInput['results'][number]['name']; result: SourceResult }>, options: ClassifyInput['options'] = {}): ClassifyInput {
    return {
        table: TABLE,
        org: { auditEnabled: true },
        environment: ENV,
        generatedAt: NOW,
        results,
        sourceErrors: [{ source: 'apps', message: 'HTTP 403', kind: 'permission' }],
        options,
        stats: { requests: 12, durationMs: 345, sourcesDone: ['tableMeta', 'apps'], partial: false },
    };
}

const ids = (items: LogicItem[]) => items.map((i) => i.id);

// ---------------------------------------------------------------------------
// Pipeline ordering
// ---------------------------------------------------------------------------

describe('buildPipeline', () => {
    it('orders plugins by rank then name and puts events in display order', () => {
        const items = [
            makeItem({ id: 'p-b', name: 'Beta', order: 1 }),
            makeItem({ id: 'p-c', name: 'Gamma', order: 10 }),
            makeItem({ id: 'p-a', name: 'Alpha', order: 1 }),
            makeItem({ id: 'c-1', name: 'OnCreate', event: 'Create', order: 5 }),
            makeItem({ id: 'm-1', name: 'Custom', event: 'Message:GrantAccess', order: 5 }),
            makeItem({ id: 'x-1', name: 'Api', event: 'Custom:vb_Do', stage: 'mainoperation', kind: 'customapi' }),
        ];
        const pipeline = buildPipeline(items);
        expect(Object.keys(pipeline)).toEqual(['Create', 'Update', 'Custom:vb_Do', 'Message:GrantAccess']);
        expect(ids(pipeline.Update.preoperation)).toEqual(['p-a', 'p-b', 'p-c']);
        expect(pipeline.Update.postoperation).toEqual([]);
    });

    it('puts real-time workflows after plugins of equal rank (missing order = rank 1)', () => {
        const items = [
            makeItem({ id: 'wf-1', name: 'Aaa workflow', kind: 'workflow', mode: 'realtime' }), // rank 1 implied
            makeItem({ id: 'p-3', name: 'Rank three', order: 3 }),
            makeItem({ id: 'p-1', name: 'Zzz plugin', order: 1 }),
            makeItem({ id: 'wf-2', name: 'Bbb workflow', kind: 'workflow', mode: 'realtime', order: 2 }),
        ];
        expect(ids(buildPipeline(items).Update.preoperation)).toEqual(['p-1', 'wf-1', 'wf-2', 'p-3']);
    });

    it('groups postcommit as async plugins, background workflows, flows, then the rest', () => {
        const items = [
            makeItem({ id: 'other', name: 'Aaa other', kind: 'action', stage: 'postcommit', mode: 'async' }),
            makeItem({ id: 'flow-b', name: 'Bbb flow', kind: 'flow', stage: 'postcommit', mode: 'async' }),
            makeItem({ id: 'flow-a', name: 'Aaa flow', kind: 'flow', stage: 'postcommit', mode: 'async' }),
            makeItem({ id: 'wf', name: 'Aaa workflow', kind: 'workflow', stage: 'postcommit', mode: 'background' }),
            makeItem({ id: 'plg-2', name: 'Async plugin two', stage: 'postcommit', mode: 'async', order: 2 }),
            makeItem({ id: 'plg-1', name: 'Async plugin one', stage: 'postcommit', mode: 'async', order: 9 }),
        ];
        expect(ids(buildPipeline(items).Update.postcommit)).toEqual(['plg-2', 'plg-1', 'wf', 'flow-a', 'flow-b', 'other']);
    });

    it('does not mutate the input array', () => {
        const items = [makeItem({ id: 'b', order: 2 }), makeItem({ id: 'a', order: 1 })];
        buildPipeline(items);
        expect(ids(items)).toEqual(['b', 'a']);
    });
});

describe('stageOrderNote', () => {
    it('flags postcommit cells with two or more items only', () => {
        const one = buildPipeline([makeItem({ id: 'a', stage: 'postcommit', mode: 'async' })]);
        const two = buildPipeline([makeItem({ id: 'a', stage: 'postcommit', mode: 'async' }), makeItem({ id: 'b', stage: 'postcommit', mode: 'async' })]);
        expect(stageOrderNote(one.Update, 'postcommit')).toBeUndefined();
        expect(stageOrderNote(two.Update, 'postcommit')).toBe(NOTE_AFTER_COMMIT);
        expect(stageOrderNote(two.Update.postcommit, 'postcommit')).toBe(NOTE_AFTER_COMMIT);
    });

    it('flags a plugin and a real-time workflow sharing a rank', () => {
        const shared = [makeItem({ id: 'p', order: 1 }), makeItem({ id: 'wf', kind: 'workflow', mode: 'realtime' })];
        const distinct = [makeItem({ id: 'p', order: 2 }), makeItem({ id: 'wf', kind: 'workflow', mode: 'realtime' })];
        expect(stageOrderNote(buildPipeline(shared).Update, 'preoperation')).toBe(NOTE_SAME_RANK);
        expect(stageOrderNote(buildPipeline(distinct).Update, 'preoperation')).toBeUndefined();
        expect(stageOrderNote(buildPipeline(shared).Update, 'postoperation')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Synonyms
// ---------------------------------------------------------------------------

describe('sortItems', () => {
    it('orders by event, then stage, then the pipeline order of that stage, then id', () => {
        const items = [
            makeItem({ id: 'post-flow', event: 'Create', kind: 'flow', stage: 'postcommit', mode: 'async' }),
            makeItem({ id: 'update-rank-2', order: 2 }),
            makeItem({ id: 'create-pre', event: 'Create', order: 5 }),
            makeItem({ id: 'post-async-plugin', event: 'Create', stage: 'postcommit', mode: 'async' }),
            makeItem({ id: 'update-rank-1', order: 1 }),
            makeItem({ id: 'setstate', event: 'SetState' }),
            makeItem({ id: 'create-client', event: 'Create', kind: 'formscript', stage: 'client', mode: 'client' }),
        ];
        const sorted = sortItems(items);
        expect(ids(sorted)).toEqual(['create-client', 'create-pre', 'post-async-plugin', 'post-flow', 'update-rank-1', 'update-rank-2', 'setstate']);
        expect(ids(items)).not.toEqual(ids(sorted)); // the input array is not mutated
        expect(sortItems([...items].reverse())).toStrictEqual(sorted);
    });

    it('is a total order (equal only for the same id)', () => {
        const a = makeItem({ id: 'a', name: 'same', order: 1 });
        const b = makeItem({ id: 'b', name: 'same', order: 1 });
        expect(compareItemsForDisplay(a, b)).toBeLessThan(0);
        expect(compareItemsForDisplay(b, a)).toBeGreaterThan(0);
        expect(compareItemsForDisplay(a, { ...a })).toBe(0);
    });
});

describe('expandSynonyms', () => {
    it('adds a SetState twin for Update items filtered on statecode', () => {
        const item = makeItem({ id: 'step-1', filteringAttributes: ['name', 'statecode'] });
        const out = expandSynonyms([item]);
        expect(ids(out)).toEqual(['step-1', 'step-1:setstate']);
        const twin = out[1];
        expect(twin.event).toBe('SetState');
        expect(twin.groupId).toBe('step-1');
        expect(twin.stage).toBe(item.stage);
        expect(twin.details.synonymOf).toBe('step-1');
        expect(twin.filteringAttributes).toEqual(['name', 'statecode']);
    });

    it('adds an Assign twin for ownerid and keeps the original groupId', () => {
        const out = expandSynonyms([makeItem({ id: 'step-2', groupId: 'grp', filteringAttributes: ['ownerid'] })]);
        expect(ids(out)).toEqual(['step-2', 'step-2:assign']);
        expect(out[1].event).toBe('Assign');
        expect(out[1].groupId).toBe('grp');
    });

    it('adds both twins when both columns are present', () => {
        const out = expandSynonyms([makeItem({ id: 's', filteringAttributes: ['ownerid', 'statecode'] })]);
        expect(ids(out)).toEqual(['s', 's:setstate', 's:assign']);
    });

    it('does not duplicate when the group already covers the event', () => {
        const update = makeItem({ id: 'wf:Update', groupId: 'wf', kind: 'workflow', mode: 'realtime', filteringAttributes: ['statecode', 'ownerid'] });
        const setState = makeItem({ id: 'wf:SetState', groupId: 'wf', kind: 'workflow', mode: 'realtime', event: 'SetState' });
        expect(ids(expandSynonyms([update, setState]))).toEqual(['wf:Update', 'wf:Update:assign', 'wf:SetState']);
    });

    it('honours excludeIds (twins removed by a view filter stay removed)', () => {
        const out = expandSynonyms([makeItem({ id: 's', filteringAttributes: ['statecode'] })], new Set(['s:setstate']));
        expect(ids(out)).toEqual(['s']);
    });

    it('flags unfiltered Update plugins/workflows/flows with firesOnAnyUpdate without mutating input', () => {
        const plugin = makeItem({ id: 'p', filteringAttributes: [] });
        const flow = makeItem({ id: 'f', kind: 'flow', stage: 'postcommit', mode: 'async' });
        const workflow = makeItem({ id: 'w', kind: 'workflow', mode: 'background', stage: 'postcommit' });
        const script = makeItem({ id: 'js', kind: 'formscript', stage: 'client', mode: 'client' });
        const filtered = makeItem({ id: 'ok', filteringAttributes: ['name'] });
        const create = makeItem({ id: 'c', event: 'Create' });
        const out = expandSynonyms([plugin, flow, workflow, script, filtered, create]);
        const byId = new Map(out.map((i) => [i.id, i]));
        expect(byId.get('p')?.details.firesOnAnyUpdate).toBe(true);
        expect(byId.get('f')?.details.firesOnAnyUpdate).toBe(true);
        expect(byId.get('w')?.details.firesOnAnyUpdate).toBe(true);
        expect(byId.get('js')?.details.firesOnAnyUpdate).toBeUndefined();
        expect(byId.get('ok')?.details.firesOnAnyUpdate).toBeUndefined();
        expect(byId.get('c')?.details.firesOnAnyUpdate).toBeUndefined();
        expect(plugin.details).toEqual({});
        expect(byId.get('js')).toBe(script);
    });

    it('is idempotent', () => {
        const once = expandSynonyms([makeItem({ id: 's', filteringAttributes: ['statecode'] }), makeItem({ id: 'p' })]);
        expect(expandSynonyms(once)).toEqual(once);
    });
});

// ---------------------------------------------------------------------------
// Column index
// ---------------------------------------------------------------------------

describe('indexColumns', () => {
    it('builds sorted unique triggers/touchedBy and ignores unknown columns', () => {
        const map = makeMap([], { columns: { name: makeColumn('name'), statecode: makeColumn('statecode'), alpha: makeColumn('alpha') } });
        const items = [
            makeItem({ id: 'z', filteringAttributes: ['name', 'ghost'], touchesColumns: ['name'] }),
            makeItem({ id: 'a', filteringAttributes: ['name', 'name'], touchesColumns: ['statecode'] }),
        ];
        const columns = indexColumns(map, items);
        expect(Object.keys(columns)).toEqual(['alpha', 'name', 'statecode']);
        expect(columns.name.triggers).toEqual(['a', 'z']);
        expect(columns.name.touchedBy).toEqual(['z']);
        expect(columns.statecode.triggers).toEqual([]);
        expect(columns.statecode.touchedBy).toEqual(['a']);
        expect(columns.alpha.triggers).toEqual([]);
        expect(columns).not.toHaveProperty('ghost');
        expect(map.columns.name.triggers).toEqual([]); // input untouched
    });
});

// ---------------------------------------------------------------------------
// Business rules → forms
// ---------------------------------------------------------------------------

describe('business rules on forms', () => {
    const brItem = (rule: string, event: 'FormLoad' | 'FieldChange', formId?: string) =>
        makeItem({ id: `${rule}:${event}`, groupId: rule, kind: 'businessrule', stage: 'client', mode: 'rule', event, details: formId ? { formId } : {} });

    it('attaches form-scoped rules to their form and entity-scoped rules to every form', () => {
        const forms = [makeForm('{AAAAAAAA-0000-0000-0000-000000000001}', 'Main'), makeForm('bbbbbbbb-0000-0000-0000-000000000002', 'Quick Create')];
        const items = [
            brItem('rule-entity', 'FieldChange'),
            brItem('rule-entity', 'FormLoad'),
            brItem('rule-main', 'FormLoad', 'aaaaaaaa-0000-0000-0000-000000000001'),
            brItem('rule-main', 'FieldChange', 'aaaaaaaa-0000-0000-0000-000000000001'),
            brItem('rule-qc', 'FormLoad', '{BBBBBBBB-0000-0000-0000-000000000002}'),
            makeItem({ id: 'rule-single', kind: 'businessrule', stage: 'client', event: 'FieldChange' }),
        ];
        const next = rederive(makeMap([], { forms }), items);
        expect(next.forms[0].businessRules).toEqual(['rule-entity:FormLoad', 'rule-main:FormLoad', 'rule-single']);
        expect(next.forms[1].businessRules).toEqual(['rule-entity:FormLoad', 'rule-qc:FormLoad', 'rule-single']);
        expect(forms[0].businessRules).toEqual([]); // input untouched
    });
});

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

describe('dependency classification', () => {
    const dep = (objectId: string, componentType = 92): DependencyInfo => ({ componentType, objectId, classified: false });

    it('matches item id, source id, group id and form id (case/brace-insensitive)', () => {
        const items = [
            makeItem({ id: 'ITEM-1', source: { table: 'sdkmessageprocessingstep', id: '{SRC-1}' } }),
            makeItem({ id: 'wf:Create', groupId: 'GROUP-1', event: 'Create', name: 'B' }),
            makeItem({ id: 'wf:Update', groupId: 'GROUP-1', name: 'A' }),
        ];
        const forms = [makeForm('{FORM-1}', 'Main')];
        const deps = [dep('item-1'), dep('src-1'), dep('{group-1}', 29), dep('form-1', 60), dep('nope', 61)];
        const next = rederive(makeMap([], { forms, dependencies: deps }), items);
        expect(next.dependencies).toEqual([
            { componentType: 92, objectId: 'item-1', classified: true, itemId: 'ITEM-1' },
            { componentType: 92, objectId: 'src-1', classified: true, itemId: 'ITEM-1' },
            { componentType: 29, objectId: '{group-1}', classified: true, itemId: 'wf:Update' },
            { componentType: 60, objectId: 'form-1', classified: true, itemId: '{FORM-1}' },
            { componentType: 61, objectId: 'nope', classified: false },
        ]);
    });
});

// ---------------------------------------------------------------------------
// Smells
// ---------------------------------------------------------------------------

describe('detectSmells', () => {
    const codesOf = (items: LogicItem[], extra: Partial<LogicMap> = {}, maxSyncItems?: number) => detectSmells(makeMap([], extra), items, { maxSyncItems }).map((s) => s.id);

    it('update-no-filter: sync plugins / real-time workflows on Update without filters', () => {
        const bad = makeItem({ id: 'p' });
        const badWf = makeItem({ id: 'wf', kind: 'workflow', mode: 'realtime' });
        const good = makeItem({ id: 'ok', filteringAttributes: ['name'] });
        const asyncPlugin = makeItem({ id: 'async', stage: 'postcommit', mode: 'async' });
        const create = makeItem({ id: 'create', event: 'Create' });
        const smells = detectSmells(makeMap(), [bad, badWf, good, asyncPlugin, create], {});
        const found = smells.filter((s) => s.code === 'update-no-filter');
        expect(found.map((s) => s.id)).toEqual(['smell:update-no-filter:p', 'smell:update-no-filter:wf']);
        expect(found[0]).toMatchObject({ severity: 'warning', itemIds: ['p'], event: 'Update', stage: 'preoperation' });
        expect(found[0].message).toContain('p');
        expect(found[0].explanation.length).toBeGreaterThan(20);
    });

    it('too-many-sync: more than maxSyncItems sync items on one event/stage', () => {
        const six = Array.from({ length: 6 }, (_, i) => makeItem({ id: `p${i}`, filteringAttributes: ['name'], order: i }));
        const smells = detectSmells(makeMap(), six, {});
        const smell = smells.find((s) => s.code === 'too-many-sync');
        expect(smell).toMatchObject({ id: 'smell:too-many-sync:Update:preoperation', severity: 'warning', event: 'Update', stage: 'preoperation' });
        expect(smell?.itemIds).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
        expect(codesOf(six.slice(0, 5))).not.toContain('smell:too-many-sync:Update:preoperation');
        expect(codesOf(six.slice(0, 3), {}, 2)).toContain('smell:too-many-sync:Update:preoperation');
        // async items do not count
        const asyncSix = six.map((i) => ({ ...i, stage: 'postcommit' as const, mode: 'async' as const }));
        expect(codesOf(asyncSix).filter((id) => id.startsWith('smell:too-many-sync'))).toEqual([]);
    });

    it('disabled-clutter: every disabled item, but not synonym twins', () => {
        const disabled = makeItem({ id: 'd', enabled: false, filteringAttributes: ['statecode'] });
        const enabled = makeItem({ id: 'e', filteringAttributes: ['name'] });
        const next = rederive(makeMap(), [disabled, enabled]);
        const clutter = next.smells.filter((s) => s.code === 'disabled-clutter');
        expect(clutter.map((s) => s.id)).toEqual(['smell:disabled-clutter:d']);
        expect(clutter[0].severity).toBe('info');
        expect(next.items.find((i) => i.id === 'd')?.smells).toEqual(['smell:disabled-clutter:d']);
        expect(next.items.find((i) => i.id === 'e')?.smells).toBeUndefined();
    });

    it('disabled-clutter: ignores audit-off and pending-key data rules (a setting, not a leftover registration)', () => {
        const auditOff = makeItem({ id: 'audit:vb_widget', kind: 'audit', event: 'Any', stage: 'always', mode: 'rule', enabled: false, source: { table: 'organization' } });
        const pendingKey = makeItem({ id: 'key-1', kind: 'key', event: 'Create', stage: 'always', mode: 'rule', enabled: false, source: { table: 'entitykey' } });
        const draftFlow = makeItem({ id: 'flow-1', kind: 'flow', stage: 'postcommit', mode: 'async', enabled: false, source: { table: 'workflow' } });
        const next = rederive(makeMap(), [auditOff, pendingKey, draftFlow]);
        expect(next.smells.filter((s) => s.code === 'disabled-clutter').map((s) => s.id)).toEqual(['smell:disabled-clutter:flow-1']);
    });

    it('realtime-plus-plugin: a sync plugin and a real-time workflow on the same event/stage', () => {
        const plugin = makeItem({ id: 'p', filteringAttributes: ['name'] });
        const wf = makeItem({ id: 'wf', kind: 'workflow', mode: 'realtime', filteringAttributes: ['name'] });
        const wfOtherStage = makeItem({ id: 'wf2', kind: 'workflow', mode: 'realtime', stage: 'postoperation', filteringAttributes: ['name'] });
        const smell = detectSmells(makeMap(), [plugin, wf, wfOtherStage], {}).find((s) => s.code === 'realtime-plus-plugin');
        expect(smell).toMatchObject({ id: 'smell:realtime-plus-plugin:Update:preoperation', severity: 'info', itemIds: ['p', 'wf'] });
        expect(codesOf([plugin, wfOtherStage]).filter((id) => id.startsWith('smell:realtime-plus-plugin'))).toEqual([]);
    });

    it('flow-update-unfiltered: flows on Update without columns or a filter expression', () => {
        const flow = (id: string, over: Partial<LogicItem> = {}) => makeItem({ id, kind: 'flow', stage: 'postcommit', mode: 'async', ...over });
        const bad = flow('bad');
        const withColumns = flow('cols', { filteringAttributes: ['name'] });
        const withExpr = flow('expr', { details: { filterExpression: "statecode eq 0" } });
        const onCreate = flow('create', { event: 'Create' });
        const found = codesOf([bad, withColumns, withExpr, onCreate]).filter((id) => id.startsWith('smell:flow-update-unfiltered'));
        expect(found).toEqual(['smell:flow-update-unfiltered:bad']);
        const smell = detectSmells(makeMap(), [bad], {}).find((s) => s.code === 'flow-update-unfiltered');
        expect(smell?.severity).toBe('warning');
        // an unfiltered async flow is not an update-no-filter (that one is for sync logic)
        expect(codesOf([bad]).filter((id) => id.startsWith('smell:update-no-filter'))).toEqual([]);
    });

    it('cascade-chain: self-referential, chainDepth >= 2, or inbound + outbound cascade delete', () => {
        const cascade = (id: string, details: Record<string, unknown>) => makeItem({ id, kind: 'cascade', event: 'Delete', stage: 'always', mode: 'rule', details });
        const selfRef = cascade('self', { child: 'vb_widget', via: 'vb_parentid', behaviour: 'Cascade', action: 'Delete' });
        const deep = cascade('deep', { child: 'vb_part', behaviour: 'Cascade', action: 'Delete', chainDepth: 2 });
        const shallow = cascade('shallow', { child: 'vb_note', behaviour: 'Cascade', action: 'Delete', chainDepth: 1 });
        const restrict = cascade('restrict', { child: 'vb_widget', behaviour: 'Restrict', action: 'Delete' });
        const assign = makeItem({ id: 'assign', kind: 'cascade', event: 'Assign', stage: 'always', mode: 'rule', details: { child: 'vb_widget', behaviour: 'Cascade', action: 'Assign' } });
        const found = detectSmells(makeMap(), [selfRef, deep, shallow, restrict, assign], {}).filter((s) => s.code === 'cascade-chain');
        expect(found.map((s) => s.id)).toEqual(['smell:cascade-chain:deep', 'smell:cascade-chain:self']);
        expect(found[1]).toMatchObject({ severity: 'info', itemIds: ['self'], event: 'Delete', stage: 'always' });

        // parent → this table → child is a two-level chain we can see
        const inbound = cascade('inbound', { parent: 'account', behaviour: 'Cascade' });
        const withInbound = detectSmells(makeMap(), [shallow, inbound], {}).filter((s) => s.code === 'cascade-chain');
        expect(withInbound.map((s) => s.id)).toEqual(['smell:cascade-chain:shallow']);
        expect(withInbound[0].itemIds).toEqual(['inbound', 'shallow']);
        expect(withInbound[0].message).toContain('account');

        // inbound alone or a single shallow outbound is not a chain
        expect(codesOf([inbound]).filter((id) => id.startsWith('smell:cascade-chain'))).toEqual([]);
        expect(codesOf([shallow]).filter((id) => id.startsWith('smell:cascade-chain'))).toEqual([]);
    });

    it('br-plus-js: entity-scoped business rule and an onchange handler on the same column', () => {
        // `processes` writes details.scope = 'entity' (workflow.scope 2) and marks the server-side
        // Create/Update items with serverSide: true; formId is null for every non-form-scoped rule.
        const rule = makeItem({ id: 'br:FormLoad', groupId: 'br', kind: 'businessrule', stage: 'client', mode: 'rule', event: 'FormLoad', touchesColumns: ['name', 'vb_total'], details: { formId: null, scope: 'entity' } });
        const ruleServer = makeItem({ id: 'br:Create', groupId: 'br', kind: 'businessrule', stage: 'preoperation', event: 'Create', touchesColumns: ['name'], details: { formId: null, scope: 'entity', serverSide: true } });
        const formRule = makeItem({ id: 'br2:FormLoad', groupId: 'br2', kind: 'businessrule', stage: 'client', mode: 'rule', event: 'FormLoad', touchesColumns: ['vb_other'], details: { formId: 'f1', scope: 'form' } });
        const js = makeItem({ id: 'js1', kind: 'formscript', stage: 'client', mode: 'client', event: 'FieldChange', filteringAttributes: ['name'] });
        const jsOther = makeItem({ id: 'js2', kind: 'formscript', stage: 'client', mode: 'client', event: 'FieldChange', filteringAttributes: ['vb_other'] });
        const jsLoad = makeItem({ id: 'js3', kind: 'formscript', stage: 'client', mode: 'client', event: 'FormLoad', filteringAttributes: ['vb_total'] });
        const found = detectSmells(makeMap(), [rule, ruleServer, formRule, js, jsOther, jsLoad], {}).filter((s) => s.code === 'br-plus-js');
        expect(found.map((s) => s.id)).toEqual(['smell:br-plus-js:name']);
        expect(found[0]).toMatchObject({ severity: 'info', itemIds: ['br:Create', 'br:FormLoad', 'js1'] });
        expect(codesOf([rule, jsOther]).filter((id) => id.startsWith('smell:br-plus-js'))).toEqual([]);
    });

    it('br-plus-js: all-forms rules (client-only) and rules whose form id could not be read do not fire', () => {
        const js = makeItem({ id: 'js1', kind: 'formscript', stage: 'client', mode: 'client', event: 'FieldChange', filteringAttributes: ['name'] });
        // scope 1 = "All Forms": formId is null but the rule never runs on the server.
        const allForms = makeItem({ id: 'br3:FieldChange', groupId: 'br3', kind: 'businessrule', stage: 'client', mode: 'rule', event: 'FieldChange', touchesColumns: ['name'], details: { formId: null, scope: 'allforms', scopeCode: 1 } });
        expect(detectSmells(makeMap(), [allForms, js], {}).filter((s) => s.code === 'br-plus-js')).toEqual([]);
        // a form-scoped rule read through the `_formid_value` fallback: no formId, no entity scope.
        const unknownForm = makeItem({ id: 'br4:FieldChange', groupId: 'br4', kind: 'businessrule', stage: 'client', mode: 'rule', event: 'FieldChange', touchesColumns: ['name'], details: { formId: null, scope: 'allforms', note: 'form id unavailable' } });
        expect(detectSmells(makeMap(), [unknownForm, js], {}).filter((s) => s.code === 'br-plus-js')).toEqual([]);
    });

    it('sorts smells by code then key and every smell has message + explanation', () => {
        const items = [
            makeItem({ id: 'z-disabled', enabled: false, filteringAttributes: ['name'] }),
            makeItem({ id: 'a-disabled', enabled: false, filteringAttributes: ['name'] }),
            makeItem({ id: 'unfiltered' }),
            makeItem({ id: 'flow', kind: 'flow', stage: 'postcommit', mode: 'async' }),
        ];
        const smells = detectSmells(makeMap(), items, {});
        expect(smells.map((s) => s.id)).toEqual([
            'smell:disabled-clutter:a-disabled',
            'smell:disabled-clutter:z-disabled',
            'smell:flow-update-unfiltered:flow',
            'smell:update-no-filter:unfiltered',
        ]);
        for (const s of smells) {
            expect(s.message).not.toContain('\n');
            expect(s.message.length).toBeGreaterThan(0);
            expect(s.explanation.length).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// classify / rederive
// ---------------------------------------------------------------------------

describe('classify', () => {
    const results = (): ClassifyInput['results'] => [
        {
            name: 'pluginSteps',
            result: {
                items: [
                    makeItem({ id: 'step-1', name: 'Zed', order: 2, filteringAttributes: ['name', 'statecode'], touchesColumns: ['vb_total'] }),
                    makeItem({ id: 'step-1', name: 'Duplicate id' }),
                    makeItem({ id: 'step-2', name: 'Alpha', order: 1, enabled: false, filteringAttributes: ['name'] }),
                ],
                raw: [{ name: 'Zed' }],
            },
        },
        {
            name: 'columns',
            result: { items: [], columns: [makeColumn('vb_total'), makeColumn('name'), makeColumn('statecode')] },
        },
        {
            name: 'forms',
            result: { items: [], forms: [makeForm('f2', 'Zulu'), makeForm('f1', 'Alpha')], raw: { count: 2 } },
        },
        {
            name: 'dependencies',
            result: { items: [], dependencies: [{ componentType: 92, objectId: 'STEP-1', classified: false }, { componentType: 24, objectId: 'f1', classified: false }] },
        },
        { name: 'apps', result: { items: [], apps: [{ id: 'a2', name: 'Zapp', uniqueName: 'z', isManaged: false, state: 'Active' }, { id: 'a1', name: 'App', uniqueName: 'a', isManaged: true, state: 'Active' }] } },
        { name: 'views', result: { items: [], views: { total: 3, quickFind: 1, names: ['Active'] } } },
    ];

    it('merges source extras, raw and stats and de-duplicates item ids', () => {
        const map = classify(makeInput(results()));
        expect(map.table).toBe(TABLE);
        expect(map.environment).toEqual(ENV);
        expect(map.org).toEqual({ auditEnabled: true });
        expect(map.stats.requests).toBe(12);
        expect(map.sourceErrors).toEqual([{ source: 'apps', message: 'HTTP 403', kind: 'permission' }]);
        expect(map.raw).toEqual({ pluginSteps: [{ name: 'Zed' }], forms: { count: 2 } });
        expect(map.views).toEqual({ total: 3, quickFind: 1, names: ['Active'] });
        expect(map.forms.map((f) => f.name)).toEqual(['Alpha', 'Zulu']);
        expect(map.apps.map((a) => a.name)).toEqual(['App', 'Zapp']);
        // items are in execution order (Update by rank, then the SetState twin), not source order
        expect(ids(map.items)).toEqual(['step-2', 'step-1', 'step-1:setstate']);
        expect(map.items.find((i) => i.id === 'step-1')?.name).toBe('Zed');
        expect(Object.keys(map.columns)).toEqual(['name', 'statecode', 'vb_total']);
        expect(map.columns.name.triggers).toEqual(['step-1', 'step-1:setstate', 'step-2']);
        expect(map.columns.vb_total.touchedBy).toEqual(['step-1', 'step-1:setstate']);
        expect(ids(map.pipeline.Update.preoperation)).toEqual(['step-2', 'step-1']);
        expect(ids(map.pipeline.SetState.preoperation)).toEqual(['step-1:setstate']);
        expect(map.dependencies).toEqual([
            { componentType: 24, objectId: 'f1', classified: true, itemId: 'f1' },
            { componentType: 92, objectId: 'STEP-1', classified: true, itemId: 'step-1' },
        ]);
        expect(map.smells.map((s) => s.id)).toEqual(['smell:disabled-clutter:step-2']);
        expect(map.items.find((i) => i.id === 'step-2')?.smells).toEqual(['smell:disabled-clutter:step-2']);
        expect(map.pipeline.Update.preoperation[0].smells).toEqual(['smell:disabled-clutter:step-2']);
    });

    it('passes maxSyncItems through to the smells', () => {
        const map = classify(makeInput(results(), { maxSyncItems: 1 }));
        expect(map.smells.map((s) => s.code)).toContain('too-many-sync');
    });

    it('is deterministic and rederive is idempotent', () => {
        const a = classify(makeInput(results()));
        const b = classify(makeInput(results()));
        expect(b).toStrictEqual(a);
        const once = rederive(a, a.items);
        expect(once).toStrictEqual(a);
        expect(rederive(once, once.items)).toStrictEqual(once);
    });

    it('does not depend on the order in which the sources finished', () => {
        // The orchestrator hands `results` over in completion order, which varies with response
        // timing; the same environment must still produce a byte-identical map.
        const rotate = <T>(list: T[], by: number): T[] => [...list.slice(by), ...list.slice(0, by)];
        const base = classify(makeInput(results()));
        for (let by = 1; by < results().length; by++) {
            expect(classify(makeInput(rotate(results(), by)))).toStrictEqual(base);
            expect(classify(makeInput(rotate(results(), by).reverse()))).toStrictEqual(base);
        }
    });

    it('resolves a duplicate item id by source order, not by which source answered first', () => {
        const withDuplicate = (reversed: boolean): ClassifyInput['results'] => {
            const extra: ClassifyInput['results'] = [
                { name: 'processes', result: { items: [makeItem({ id: 'dup', name: 'From processes', kind: 'workflow', mode: 'realtime' })] } },
                { name: 'pluginSteps', result: { items: [makeItem({ id: 'dup', name: 'From plugin steps' })] } },
            ];
            return reversed ? extra.reverse() : extra;
        };
        // `processes` comes before `pluginSteps` in ALL_SOURCES, so it wins either way.
        for (const reversed of [false, true]) {
            const map = classify(makeInput(withDuplicate(reversed)));
            expect(map.items.map((i) => i.name)).toEqual(['From processes']);
        }
    });

    it('sorts sourceErrors and stats.sourcesDone into source order', () => {
        const input = makeInput(results());
        input.sourceErrors = [
            { source: 'views', message: 'HTTP 500', kind: 'error' },
            { source: 'apps', message: 'HTTP 403', kind: 'permission' },
            { source: 'apps', message: 'HTTP 400', kind: 'error' },
        ];
        input.stats = { ...input.stats, sourcesDone: ['views', 'columns', 'tableMeta'] };
        const map = classify(input);
        expect(map.sourceErrors).toEqual([
            { source: 'apps', message: 'HTTP 400', kind: 'error' },
            { source: 'apps', message: 'HTTP 403', kind: 'permission' },
            { source: 'views', message: 'HTTP 500', kind: 'error' },
        ]);
        expect(map.stats.sourcesDone).toEqual(['tableMeta', 'columns', 'views']);
        // the caller's arrays are not mutated
        expect(input.stats.sourcesDone).toEqual(['views', 'columns', 'tableMeta']);
    });

    it('does not resurrect synonym twins that were dropped from a derived map', () => {
        const full = classify(makeInput(results()));
        const withoutTwin = full.items.filter((i) => i.id !== 'step-1:setstate');
        const next = rederive(full, withoutTwin);
        expect(ids(next.items)).toEqual(['step-2', 'step-1']);
        expect(next.pipeline.SetState).toBeUndefined();
    });
});

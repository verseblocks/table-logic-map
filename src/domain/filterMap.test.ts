import { describe, expect, it } from 'vitest';
import { classify, type ClassifyInput } from '../classify';
import { filterItems, filterMap, isSystemItem } from './filterMap';
import type { ColumnInfo, FormInfo, LogicItem, LogicMap, TableFacts } from './model';

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

const ids = (items: LogicItem[]) => items.map((i) => i.id);

/** A small but complete map: system step, disabled step, synonym source, form handlers and a business rule. */
function fullMap(): LogicMap {
    const handler = makeItem({ id: 'js-1', kind: 'formscript', stage: 'client', mode: 'client', event: 'FieldChange', filteringAttributes: ['name'], details: { formId: 'f1' } });
    const disabledHandler = makeItem({ id: 'js-2', kind: 'formscript', stage: 'client', mode: 'client', event: 'FormLoad', enabled: false, details: { formId: 'f1' } });
    const pcf = makeItem({ id: 'pcf-1', kind: 'pcf', stage: 'client', mode: 'client', event: 'FormLoad', details: { formId: 'f1' } });
    const component = makeItem({ id: 'cmp-1', kind: 'formcomponent', stage: 'client', mode: 'client', event: 'FormLoad', details: { formId: 'f1' } });
    const items: LogicItem[] = [
        makeItem({ id: 'sys-1', name: 'Microsoft system step', order: 1, details: { isHidden: true } }),
        makeItem({ id: 'cust-1', name: 'Custom step', order: 2, filteringAttributes: ['name', 'statecode'] }),
        makeItem({ id: 'off-1', name: 'Disabled step', order: 3, enabled: false, filteringAttributes: ['name'] }),
        makeItem({ id: 'create-1', name: 'On create', event: 'Create', order: 1 }),
        makeItem({ id: 'br:FormLoad', groupId: 'br', kind: 'businessrule', stage: 'client', mode: 'rule', event: 'FormLoad', enabled: false }),
        handler,
        disabledHandler,
        pcf,
        component,
    ];
    const input: ClassifyInput = {
        table: TABLE,
        org: {},
        environment: { name: 'Dev', url: 'https://org.crm.dynamics.com' },
        generatedAt: '2026-01-01T00:00:00.000Z',
        results: [
            { name: 'pluginSteps', result: { items } },
            { name: 'columns', result: { items: [], columns: ['name', 'statecode'].map(makeColumn) } },
            { name: 'forms', result: { items: [], forms: [makeForm('f1', 'Main', { handlers: [handler, disabledHandler], pcf: [pcf], components: [component] })] } },
        ],
        sourceErrors: [],
        options: {},
        stats: { requests: 0, durationMs: 0, sourcesDone: [], partial: false },
    };
    return classify(input);
}

describe('filterItems / isSystemItem', () => {
    it('recognises hidden system steps', () => {
        expect(isSystemItem(makeItem({ id: 'a', details: { isHidden: true } }))).toBe(true);
        expect(isSystemItem(makeItem({ id: 'b', details: { isHidden: false } }))).toBe(false);
        expect(isSystemItem(makeItem({ id: 'c' }))).toBe(false);
    });

    it('applies each filter independently', () => {
        const items = [makeItem({ id: 'sys', details: { isHidden: true } }), makeItem({ id: 'off', enabled: false }), makeItem({ id: 'create', event: 'Create' }), makeItem({ id: 'ok' })];
        expect(ids(filterItems(items, {}))).toEqual(['off', 'create', 'ok']);
        expect(ids(filterItems(items, { includeSystemSteps: true }))).toEqual(['sys', 'off', 'create', 'ok']);
        expect(ids(filterItems(items, { includeSystemSteps: true, enabledOnly: true }))).toEqual(['sys', 'create', 'ok']);
        expect(ids(filterItems(items, { includeSystemSteps: true, events: ['Create'] }))).toEqual(['create']);
        expect(ids(filterItems(items, { includeSystemSteps: true, events: [] }))).toEqual(['sys', 'off', 'create', 'ok']);
    });
});

describe('filterMap', () => {
    it('hides system steps by default and re-derives the pipeline, column index and smells', () => {
        const full = fullMap();
        expect(ids(full.pipeline.Update.preoperation)).toEqual(['sys-1', 'cust-1', 'off-1']);

        const view = filterMap(full, {});
        expect(view).not.toBe(full);
        expect(ids(view.items)).not.toContain('sys-1');
        expect(ids(view.pipeline.Update.preoperation)).toEqual(['cust-1', 'off-1']);
        expect(full.pipeline.Update.preoperation.length).toBe(3); // the full map is untouched
        // the synonym twin of the surviving Update step is still derived
        expect(ids(view.pipeline.SetState.preoperation)).toEqual(['cust-1:setstate']);
        expect(full.smells.map((s) => s.id)).toContain('smell:update-no-filter:sys-1');
        expect(view.smells.map((s) => s.id)).not.toContain('smell:update-no-filter:sys-1');
        // the re-derived item list stays in execution order (event → stage → rank → name)
        expect(ids(view.items)).toEqual(['create-1', 'cust-1', 'off-1', 'cust-1:setstate', 'br:FormLoad', 'cmp-1', 'js-2', 'pcf-1', 'js-1']);
    });

    it('keeps system steps when includeSystemSteps is set (and returns the same map when nothing changes)', () => {
        const full = fullMap();
        const view = filterMap(full, { includeSystemSteps: true });
        expect(view).toBe(full);
        expect(ids(view.pipeline.Update.preoperation)).toEqual(['sys-1', 'cust-1', 'off-1']);
    });

    it('enabledOnly drops disabled items everywhere, including form handlers and business rules', () => {
        const view = filterMap(fullMap(), { includeSystemSteps: true, enabledOnly: true });
        expect(ids(view.items)).not.toContain('off-1');
        expect(ids(view.items)).not.toContain('js-2');
        expect(ids(view.items)).not.toContain('br:FormLoad');
        expect(ids(view.pipeline.Update.preoperation)).toEqual(['sys-1', 'cust-1']);
        expect(view.smells.map((s) => s.code)).not.toContain('disabled-clutter');
        expect(view.forms[0].businessRules).toEqual([]);
        expect(ids(view.forms[0].handlers)).toEqual(['js-1']);
        expect(ids(view.forms[0].pcf)).toEqual(['pcf-1']);
        expect(ids(view.forms[0].components)).toEqual(['cmp-1']);
    });

    it('events filter keeps only the requested events without resurrecting synonym twins', () => {
        const full = fullMap();
        const view = filterMap(full, { includeSystemSteps: true, events: ['Update'] });
        expect(Object.keys(view.pipeline)).toEqual(['Update']);
        expect(ids(view.items)).toEqual(['sys-1', 'cust-1', 'off-1']);
        expect(view.items.every((i) => i.event === 'Update')).toBe(true);
        // form-time items were filtered out too, so the form lists follow
        expect(view.forms[0].handlers).toEqual([]);
        expect(view.forms[0].pcf).toEqual([]);
        expect(view.forms[0].components).toEqual([]);
        expect(view.forms[0].businessRules).toEqual([]);
        expect(view.columns.name.triggers).toEqual(['cust-1', 'off-1']);

        const setState = filterMap(full, { includeSystemSteps: true, events: ['SetState'] });
        expect(ids(setState.items)).toEqual(['cust-1:setstate']);
        expect(Object.keys(setState.pipeline)).toEqual(['SetState']);
    });

    it("filters the forms' handler lists and business rules to surviving items", () => {
        const view = filterMap(fullMap(), { includeSystemSteps: true, events: ['FieldChange', 'FormLoad'] });
        expect(ids(view.forms[0].handlers)).toEqual(['js-1', 'js-2']);
        expect(view.forms[0].businessRules).toEqual(['br:FormLoad']);
        const loadOnly = filterMap(fullMap(), { includeSystemSteps: true, events: ['FormLoad'] });
        expect(ids(loadOnly.forms[0].handlers)).toEqual(['js-2']);
        expect(ids(loadOnly.forms[0].pcf)).toEqual(['pcf-1']);
    });
});

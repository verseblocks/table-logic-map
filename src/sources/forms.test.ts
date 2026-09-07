import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Row } from '../data/client';
import { FORM_SELECT, compareForms, formsSource, systemFormsQuery, toForm } from './forms';
import type { RawFormRow } from './forms';
import { SAMPLE_ENVIRONMENT_URL, SAMPLE_TABLE, makeCtx, makeFakeClient } from './testUtils';

const mainXml = fs.readFileSync(path.join(__dirname, '../fixtures/formxml.main.xml'), 'utf8');

const MAIN_FORM_ID = '9f1c0b2a-1111-4c3d-8e2f-0a0a0a0a0a0a';
const QUICK_CREATE_ID = '9f1c0b2a-2222-4c3d-8e2f-0b0b0b0b0b0b';
const QUICK_CREATE_HANDLER_ID = 'cc00cc00-0000-0000-0000-000000000001';

/** A quick create form with one library and a single onload handler. */
const quickCreateXml = `<?xml version="1.0" encoding="utf-8"?>
<form>
  <formLibraries>
    <Library name="contoso_/scripts/quickcreate.js" libraryUniqueId="{aa11aa11-0000-0000-0000-000000000009}" />
  </formLibraries>
  <events>
    <event name="onload" application="false" active="false">
      <Handlers>
        <Handler functionName="Contoso.Project.QuickCreate.onLoad" libraryName="contoso_/scripts/quickcreate.js" handlerUniqueId="{${QUICK_CREATE_HANDLER_ID}}" enabled="true" parameters="" passExecutionContext="true" />
      </Handlers>
    </event>
  </events>
  <tabs>
    <tab name="tab_qc" id="{dd44dd44-0000-0000-0000-000000000099}">
      <columns><column width="100%"><sections><section name="section_qc" id="{dd44dd44-0000-0000-0000-000000000098}">
        <rows><row><cell id="{dd44dd44-0000-0000-0000-000000000097}">
          <control id="contoso_name" classid="{4273EDBD-AC1D-40d3-9FB2-095C621B552D}" datafieldname="contoso_name" disabled="false" />
        </cell></row></rows>
      </section></sections></column></columns>
    </tab>
  </tabs>
</form>`;

/** `systemforms?$select=formid,name,type,formxml,formactivationstate,isdefault,ismanaged,description&$filter=...`. */
const FORMS: Row[] = [
    // Quick create listed first: the source must sort Main (type 2) before Quick Create (type 7).
    { formid: QUICK_CREATE_ID, name: 'Project Quick Create', type: 7, formxml: quickCreateXml, formactivationstate: 1, isdefault: false, ismanaged: true, description: 'Quick create' },
    { formid: MAIN_FORM_ID, name: 'Project', type: 2, formxml: mainXml, formactivationstate: 1, isdefault: true, ismanaged: false, description: null },
];

describe('formsSource', () => {
    it('queries systemforms with the logic form type filter and the full select list', async () => {
        const client = makeFakeClient({ systemforms: FORMS });
        await formsSource.run(makeCtx({ client }));

        expect(client.paths).toEqual([systemFormsQuery(SAMPLE_TABLE.logicalName)]);
        expect(client.callsOf('query')).toHaveLength(1);
        expect(client.paths[0]).toContain(`$select=${FORM_SELECT}`);
        expect(client.paths[0]).toContain("$filter=objecttypecode eq 'contoso_project' and (type eq 2 or type eq 5 or type eq 6 or type eq 7 or type eq 11 or type eq 12)");
    });

    it('maps each systemform row to a FormInfo, sorted by type then name', async () => {
        const client = makeFakeClient({ systemforms: FORMS });
        const result = await formsSource.run(makeCtx({ client }));

        expect(result.forms).toHaveLength(2);
        const [main, quick] = result.forms ?? [];

        expect(main).toMatchObject({
            id: MAIN_FORM_ID,
            name: 'Project',
            type: 'Main',
            typeCode: 2,
            state: 'Active',
            isDefault: true,
            isManaged: false,
            libraries: ['contoso_/scripts/project.js', 'contoso_/scripts/common.js'],
            businessRules: [],
        });
        expect(main.handlers).toHaveLength(7);
        expect(main.pcf).toHaveLength(3);
        expect(main.components).toHaveLength(6);

        expect(quick).toMatchObject({
            id: QUICK_CREATE_ID,
            name: 'Project Quick Create',
            type: 'Quick Create',
            typeCode: 7,
            state: 'Active',
            isDefault: false,
            isManaged: true,
            libraries: ['contoso_/scripts/quickcreate.js'],
            pcf: [],
            components: [],
            businessRules: [],
        });
        expect(quick.handlers).toHaveLength(1);
    });

    it('flattens handlers, PCF and components of every form into items with unique ids', async () => {
        const client = makeFakeClient({ systemforms: FORMS });
        const result = await formsSource.run(makeCtx({ client }));

        expect(result.items).toHaveLength(7 + 3 + 6 + 1);
        expect(result.items.filter((i) => i.kind === 'formscript')).toHaveLength(8);
        expect(result.items.filter((i) => i.kind === 'pcf')).toHaveLength(3);
        expect(result.items.filter((i) => i.kind === 'formcomponent')).toHaveLength(6);
        expect(new Set(result.items.map((i) => i.id)).size).toBe(result.items.length);
        // Main form items come first (forms are sorted by type), each form's handlers before its PCF and components.
        expect(result.items[0].id).toBe(`formscript:${MAIN_FORM_ID}:bb22bb22-0000-0000-0000-000000000001`);
        expect(result.items[result.items.length - 1].id).toBe(`formscript:${QUICK_CREATE_ID}:${QUICK_CREATE_HANDLER_ID}`);
        for (const item of result.items) {
            expect(item.stage).toBe('client');
            expect(item.mode).toBe('client');
        }
    });

    it('links every handler to its FormInfo through details.formId, source.id and the maker link', async () => {
        const client = makeFakeClient({ systemforms: FORMS });
        const result = await formsSource.run(makeCtx({ client }));
        const forms = result.forms ?? [];

        for (const form of forms) {
            const own = [...form.handlers, ...form.pcf, ...form.components];
            for (const item of own) {
                expect(item.details.formId).toBe(form.id);
                expect(item.details.formName).toBe(form.name);
                expect(item.source).toEqual({ table: 'systemform', id: form.id });
                expect(item.links?.maker).toContain(`${SAMPLE_ENVIRONMENT_URL}/main.aspx?pagetype=formeditor&etn=contoso_project`);
                expect(item.links?.maker).toContain(encodeURIComponent(`formId=${form.id}`));
                // The same object is exposed through `items`, so the classifier and the UI see one instance.
                expect(result.items).toContain(item);
            }
        }

        const quick = forms.find((f) => f.id === QUICK_CREATE_ID);
        expect(quick?.handlers[0]).toMatchObject({
            id: `formscript:${QUICK_CREATE_ID}:${QUICK_CREATE_HANDLER_ID}`,
            kind: 'formscript',
            name: 'Contoso.Project.QuickCreate.onLoad',
            event: 'FormLoad',
            enabled: true,
            details: { formId: QUICK_CREATE_ID, formName: 'Project Quick Create', library: 'contoso_/scripts/quickcreate.js', formEvent: 'onload' },
        });
    });

    it('tolerates empty, null and unparseable formxml', async () => {
        const rows: Row[] = [
            { formid: 'aaaa0000-0000-4000-8000-000000000001', name: 'Empty', type: 2, formxml: '', formactivationstate: 1, isdefault: false, ismanaged: false },
            { formid: 'aaaa0000-0000-4000-8000-000000000002', name: 'Null', type: 6, formxml: null, formactivationstate: 0, isdefault: false, ismanaged: false },
            // fast-xml-parser tolerates unclosed tags; only a document without a root element is unparseable.
            { formid: 'aaaa0000-0000-4000-8000-000000000003', name: 'Broken', type: 11, formxml: 'not xml at all <<<', formactivationstate: 1, isdefault: false, ismanaged: true },
        ];
        const client = makeFakeClient({ systemforms: rows });
        const result = await formsSource.run(makeCtx({ client }));

        expect(result.items).toEqual([]);
        expect(result.forms?.map((f) => [f.name, f.type, f.state])).toEqual([
            ['Empty', 'Main', 'Active'],
            ['Null', 'Quick View', 'Inactive'],
            ['Broken', 'Card', 'Active'],
        ]);
        for (const form of result.forms ?? []) {
            expect(form.libraries).toEqual([]);
            expect(form.handlers).toEqual([]);
            expect(form.pcf).toEqual([]);
            expect(form.components).toEqual([]);
        }
        // Only the unparseable document is reported; empty/null documents are silently empty.
        expect(result.warnings).toEqual(['Form "Broken": Form XML could not be parsed']);
    });

    it('returns no forms when the table has none', async () => {
        const client = makeFakeClient();
        const result = await formsSource.run(makeCtx({ client }));
        expect(result).toEqual({ items: [], forms: [], raw: [] });
    });

    it('exposes redacted raw rows without formxml', async () => {
        const client = makeFakeClient({ systemforms: FORMS });
        const result = await formsSource.run(makeCtx({ client }));
        const raw = result.raw as RawFormRow[];

        expect(raw.map((r) => r.formid)).toEqual([MAIN_FORM_ID, QUICK_CREATE_ID]);
        for (const r of raw) expect(r).not.toHaveProperty('formxml');
        expect(raw[0]).toEqual({
            formid: MAIN_FORM_ID,
            name: 'Project',
            type: 2,
            typeLabel: 'Main',
            formactivationstate: 1,
            state: 'Active',
            isdefault: true,
            ismanaged: false,
            counts: { libraries: 2, handlers: 7, pcf: 3, components: 6 },
        });
        expect(raw[1]).toMatchObject({ formid: QUICK_CREATE_ID, description: 'Quick create', counts: { libraries: 1, handlers: 1, pcf: 0, components: 0 } });
        // The IFrame's secret query string must never reach the raw payload.
        expect(JSON.stringify(result.raw)).not.toContain('SECRET123');
        expect(JSON.stringify(result.items)).not.toContain('SECRET123');
    });

    it('skips rows without a form id and normalises braces / case in ids', async () => {
        const rows: Row[] = [
            { name: 'No id', type: 2, formxml: '' },
            { formid: `{${MAIN_FORM_ID.toUpperCase()}}`, name: 'Braced', type: 2, formxml: quickCreateXml, formactivationstate: 1 },
        ];
        const client = makeFakeClient({ systemforms: rows });
        const result = await formsSource.run(makeCtx({ client }));
        expect(result.forms?.map((f) => f.id)).toEqual([MAIN_FORM_ID]);
        expect(result.items[0].id).toBe(`formscript:${MAIN_FORM_ID}:${QUICK_CREATE_HANDLER_ID}`);
    });
});

describe('forms helpers', () => {
    it('labels unknown form types and non-active states', () => {
        const ctx = makeCtx();
        const form = toForm({ formid: 'bbbb0000-0000-4000-8000-000000000001', name: 'Odd', type: 42, formxml: '', formactivationstate: 5 }, ctx);
        expect(form?.info.type).toBe('Type 42');
        expect(form?.info.state).toBe('Inactive');
        expect(form?.info.isDefault).toBe(false);
        expect(form?.info.isManaged).toBe(false);
    });

    it('orders forms by type code, then name, then id', () => {
        const ctx = makeCtx();
        const mk = (id: string, name: string, type: number) => toForm({ formid: id, name, type, formxml: '' }, ctx)?.info;
        const forms = [mk('c', 'B', 7), mk('b', 'B', 2), mk('a', 'A', 7), mk('d', 'B', 7)].flatMap((f) => (f ? [f] : []));
        forms.sort(compareForms);
        expect(forms.map((f) => `${f.typeCode}:${f.name}:${f.id}`)).toEqual(['2:B:b', '7:A:a', '7:B:c', '7:B:d']);
    });
});

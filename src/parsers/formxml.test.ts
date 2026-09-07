import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LogicItem } from '../domain/model';
import { parseFormXml, type FormParseContext } from './formxml';

const xml = fs.readFileSync(path.join(__dirname, '../fixtures/formxml.main.xml'), 'utf8');

const FORM_ID = '9f1c0b2a-1111-4c3d-8e2f-0a0a0a0a0a0a';
const ctx: FormParseContext = {
    formId: FORM_ID,
    formName: 'Project',
    table: 'contoso_project',
    environmentUrl: 'https://org.crm.dynamics.com',
};
const MAKER = `https://org.crm.dynamics.com/main.aspx?pagetype=formeditor&etn=contoso_project&extraqs=${encodeURIComponent(`formtype=main&formId=${FORM_ID}`)}`;

const result = parseFormXml(xml, ctx);

function byName(items: LogicItem[], name: string): LogicItem {
    const item = items.find((i) => i.name === name);
    if (!item) throw new Error(`item "${name}" not found in [${items.map((i) => i.name).join(', ')}]`);
    return item;
}

function byControlId(items: LogicItem[], controlId: string): LogicItem {
    const item = items.find((i) => i.details.controlId === controlId);
    if (!item) throw new Error(`control "${controlId}" not found in [${items.map((i) => String(i.details.controlId)).join(', ')}]`);
    return item;
}

describe('parseFormXml — libraries', () => {
    it('lists form libraries in document order, de-duplicated', () => {
        expect(result.libraries).toEqual(['contoso_/scripts/project.js', 'contoso_/scripts/common.js']);
    });

    it('de-duplicates repeated library names', () => {
        const dup = `<form><formLibraries><Library name="a.js" /><Library name="b.js" /><Library name="a.js" /></formLibraries></form>`;
        expect(parseFormXml(dup, ctx).libraries).toEqual(['a.js', 'b.js']);
    });
});

describe('parseFormXml — handlers', () => {
    it('produces one formscript item per handler in registration order', () => {
        expect(result.handlers).toHaveLength(7);
        expect(result.handlers.map((h) => [h.name, h.event])).toEqual([
            ['Contoso.Project.Form.onLoad', 'FormLoad'],
            ['Contoso.Common.applyTheme', 'FormLoad'],
            ['Contoso.Project.Form.onSave', 'FormSave'],
            ['Contoso.Project.Form.onStatusChange', 'FieldChange'],
            ['Contoso.Project.Form.onBudgetChange', 'FieldChange'],
            ['Contoso.Project.Form.onTabChange', 'Any'],
            ['Contoso.Project.Form.onTaskSelected', 'Any'],
        ]);
        for (const h of result.handlers) {
            expect(h.kind).toBe('formscript');
            expect(h.stage).toBe('client');
            expect(h.mode).toBe('client');
            expect(h.confidence).toBe('exact');
            expect(h.source).toEqual({ table: 'systemform', id: FORM_ID });
            expect(h.links).toEqual({ maker: MAKER });
            expect(h.details.formId).toBe(FORM_ID);
            expect(h.details.formName).toBe('Project');
        }
    });

    it('maps onload handlers with library, parameters and execution context', () => {
        const onLoad = byName(result.handlers, 'Contoso.Project.Form.onLoad');
        expect(onLoad.id).toBe(`formscript:${FORM_ID}:bb22bb22-0000-0000-0000-000000000001`);
        expect(onLoad.enabled).toBe(true);
        expect(onLoad.filteringAttributes).toBeUndefined();
        expect(onLoad.details).toEqual({
            formId: FORM_ID,
            formName: 'Project',
            formEvent: 'onload',
            library: 'contoso_/scripts/project.js',
            functionName: 'Contoso.Project.Form.onLoad',
            parameters: '',
            passExecutionContext: true,
            handlerId: 'bb22bb22-0000-0000-0000-000000000001',
        });

        const theme = byName(result.handlers, 'Contoso.Common.applyTheme');
        expect(theme.details.library).toBe('contoso_/scripts/common.js');
        expect(theme.details.parameters).toBe('"dark"');
        expect(theme.details.passExecutionContext).toBe(false);
    });

    it('maps onsave to FormSave', () => {
        const onSave = byName(result.handlers, 'Contoso.Project.Form.onSave');
        expect(onSave.event).toBe('FormSave');
        expect(onSave.details.formEvent).toBe('onsave');
        expect(onSave.filteringAttributes).toBeUndefined();
    });

    it('maps onchange to FieldChange with the attribute as filtering attribute', () => {
        const status = byName(result.handlers, 'Contoso.Project.Form.onStatusChange');
        expect(status.event).toBe('FieldChange');
        expect(status.filteringAttributes).toEqual(['contoso_status']);
        expect(status.details.attribute).toBe('contoso_status');
        expect(status.enabled).toBe(true);

        const budget = byName(result.handlers, 'Contoso.Project.Form.onBudgetChange');
        expect(budget.event).toBe('FieldChange');
        expect(budget.filteringAttributes).toEqual(['contoso_budget']);
        expect(budget.details.attribute).toBe('contoso_budget');
        expect(budget.enabled).toBe(false);
    });

    it('maps control-level events to Any and keeps the raw event name and control', () => {
        const tab = byName(result.handlers, 'Contoso.Project.Form.onTabChange');
        expect(tab.event).toBe('Any');
        expect(tab.details.formEvent).toBe('tabstatechange');
        expect(tab.details.control).toBe('tab_details');
        expect(tab.details.attribute).toBeUndefined();
        expect(tab.filteringAttributes).toBeUndefined();

        const grid = byName(result.handlers, 'Contoso.Project.Form.onTaskSelected');
        expect(grid.event).toBe('Any');
        expect(grid.details.formEvent).toBe('onrecordselect');
        expect(grid.details.control).toBe('Tasks');
    });

    it('falls back to the handler index when handlerUniqueId is missing and defaults enabled to true', () => {
        const noIds = `<form><events>
            <event name="onload"><Handlers><Handler functionName="a" libraryName="l.js" /><Handler functionName="b" libraryName="l.js" /></Handlers></event>
            <event name="onchange" attribute="Contoso_Field"><Handlers><Handler functionName="c" libraryName="l.js" enabled="false" /></Handlers></event>
        </events></form>`;
        const parsed = parseFormXml(noIds, ctx);
        expect(parsed.handlers.map((h) => h.id)).toEqual([`formscript:${FORM_ID}:0`, `formscript:${FORM_ID}:1`, `formscript:${FORM_ID}:2`]);
        expect(parsed.handlers.map((h) => h.enabled)).toEqual([true, true, false]);
        expect(parsed.handlers[2].filteringAttributes).toEqual(['contoso_field']);
        expect(parsed.handlers[0].details.passExecutionContext).toBe(false);
    });
});

describe('parseFormXml — PCF', () => {
    it('produces one pcf item per (control, custom control name), merging form factors', () => {
        expect(result.pcf).toHaveLength(3);
        for (const p of result.pcf) {
            expect(p.kind).toBe('pcf');
            expect(p.event).toBe('FormLoad');
            expect(p.stage).toBe('client');
            expect(p.mode).toBe('client');
            expect(p.confidence).toBe('exact');
            expect(p.enabled).toBe(true);
            expect(p.source).toEqual({ table: 'systemform', id: FORM_ID });
            expect(p.links).toEqual({ maker: MAKER });
        }
    });

    it('merges the ProgressBar descriptors for phone and default form factors into one item', () => {
        const bar = byName(result.pcf, 'Contoso.Controls.ProgressBar');
        expect(bar.id).toBe(`pcf:${FORM_ID}:ee55ee55-0000-0000-0000-000000000003:Contoso.Controls.ProgressBar`);
        expect(bar.touchesColumns).toEqual(['contoso_progress']);
        expect(bar.details.controlId).toBe('contoso_progress');
        expect(bar.details.datafieldname).toBe('contoso_progress');
        expect(bar.details.formFactors).toEqual([2, 0]);
        expect(bar.details.parameters).toEqual({ value: 'contoso_progress', max: '100' });
        expect(bar.details.isFirstParty).toBe(false);
        expect(bar.details.tab).toBe('tab_general');
        expect(bar.details.section).toBe('section_general');
        expect(result.pcf.filter((p) => p.name === 'Contoso.Controls.ProgressBar')).toHaveLength(1);
    });

    it('flags first-party MscrmControls and binds the currency control to its column', () => {
        const currency = byName(result.pcf, 'MscrmControls.FieldControls.CurrencyControl');
        expect(currency.details.isFirstParty).toBe(true);
        expect(currency.details.controlId).toBe('contoso_budget');
        expect(currency.touchesColumns).toEqual(['contoso_budget']);
        expect(currency.details.formFactors).toEqual([2]);
        expect(currency.details.parameters).toEqual({ value: 'contoso_budget' });
    });

    it('binds the grid control to the Tasks subgrid without a datafieldname', () => {
        const grid = byName(result.pcf, 'MscrmControls.Grid.PCFGridControl');
        expect(grid.details.isFirstParty).toBe(true);
        expect(grid.details.controlId).toBe('Tasks');
        expect(grid.details.datafieldname).toBeUndefined();
        expect(grid.touchesColumns).toBeUndefined();
        expect(grid.details.tab).toBe('tab_details');
        expect(grid.details.section).toBe('section_tasks');
        expect(grid.details.parameters).toEqual({ TargetEntityType: 'contoso_task' });
    });

    it('still reports a descriptor whose control cannot be found on the form', () => {
        const orphan = `<form><controlDescriptions><controlDescription forControl="{ab}"><customControl formFactor="2" name="X.Y" /></controlDescription></controlDescriptions></form>`;
        const parsed = parseFormXml(orphan, ctx);
        expect(parsed.pcf).toHaveLength(1);
        expect(parsed.pcf[0].details.controlId).toBe('{ab}');
        expect(parsed.pcf[0].touchesColumns).toBeUndefined();
    });
});

describe('parseFormXml — components', () => {
    it('produces components for non-field controls only', () => {
        expect(result.components.map((c) => c.details.controlId)).toEqual(['QuickViewCustomer', 'WebResource_SiteMap', 'Tasks', 'IFRAME_Portal', 'notescontrol', 'mystery_control']);
        for (const c of result.components) {
            expect(c.kind).toBe('formcomponent');
            expect(c.event).toBe('FormLoad');
            expect(c.stage).toBe('client');
            expect(c.mode).toBe('client');
            expect(c.id).toBe(`formcomponent:${FORM_ID}:${String(c.details.controlId)}`);
            expect(c.source).toEqual({ table: 'systemform', id: FORM_ID });
            expect(c.links).toEqual({ maker: MAKER });
        }
    });

    it('does not turn header or body field controls into items', () => {
        const all = [...result.handlers, ...result.pcf, ...result.components];
        const controlIds = all.map((i) => i.details.controlId);
        expect(controlIds).not.toContain('header_ownerid');
        expect(controlIds).not.toContain('header_statuscode');
        expect(controlIds).not.toContain('contoso_name');
        expect(controlIds).not.toContain('contoso_customerid');
        expect(result.components.some((c) => c.details.datafieldname !== undefined)).toBe(false);
    });

    it('maps the quick view form with its embedded form ids and lookup column', () => {
        const qv = byControlId(result.components, 'QuickViewCustomer');
        expect(qv.name).toBe('Quick view form: QuickViewCustomer');
        expect(qv.confidence).toBe('exact');
        expect(qv.details.componentKind).toBe('Quick view form');
        expect(qv.details.classId).toBe('{5C5600E0-1D6E-4205-A272-BE80DA87FD42}');
        expect(qv.details.quickFormIds).toEqual([{ entityName: 'account', formId: 'ff66ff66-0000-0000-0000-000000000001' }]);
        expect(qv.touchesColumns).toEqual(['contoso_customerid']);
        expect(qv.details.tab).toBe('tab_general');
        expect(qv.details.section).toBe('section_customer');
        const params = qv.details.parameters as Record<string, string>;
        expect(params.QuickFormsRelationshipName).toBe('contoso_customerid');
        expect(JSON.parse(params.QuickForms)).toEqual({ QuickFormIds: { QuickFormId: { '@entityname': 'account', '#text': '{ff66ff66-0000-0000-0000-000000000001}' } } });
    });

    it('only reports the quick view lookup as a touched column when it is a known column', () => {
        const known = parseFormXml(xml, { ...ctx, knownColumns: new Set(['contoso_customerid']) });
        expect(byControlId(known.components, 'QuickViewCustomer').touchesColumns).toEqual(['contoso_customerid']);
        const unknown = parseFormXml(xml, { ...ctx, knownColumns: new Set(['contoso_name']) });
        expect(byControlId(unknown.components, 'QuickViewCustomer').touchesColumns).toBeUndefined();
    });

    it('keeps the web resource URL (no query string to redact)', () => {
        const wr = byControlId(result.components, 'WebResource_SiteMap');
        expect(wr.name).toBe('Web resource: WebResource_SiteMap');
        expect(wr.details.componentKind).toBe('Web resource');
        expect(wr.confidence).toBe('exact');
        expect(wr.details.url).toBe('contoso_/pages/sitemap.html');
        expect(wr.details.parameters).toEqual({
            Url: 'contoso_/pages/sitemap.html',
            PassParameters: 'true',
            Security: 'false',
            Scrolling: 'auto',
            Border: 'false',
        });
    });

    it('redacts the IFrame URL query string', () => {
        const iframe = byControlId(result.components, 'IFRAME_Portal');
        expect(iframe.details.componentKind).toBe('IFrame');
        expect(iframe.details.url).toBe('https://portal.contoso.example/embed?…');
        expect((iframe.details.parameters as Record<string, string>).Url).toBe('https://portal.contoso.example/embed?…');
        expect(iframe.details.disabled).toBe(false);
    });

    it('never leaks the IFrame secret anywhere in the result', () => {
        expect(JSON.stringify(result)).not.toContain('SECRET123');
        expect(JSON.stringify(result)).not.toContain('token=');
    });

    it('maps the subgrid with relationship, target table and view', () => {
        const grid = byControlId(result.components, 'Tasks');
        expect(grid.name).toBe('Subgrid: Tasks');
        expect(grid.details.componentKind).toBe('Subgrid');
        expect(grid.details.relationshipName).toBe('contoso_project_task');
        expect(grid.details.targetEntity).toBe('contoso_task');
        expect(grid.details.viewId).toBe('11111111-1111-1111-1111-111111111111');
        expect(grid.details.tab).toBe('tab_details');
        expect(grid.details.section).toBe('section_tasks');
        expect(grid.touchesColumns).toBeUndefined();
        const params = grid.details.parameters as Record<string, string>;
        expect(params.RelationshipName).toBe('contoso_project_task');
        expect(params.VisualizationId).toBe('');
    });

    it('maps the notes control', () => {
        const notes = byControlId(result.components, 'notescontrol');
        expect(notes.name).toBe('Notes: notescontrol');
        expect(notes.details.componentKind).toBe('Notes');
        expect(notes.confidence).toBe('exact');
        expect(notes.details.parameters).toEqual({});
    });

    it('shows unknown class ids verbatim with heuristic confidence', () => {
        const mystery = byControlId(result.components, 'mystery_control');
        expect(mystery.name).toBe('Control {00000000-0000-0000-0000-00000000ABCD}: mystery_control');
        expect(mystery.details.componentKind).toBe('Control {00000000-0000-0000-0000-00000000ABCD}');
        expect(mystery.details.classId).toBe('{00000000-0000-0000-0000-00000000ABCD}');
        expect(mystery.confidence).toBe('heuristic');
        expect(mystery.details.parameters).toEqual({ Custom: 'x' });
    });

    it('normalises class id case and braces before looking up the component table', () => {
        const lower = `<form><tabs><tab name="t"><columns><column><sections><section name="s"><rows><row><cell>
            <control id="wr" classId="9fdf5f91-88b1-47f4-ad53-c11efc01a01d"><parameters><Url>x.html</Url></parameters></control>
        </cell></row></rows></section></sections></column></sections></tab></tabs></form>`;
        const parsed = parseFormXml(lower, ctx);
        expect(parsed.components).toHaveLength(1);
        expect(parsed.components[0].details.componentKind).toBe('Web resource');
        expect(parsed.components[0].details.classId).toBe('{9FDF5F91-88B1-47F4-AD53-C11EFC01A01D}');
    });

    it('includes header and footer components', () => {
        const hf = `<form>
            <header><rows><row><cell><control id="hdr_field" classid="{4273EDBD-AC1D-40d3-9FB2-095C621B552D}" datafieldname="name" /></cell>
                <cell><control id="hdr_wr" classid="{9FDF5F91-88B1-47F4-AD53-C11EFC01A01D}"><parameters><Url>a.html</Url></parameters></control></cell></row></rows></header>
            <footer><rows><row><cell><control id="ftr_iframe" classid="{FD2A7985-3187-444E-908D-6624B21F69C0}"><parameters><Url>https://x.example/p?k=v</Url></parameters></control></cell></row></rows></footer>
        </form>`;
        const parsed = parseFormXml(hf, ctx);
        expect(parsed.components.map((c) => [c.details.controlId, c.details.region])).toEqual([
            ['hdr_wr', 'header'],
            ['ftr_iframe', 'footer'],
        ]);
        expect(parsed.components[1].details.url).toBe('https://x.example/p?…');
        expect(parsed.components[0].details.tab).toBeUndefined();
    });
});

describe('parseFormXml — robustness and determinism', () => {
    it('returns an empty result for empty, whitespace or invalid XML without throwing', () => {
        const empty = { libraries: [], handlers: [], pcf: [], components: [] };
        expect(parseFormXml('', ctx)).toEqual(empty);
        expect(parseFormXml('   ', ctx)).toEqual(empty);
        const invalid = parseFormXml('<form><tabs><tab></form>', ctx);
        expect(invalid.libraries).toEqual([]);
        expect(invalid.handlers).toEqual([]);
        expect(invalid.pcf).toEqual([]);
        expect(invalid.components).toEqual([]);
        expect(parseFormXml('not xml at all <<<', ctx).handlers).toEqual([]);
    });

    it('handles a form with no sections, events or descriptors', () => {
        expect(parseFormXml('<form />', ctx)).toEqual({ libraries: [], handlers: [], pcf: [], components: [] });
        expect(parseFormXml('<form><tabs /><events /><formLibraries /><controlDescriptions /></form>', ctx)).toEqual({ libraries: [], handlers: [], pcf: [], components: [] });
    });

    it('omits maker links when no environment URL is known', () => {
        const parsed = parseFormXml(xml, { ...ctx, environmentUrl: '' });
        expect(parsed.handlers[0].links).toBeUndefined();
        expect(parsed.pcf[0].links).toBeUndefined();
        expect(parsed.components[0].links).toBeUndefined();
    });

    it('produces identical output across two parses (stable ids)', () => {
        const again = parseFormXml(xml, { ...ctx });
        expect(again).toEqual(result);
        expect(again.handlers.map((h) => h.id)).toEqual(result.handlers.map((h) => h.id));
        const ids = [...again.handlers, ...again.pcf, ...again.components].map((i) => i.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

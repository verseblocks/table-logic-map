/**
 * Form XML parser (design guide §5.5) — pure function, no Dataverse access.
 *
 * A `systemform.formxml` document carries three kinds of client-side logic:
 *  - `formLibraries/Library` + `events/event/Handlers/Handler`: JavaScript web resources and the
 *    functions registered on form events (`onload`, `onsave`, `onchange` per attribute, plus
 *    control-level events such as `tabstatechange` / `onrecordselect`).
 *  - `controlDescriptions/controlDescription[@forControl]/customControl`: PCF / custom controls
 *    bound to a control (matched by the control's `uniqueid`), one descriptor per form factor.
 *  - Non-field controls in the layout (web resources, IFrames, subgrids, quick view forms, notes …),
 *    recognised by class id (`FORM_CONTROL_CLASSID`); anything unknown is shown verbatim.
 *
 * Data-bound field controls (`datafieldname` set, class id not in the component table) are not
 * logic and produce no items. Output is deterministic: handlers in registration (document) order,
 * PCF and components in layout order; ids are `${kind}:${formId}:${stableKey}`.
 */
import { FORM_CONTROL_CLASSID } from '../domain/codes';
import type { Confidence, EventName, LogicItem } from '../domain/model';
import { formEditorUrl, redactUrl } from '../sources/types';
import type { XmlEl } from '../xml/xml';
import { attr, attrBool, child, children, descendants, parseXml } from '../xml/xml';

export interface FormParseContext {
    formId: string;
    formName: string;
    /** Table logical name (used for the maker link). */
    table: string;
    environmentUrl: string;
    /**
     * Optional column logical names of the table. When provided (non-empty), a quick view form's
     * lookup (`QuickFormsRelationshipName`) is only reported in `touchesColumns` if it is a column.
     */
    knownColumns?: ReadonlySet<string>;
}

export interface FormParseResult {
    libraries: string[];
    handlers: LogicItem[];
    pcf: LogicItem[];
    components: LogicItem[];
    /** Non-fatal notes, e.g. the form XML could not be parsed (result is otherwise empty). */
    warnings?: string[];
}

/** Form event name (lower-case) → domain event. Every other event maps to `Any`. */
const FORM_EVENT_TO_EVENT: Record<string, EventName> = {
    onload: 'FormLoad',
    onsave: 'FormSave',
    onchange: 'FieldChange',
};

const SOURCE_TABLE = 'systemform';

type Region = 'body' | 'header' | 'footer';

/** A `<control>` element plus where it sits on the form. */
interface LocatedControl {
    el: XmlEl;
    region: Region;
    tab?: string;
    section?: string;
}

function emptyResult(): FormParseResult {
    return { libraries: [], handlers: [], pcf: [], components: [] };
}

/** `{AAAA-...}` → `aaaa-...` (bare, lower-case); empty string when missing. */
function normalizeGuid(value: string | undefined): string {
    return (value ?? '').replace(/[{}]/g, '').trim().toLowerCase();
}

/** Class ids in form XML mix case and sometimes omit braces; the code table uses `{UPPER}`. */
function normalizeClassId(value: string | undefined): string {
    const bare = (value ?? '').replace(/[{}]/g, '').trim().toUpperCase();
    return bare ? `{${bare}}` : '';
}

/** Non-empty attribute value or undefined. */
function attrText(el: XmlEl | undefined, name: string): string | undefined {
    const v = attr(el, name);
    return v !== undefined && v !== '' ? v : undefined;
}

/** Strip the query string from anything that looks like an absolute URL (IFrame/web resource URLs may embed tokens). */
function redactText(value: string): string {
    return /^https?:\/\//i.test(value) ? (redactUrl(value) ?? value) : value;
}

/** Plain-object view of a nested XML element (attributes prefixed `@`, repeated children as arrays). */
function plainValue(el: XmlEl): unknown {
    if (el.children.length === 0 && Object.keys(el.attrs).length === 0) return redactText(el.text);
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el.attrs)) obj[`@${k}`] = v;
    for (const c of el.children) {
        const v = plainValue(c);
        const existing = obj[c.name];
        if (existing === undefined) obj[c.name] = v;
        else if (Array.isArray(existing)) existing.push(v);
        else obj[c.name] = [existing, v];
    }
    if (el.text) obj['#text'] = redactText(el.text);
    return obj;
}

/**
 * Flatten `<parameters>` children to `name → text`. Nested elements (e.g. `QuickForms`) become a
 * JSON string. Values named `*Url*` or that look like URLs are redacted to their path.
 */
function flattenParameters(paramsEl: XmlEl | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of children(paramsEl)) {
        const raw = p.children.length > 0 ? JSON.stringify(plainValue(p)) : p.text;
        out[p.name] = /url/i.test(p.name) ? (redactUrl(raw) ?? '') : redactText(raw);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Libraries and handlers
// ---------------------------------------------------------------------------

function parseLibraries(root: XmlEl): string[] {
    const seen = new Set<string>();
    for (const lib of children(child(root, 'formLibraries'), 'Library')) {
        const name = attrText(lib, 'name');
        if (name) seen.add(name);
    }
    return [...seen];
}

function parseHandlers(root: XmlEl, ctx: FormParseContext, maker: string | undefined): LogicItem[] {
    const items: LogicItem[] = [];
    let index = 0;
    for (const ev of children(child(root, 'events'), 'event')) {
        const formEvent = attr(ev, 'name') ?? '';
        const event = FORM_EVENT_TO_EVENT[formEvent.toLowerCase()] ?? 'Any';
        // `attribute` is set for onchange; `control` for tab/grid/control events.
        const attribute = attrText(ev, 'attribute')?.toLowerCase();
        const control = attrText(ev, 'control');
        // The schema nests handlers under <Handlers>; tolerate direct <Handler> children too.
        const handlers = [...children(child(ev, 'Handlers'), 'Handler'), ...children(ev, 'Handler')];
        for (const h of handlers) {
            const functionName = attr(h, 'functionName') ?? '';
            const handlerId = normalizeGuid(attr(h, 'handlerUniqueId')) || String(index);
            const details: Record<string, unknown> = {
                formId: ctx.formId,
                formName: ctx.formName,
                formEvent,
            };
            if (attribute) details.attribute = attribute;
            if (control) details.control = control;
            Object.assign(details, {
                library: attr(h, 'libraryName') ?? '',
                functionName,
                parameters: attr(h, 'parameters') ?? '',
                passExecutionContext: attrBool(h, 'passExecutionContext', false),
                handlerId,
            });
            const item: LogicItem = {
                id: `formscript:${ctx.formId}:${handlerId}`,
                kind: 'formscript',
                name: functionName,
                event,
                stage: 'client',
                enabled: attrBool(h, 'enabled', true),
                mode: 'client',
                confidence: 'exact',
                details,
                source: { table: SOURCE_TABLE, id: ctx.formId },
            };
            if (event === 'FieldChange' && attribute) item.filteringAttributes = [attribute];
            if (maker) item.links = { maker };
            items.push(item);
            index++;
        }
    }
    return items;
}

// ---------------------------------------------------------------------------
// Layout controls (tabs / header / footer)
// ---------------------------------------------------------------------------

/** All `<control>` elements in layout order: header, then tabs/sections, then footer. */
function collectControls(root: XmlEl): LocatedControl[] {
    const out: LocatedControl[] = [];
    // Header, footer and sections share the same rows/row/cell/control structure.
    const pushCells = (container: XmlEl | undefined, region: Region, tab?: string, section?: string) => {
        for (const row of children(child(container, 'rows'), 'row')) {
            for (const cell of children(row, 'cell')) {
                for (const control of children(cell, 'control')) out.push({ el: control, region, tab, section });
            }
        }
    };
    pushCells(child(root, 'header'), 'header');
    for (const tab of children(child(root, 'tabs'), 'tab')) {
        const tabName = attrText(tab, 'name') ?? normalizeGuid(attr(tab, 'id'));
        for (const column of children(child(tab, 'columns'), 'column')) {
            for (const section of children(child(column, 'sections'), 'section')) {
                const sectionName = attrText(section, 'name') ?? normalizeGuid(attr(section, 'id'));
                pushCells(section, 'body', tabName || undefined, sectionName || undefined);
            }
        }
    }
    pushCells(child(root, 'footer'), 'footer');
    return out;
}

/** Index controls by `uniqueid` (what `controlDescription/@forControl` references) and by `id`. */
function indexControls(controls: LocatedControl[]): (forControl: string) => LocatedControl | undefined {
    const byUniqueId = new Map<string, LocatedControl>();
    const byId = new Map<string, LocatedControl>();
    for (const c of controls) {
        const unique = normalizeGuid(attr(c.el, 'uniqueid'));
        if (unique && !byUniqueId.has(unique)) byUniqueId.set(unique, c);
        const id = attrText(c.el, 'id');
        if (id) {
            if (!byId.has(id)) byId.set(id, c);
            const lower = normalizeGuid(id);
            if (!byId.has(lower)) byId.set(lower, c);
        }
    }
    return (forControl) => byUniqueId.get(normalizeGuid(forControl)) ?? byId.get(forControl) ?? byId.get(normalizeGuid(forControl));
}

// ---------------------------------------------------------------------------
// PCF / custom controls
// ---------------------------------------------------------------------------

interface PcfDescriptor {
    forControl: string;
    name: string;
    formFactors: number[];
    parameters: Record<string, string>;
}

/** Merge the per-form-factor `customControl` descriptors into one entry per (control, control name). */
function collectPcfDescriptors(root: XmlEl): PcfDescriptor[] {
    const byKey = new Map<string, PcfDescriptor>();
    for (const cd of children(child(root, 'controlDescriptions'), 'controlDescription')) {
        const forControl = attrText(cd, 'forControl');
        if (!forControl) continue;
        for (const cc of children(cd, 'customControl')) {
            const name = attrText(cc, 'name');
            if (!name) continue;
            const key = `${normalizeGuid(forControl)}::${name}`;
            let entry = byKey.get(key);
            if (!entry) {
                entry = { forControl, name, formFactors: [], parameters: {} };
                byKey.set(key, entry);
            }
            // formFactor: 0 = all/default, 1 = web/desktop, 2 = phone, 3 = tablet (designer convention).
            const factor = Number(attr(cc, 'formFactor'));
            if (Number.isInteger(factor) && !entry.formFactors.includes(factor)) entry.formFactors.push(factor);
            // First descriptor wins for a parameter; later form factors only add missing ones.
            for (const [k, v] of Object.entries(flattenParameters(child(cc, 'parameters')))) {
                if (!(k in entry.parameters)) entry.parameters[k] = v;
            }
        }
    }
    return [...byKey.values()];
}

function parsePcf(root: XmlEl, lookup: (forControl: string) => LocatedControl | undefined, ctx: FormParseContext, maker: string | undefined): LogicItem[] {
    const items: LogicItem[] = [];
    for (const d of collectPcfDescriptors(root)) {
        const located = lookup(d.forControl);
        const datafieldname = attrText(located?.el, 'datafieldname')?.toLowerCase();
        const details: Record<string, unknown> = {
            formId: ctx.formId,
            formName: ctx.formName,
            controlId: attrText(located?.el, 'id') ?? d.forControl,
            controlUniqueId: normalizeGuid(d.forControl),
        };
        if (datafieldname) details.datafieldname = datafieldname;
        Object.assign(details, {
            formFactors: d.formFactors,
            parameters: d.parameters,
            isFirstParty: d.name.startsWith('MscrmControls.'),
        });
        if (located?.tab) details.tab = located.tab;
        if (located?.section) details.section = located.section;
        if (located) details.region = located.region;
        const item: LogicItem = {
            id: `pcf:${ctx.formId}:${normalizeGuid(d.forControl)}:${d.name}`,
            kind: 'pcf',
            name: d.name,
            event: 'FormLoad',
            stage: 'client',
            enabled: true,
            mode: 'client',
            confidence: 'exact',
            details,
            source: { table: SOURCE_TABLE, id: ctx.formId },
        };
        if (datafieldname) item.touchesColumns = [datafieldname];
        if (maker) item.links = { maker };
        items.push(item);
    }
    return items;
}

// ---------------------------------------------------------------------------
// Form components (web resources, IFrames, subgrids, quick view forms, notes, unknown controls)
// ---------------------------------------------------------------------------

/** `QuickForms/QuickFormIds/QuickFormId[@entityname]{formId}` → `[{ entityName, formId }]`. */
function quickFormIds(paramsEl: XmlEl | undefined): Array<{ entityName: string; formId: string }> {
    const out: Array<{ entityName: string; formId: string }> = [];
    for (const qf of descendants(child(paramsEl, 'QuickForms'), 'QuickFormId')) {
        out.push({ entityName: attr(qf, 'entityname') ?? '', formId: normalizeGuid(qf.text) });
    }
    return out;
}

/** True when `name` can be reported as a column of the table. */
function isColumn(name: string | undefined, known: ReadonlySet<string> | undefined): name is string {
    if (!name) return false;
    if (known && known.size > 0) return known.has(name);
    return /^[a-z][a-z0-9_]*$/.test(name);
}

function toComponent(located: LocatedControl, ordinal: number, ctx: FormParseContext, maker: string | undefined): LogicItem | undefined {
    const { el } = located;
    const rawClassId = attr(el, 'classid') ?? '';
    const classId = normalizeClassId(rawClassId);
    const datafieldname = attrText(el, 'datafieldname');
    const known = classId ? FORM_CONTROL_CLASSID[classId] : undefined;
    // Data-bound field controls are not logic; everything else on the form is a component.
    if (!known && datafieldname) return undefined;

    const componentKind = known ? known.kind : rawClassId ? `Control ${rawClassId}` : 'Control';
    const confidence: Confidence = known ? known.confidence : 'heuristic';
    // Control ids are the designer names (`WebResource_SiteMap`); fall back to uniqueid, then position.
    const stableId = attrText(el, 'id') ?? (normalizeGuid(attr(el, 'uniqueid')) || `control${ordinal}`);
    const paramsEl = child(el, 'parameters');
    const parameters = flattenParameters(paramsEl);

    const details: Record<string, unknown> = {
        formId: ctx.formId,
        formName: ctx.formName,
        controlId: stableId,
        classId,
        componentKind,
        parameters,
        region: located.region,
    };
    if (located.tab) details.tab = located.tab;
    if (located.section) details.section = located.section;
    details.disabled = attrBool(el, 'disabled', false);
    if (datafieldname) details.datafieldname = datafieldname.toLowerCase();

    const item: LogicItem = {
        id: `formcomponent:${ctx.formId}:${stableId}`,
        kind: 'formcomponent',
        name: `${componentKind}: ${stableId}`,
        event: 'FormLoad',
        stage: 'client',
        enabled: true,
        mode: 'client',
        confidence,
        details,
        source: { table: SOURCE_TABLE, id: ctx.formId },
    };
    if (maker) item.links = { maker };

    // Web resource / IFrame: the (redacted) URL. For web resources this is the web resource name.
    if (parameters.Url !== undefined) details.url = parameters.Url;

    // Quick view form: embedded forms of the lookup target, driven by a lookup column of this table.
    const quickForms = quickFormIds(paramsEl);
    if (quickForms.length > 0) details.quickFormIds = quickForms;
    const relationshipLookup = child(paramsEl, 'QuickFormsRelationshipName')?.text.toLowerCase();
    if (relationshipLookup) {
        details.lookupColumn = relationshipLookup;
        if (isColumn(relationshipLookup, ctx.knownColumns)) item.touchesColumns = [relationshipLookup];
    }

    // Subgrid: relationship, target table and default view.
    const relationshipName = child(paramsEl, 'RelationshipName')?.text;
    const targetEntity = child(paramsEl, 'TargetEntityType')?.text;
    const viewId = child(paramsEl, 'ViewId')?.text;
    if (relationshipName) details.relationshipName = relationshipName;
    if (targetEntity) details.targetEntity = targetEntity.toLowerCase();
    if (viewId) details.viewId = normalizeGuid(viewId);

    return item;
}

function parseComponents(controls: LocatedControl[], ctx: FormParseContext, maker: string | undefined): LogicItem[] {
    const items: LogicItem[] = [];
    controls.forEach((located, ordinal) => {
        const item = toComponent(located, ordinal, ctx, maker);
        if (item) items.push(item);
    });
    return items;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse a `systemform.formxml` document. Never throws: empty, invalid or unexpected XML yields an
 * empty result (with a warning when the text was non-empty but unparseable).
 */
export function parseFormXml(xml: string, ctx: FormParseContext): FormParseResult {
    let root: XmlEl | null = null;
    try {
        root = parseXml(xml);
    } catch {
        root = null;
    }
    if (!root) {
        const result = emptyResult();
        if (typeof xml === 'string' && xml.trim()) result.warnings = ['Form XML could not be parsed'];
        return result;
    }
    try {
        const maker = ctx.environmentUrl ? formEditorUrl(ctx.environmentUrl, ctx.table, ctx.formId) : undefined;
        const controls = collectControls(root);
        return {
            libraries: parseLibraries(root),
            handlers: parseHandlers(root, ctx, maker),
            pcf: parsePcf(root, indexControls(controls), ctx, maker),
            components: parseComponents(controls, ctx, maker),
        };
    } catch (err) {
        const result = emptyResult();
        result.warnings = [`Form XML parse failed: ${err instanceof Error ? err.message : String(err)}`];
        return result;
    }
}

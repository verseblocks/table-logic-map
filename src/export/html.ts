/**
 * HTML export — the client-ready deliverable (Markdown stays the diffable source of truth).
 *
 * One self-contained document: no scripts, no external stylesheets, fonts or images, so it renders
 * under PPTB's CSP, opens straight into Microsoft Word (which converts it to .docx) and prints to
 * PDF. Layout is plain block flow plus real `<table>` elements because Word's HTML importer ignores
 * CSS grid/flexbox for content layout.
 *
 * Sections mirror `toMarkdown` exactly, in the same order and with the same facts:
 *   title/environment/facts/counts · Contents · Smells · Pipeline · Forms · Columns · Data rules ·
 *   Touched by · Apps · Other dependencies · Source errors.
 *
 * Redaction (CLAUDE.md): `stripRaw` + `redactConfiguration` are applied before anything is
 * rendered, exactly as `toJson` does, so raw source payloads and plugin unsecure configuration
 * never reach the file unless `includeConfiguration` is set. Secure configuration is never fetched.
 *
 * Escaping: Dataverse record names, column names, error messages and detail values are free text
 * that may contain `<`, `&` or quotes. Every interpolated value goes through `escapeHtml` (via
 * `h()` for text that must also be flattened with `inline()`), attribute values included. The only
 * exception — deliberately isolated and commented at its single call site — is the SVG string
 * returned by `pipelineSvg`, which is already-escaped markup.
 */
import { stageOrderNote } from '../classify';
import type { ColumnInfo, DependencyInfo, EventName, ExecutionMode, FormInfo, LogicItem, LogicKind, LogicMap, Smell, TableFacts } from '../domain/model';
import { STAGE_LABEL, STAGE_ORDER, stripRaw } from '../domain/model';
import { pipelineSvg } from './htmlDiagram';
import { CONFIG_OMITTED, redactConfiguration } from './redact';
import { inline } from './text';

export interface HtmlOptions {
    /** Render the inline pipeline diagram (SVG) under each event heading. */
    includeDiagrams?: boolean;
    /** Write plugin steps' unsecure configuration strings (never the secure configuration). */
    includeConfiguration?: boolean;
    /** List every column, not only the ones with logic. */
    fullColumnList?: boolean;
}

const NONE = 'None';
const EMPTY = '—';
const SEP = ' · ';

const KIND_LABEL: Record<LogicKind, string> = {
    plugin: 'plugin step',
    customapi: 'custom API',
    workflow: 'workflow',
    action: 'action',
    flow: 'cloud flow',
    businessrule: 'business rule',
    formscript: 'form script',
    pcf: 'PCF control',
    formcomponent: 'form component',
    bpf: 'business process flow',
    duplicaterule: 'duplicate rule',
    cascade: 'cascade',
    key: 'alternate key',
    requiredcolumn: 'required column',
    formula: 'formula column',
    rollup: 'rollup column',
    calculated: 'calculated column',
    autonumber: 'autonumber',
    fieldsecurity: 'field security profile',
    audit: 'audit',
    app: 'app',
};

const MODE_LABEL: Record<ExecutionMode, string> = {
    sync: 'sync',
    async: 'async',
    realtime: 'real-time',
    background: 'background',
    client: 'client',
    instant: 'instant',
    rule: 'rule',
};

/** What each mode means in the Dataverse pipeline; rendered once as the badge legend. */
const MODE_MEANING: Record<ExecutionMode, string> = {
    sync: 'runs inside the database transaction and can block the save',
    async: 'queued by the async service, runs after the transaction commits',
    realtime: 'real-time workflow — inside the transaction, like a sync plugin',
    background: 'background workflow — queued, runs after the transaction commits',
    client: 'runs in the browser on the form, before the save reaches the server',
    instant: 'run on demand by a user, not by a table event',
    rule: 'platform data rule, enforced whenever the data changes',
};

const OWNERSHIP_LABEL: Record<string, string> = {
    UserOwned: 'User-owned',
    OrganizationOwned: 'Organization-owned',
    BusinessOwned: 'Business-owned',
    TeamOwned: 'Team-owned',
    None: 'No ownership',
};

/** Kind-specific detail keys worth a place on the one-line pipeline entry, with their labels. */
const LINE_DETAILS: Partial<Record<LogicKind, ReadonlyArray<readonly [key: string, label: string]>>> = {
    plugin: [
        ['assembly', 'assembly'],
        ['assemblyVersion', 'version'],
        ['pluginType', 'type'],
        ['secondaryEntity', 'secondary entity'],
    ],
    customapi: [
        ['bindingType', 'binding'],
        ['implementation', 'implementation'],
    ],
    workflow: [
        ['scope', 'scope'],
        ['onDemand', 'on demand'],
    ],
    action: [['uniqueName', 'unique name']],
    flow: [
        ['scope', 'scope'],
        ['filterExpression', 'filter'],
        ['runAs', 'run as'],
        ['instant', 'instant'],
    ],
    businessrule: [
        ['formName', 'form'],
        ['scope', 'scope'],
        ['actions', 'actions'],
    ],
    formscript: [
        ['formName', 'form'],
        ['library', 'library'],
        ['functionName', 'function'],
        ['formEvent', 'form event'],
        ['control', 'control'],
    ],
    pcf: [
        ['formName', 'form'],
        ['datafieldname', 'column'],
        ['tab', 'tab'],
        ['section', 'section'],
    ],
    formcomponent: [
        ['formName', 'form'],
        ['componentKind', 'type'],
        ['url', 'url'],
        ['targetEntity', 'target table'],
        ['relationshipName', 'relationship'],
        ['tab', 'tab'],
        ['section', 'section'],
    ],
    bpf: [['stages', 'stages']],
    duplicaterule: [
        ['matchingTable', 'matching table'],
        ['status', 'status'],
    ],
    cascade: [
        ['child', 'child'],
        ['parent', 'parent'],
        ['via', 'via'],
        ['behaviour', 'behaviour'],
        ['relationship', 'relationship'],
    ],
    key: [
        ['attributes', 'columns'],
        ['status', 'status'],
    ],
    requiredcolumn: [['level', 'level']],
    formula: [['formula', 'formula']],
    calculated: [['formula', 'formula']],
    rollup: [['formula', 'definition']],
    autonumber: [['format', 'format']],
    fieldsecurity: [['profileName', 'profile']],
    audit: [['note', 'note']],
};

// ---------------------------------------------------------------------------
// Escaping — the one gate every interpolated value passes through
// ---------------------------------------------------------------------------

/**
 * Escape text for both element content and quoted attribute values. `&` is replaced first so the
 * later replacements are not double-escaped; `'` becomes the numeric `&#39;` (understood by every
 * HTML parser, unlike `&apos;`).
 */
export function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Flatten a possibly multi-line Dataverse value onto one line, then escape it. */
function h(value: string): string {
    return escapeHtml(inline(value));
}

/**
 * Deterministic, collision-free `id` for a heading anchor. Everything outside `[a-z0-9]` is folded
 * to `-` (event names may be `Custom:<anything>` and form names are free text), and repeats get a
 * numeric suffix so two identically named forms still get distinct anchors.
 */
function anchor(used: Set<string>, prefix: string, label: string): string {
    const slug =
        inline(label)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'x';
    let id = `${prefix}-${slug}`;
    for (let n = 2; used.has(id); n++) id = `${prefix}-${slug}-${n}`;
    used.add(id);
    return id;
}

// ---------------------------------------------------------------------------
// Small helpers (unknown narrowing, formatting) — mirrors of the Markdown export's
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function recordArray(v: unknown): Record<string, unknown>[] {
    return Array.isArray(v) ? v.filter(isRecord) : [];
}

function list(values: readonly string[] | undefined, empty = EMPTY): string {
    return values && values.length > 0 ? values.join(', ') : empty;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
    return `${n} ${n === 1 ? singular : pluralForm}`;
}

function yesNo(v: boolean): string {
    return v ? 'yes' : 'no';
}

function onOff(v: boolean): string {
    return v ? 'on' : 'off';
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function byName<T extends { name: string; id: string }>(a: T, b: T): number {
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function unique(values: Iterable<string>): string[] {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/** Scalar or array-of-scalars detail value as one line (objects as one-line JSON). */
function formatValue(v: unknown): string | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'string') return inline(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
        if (v.length === 0) return undefined;
        return v.map((x) => (isRecord(x) || Array.isArray(x) ? JSON.stringify(x) : inline(String(x)))).join(', ');
    }
    if (isRecord(v)) return JSON.stringify(v);
    return String(v);
}

// ---------------------------------------------------------------------------
// HTML building blocks (callers pass raw values; escaping happens here)
// ---------------------------------------------------------------------------

function p(text: string, cls?: string): string {
    return `<p${cls ? ` class="${escapeHtml(cls)}"` : ''}>${h(text)}</p>`;
}

function none(): string {
    return `<p class="none">${NONE}</p>`;
}

/** `<ul>` of already-escaped HTML fragments (item lines build their own inline markup). */
function ulRaw(fragments: readonly string[]): string[] {
    if (fragments.length === 0) return [none()];
    return ['<ul>', ...fragments.map((f) => `<li>${f}</li>`), '</ul>'];
}

/** `<ul>` of plain text lines. */
function ul(lines: readonly string[]): string[] {
    return ulRaw(lines.map((line) => h(line)));
}

/** A bordered table; every header and cell is flattened and escaped. */
function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
    return ['<table>', '<thead>', `<tr>${header.map((c) => `<th>${h(c)}</th>`).join('')}</tr>`, '</thead>', '<tbody>', ...rows.map((row) => `<tr>${row.map((c) => `<td>${h(c)}</td>`).join('')}</tr>`), '</tbody>', '</table>'];
}

function badge(mode: ExecutionMode): string {
    return `<span class="badge badge-${escapeHtml(mode)}">${h(MODE_LABEL[mode])}</span>`;
}

// ---------------------------------------------------------------------------
// Context shared by the sections
// ---------------------------------------------------------------------------

interface Ctx {
    map: LogicMap;
    opts: HtmlOptions;
    /** Every item reachable from the map, by id (items, external touchers, form-attached items). */
    byId: Map<string, LogicItem>;
    /** Smell id → smell (for smell codes on item lines). */
    smellById: Map<string, Smell>;
    /** Anchor ids already handed out, so headings never collide. */
    usedIds: Set<string>;
}

function buildCtx(map: LogicMap, opts: HtmlOptions): Ctx {
    const byId = new Map<string, LogicItem>();
    const add = (item: LogicItem) => {
        if (!byId.has(item.id)) byId.set(item.id, item);
    };
    map.items.forEach(add);
    map.externalTouchers.forEach(add);
    for (const form of map.forms) [...form.handlers, ...form.pcf, ...form.components].forEach(add);
    return { map, opts, byId, smellById: new Map(map.smells.map((s) => [s.id, s])), usedIds: new Set<string>() };
}

function nameOf(ctx: Ctx, id: string): string {
    return inline(ctx.byId.get(id)?.name ?? id);
}

/** Synonym twins (Update shown under SetState/Assign) are not separate registrations. */
function isSynonym(item: LogicItem): boolean {
    return typeof item.details.synonymOf === 'string';
}

/** Distinct registrations of a kind (multi-event items share `groupId`). */
function registrations(items: readonly LogicItem[], kind: LogicKind, predicate: (item: LogicItem) => boolean = () => true): number {
    const groups = new Set<string>();
    for (const item of items) if (item.kind === kind && !isSynonym(item) && predicate(item)) groups.add(item.groupId ?? item.id);
    return groups.size;
}

/** One item per registration (the first in stable order), used by the data-rule lists. */
function firstPerGroup(items: readonly LogicItem[], kind: LogicKind): LogicItem[] {
    const seen = new Set<string>();
    const out: LogicItem[] = [];
    for (const item of [...items].sort(byName)) {
        if (item.kind !== kind || isSynonym(item)) continue;
        const key = item.groupId ?? item.id;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Header lines (same wording as the Markdown export)
// ---------------------------------------------------------------------------

function titleText(map: LogicMap): string {
    return `Table Logic Map — ${map.table.displayName} (${map.table.logicalName})`;
}

/** Browser tab / Word document title: the table plus the environment it was read from. */
function documentTitle(map: LogicMap): string {
    const env = map.environment.name || map.environment.url;
    return env ? `${titleText(map)} — ${env}` : titleText(map);
}

function environmentLine(map: LogicMap): string {
    const env = map.environment.url ? `${map.environment.name || map.environment.url} (${map.environment.url})` : map.environment.name || 'unknown';
    const parts = [`Environment: ${env}`, `Generated: ${map.generatedAt}`];
    if (map.stats.partial) parts.push(`Partial map (${map.stats.sourcesDone.length} sources done)`);
    return parts.join(SEP);
}

function factsLine(map: LogicMap): string {
    const t: TableFacts = map.table;
    const orgAuditOff = map.org.auditEnabled === false ? ' (org off)' : '';
    const orgDupOff = map.org.duplicateDetectionEnabled === false ? ' (org off)' : '';
    const facts = [
        t.isCustom ? 'Custom' : 'Standard',
        OWNERSHIP_LABEL[t.ownership] ?? t.ownership,
        ...(t.isActivity ? ['Activity table'] : []),
        `Audit ${onOff(t.audit)}${orgAuditOff}`,
        `Duplicate detection ${onOff(t.duplicateDetection)}${orgDupOff}`,
        `Change tracking ${onOff(t.changeTracking)}`,
        `Activities ${onOff(t.hasActivities)}`,
        `Notes ${onOff(t.hasNotes)}`,
        ...(t.isBpfEntity ? ['BPF table'] : []),
    ];
    return facts.join(SEP);
}

function countsLine(map: LogicMap): string {
    const items = map.items;
    const realtime = registrations(items, 'workflow', (i) => i.mode === 'realtime');
    const background = registrations(items, 'workflow', (i) => i.mode !== 'realtime');
    const handlers = map.forms.reduce((n, f) => n + f.handlers.length, 0);
    const pcf = map.forms.reduce((n, f) => n + f.pcf.length, 0);
    const components = map.forms.reduce((n, f) => n + f.components.length, 0);
    const optional = (n: number, singular: string, pluralForm?: string) => (n > 0 ? [plural(n, singular, pluralForm)] : []);
    const parts = [
        plural(registrations(items, 'plugin'), 'plugin step'),
        `${plural(realtime + background, 'workflow')} (${realtime} real-time / ${background} background)`,
        plural(registrations(items, 'flow'), 'flow'),
        ...optional(registrations(items, 'customapi') + registrations(items, 'action'), 'custom API/action', 'custom APIs/actions'),
        ...optional(registrations(items, 'bpf'), 'business process flow'),
        plural(registrations(items, 'businessrule'), 'business rule'),
        `${plural(map.forms.length, 'form')} (${plural(handlers, 'handler')}, ${pcf} PCF, ${plural(components, 'component')})`,
        plural(registrations(items, 'key'), 'key'),
        plural(registrations(items, 'duplicaterule'), 'duplicate rule'),
        // Cascade items share the relationship's groupId; every behaviour (Delete, Assign, ...) is its own rule.
        plural(items.filter((i) => i.kind === 'cascade' && !isSynonym(i)).length, 'cascade'),
        ...optional(registrations(items, 'fieldsecurity'), 'field security profile'),
        ...optional(registrations(items, 'autonumber'), 'autonumber column'),
        ...optional(registrations(items, 'formula') + registrations(items, 'calculated') + registrations(items, 'rollup'), 'computed column'),
        ...optional(map.externalTouchers.length, 'external toucher'),
        plural(map.apps.length, 'app'),
        `${plural(map.views.total, 'view')} (${map.views.quickFind} quick find)`,
    ];
    return parts.join(SEP);
}

// ---------------------------------------------------------------------------
// Smells
// ---------------------------------------------------------------------------

function smellsBody(map: LogicMap): string[] {
    if (map.smells.length === 0) return [none()];
    // Smell messages embed item names, which may contain line breaks and markup.
    const fragments = map.smells.map((smell) => `<strong>${h(smell.severity)}</strong> <code>${h(smell.code)}</code> — ${h(smell.message)}<br /><span class="explain">${h(smell.explanation)}</span>`);
    return ulRaw(fragments);
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function imagesSummary(item: LogicItem): string | undefined {
    const images = recordArray(item.details.images);
    if (images.length === 0) return undefined;
    return images
        .map((img) => {
            const attrs = stringArray(img.attributes);
            const type = str(img.type) ?? 'Image';
            return `${str(img.name) ?? str(img.alias) ?? 'image'} (${type}: ${attrs.length > 0 ? attrs.join(', ') : 'all columns'})`;
        })
        .join('; ');
}

function endpointSummary(item: LogicItem): string | undefined {
    const endpoint = item.details.endpoint;
    if (!isRecord(endpoint)) return undefined;
    const bits = [str(endpoint.name), str(endpoint.contract), str(endpoint.url)].filter((s): s is string => s !== undefined);
    return bits.length > 0 ? bits.join(' ') : undefined;
}

/** Kind-specific facts for an item line (assembly/type/images for plugins, form/library for scripts, ...). */
function kindFacts(item: LogicItem, ctx: Ctx): string[] {
    const facts: string[] = [];
    for (const [key, label] of LINE_DETAILS[item.kind] ?? []) {
        const raw = item.details[key];
        if (typeof raw === 'boolean') {
            if (raw) facts.push(label);
            continue;
        }
        const value = formatValue(raw);
        if (value !== undefined) facts.push(`${label}: ${truncate(value, 120)}`);
    }
    if (item.kind === 'plugin') {
        const endpoint = endpointSummary(item);
        if (endpoint) facts.push(`endpoint: ${endpoint}`);
        const images = imagesSummary(item);
        facts.push(images ? `images: ${images}` : 'images: none');
        if (item.details.hasSecureConfig === true) facts.push('secure config: set (never exported)');
        const config = str(item.details.unsecureConfig);
        // `redactConfiguration` already replaced the value unless the caller opted in; this line
        // only picks the wording, it is not the redaction itself.
        if (config !== undefined) facts.push(ctx.opts.includeConfiguration ? `config: ${config}` : `config: ${CONFIG_OMITTED}`);
        if (item.details.role === 'secondary') facts.push('registered as secondary entity');
    }
    return facts;
}

function filteringFact(item: LogicItem): string | undefined {
    const filters = item.filteringAttributes ?? [];
    if (filters.length > 0) return `filtering: ${filters.join(', ')}`;
    if (item.event === 'Update' && (item.details.firesOnAnyUpdate === true || item.kind === 'plugin' || item.kind === 'workflow' || item.kind === 'flow')) return 'filtering: any column';
    return undefined;
}

function smellFact(item: LogicItem, ctx: Ctx): string | undefined {
    if (!item.smells || item.smells.length === 0) return undefined;
    return `smells: ${unique(item.smells.map((id) => ctx.smellById.get(id)?.code ?? id)).join(', ')}`;
}

/** `<strong>#rank</strong> name — kind · [mode badge] · enabled · filtering: … · facts · smells: …` */
function itemFragment(item: LogicItem, ctx: Ctx): string {
    const rank = item.order !== undefined ? `<strong>#${h(String(item.order))}</strong> ` : '';
    const parts: Array<string | undefined> = [
        KIND_LABEL[item.kind],
        item.mode ? badge(item.mode) : undefined,
        item.enabled ? 'enabled' : '<span class="off">disabled</span>',
        filteringFact(item),
        ...kindFacts(item, ctx),
        item.touchesColumns && item.touchesColumns.length > 0 ? `touches: ${item.touchesColumns.join(', ')}` : undefined,
        item.confidence === 'heuristic' ? 'confidence: heuristic' : undefined,
        isSynonym(item) ? 'also runs here (Update filtering attributes)' : undefined,
        smellFact(item, ctx),
    ];
    // The two entries above that are already markup start with `<`; every other part is Dataverse
    // free text and is escaped here.
    const tail = parts
        .filter((part): part is string => part !== undefined)
        .map((part) => (part.startsWith('<') ? part : h(part)))
        .join(SEP);
    return `${rank}<span class="name">${h(item.name)}</span> — ${tail}`;
}

function pipelineBody(ctx: Ctx): string[] {
    const { map, opts } = ctx;
    const events = Object.keys(map.pipeline);
    if (events.length === 0) return [none()];
    const out: string[] = [];
    for (const event of events) {
        const row = map.pipeline[event];
        const id = anchor(ctx.usedIds, 'pipeline', event);
        out.push(`<h3 id="${escapeHtml(id)}">${h(event)}</h3>`);
        if (opts.includeDiagrams) {
            // The heading anchor prefixes the diagram's node ids, so a page with one figure per
            // event still has unique `id` attributes (Word and HTML validators both care).
            const svg = pipelineSvg(map, event as EventName, { idPrefix: `${id}-` });
            if (svg !== '') {
                // The ONLY unescaped interpolation in this module: `pipelineSvg` returns complete
                // SVG markup whose text and attribute values it has already escaped itself.
                out.push('<figure class="diagram">', svg, `<figcaption>Execution order for ${h(event)}</figcaption>`, '</figure>');
            }
        }
        let any = false;
        for (const stage of STAGE_ORDER) {
            const items = row[stage];
            if (items.length === 0) continue;
            any = true;
            const note = stageOrderNote(row, stage);
            out.push(`<h4>${h(STAGE_LABEL[stage])}${note ? ` <span class="note">(${h(note)})</span>` : ''}</h4>`);
            out.push(...ulRaw(items.map((item) => itemFragment(item, ctx))));
        }
        if (!any) out.push(none());
    }
    return out;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function handlerRow(handler: LogicItem): string[] {
    const d = handler.details;
    return [str(d.formEvent) ?? handler.event, str(d.attribute) ?? str(d.control) ?? EMPTY, str(d.functionName) ?? handler.name, str(d.library) ?? EMPTY, yesNo(handler.enabled), yesNo(d.passExecutionContext === true), str(d.parameters) ?? EMPTY];
}

function controlRow(c: LogicItem): string[] {
    const d = c.details;
    const location = [str(d.tab), str(d.section)].filter((s): s is string => s !== undefined).join(' › ');
    const extras = [str(d.url) && `url ${str(d.url)}`, str(d.targetEntity) && `target ${str(d.targetEntity)}`, str(d.relationshipName) && `relationship ${str(d.relationshipName)}`, str(d.region) && `region ${str(d.region)}`].filter((s): s is string => typeof s === 'string');
    const column = str(d.datafieldname) ?? str(d.lookupColumn) ?? list(c.touchesColumns);
    return [c.kind === 'pcf' ? 'PCF' : (str(d.componentKind) ?? 'Component'), c.name, column, location || EMPTY, list(extras)];
}

function ruleScope(rule: LogicItem | undefined): string {
    if (!rule) return 'unknown';
    return str(rule.details.formId) !== undefined ? 'form' : 'entity';
}

function formBlock(form: FormInfo, ctx: Ctx): string[] {
    const flags = [form.type, form.state, ...(form.isDefault ? ['default'] : []), ...(form.isManaged ? ['managed'] : [])].join(SEP);
    const id = anchor(ctx.usedIds, 'form', form.name);
    const out = [`<h3 id="${escapeHtml(id)}">${h(`${form.name} (${flags})`)}</h3>`];
    if (form.description) out.push(p(form.description, 'meta'));
    out.push(p(`Libraries: ${list(form.libraries, 'none')}`, 'meta'));
    out.push('<h4>Handlers</h4>');
    if (form.handlers.length === 0) out.push(none());
    else out.push(...table(['Event', 'Column / control', 'Function', 'Library', 'Enabled', 'Pass context', 'Parameters'], [...form.handlers].sort(byName).map(handlerRow)));
    out.push('<h4>PCF and components</h4>');
    const controls = [...form.pcf, ...form.components].sort(byName);
    if (controls.length === 0) out.push(none());
    else out.push(...table(['Type', 'Name', 'Column', 'Location', 'Details'], controls.map(controlRow)));
    const rules = unique(form.businessRules.map((ruleId) => `${nameOf(ctx, ruleId)} (${ruleScope(ctx.byId.get(ruleId))})`));
    out.push(p(`Business rules: ${list(rules, 'none')}`, 'meta'));
    return out;
}

function formsBody(ctx: Ctx): string[] {
    const forms = [...ctx.map.forms].sort(byName);
    if (forms.length === 0) return [none()];
    return forms.flatMap((form) => formBlock(form, ctx));
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function hasLogic(col: ColumnInfo): boolean {
    return col.triggers.length > 0 || col.touchedBy.length > 0 || col.required || col.secured || col.audited || col.sourceType !== 'simple' || col.autoNumber !== undefined;
}

function columnRow(col: ColumnInfo, ctx: Ctx): string[] {
    const flags = [col.required && 'required', col.secured && 'secured', col.audited && 'audited', !col.isCustom && 'system'].filter((f): f is string => typeof f === 'string');
    const source = col.autoNumber ? `autonumber ${col.autoNumber}` : col.sourceType;
    const names = (ids: string[]) => list(unique(ids.map((id) => nameOf(ctx, id))));
    return [col.logicalName, col.displayName, col.type, list(flags), source, names(col.triggers), names(col.touchedBy)];
}

/** Columns the table shows: only the ones carrying logic unless `fullColumnList` is set. */
function shownColumns(ctx: Ctx): ColumnInfo[] {
    const all = Object.values(ctx.map.columns).sort((a, b) => a.logicalName.localeCompare(b.logicalName));
    return ctx.opts.fullColumnList ? all : all.filter(hasLogic);
}

function columnsBody(ctx: Ctx): string[] {
    const total = Object.keys(ctx.map.columns).length;
    const shown = shownColumns(ctx);
    const out = [p(ctx.opts.fullColumnList ? `All ${plural(total, 'column')}.` : `${shown.length} of ${plural(total, 'column')} with logic (triggers, touched by, required, secured, audited or computed).`, 'meta')];
    if (shown.length === 0) return [...out, none()];
    return [...out, ...table(['Column', 'Display name', 'Type', 'Flags', 'Source', 'Triggers', 'Touched by'], shown.map((c) => columnRow(c, ctx)))];
}

// ---------------------------------------------------------------------------
// Data rules
// ---------------------------------------------------------------------------

function keysBlock(ctx: Ctx): string[] {
    const keys = firstPerGroup(ctx.map.items, 'key');
    return ul(keys.map((k) => `${k.name} (${str(k.details.status) ?? (k.enabled ? 'Active' : 'Inactive')}): ${list(stringArray(k.details.attributes).length > 0 ? stringArray(k.details.attributes) : k.touchesColumns)}`));
}

function conditionLine(c: Record<string, unknown>): string {
    const flags = [str(c.operator) ?? 'match', typeof c.param === 'number' ? `${c.param}` : undefined, c.ignoreBlank === true ? 'ignore blanks' : undefined].filter((s): s is string => s !== undefined);
    return `${str(c.base) ?? '?'} ↔ ${str(c.matching) ?? '?'} (${flags.join(', ')})`;
}

function duplicateRulesBlock(ctx: Ctx): string[] {
    const rules = firstPerGroup(ctx.map.items, 'duplicaterule');
    if (rules.length === 0) return [none()];
    const fragments = rules.map((rule) => {
        const d = rule.details;
        const status = str(d.status) ?? (rule.enabled ? 'Published' : 'Unpublished');
        const head = h(`${rule.name} (${status}) — ${str(d.baseTable) ?? ctx.map.table.logicalName} ↔ ${str(d.matchingTable) ?? '?'}`);
        const conditions = recordArray(d.conditions);
        return `${head}${ul(conditions.length === 0 ? ['no conditions'] : conditions.map(conditionLine)).join('')}`;
    });
    return ulRaw(fragments);
}

/** `this table → child (via lookup)` with one nested line per action, plus inbound cascades from parents. */
function cascadesBlock(ctx: Ctx): string[] {
    const tableName = ctx.map.table.logicalName;
    const cascades = ctx.map.items.filter((i) => i.kind === 'cascade' && !isSynonym(i));
    if (cascades.length === 0) return [none()];
    const outbound = new Map<string, LogicItem[]>();
    const inbound: LogicItem[] = [];
    for (const item of cascades) {
        const child = str(item.details.child);
        if (child === undefined) {
            inbound.push(item);
            continue;
        }
        const key = `${child}|${str(item.details.via) ?? ''}`;
        (outbound.get(key) ?? outbound.set(key, []).get(key)!).push(item);
    }
    const fragments: string[] = [];
    for (const key of [...outbound.keys()].sort((a, b) => a.localeCompare(b))) {
        const group = outbound.get(key)!;
        const [child, via] = key.split('|');
        const actions = group.map((i) => inline(`${str(i.details.action) ?? i.event}: ${str(i.details.behaviour) ?? 'Cascade'}${i.details.chainDepth !== undefined ? ` (chain depth ${String(i.details.chainDepth)})` : ''}`)).sort((a, b) => a.localeCompare(b));
        fragments.push(`${h(`${tableName} → ${child}${via ? ` (via ${via})` : ''}`)}${ul(unique(actions)).join('')}`);
    }
    for (const item of inbound.sort(byName)) {
        const parent = str(item.details.parent) ?? '?';
        const via = str(item.details.via);
        const action = `${str(item.details.action) ?? item.event}: ${str(item.details.behaviour) ?? 'Cascade'} (${item.name})`;
        fragments.push(`${h(`${parent} → ${tableName}${via ? ` (via ${via})` : ''}`)}${ul([action]).join('')}`);
    }
    return ulRaw(fragments);
}

function fieldSecurityBlock(ctx: Ctx): string[] {
    const profiles = firstPerGroup(ctx.map.items, 'fieldsecurity');
    return ul(
        profiles.map((profile) => {
            const permissions = recordArray(profile.details.permissions);
            const columns = permissions.length > 0 ? permissions.map((perm) => `${str(perm.attribute) ?? '?'} (read ${str(perm.canRead) ?? '?'}, create ${str(perm.canCreate) ?? '?'}, update ${str(perm.canUpdate) ?? '?'})`) : (profile.touchesColumns ?? []);
            return `${profile.name}: ${list(unique(columns))}`;
        }),
    );
}

function auditBlock(ctx: Ctx): string[] {
    const item = ctx.map.items.find((i) => i.kind === 'audit');
    const orgOn = item ? item.details.orgEnabled === true : ctx.map.org.auditEnabled === true;
    const tableOn = item ? item.details.tableEnabled === true : ctx.map.table.audit;
    const effective = item ? item.enabled : orgOn && tableOn;
    const audited = Object.values(ctx.map.columns)
        .filter((c) => c.audited)
        .map((c) => c.logicalName)
        .sort((a, b) => a.localeCompare(b));
    const note = str(item?.details.note);
    return ul([`Auditing: ${effective ? 'effective' : 'not effective'} (organization ${onOff(orgOn)}, table ${onOff(tableOn)})${note ? ` — ${note}` : ''}`, `Audited columns: ${list(audited, 'none')}`]);
}

function requiredColumnsBlock(ctx: Ctx): string[] {
    const required = Object.values(ctx.map.columns)
        .filter((c) => c.required)
        .sort((a, b) => a.logicalName.localeCompare(b.logicalName))
        .map((c) => `${c.logicalName} (${c.displayName})`);
    return [p(list(required, 'none'))];
}

function dataRulesBody(ctx: Ctx): string[] {
    const heading = (label: string) => `<h3 id="${escapeHtml(anchor(ctx.usedIds, 'rules', label))}">${h(label)}</h3>`;
    return [heading('Keys'), ...keysBlock(ctx), heading('Duplicate rules'), ...duplicateRulesBlock(ctx), heading('Cascades'), ...cascadesBlock(ctx), heading('Field security profiles'), ...fieldSecurityBlock(ctx), heading('Audit'), ...auditBlock(ctx), heading('Required columns'), ...requiredColumnsBlock(ctx)];
}

// ---------------------------------------------------------------------------
// Touched by (external touchers)
// ---------------------------------------------------------------------------

/** `details.access` when the source set it, else derived from `details.actionsOnTable[].kind`. */
function accessOf(item: LogicItem): 'write' | 'read' {
    const access = str(item.details.access);
    if (access === 'write' || access === 'readwrite') return 'write';
    if (access === 'read') return 'read';
    return recordArray(item.details.actionsOnTable).some((a) => a.kind === 'write') ? 'write' : 'read';
}

function toucherFragment(item: LogicItem): string {
    const ops = recordArray(item.details.actionsOnTable).map((a) => `${str(a.operationId) ?? str(a.name) ?? '?'}${str(a.path) ? ` (${str(a.path)})` : ''}`);
    const parts = [KIND_LABEL[item.kind], item.enabled ? 'enabled' : 'disabled', str(item.details.trigger) ? `trigger: ${str(item.details.trigger)}` : undefined, ops.length > 0 ? `operations: ${ops.join(', ')}` : undefined, item.touchesColumns && item.touchesColumns.length > 0 ? `touches: ${item.touchesColumns.join(', ')}` : undefined];
    return `<span class="name">${h(item.name)}</span> — ${h(parts.filter((part): part is string => part !== undefined).join(SEP))}`;
}

function touchedByBody(ctx: Ctx): string[] {
    const out = [p(`Flows and actions that read or write ${ctx.map.table.logicalName} without being triggered by it.`, 'meta')];
    const touchers = [...ctx.map.externalTouchers].sort(byName);
    for (const access of ['write', 'read'] as const) {
        const group = touchers.filter((t) => accessOf(t) === access);
        const label = access === 'write' ? 'Write' : 'Read';
        out.push(`<h3 id="${escapeHtml(anchor(ctx.usedIds, 'touched', label))}">${h(label)}</h3>`);
        out.push(...ulRaw(group.map(toucherFragment)));
    }
    return out;
}

// ---------------------------------------------------------------------------
// Apps, dependencies, source errors
// ---------------------------------------------------------------------------

function appsBody(map: LogicMap): string[] {
    const apps = [...map.apps].sort(byName);
    if (apps.length === 0) return [none()];
    return table(
        ['App', 'Unique name', 'State', 'Managed'],
        apps.map((a) => [a.name, a.uniqueName, a.state, yesNo(a.isManaged)]),
    );
}

function dependencyType(d: DependencyInfo): string {
    return d.componentTypeName ? `${d.componentTypeName} (${d.componentType})` : String(d.componentType);
}

/** Dependencies the classifier could not tie to an item (views, charts, dashboards, ...). */
function unclassifiedDependencies(map: LogicMap): DependencyInfo[] {
    return map.dependencies.filter((d) => !d.classified).sort((a, b) => a.componentType - b.componentType || (a.name ?? '').localeCompare(b.name ?? '') || a.objectId.localeCompare(b.objectId));
}

function dependenciesBody(map: LogicMap): string[] {
    const out = [p('Components that depend on the table and are not represented above (views, charts, dashboards, ...).', 'meta')];
    const other = unclassifiedDependencies(map);
    if (other.length === 0) return [...out, none()];
    return [
        ...out,
        ...table(
            ['Component type', 'Name', 'Object id'],
            other.map((d) => [dependencyType(d), d.name ?? EMPTY, d.objectId]),
        ),
    ];
}

function sourceErrorsBody(map: LogicMap): string[] {
    if (map.sourceErrors.length === 0) return [none()];
    const errors = [...map.sourceErrors].sort((a, b) => a.source.localeCompare(b.source) || a.message.localeCompare(b.message));
    // The message and the permission note are escaped as one string: `h()` trims, so escaping the
    // note separately would swallow the space in front of it.
    return ulRaw(errors.map((e) => `<strong>${h(e.source)}</strong> (${h(e.kind)}): ${h(`${e.message}${e.kind === 'permission' ? ' — this map is missing what that source would have found' : ''}`)}`));
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

interface Section {
    id: string;
    label: string;
    /** Shown next to the heading and in the contents; omitted where a count means nothing. */
    count?: number;
    body: string[];
}

/** Badge legend: what each execution mode means for when the item runs. */
function legend(): string[] {
    const modes: ExecutionMode[] = ['sync', 'async', 'realtime', 'background', 'client', 'instant', 'rule'];
    return ['<h2 id="legend">Legend</h2>', '<ul class="legend">', ...modes.map((mode) => `<li>${badge(mode)} ${h(MODE_MEANING[mode])}</li>`), '</ul>'];
}

function contents(sections: readonly Section[]): string[] {
    const links = sections.map((s) => `<li><a href="#${escapeHtml(s.id)}">${h(s.label)}${s.count === undefined ? '' : ` (${h(String(s.count))})`}</a></li>`);
    return ['<nav class="toc">', '<h2 id="contents">Contents</h2>', '<ul>', ...links, '</ul>', '</nav>'];
}

function sectionHtml(section: Section): string[] {
    const count = section.count === undefined ? '' : ` <span class="count">(${h(String(section.count))})</span>`;
    return ['<section>', `<h2 id="${escapeHtml(section.id)}">${h(section.label)}${count}</h2>`, ...section.body, '</section>'];
}

/** The whole stylesheet: inline, print-aware, and free of grid/flexbox so Word keeps the layout. */
const STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #f7f7f8; color: #16181d; font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif; font-size: 14px; line-height: 1.5; }
main { max-width: 960px; margin: 0 auto; padding: 24px 28px 64px; background: #ffffff; }
h1 { font-size: 24px; margin: 0 0 8px; }
h2 { font-size: 19px; margin: 30px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #d6d8dd; }
h3 { font-size: 16px; margin: 20px 0 6px; }
h4 { font-size: 14px; margin: 14px 0 4px; }
p { margin: 6px 0; }
ul { margin: 6px 0; padding-left: 22px; }
li { margin: 3px 0; }
code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
.meta { color: #4a4f57; }
.none { color: #6b7078; font-style: italic; }
.off { color: #8a3d3d; }
.note, .explain { color: #6b7078; font-size: 12px; }
.count { color: #6b7078; font-weight: normal; font-size: 13px; }
.name { font-weight: 600; }
.toc { margin: 20px 0; padding: 4px 18px 12px; border: 1px solid #d6d8dd; background: #fafafb; }
.toc h2 { border-bottom: 0; margin: 12px 0 4px; font-size: 16px; }
.toc a { color: #1a4f9c; }
ul.legend { list-style: none; padding-left: 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 12px; }
th, td { border: 1px solid #b9bcc3; padding: 4px 7px; text-align: left; vertical-align: top; }
th { background: #eef0f3; font-weight: 600; }
.badge { display: inline-block; border: 1px solid #9aa0a8; border-radius: 3px; padding: 0 5px; font-size: 11px; background: #f2f3f5; }
.badge-sync, .badge-realtime { border-color: #a86b2d; background: #fbf1e4; }
.badge-async, .badge-background { border-color: #4a7ba8; background: #eaf1f8; }
figure.diagram { margin: 10px 0 16px; overflow-x: auto; page-break-inside: avoid; }
/* The figure is 820px wide, the printed column (A4/Letter less the 16mm @page margin) is
   about 675px: without this the right end of every row — the kind/mode tail, and the tail of
   a long name — would be clipped off the paper. viewBox + height:auto scale it down whole. */
figure.diagram svg { max-width: 100%; height: auto; }
figcaption { color: #6b7078; font-size: 12px; margin-top: 4px; }
footer.brand { max-width: 960px; margin: 0 auto; padding: 10px 28px 28px; background: #ffffff; }
footer.brand a { display: inline-flex; align-items: center; gap: 7px; color: #5c636b; font-size: 12px; text-decoration: none; }
footer.brand a:hover { color: #16181d; text-decoration: underline; }
@media print {
  @page { margin: 16mm; }
  body { background: #ffffff; color: #000000; font-size: 11pt; }
  main { max-width: none; padding: 0; background: #ffffff; }
  h1, h2, h3, h4 { color: #000000; page-break-after: avoid; break-after: avoid; }
  h2, h3 { page-break-inside: avoid; }
  table, figure.diagram, li { page-break-inside: avoid; }
  thead { display: table-header-group; }
  th { background: #eeeeee; }
  .toc { border-color: #000000; background: transparent; }
  a { color: #000000; text-decoration: none; }
}
`.trim();

/**
 * Full, self-contained HTML document for a LogicMap: no scripts, no external resources, safe to
 * open in a browser or Word and to print to PDF. Never writes `raw`, flow clientdata or secure
 * configuration; the unsecure configuration appears only with `includeConfiguration`.
 */
/** Public site for the tool, linked from the exported document's footer. */
const VERSEBLOCKS_URL = 'https://www.verseblocks.com';

/**
 * Attribution footer. The mark is inlined (not linked) so the document stays self-contained and
 * renders with no network; the only outbound link is an ordinary hyperlink a reader may click.
 * Its gradient id is prefixed to avoid colliding with the pipeline diagrams' own ids.
 */
function brandFooter(): string[] {
    return [
        '<footer class="brand">',
        `<a href="${VERSEBLOCKS_URL}">`,
        '<svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="VerseBlocks">',
        '<defs><linearGradient id="vb-footer-fg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">',
        '<stop offset="0%" stop-color="#E94560"/><stop offset="100%" stop-color="#B8354D"/>',
        '</linearGradient></defs>',
        '<rect width="32" height="32" rx="7" fill="#0A0A0F"/>',
        '<path d="M8 7h16v3H8z" fill="url(#vb-footer-fg)"/>',
        '<path d="M10 7L16 26L22 7" stroke="url(#vb-footer-fg)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
        '</svg>',
        '<span>Generated by Table Logic Map &mdash; VerseBlocks</span>',
        '</a>',
        '</footer>',
    ];
}

export function toHtml(map: LogicMap, opts: HtmlOptions = {}): string {
    // Same redaction pipeline as `toJson`: drop the raw payload, then blank the configuration.
    const safe = redactConfiguration(stripRaw(map), { includeConfiguration: opts.includeConfiguration });
    const ctx = buildCtx(safe, opts);

    const sections: Section[] = [
        { id: 'smells', label: 'Smells', count: safe.smells.length, body: smellsBody(safe) },
        { id: 'pipeline', label: 'Pipeline', count: Object.keys(safe.pipeline).length, body: pipelineBody(ctx) },
        { id: 'forms', label: 'Forms', count: safe.forms.length, body: formsBody(ctx) },
        { id: 'columns', label: 'Columns', count: shownColumns(ctx).length, body: columnsBody(ctx) },
        { id: 'data-rules', label: 'Data rules', body: dataRulesBody(ctx) },
        { id: 'touched-by', label: 'Touched by', count: safe.externalTouchers.length, body: touchedByBody(ctx) },
        { id: 'apps', label: 'Apps', count: safe.apps.length, body: appsBody(safe) },
        { id: 'other-dependencies', label: 'Other dependencies', count: unclassifiedDependencies(safe).length, body: dependenciesBody(safe) },
        { id: 'source-errors', label: 'Source errors', count: safe.sourceErrors.length, body: sourceErrorsBody(safe) },
    ];

    const lines = [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8" />',
        `<title>${h(documentTitle(safe))}</title>`,
        '<style>',
        STYLE,
        '</style>',
        '</head>',
        '<body>',
        '<main>',
        `<h1>${h(titleText(safe))}</h1>`,
        p(environmentLine(safe), 'meta'),
        p(factsLine(safe), 'meta'),
        p(countsLine(safe), 'meta'),
        ...contents(sections),
        ...legend(),
        ...sections.flatMap(sectionHtml),
        '</main>',
        ...brandFooter(),
        '</body>',
        '</html>',
    ];
    return `${lines.join('\n')}\n`;
}

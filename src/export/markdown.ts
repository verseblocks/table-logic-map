/**
 * Markdown export — the primary, human-readable output (design guide §8).
 *
 * Sections, in a fixed order so re-exports diff cleanly in git:
 *   title · environment/date · facts · counts · Smells · Pipeline · Forms · Columns · Data rules ·
 *   Touched by · Apps · Other dependencies · Source errors · Diagrams (optional).
 *
 * Redaction rules (CLAUDE.md): plugin secure configuration is never fetched, raw source data and
 * flow `clientdata` are never written, webhook/IFrame URLs arrive already redacted from the
 * sources, and a step's unsecure configuration is written only with `includeConfiguration`.
 *
 * Ordering: the pipeline is used as the classifier sorted it (execution order); everything else
 * (forms, apps, columns, dependencies, cascades) is sorted by name here.
 *
 * Structure safety: Dataverse allows line breaks in record names (step, workflow, form, ...), so
 * every name/label written into a bullet, heading or detail line goes through `inline()` and every
 * table cell through `escapeCell()`; otherwise one crafted record name could forge headings or list
 * items in the report.
 */
import { stageOrderNote } from '../classify';
import type { ColumnInfo, DependencyInfo, EventName, FormInfo, LogicItem, LogicKind, LogicMap, Smell, TableFacts } from '../domain/model';
import { STAGE_LABEL, STAGE_ORDER } from '../domain/model';
import { toMermaid } from './mermaid';
import { CONFIG_OMITTED } from './redact';
import { inline } from './text';

export interface MarkdownOptions {
    /** Append a `## Diagrams` section with one Mermaid block per event. */
    includeDiagrams?: boolean;
    /** Write plugin steps' unsecure configuration strings (never the secure configuration). */
    includeConfiguration?: boolean;
    /** List every column, not only the ones with logic. */
    fullColumnList?: boolean;
}

/** Public site for the tool, linked from the exported document's footer. */
const VERSEBLOCKS_URL = 'https://www.verseblocks.com';

const NONE = '_None_';
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

const MODE_LABEL: Record<NonNullable<LogicItem['mode']>, string> = {
    sync: 'sync',
    async: 'async',
    realtime: 'real-time',
    background: 'background',
    client: 'client',
    instant: 'instant',
    rule: 'rule',
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
// Small helpers (unknown narrowing, formatting)
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

/** Escape a value for a Markdown table cell: pipes and line breaks would break the row. */
export function escapeCell(v: string): string {
    return inline(v.replace(/\|/g, '\\|'));
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

/** Scalar or array-of-scalars detail value as one line (objects are JSON on one line). */
function formatValue(v: unknown): string | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'string') return inline(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
        if (v.length === 0) return undefined;
        // Array members are flattened too: a string element with a line break would forge structure.
        return v.map((x) => (isRecord(x) || Array.isArray(x) ? JSON.stringify(x) : inline(String(x)))).join(', ');
    }
    if (isRecord(v)) return JSON.stringify(v);
    return String(v);
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
    const line = (cells: readonly string[]) => `| ${cells.map(escapeCell).join(' | ')} |`;
    return [line(header), `|${header.map(() => '---').join('|')}|`, ...rows.map(line)];
}

// ---------------------------------------------------------------------------
// Context shared by the sections
// ---------------------------------------------------------------------------

interface Ctx {
    map: LogicMap;
    opts: MarkdownOptions;
    /** Every item reachable from the map, by id (items, external touchers, form-attached items). */
    byId: Map<string, LogicItem>;
    /** Smell id → smell (for badge codes on item lines). */
    smellById: Map<string, Smell>;
}

function buildCtx(map: LogicMap, opts: MarkdownOptions): Ctx {
    const byId = new Map<string, LogicItem>();
    const add = (item: LogicItem) => {
        if (!byId.has(item.id)) byId.set(item.id, item);
    };
    map.items.forEach(add);
    map.externalTouchers.forEach(add);
    for (const form of map.forms) [...form.handlers, ...form.pcf, ...form.components].forEach(add);
    return { map, opts, byId, smellById: new Map(map.smells.map((s) => [s.id, s])) };
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
// Header
// ---------------------------------------------------------------------------

function title(map: LogicMap): string {
    return inline(`# Table Logic Map — ${map.table.displayName} (${map.table.logicalName})`);
}

function environmentLine(map: LogicMap): string {
    const env = map.environment.url ? `${map.environment.name || map.environment.url} (${map.environment.url})` : map.environment.name || 'unknown';
    const parts = [`Environment: ${env}`, `Generated: ${map.generatedAt}`];
    if (map.stats.partial) parts.push(`Partial map (${map.stats.sourcesDone.length} sources done)`);
    return inline(parts.join(SEP));
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
    return inline(facts.join(SEP));
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

function smellsSection(map: LogicMap): string[] {
    const lines = ['## Smells', ''];
    if (map.smells.length === 0) return [...lines, NONE];
    for (const smell of map.smells) {
        // Smell messages embed item names, which may contain line breaks.
        lines.push(inline(`- **${smell.severity}** \`${smell.code}\` — ${smell.message}`));
        lines.push(`  - ${inline(smell.explanation)}`);
    }
    return lines;
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
        if (config !== undefined) facts.push(ctx.opts.includeConfiguration ? `config: ${inline(config)}` : `config: ${CONFIG_OMITTED}`);
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

/** `- **#rank** name — kind · mode · enabled · filtering: a, b · <kind facts> · touches: x · smells: …` */
function itemLine(item: LogicItem, ctx: Ctx): string {
    const rank = item.order !== undefined ? `**#${item.order}** ` : '';
    const parts: Array<string | undefined> = [
        KIND_LABEL[item.kind],
        item.mode ? MODE_LABEL[item.mode] : undefined,
        item.enabled ? 'enabled' : 'disabled',
        filteringFact(item),
        ...kindFacts(item, ctx),
        item.touchesColumns && item.touchesColumns.length > 0 ? `touches: ${item.touchesColumns.join(', ')}` : undefined,
        item.confidence === 'heuristic' ? 'confidence: heuristic' : undefined,
        isSynonym(item) ? 'also runs here (Update filtering attributes)' : undefined,
        smellFact(item, ctx),
    ];
    return inline(`${rank}${item.name} — ${parts.filter((p): p is string => p !== undefined).join(SEP)}`);
}

function pipelineSection(ctx: Ctx): string[] {
    const { map } = ctx;
    const lines = ['## Pipeline', ''];
    const events = Object.keys(map.pipeline);
    if (events.length === 0) return [...lines, NONE];
    events.forEach((event, index) => {
        const row = map.pipeline[event];
        if (index > 0) lines.push('');
        lines.push(`### ${inline(event)}`, '');
        let any = false;
        for (const stage of STAGE_ORDER) {
            const items = row[stage];
            if (items.length === 0) continue;
            any = true;
            const note = stageOrderNote(row, stage);
            lines.push(`- **${STAGE_LABEL[stage]}**${note ? ` _(${note})_` : ''}`);
            for (const item of items) lines.push(`  - ${itemLine(item, ctx)}`);
        }
        if (!any) lines.push(NONE);
    });
    return lines;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function handlerRow(h: LogicItem): string[] {
    const d = h.details;
    return [
        str(d.formEvent) ?? h.event,
        str(d.attribute) ?? str(d.control) ?? EMPTY,
        str(d.functionName) ?? h.name,
        str(d.library) ?? EMPTY,
        yesNo(h.enabled),
        yesNo(d.passExecutionContext === true),
        str(d.parameters) ?? EMPTY,
    ];
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
    const lines = [inline(`### ${form.name} (${flags})`), '', inline(`Libraries: ${list(form.libraries, 'none')}`), ''];
    lines.push('**Handlers**', '');
    if (form.handlers.length === 0) lines.push(NONE);
    else lines.push(...table(['Event', 'Column / control', 'Function', 'Library', 'Enabled', 'Pass context', 'Parameters'], [...form.handlers].sort(byName).map(handlerRow)));
    lines.push('', '**PCF and components**', '');
    const controls = [...form.pcf, ...form.components].sort(byName);
    if (controls.length === 0) lines.push(NONE);
    else lines.push(...table(['Type', 'Name', 'Column', 'Location', 'Details'], controls.map(controlRow)));
    const rules = unique(form.businessRules.map((id) => `${nameOf(ctx, id)} (${ruleScope(ctx.byId.get(id))})`));
    lines.push('', inline(`Business rules: ${list(rules, 'none')}`));
    return lines;
}

function formsSection(ctx: Ctx): string[] {
    const lines = ['## Forms', ''];
    const forms = [...ctx.map.forms].sort(byName);
    if (forms.length === 0) return [...lines, NONE];
    forms.forEach((form, i) => {
        if (i > 0) lines.push('');
        lines.push(...formBlock(form, ctx));
    });
    return lines;
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

function columnsSection(ctx: Ctx): string[] {
    const all = Object.values(ctx.map.columns).sort((a, b) => a.logicalName.localeCompare(b.logicalName));
    const shown = ctx.opts.fullColumnList ? all : all.filter(hasLogic);
    const lines = ['## Columns', ''];
    lines.push(ctx.opts.fullColumnList ? `All ${plural(all.length, 'column')}.` : `${shown.length} of ${plural(all.length, 'column')} with logic (triggers, touched by, required, secured, audited or computed).`, '');
    if (shown.length === 0) return [...lines, NONE];
    lines.push(...table(['Column', 'Display name', 'Type', 'Flags', 'Source', 'Triggers', 'Touched by'], shown.map((c) => columnRow(c, ctx))));
    return lines;
}

// ---------------------------------------------------------------------------
// Data rules
// ---------------------------------------------------------------------------

function keysBlock(ctx: Ctx): string[] {
    const keys = firstPerGroup(ctx.map.items, 'key');
    if (keys.length === 0) return [NONE];
    return keys.map((k) => inline(`- ${k.name} (${str(k.details.status) ?? (k.enabled ? 'Active' : 'Inactive')}): ${list(stringArray(k.details.attributes).length > 0 ? stringArray(k.details.attributes) : k.touchesColumns)}`));
}

function conditionLine(c: Record<string, unknown>): string {
    const flags = [str(c.operator) ?? 'match', typeof c.param === 'number' ? `${c.param}` : undefined, c.ignoreBlank === true ? 'ignore blanks' : undefined].filter((s): s is string => s !== undefined);
    return `  - ${inline(`${str(c.base) ?? '?'} ↔ ${str(c.matching) ?? '?'} (${flags.join(', ')})`)}`;
}

function duplicateRulesBlock(ctx: Ctx): string[] {
    const rules = firstPerGroup(ctx.map.items, 'duplicaterule');
    if (rules.length === 0) return [NONE];
    const lines: string[] = [];
    for (const rule of rules) {
        const d = rule.details;
        const status = str(d.status) ?? (rule.enabled ? 'Published' : 'Unpublished');
        lines.push(inline(`- ${rule.name} (${status}) — ${str(d.baseTable) ?? ctx.map.table.logicalName} ↔ ${str(d.matchingTable) ?? '?'}`));
        const conditions = recordArray(d.conditions);
        if (conditions.length === 0) lines.push('  - no conditions');
        for (const c of conditions) lines.push(conditionLine(c));
    }
    return lines;
}

/** `this table → child (via lookup)` with one nested line per action, plus inbound cascades from parents. */
function cascadesBlock(ctx: Ctx): string[] {
    const table = ctx.map.table.logicalName;
    const cascades = ctx.map.items.filter((i) => i.kind === 'cascade' && !isSynonym(i));
    if (cascades.length === 0) return [NONE];
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
    const lines: string[] = [];
    for (const key of [...outbound.keys()].sort((a, b) => a.localeCompare(b))) {
        const group = outbound.get(key)!;
        const [child, via] = key.split('|');
        lines.push(inline(`- ${table} → ${child}${via ? ` (via ${via})` : ''}`));
        const actions = group
            .map((i) => inline(`${str(i.details.action) ?? i.event}: ${str(i.details.behaviour) ?? 'Cascade'}${i.details.chainDepth !== undefined ? ` (chain depth ${String(i.details.chainDepth)})` : ''}`))
            .sort((a, b) => a.localeCompare(b));
        for (const a of unique(actions)) lines.push(`  - ${a}`);
    }
    for (const item of inbound.sort(byName)) {
        const parent = str(item.details.parent) ?? '?';
        const via = str(item.details.via);
        lines.push(inline(`- ${parent} → ${table}${via ? ` (via ${via})` : ''}`), `  - ${inline(`${str(item.details.action) ?? item.event}: ${str(item.details.behaviour) ?? 'Cascade'} (${item.name})`)}`);
    }
    return lines;
}

function fieldSecurityBlock(ctx: Ctx): string[] {
    const profiles = firstPerGroup(ctx.map.items, 'fieldsecurity');
    if (profiles.length === 0) return [NONE];
    return profiles.map((p) => {
        const permissions = recordArray(p.details.permissions);
        const columns = permissions.length > 0 ? permissions.map((perm) => `${str(perm.attribute) ?? '?'} (read ${str(perm.canRead) ?? '?'}, create ${str(perm.canCreate) ?? '?'}, update ${str(perm.canUpdate) ?? '?'})`) : (p.touchesColumns ?? []);
        return inline(`- ${p.name}: ${list(unique(columns))}`);
    });
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
    const lines = [inline(`- Auditing: ${effective ? 'effective' : 'not effective'} (organization ${onOff(orgOn)}, table ${onOff(tableOn)})${str(item?.details.note) ? ` — ${str(item?.details.note)}` : ''}`)];
    lines.push(`- Audited columns: ${list(audited, 'none')}`);
    return lines;
}

function requiredColumnsBlock(ctx: Ctx): string[] {
    const required = Object.values(ctx.map.columns)
        .filter((c) => c.required)
        .sort((a, b) => a.logicalName.localeCompare(b.logicalName))
        .map((c) => inline(`${c.logicalName} (${c.displayName})`));
    return [`- ${list(required, 'none')}`];
}

function dataRulesSection(ctx: Ctx): string[] {
    return [
        '## Data rules',
        '',
        '### Keys',
        '',
        ...keysBlock(ctx),
        '',
        '### Duplicate rules',
        '',
        ...duplicateRulesBlock(ctx),
        '',
        '### Cascades',
        '',
        ...cascadesBlock(ctx),
        '',
        '### Field security profiles',
        '',
        ...fieldSecurityBlock(ctx),
        '',
        '### Audit',
        '',
        ...auditBlock(ctx),
        '',
        '### Required columns',
        '',
        ...requiredColumnsBlock(ctx),
    ];
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

function toucherLine(item: LogicItem): string {
    const ops = recordArray(item.details.actionsOnTable).map((a) => `${str(a.operationId) ?? str(a.name) ?? '?'}${str(a.path) ? ` (${str(a.path)})` : ''}`);
    const parts = [KIND_LABEL[item.kind], item.enabled ? 'enabled' : 'disabled', str(item.details.trigger) ? `trigger: ${str(item.details.trigger)}` : undefined, ops.length > 0 ? `operations: ${ops.join(', ')}` : undefined, item.touchesColumns && item.touchesColumns.length > 0 ? `touches: ${item.touchesColumns.join(', ')}` : undefined];
    return inline(`- ${item.name} — ${parts.filter((p): p is string => p !== undefined).join(SEP)}`);
}

function touchedBySection(ctx: Ctx): string[] {
    const lines = ['## Touched by', '', `Flows and actions that read or write ${ctx.map.table.logicalName} without being triggered by it.`, ''];
    const touchers = [...ctx.map.externalTouchers].sort(byName);
    for (const access of ['write', 'read'] as const) {
        const group = touchers.filter((t) => accessOf(t) === access);
        lines.push(`### ${access === 'write' ? 'Write' : 'Read'}`, '');
        lines.push(...(group.length === 0 ? [NONE] : group.map(toucherLine)));
        if (access === 'write') lines.push('');
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Apps, dependencies, source errors, diagrams
// ---------------------------------------------------------------------------

function appsSection(map: LogicMap): string[] {
    const lines = ['## Apps', ''];
    const apps = [...map.apps].sort(byName);
    if (apps.length === 0) return [...lines, NONE];
    return [...lines, ...table(['App', 'Unique name', 'State', 'Managed'], apps.map((a) => [a.name, a.uniqueName, a.state, yesNo(a.isManaged)]))];
}

function dependencyType(d: DependencyInfo): string {
    return d.componentTypeName ? `${d.componentTypeName} (${d.componentType})` : String(d.componentType);
}

function dependenciesSection(map: LogicMap): string[] {
    const lines = ['## Other dependencies', '', 'Components that depend on the table and are not represented above (views, charts, dashboards, ...).', ''];
    const other = map.dependencies.filter((d) => !d.classified).sort((a, b) => a.componentType - b.componentType || (a.name ?? '').localeCompare(b.name ?? '') || a.objectId.localeCompare(b.objectId));
    if (other.length === 0) return [...lines, NONE];
    return [...lines, ...table(['Component type', 'Name', 'Object id'], other.map((d) => [dependencyType(d), d.name ?? EMPTY, d.objectId]))];
}

function sourceErrorsSection(map: LogicMap): string[] {
    const lines = ['## Source errors', ''];
    if (map.sourceErrors.length === 0) return [...lines, NONE];
    const errors = [...map.sourceErrors].sort((a, b) => a.source.localeCompare(b.source) || a.message.localeCompare(b.message));
    return [...lines, ...errors.map((e) => inline(`- **${e.source}** (${e.kind}): ${e.message}${e.kind === 'permission' ? ' — this map is missing what that source would have found' : ''}`))];
}

function diagramsSection(map: LogicMap): string[] {
    const lines = ['## Diagrams', ''];
    const events = Object.keys(map.pipeline);
    if (events.length === 0) return [...lines, NONE];
    events.forEach((event, i) => {
        if (i > 0) lines.push('');
        lines.push(`### ${inline(event)}`, '', '```mermaid', toMermaid(map, event as EventName), '```');
    });
    return lines;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Full Markdown document for a LogicMap. Never writes `raw`, flow clientdata or secure configuration. */
export function toMarkdown(map: LogicMap, opts: MarkdownOptions = {}): string {
    const ctx = buildCtx(map, opts);
    const blocks: string[][] = [
        [title(map), '', environmentLine(map), '', factsLine(map), '', countsLine(map)],
        smellsSection(map),
        pipelineSection(ctx),
        formsSection(ctx),
        columnsSection(ctx),
        dataRulesSection(ctx),
        touchedBySection(ctx),
        appsSection(map),
        dependenciesSection(map),
        sourceErrorsSection(map),
    ];
    if (opts.includeDiagrams) blocks.push(diagramsSection(map));
    // Attribution last, after a rule, so it reads as a footer wherever the file is pasted.
    blocks.push(['---', '', `Generated by [Table Logic Map](${VERSEBLOCKS_URL}) — VerseBlocks`]);
    return `${blocks.map((b) => b.join('\n')).join('\n\n')}\n`;
}

/**
 * Self-contained bullet for one item (detail pane "Copy as markdown"): the name, then indented
 * key/value lines with the well-known fields followed by every `details` entry (keys sorted;
 * arrays as comma lists, nested objects as one-line JSON). The unsecure configuration is
 * always replaced by a placeholder; secure configuration is never present on the item.
 */
export function itemToMarkdown(item: LogicItem, map: LogicMap): string {
    const ctx = buildCtx(map, {});
    const lines = [inline(`- **${item.name}** (${KIND_LABEL[item.kind]})`)];
    const push = (label: string, value: string | undefined) => {
        if (value !== undefined) lines.push(`  - ${inline(`${label}: ${value}`)}`);
    };
    push('Table', `${map.table.displayName} (${map.table.logicalName})`);
    push('Event', item.event);
    push('Stage', STAGE_LABEL[item.stage]);
    push('Mode', item.mode ? MODE_LABEL[item.mode] : undefined);
    push('Rank', item.order !== undefined ? String(item.order) : undefined);
    push('Enabled', yesNo(item.enabled));
    push('Filtering attributes', item.filteringAttributes !== undefined ? list(item.filteringAttributes, item.event === 'Update' ? 'any column' : EMPTY) : undefined);
    push('Touches columns', item.touchesColumns !== undefined && item.touchesColumns.length > 0 ? item.touchesColumns.join(', ') : undefined);
    push('Confidence', item.confidence);
    push('Source', `${item.source.table}${item.source.id ? ` ${item.source.id}` : ''}`);
    push('Group', item.groupId);
    push('Link', item.links?.maker ?? item.links?.record);
    push('Smells', item.smells && item.smells.length > 0 ? unique(item.smells.map((id) => ctx.smellById.get(id)?.message ?? id)).join('; ') : undefined);
    for (const key of Object.keys(item.details).sort((a, b) => a.localeCompare(b))) {
        if (key === 'unsecureConfig') {
            push(key, CONFIG_OMITTED);
            continue;
        }
        push(key, formatValue(item.details[key]));
    }
    return lines.join('\n');
}

/**
 * Inline-SVG pipeline diagram for the HTML export.
 *
 * Draws the same content the Mermaid export describes — one event's execution pipeline, stage by
 * stage in `STAGE_ORDER` — but as a finished picture. The HTML report is the client-ready
 * deliverable: it has to render with no network, open in Word and print to PDF, so it cannot rely
 * on a Mermaid runtime, an external stylesheet or a web font. Everything here is geometry plus SVG
 * presentation attributes; there is no `<style>` block and no class attribute inside the figure, so
 * the host document's CSS cannot restyle the drawing and nothing in the drawing leaks out. (The one
 * rule the report does apply from outside is `figure.diagram svg { max-width: 100%; height: auto }`,
 * which only scales the whole picture down when the page — a printed A4/Letter column is about
 * 675px — is narrower than the figure. Nothing inside is restyled or reflowed.)
 *
 * Layout — stages are stacked as full-width bands, not side-by-side columns. Dataverse names are
 * long (`Contoso.Plugins.ProjectNumbering: Create of contoso_project` is 59 characters, and 80 is
 * ordinary), and a column layout can only ever offer a fifth of the canvas to each label, so
 * essentially every name was cut exactly where the identifying part lives. A band gives one item
 * roughly the whole canvas width — about 105 characters at the default 820px — while execution
 * order still reads unambiguously as top-to-bottom, and the figure grows down a printed page
 * instead of demanding a canvas wider than the paper. This is a document, not a dashboard.
 *
 * One item row is `[mode marker][#rank][name ................][mode · kind]`:
 *  - the mode marker is a colour bar in a fixed 10px gutter, so the colour never eats the name;
 *  - the rank sits in its own fixed-width gutter, so a two-digit rank cannot shift the names out
 *    of alignment (and rows without a rank still line up with the ones that have one);
 *  - the kind and the mode are written out, right-aligned and muted, at the far end of the row.
 *    The mode is the fact a reader needs first — it decides whether the logic can block or roll
 *    back the caller's transaction — so it is encoded twice: as the marker colour (fast to scan)
 *    and as a word (survives a black-and-white printer and a photocopier, where seven fills are
 *    only distinguishable in theory).
 *  - the name gets everything left over, which is the whole point of the layout.
 *
 * Dataverse semantics that shape the picture:
 *  - Stages run in a fixed order, so the bands are chained by arrows in `STAGE_ORDER`.
 *  - `always` (alternate keys, cascades, autonumber, formula/rollup columns) is not stage-bound:
 *    exactly like `toMermaid`, it is drawn as its own band but kept out of the arrow chain,
 *    because nothing "flows" into it at a point in time.
 *  - `order` is the plugin step rank (only plugin / custom-API steps have one); it is shown as
 *    `#n` because two steps sharing a rank have no guaranteed relative order.
 *
 * Safety: record names (`sdkmessageprocessingstep.name`, `workflow.name`, ...) are free text in
 * Dataverse and may contain markup, quotes, ampersands and line breaks. Every interpolated value
 * goes through `clean()` (flatten + drop control characters) and `xmlEscape()`. No
 * Dataverse-derived string is ever written into an attribute value: names reach the output only as
 * escaped text or as the text of a `<title>` child, so a crafted name cannot break out of either.
 *
 * Determinism: node ids are positional (`n1`, `n2`, ...), every coordinate is an integer derived
 * from the content, and nothing consults the clock or a random source — the same map always
 * produces a byte-identical string. Those ids are unique inside one `<svg>`; a document that embeds
 * one figure per event passes `idPrefix` so the ids stay unique across the whole page too.
 */
import type { EventName, ExecutionMode, LogicItem, LogicKind, LogicMap, Stage } from '../domain/model';
import { STAGE_LABEL, STAGE_ORDER } from '../domain/model';
import { inline } from './text';

export interface PipelineSvgOptions {
    /** Items drawn per stage before a "+N more" node replaces the rest. Default 12. */
    maxItemsPerStage?: number;
    /** Target width in CSS pixels; the stage bands (and therefore the room for a name) scale with it. Default 820. */
    width?: number;
    /**
     * Prefix for the positional item-node ids, so a document embedding one figure per event still
     * has unique `id` attributes. Anything outside `[A-Za-z0-9_-]` is dropped (the caller's slug may
     * come from an event name such as `Custom:<message>`). Default `''` → `n1`, `n2`, …
     */
    idPrefix?: string;
}

// Geometry (all integers, so the serialized numbers never depend on floating point formatting).
const DEFAULT_WIDTH = 820;
const MIN_WIDTH = 260;
const DEFAULT_MAX_ITEMS = 12;
const PAD = 14; // outer padding of the canvas
const BAND_GAP = 26; // vertical gap between stage bands (holds the arrow)
const HEAD_H = 22; // stage header band
const BOX_PAD = 8; // stage band inner padding
const ROW_H = 22; // item row height
const ROW_GAP = 4; // gap between item rows inside a band
const ROW_PAD = 7; // text inset at the ends of a row
const MARK_W = 10; // execution-mode colour bar at the left of a row
const MARK_GAP = 6; // gap between the mode marker and the rank gutter
const RANK_W = 24; // fixed gutter holding "#12"
const NAME_GAP = 8; // gap between the rank gutter and the name
const TAIL_GAP = 10; // minimum gap between the name and the right-aligned kind/mode tail
const LEGEND_TOP = 18;
const LEGEND_ENTRY_W = 116;
const LEGEND_ROW_H = 18;
const SWATCH = 12;

const HEAD_FONT = 11;
const NODE_FONT = 11;
const TAIL_FONT = 10;
const LEGEND_FONT = 10;
/**
 * Approximate advance width of one character as a fraction of the font size. SVG cannot wrap text,
 * so this is deliberately generous: labels get truncated slightly early rather than overflowing.
 */
const CHAR_RATIO = 0.55;

const FONT = 'Segoe UI, Segoe UI Web, Arial, Helvetica, sans-serif';
const INK = '#1b1b1b';
const BOX_STROKE = '#8d97a1';
const HEAD_FILL = '#eceff3';
const NODE_STROKE = '#4a5560';
const ROW_FILL = '#ffffff';
const ARROW = '#6b7480';
const MUTED = '#5c636b';

/**
 * Marker fills chosen so the modes stay apart in greyscale (their luminance ladder runs roughly
 * 244 / 231 / 220 / 210 / 200 / 191 / 169 / 143), not only by hue: the report is expected to be
 * printed, sometimes in black and white. The row itself stays white, so a page of these reads as a
 * document rather than a block of colour.
 */
const MODE_FILL: Record<ExecutionMode, string> = {
    client: '#f2f4f7',
    rule: '#f4e8c2',
    sync: '#bed6ef',
    instant: '#d5bce6',
    async: '#edb482',
    realtime: '#79b8d8',
    background: '#60a985',
};
/** Items whose mode a source could not determine. */
const UNKNOWN_FILL = '#dcdcdc';

const MODE_LABEL: Record<ExecutionMode, string> = {
    sync: 'sync',
    async: 'async',
    realtime: 'real-time',
    background: 'background',
    client: 'client',
    instant: 'instant',
    rule: 'rule',
};

/** Legend order: most local first, then the ones that hold or follow the transaction. */
const MODE_ORDER: readonly ExecutionMode[] = ['client', 'rule', 'sync', 'instant', 'async', 'realtime', 'background'];

/** Short kind labels; the pipeline tables in the document carry the long ones. */
const KIND_SHORT: Record<LogicKind, string> = {
    plugin: 'plugin',
    customapi: 'custom API',
    workflow: 'workflow',
    action: 'action',
    flow: 'flow',
    businessrule: 'business rule',
    formscript: 'script',
    pcf: 'PCF',
    formcomponent: 'component',
    bpf: 'BPF',
    duplicaterule: 'duplicate rule',
    cascade: 'cascade',
    key: 'key',
    requiredcolumn: 'required',
    formula: 'formula',
    rollup: 'rollup',
    calculated: 'calculated',
    autonumber: 'autonumber',
    fieldsecurity: 'field security',
    audit: 'audit',
    app: 'app',
};

// ---------------------------------------------------------------------------
// Text safety
// ---------------------------------------------------------------------------

/** Escape the five XML entities. Applied to every interpolated value, text or attribute. */
export function xmlEscape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Flatten a Dataverse value onto one line and drop control characters: XML 1.0 forbids most of
 * them outright, so a single stray one in a record name would make the whole document unparseable.
 */
function clean(value: string): string {
    return inline(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '));
}

/** Truncate to `maxChars` with a real ellipsis, counting code points so surrogate pairs survive. */
function truncate(value: string, maxChars: number): string {
    const chars = [...value];
    if (chars.length <= maxChars) return value;
    return `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
}

/** How many characters of `fontSize` text fit in `pxWidth`. */
function charsFor(pxWidth: number, fontSize: number): number {
    return Math.max(4, Math.floor(pxWidth / (fontSize * CHAR_RATIO)));
}

/** Room (in px) the right-aligned tail needs. Estimated the same generous way as `charsFor`. */
function widthOf(value: string, fontSize: number): number {
    return Math.ceil([...value].length * fontSize * CHAR_RATIO);
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

function text(x: number, y: number, value: string, fontSize: number, fill: string, bold = false, anchorEnd = false): string {
    const weight = bold ? ' font-weight="600"' : '';
    const anchor = anchorEnd ? ' text-anchor="end"' : '';
    return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${fontSize}" fill="${fill}"${weight}${anchor}>${xmlEscape(value)}</text>`;
}

/** Arrow head pointing down, ending at `y`. The head is a path, so the SVG needs no `<defs>` marker ids. */
function arrowHeadDown(x: number, y: number): string {
    return `<path d="M ${x} ${y} L ${x - 4} ${y - 6} L ${x + 4} ${y - 6} Z" fill="${ARROW}"/>`;
}

/** Fixed-width geometry of an item row, derived once per diagram from the band width. */
interface RowGeometry {
    /** Left edge of the row rectangle. */
    x: number;
    /** Full row width. */
    w: number;
    /** Right edge of the rank gutter (the `#n` text is right-aligned here). */
    rankRight: number;
    /** Left edge of the name. */
    nameX: number;
    /** Right edge of the row's text area (the tail is right-aligned here). */
    tailRight: number;
}

function rowGeometry(x: number, w: number): RowGeometry {
    const rankRight = x + 1 + MARK_W + MARK_GAP + RANK_W;
    return { x, w, rankRight, nameX: rankRight + NAME_GAP, tailRight: x + w - ROW_PAD };
}

/**
 * The muted right-aligned tail: what the item is and how it runs, plus `off` for a disabled one.
 * Kept out of the name's space on purpose — it is the same handful of short words on every row, so
 * the eye skips it, while the name (the only part that identifies the record) stays left-aligned.
 */
function tailLabel(item: LogicItem): string {
    const parts: string[] = [];
    // Disabled logic still exists in the solution but never runs; say so before anything else.
    if (!item.enabled) parts.push('off');
    if (item.mode) parts.push(MODE_LABEL[item.mode]);
    parts.push(KIND_SHORT[item.kind]);
    return parts.join(' · ');
}

/** Text for the `<title>` child, so hovering in a browser reveals the untruncated name. */
function nodeTitle(item: LogicItem): string {
    const facts = [KIND_SHORT[item.kind]];
    if (item.order !== undefined) facts.push(`rank ${item.order}`);
    if (item.mode) facts.push(MODE_LABEL[item.mode]);
    if (!item.enabled) facts.push('disabled');
    if (item.confidence === 'heuristic') facts.push('inferred');
    return `${clean(item.name)} — ${facts.join(' · ')}`;
}

/**
 * One item row. The name is always the LAST `<text>` in the group (the tail is drawn before it even
 * though it sits further right): that invariant is what lets a reader — and the tests — pick the
 * name out of a group without needing a class or data attribute on the text.
 */
function itemRow(item: LogicItem, id: string, g: RowGeometry, y: number): string {
    const fill = item.mode ? MODE_FILL[item.mode] : UNKNOWN_FILL;
    // Dashed = disabled, dotted = inferred (heuristic parse), solid = exact.
    const pattern = !item.enabled ? '5 3' : item.confidence === 'heuristic' ? '1 2' : '';
    const dash = pattern ? ` stroke-dasharray="${pattern}"` : '';
    const opacity = item.enabled ? '1' : '0.4';
    const ink = item.enabled ? INK : MUTED;
    const baseline = y + 15;

    const tail = tailLabel(item);
    const tailW = widthOf(tail, TAIL_FONT);
    // Everything the gutters and the tail do not use belongs to the name.
    const nameChars = charsFor(g.tailRight - tailW - TAIL_GAP - g.nameX, NODE_FONT);
    // `≈` marks a heuristic parse, and it belongs next to the thing that was inferred.
    const prefix = item.confidence === 'heuristic' ? '≈ ' : '';
    const name = `${prefix}${truncate(clean(item.name), Math.max(6, nameChars - prefix.length))}`;

    const out = [
        `<g id="${id}">`,
        `<title>${xmlEscape(nodeTitle(item))}</title>`,
        `<rect x="${g.x}" y="${y}" width="${g.w}" height="${ROW_H}" rx="3" fill="${ROW_FILL}" stroke="${NODE_STROKE}" stroke-width="1"${dash}/>`,
        `<rect x="${g.x + 1}" y="${y + 1}" width="${MARK_W}" height="${ROW_H - 2}" fill="${fill}" fill-opacity="${opacity}"/>`,
    ];
    if (item.order !== undefined) out.push(text(g.rankRight, baseline, `#${item.order}`, TAIL_FONT, MUTED, false, true));
    out.push(text(g.tailRight, baseline, tail, TAIL_FONT, MUTED, false, true));
    out.push(text(g.nameX, baseline, name, NODE_FONT, ink));
    out.push('</g>');
    return out.join('');
}

function moreRow(hidden: number, id: string, g: RowGeometry, y: number): string {
    return (
        `<g id="${id}">` +
        `<title>${xmlEscape(`${hidden} more items are not drawn; the pipeline tables list every item.`)}</title>` +
        `<rect x="${g.x}" y="${y}" width="${g.w}" height="${ROW_H}" rx="3" fill="${ROW_FILL}" stroke="${BOX_STROKE}" stroke-width="1" stroke-dasharray="3 3"/>` +
        text(g.nameX, y + 15, `+${hidden} more`, NODE_FONT, MUTED) +
        `</g>`
    );
}

interface LegendEntry {
    label: string;
    fill: string;
    fillOpacity: string;
    dash: string;
}

/** Legend built from what is actually drawn, so it never explains a colour the reader cannot see. */
function legendEntries(drawn: LogicItem[]): LegendEntry[] {
    const entries: LegendEntry[] = [];
    for (const mode of MODE_ORDER) {
        if (drawn.some((item) => item.mode === mode)) entries.push({ label: MODE_LABEL[mode], fill: MODE_FILL[mode], fillOpacity: '1', dash: '' });
    }
    if (drawn.some((item) => !item.mode)) entries.push({ label: 'unknown', fill: UNKNOWN_FILL, fillOpacity: '1', dash: '' });
    if (drawn.some((item) => !item.enabled)) entries.push({ label: 'off = disabled', fill: '#ffffff', fillOpacity: '0.4', dash: '5 3' });
    if (drawn.some((item) => item.confidence === 'heuristic')) entries.push({ label: '≈ inferred', fill: '#ffffff', fillOpacity: '1', dash: '1 2' });
    return entries;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render one event's pipeline as a self-contained `<svg>` element, or `''` when the event has no
 * items (the caller then skips the figure entirely).
 *
 * Stages are stacked top to bottom as full-width bands, chained by a downward arrow in execution
 * order; `always` is drawn as a band of its own but never joined to the chain.
 */
export function pipelineSvg(map: LogicMap, event: EventName, opts: PipelineSvgOptions = {}): string {
    const row = map.pipeline[event];
    if (!row) return '';
    const stages: Stage[] = STAGE_ORDER.filter((stage) => (row[stage]?.length ?? 0) > 0);
    if (stages.length === 0) return '';

    const maxItems = Math.max(1, Math.floor(opts.maxItemsPerStage ?? DEFAULT_MAX_ITEMS));
    const width = Math.max(MIN_WIDTH, Math.floor(opts.width ?? DEFAULT_WIDTH));
    // Sanitized here rather than trusted: the caller's slug is derived from an event name.
    const idPrefix = (opts.idPrefix ?? '').replace(/[^A-Za-z0-9_-]/g, '');

    const shown = new Map<Stage, LogicItem[]>();
    const hidden = new Map<Stage, number>();
    const drawn: LogicItem[] = [];
    let total = 0;
    for (const stage of stages) {
        const items = row[stage];
        const visible = items.slice(0, maxItems);
        shown.set(stage, visible);
        hidden.set(stage, items.length - visible.length);
        drawn.push(...visible);
        total += items.length;
    }
    const rowCount = (stage: Stage): number => (shown.get(stage)?.length ?? 0) + ((hidden.get(stage) ?? 0) > 0 ? 1 : 0);
    const bandHeight = (stage: Stage): number => {
        const n = rowCount(stage);
        return HEAD_H + BOX_PAD + n * ROW_H + (n - 1) * ROW_GAP + BOX_PAD;
    };

    const bandW = width - 2 * PAD;
    const geom = rowGeometry(PAD + BOX_PAD, bandW - 2 * BOX_PAD);

    const bandTops: number[] = [];
    let cursor = PAD;
    for (const stage of stages) {
        bandTops.push(cursor);
        cursor += bandHeight(stage) + BAND_GAP;
    }
    const diagramBottom = bandTops[stages.length - 1] + bandHeight(stages[stages.length - 1]);

    const legend = legendEntries(drawn);
    const legendCols = Math.max(1, Math.min(legend.length, Math.floor(bandW / LEGEND_ENTRY_W)));
    const legendRows = Math.ceil(legend.length / legendCols);
    const legendTop = diagramBottom + LEGEND_TOP;
    const svgW = width;
    const svgH = legendTop + legendRows * LEGEND_ROW_H + PAD;

    const out: string[] = [];

    const title = `Execution pipeline for ${clean(event)} on ${clean(map.table.displayName)} (${clean(map.table.logicalName)})`;
    const desc =
        `${total} items in ${stages.length} stages, in execution order: ` +
        `${stages.map((stage) => `${STAGE_LABEL[stage]} ${row[stage].length}`).join(', ')}. ` +
        'Alternate keys, cascades and computed columns are grouped under the "Always" stage and are not part of the ordered chain.';

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" role="img">`);
    out.push(`<title>${xmlEscape(title)}</title>`);
    out.push(`<desc>${xmlEscape(desc)}</desc>`);
    // Opaque background: the figure is printed and pasted into Word, where a transparent one
    // would pick up whatever is behind it.
    out.push(`<rect x="0" y="0" width="${svgW}" height="${svgH}" fill="#ffffff"/>`);

    let nodeId = 0;
    stages.forEach((stage, index) => {
        const top = bandTops[index];
        const h = bandHeight(stage);
        out.push(`<g data-stage="${stage}">`);
        out.push(`<rect x="${PAD}" y="${top}" width="${bandW}" height="${h}" fill="#ffffff" stroke="${BOX_STROKE}" stroke-width="1"/>`);
        out.push(`<rect x="${PAD + 1}" y="${top + 1}" width="${bandW - 2}" height="${HEAD_H - 1}" fill="${HEAD_FILL}"/>`);
        out.push(`<line x1="${PAD}" y1="${top + HEAD_H}" x2="${PAD + bandW}" y2="${top + HEAD_H}" stroke="${BOX_STROKE}" stroke-width="1"/>`);
        const head = truncate(`${STAGE_LABEL[stage]} (${row[stage].length})`, charsFor(bandW - 2 * BOX_PAD, HEAD_FONT));
        out.push(text(PAD + BOX_PAD, top + 15, head, HEAD_FONT, INK, true));
        let y = top + HEAD_H + BOX_PAD;
        for (const item of shown.get(stage) ?? []) {
            nodeId += 1;
            out.push(itemRow(item, `${idPrefix}n${nodeId}`, geom, y));
            y += ROW_H + ROW_GAP;
        }
        const rest = hidden.get(stage) ?? 0;
        if (rest > 0) {
            nodeId += 1;
            out.push(moreRow(rest, `${idPrefix}n${nodeId}`, geom, y));
        }
        out.push('</g>');
    });

    // Connectors between consecutive stages, in execution order. `always` is never connected:
    // data rules are not bound to a point in the pipeline (same rule as the Mermaid export).
    const cx = PAD + Math.floor(bandW / 2);
    for (let i = 0; i < stages.length - 1; i += 1) {
        if (stages[i] === 'always' || stages[i + 1] === 'always') continue;
        const y1 = bandTops[i] + bandHeight(stages[i]);
        const y2 = bandTops[i + 1];
        out.push(`<line x1="${cx}" y1="${y1 + 3}" x2="${cx}" y2="${y2 - 8}" stroke="${ARROW}" stroke-width="1.5"/>`);
        out.push(arrowHeadDown(cx, y2 - 2));
    }

    legend.forEach((entry, index) => {
        const lx = PAD + (index % legendCols) * LEGEND_ENTRY_W;
        const ly = legendTop + Math.floor(index / legendCols) * LEGEND_ROW_H;
        const dash = entry.dash ? ` stroke-dasharray="${entry.dash}"` : '';
        out.push(
            `<rect x="${lx}" y="${ly}" width="${SWATCH}" height="${SWATCH}" rx="2" fill="${entry.fill}" fill-opacity="${entry.fillOpacity}" stroke="${NODE_STROKE}" stroke-width="1"${dash}/>`,
        );
        out.push(text(lx + SWATCH + 6, ly + 10, truncate(entry.label, charsFor(LEGEND_ENTRY_W - SWATCH - 10, LEGEND_FONT)), LEGEND_FONT, MUTED));
    });

    out.push('</svg>');
    return out.join('');
}

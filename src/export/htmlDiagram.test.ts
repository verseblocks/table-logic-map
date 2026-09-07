import { describe, expect, it } from 'vitest';
import { STAGE_LABEL, STAGE_ORDER, emptyPipelineRow, type EventName, type LogicItem, type LogicMap } from '../domain/model';
import { HOSTILE_NAME, RAW_MARKER, UNSECURE_CONFIG, hostileItem, hostileMap, sampleMap } from '../fixtures/logicmap.sample';
import { attr, child, descendants, parseXml, type XmlEl } from '../xml/xml';
import { pipelineSvg } from './htmlDiagram';

/** Item nodes are the `<g id="nN">` groups; stage bands carry `data-stage`. */
function itemNodes(root: XmlEl): XmlEl[] {
    return descendants(root, 'g').filter((g) => /^n\d+$/.test(g.attrs.id ?? ''));
}

function stageGroups(root: XmlEl): XmlEl[] {
    return descendants(root, 'g').filter((g) => g.attrs['data-stage'] !== undefined);
}

function nodeTitle(node: XmlEl): string {
    return child(node, 'title')?.text ?? '';
}

/**
 * Text elements of one item row, in document order: `#rank` (only when the item has one), then the
 * muted kind/mode tail, then the name. The name is drawn last on purpose so a group's *last* text
 * is always the name — the row carries no class or data attribute to identify it by.
 */
function nodeTexts(node: XmlEl): string[] {
    return descendants(node, 'text').map((t) => t.text ?? '');
}

/** The name label (the last text in the group; for a "+N more" row, its only text). */
function nodeName(node: XmlEl): string {
    const texts = nodeTexts(node);
    return texts[texts.length - 1] ?? '';
}

/** The right-aligned `[off · ]mode · kind` tail. */
function nodeTail(node: XmlEl): string {
    const texts = nodeTexts(node);
    return texts.length > 1 ? texts[texts.length - 2] : '';
}

/** The `#n` rank, or `''` for an item without a rank (only plugin / custom-API steps have one). */
function nodeRank(node: XmlEl): string {
    const texts = nodeTexts(node);
    return texts.length > 2 ? texts[0] : '';
}

function findNode(root: XmlEl, startsWith: string): XmlEl {
    const found = itemNodes(root).find((n) => nodeTitle(n).startsWith(startsWith));
    expect(found, `no node titled ${startsWith}`).toBeDefined();
    return found as XmlEl;
}

function parse(svg: string): XmlEl {
    const root = parseXml(svg);
    expect(root, 'svg did not parse').not.toBeNull();
    return root as XmlEl;
}

/** Realistic Dataverse names: what a real org actually contains, 55–80 characters each. */
const REAL_NAMES = [
    'Contoso.Plugins.ProjectNumbering: Create of contoso_project',
    'Contoso.Integration.Plugins.ProjectFinanceSync: Update of contoso_project',
    'Notify the project manager when the approved budget changes',
    'Contoso.Plugins.Validation.PreValidateProjectCode: Create of project',
    'When a project is created or updated, sync the row to the finance system',
];

/** A map whose Create pipeline holds only long, realistic names, one per stage-relevant kind. */
function realisticMap(): LogicMap {
    const map = sampleMap();
    const items: LogicItem[] = REAL_NAMES.map((name, index) =>
        hostileItem({
            id: `real-${index}`,
            name,
            order: index === 0 ? 1 : undefined,
            kind: index >= 2 ? 'flow' : 'plugin',
            mode: index >= 2 ? 'async' : 'sync',
            enabled: index !== 3,
            confidence: index === 4 ? 'heuristic' : 'exact',
        }),
    );
    const row = emptyPipelineRow();
    row.preoperation = items.slice(0, 2);
    row.postcommit = items.slice(2);
    return { ...map, pipeline: { ...map.pipeline, Create: row } };
}

describe('pipelineSvg', () => {
    it('produces a well-formed svg with one full-width band per non-empty stage, stacked in execution order', () => {
        const map = sampleMap();
        const svg = pipelineSvg(map, 'Update');
        expect(svg.startsWith('<svg ')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        // Balanced tags (every element is either self-closing or explicitly closed).
        expect((svg.match(/<g[ >]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
        expect((svg.match(/<text[ >]/g) ?? []).length).toBe((svg.match(/<\/text>/g) ?? []).length);
        expect((svg.match(/<title>/g) ?? []).length).toBe((svg.match(/<\/title>/g) ?? []).length);
        // Self-contained: no script, no external reference, no styling outside the svg attributes.
        expect(svg).not.toContain('<script');
        expect(svg).not.toContain('<style');
        expect(svg).not.toContain('class=');
        expect(svg).not.toMatch(/href|url\(|<image|<use/);

        const root = parse(svg);
        expect(root.name).toBe('svg');
        expect(root.attrs.xmlns).toBe('http://www.w3.org/2000/svg');
        expect(root.attrs.role).toBe('img');
        expect(root.attrs.viewBox).toBe(`0 0 ${root.attrs.width} ${root.attrs.height}`);
        // Accessible name/description for screen readers and for Word's alt text.
        expect(child(root, 'title')?.text).toContain('Execution pipeline for Update on Project');
        expect(child(root, 'desc')?.text).toContain('6 items in 4 stages');

        // Update on the sample table: pre-operation (duplicate rule), post-operation (sync plugin +
        // real-time workflow), after commit (async plugin + flow), always (alternate key).
        const row = map.pipeline.Update;
        const nonEmpty = STAGE_ORDER.filter((s) => row[s].length > 0);
        expect(nonEmpty).toEqual(['preoperation', 'postoperation', 'postcommit', 'always']);
        const bands = stageGroups(root);
        expect(bands.map((g) => g.attrs['data-stage'])).toEqual(nonEmpty);
        expect(itemNodes(root)).toHaveLength(6);
        expect(itemNodes(root).map((n) => n.attrs.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);

        // Bands are full-width and stacked: same x and width, strictly increasing y, and the whole
        // figure is no wider than the requested canvas (it flows down a page, not across one).
        const frames = bands.map((g) => descendants(g, 'rect')[0]);
        const width = Number(root.attrs.width);
        expect(width).toBe(820);
        for (const frame of frames) {
            expect(Number(attr(frame, 'x'))).toBe(14);
            expect(Number(attr(frame, 'width'))).toBe(width - 28);
        }
        const tops = frames.map((f) => Number(attr(f, 'y')));
        expect([...tops].sort((a, b) => a - b)).toEqual(tops);
        expect(new Set(tops).size).toBe(4);
        expect(Number(root.attrs.height)).toBeGreaterThan(tops[3]);

        // 1 background + 2 per band (frame + header) + 2 per item row (row + mode marker)
        // + 6 legend swatches.
        expect(descendants(root, 'rect')).toHaveLength(1 + 4 * 2 + 6 * 2 + 6);
        // 4 stage headers + per row (name + tail) + a rank for the two plugin steps + 6 legend labels.
        expect(descendants(root, 'text')).toHaveLength(4 + 6 * 2 + 2 + 6);
        // Every stage header names the stage and its item count, exactly once.
        for (const stage of nonEmpty) {
            const group = stageGroups(root).find((g) => g.attrs['data-stage'] === stage) as XmlEl;
            expect(descendants(group, 'text')[0].text).toBe(`${STAGE_LABEL[stage]} (${row[stage].length})`);
        }
    });

    it('chains the execution stages with downward arrows and leaves `always` out of the chain', () => {
        const root = parse(pipelineSvg(sampleMap(), 'Update'));
        // pre → post → after commit is two arrows; nothing points at `always`, which is drawn as a
        // band of its own but is not bound to a point in the pipeline.
        const heads = descendants(root, 'path').filter((p) => (attr(p, 'd') ?? '').startsWith('M '));
        expect(heads).toHaveLength(2);
        const shafts = descendants(root, 'line').filter((l) => attr(l, 'stroke-width') === '1.5');
        expect(shafts).toHaveLength(2);
        // Vertical, centred on the bands, and pointing down the page.
        for (const shaft of shafts) {
            expect(attr(shaft, 'x1')).toBe(attr(shaft, 'x2'));
            expect(attr(shaft, 'x1')).toBe('410');
            expect(Number(attr(shaft, 'y2'))).toBeGreaterThan(Number(attr(shaft, 'y1')));
        }
        // The old column layout wrapped rows with a polyline; there is nothing to wrap any more.
        expect(descendants(root, 'polyline')).toHaveLength(0);
    });

    it('scales the bands to a caller-supplied width and still stacks one band per stage', () => {
        const root = parse(pipelineSvg(sampleMap(), 'Update', { width: 500 }));
        expect(Number(root.attrs.width)).toBe(500);
        expect(stageGroups(root)).toHaveLength(4);
        for (const band of stageGroups(root)) expect(Number(attr(descendants(band, 'rect')[0], 'width'))).toBe(472);
        // Narrower canvas, same shape: still no wrapping, still one arrow per consecutive pair.
        expect(descendants(root, 'polyline')).toHaveLength(0);
        expect(descendants(root, 'line').filter((l) => attr(l, 'stroke-width') === '1.5')).toHaveLength(2);
        // A width below the floor is clamped rather than producing negative geometry.
        const tiny = parse(pipelineSvg(sampleMap(), 'Update', { width: 40 }));
        expect(Number(tiny.attrs.width)).toBe(260);
        for (const rect of descendants(tiny, 'rect')) expect(Number(attr(rect, 'width'))).toBeGreaterThan(0);
    });

    it('does not truncate realistic Dataverse names — the point of the band layout', () => {
        for (const name of REAL_NAMES) {
            expect(name.length, `${name} is not a realistic length`).toBeGreaterThanOrEqual(55);
            expect(name.length).toBeLessThanOrEqual(80);
        }
        const root = parse(pipelineSvg(realisticMap(), 'Create'));
        const nodes = itemNodes(root);
        expect(nodes).toHaveLength(REAL_NAMES.length);
        for (const node of nodes) {
            const name = nodeName(node);
            expect(name, `truncated: ${name}`).not.toContain('…');
            // The full record name is present, with only the heuristic marker allowed in front.
            expect(REAL_NAMES.some((n) => name === n || name === `≈ ${n}`), `unexpected label: ${name}`).toBe(true);
        }
        // The sample map is drawn in full too: nothing anywhere in it is cut.
        for (const event of Object.keys(sampleMap().pipeline)) {
            const svg = pipelineSvg(sampleMap(), event as EventName);
            if (svg === '') continue;
            for (const node of itemNodes(parse(svg))) expect(nodeName(node), `truncated in ${event}`).not.toContain('…');
        }
    });

    it('still truncates an absurd name, with an ellipsis and the whole name in the title', () => {
        const map = sampleMap();
        const absurd = `Contoso.Plugins.${'Very'.repeat(50)}Long: Create of contoso_project`;
        expect(absurd.length).toBeGreaterThan(200);
        map.pipeline.Create.preoperation = [hostileItem({ name: absurd })];
        const root = parse(pipelineSvg(map, 'Create'));
        const node = findNode(root, 'Contoso.Plugins.Very');
        const label = nodeName(node);
        expect(label.endsWith('…')).toBe(true);
        // Cut late: the whole canvas width is available, so ~100 characters survive.
        expect(label.length).toBeGreaterThan(90);
        expect(nodeTitle(node)).toContain(absurd);
    });

    it('puts the rank in a gutter and the kind/mode in a tail, so the name keeps the width', () => {
        const root = parse(pipelineSvg(sampleMap(), 'Create'));
        const numbering = findNode(root, 'Contoso.Plugins.ProjectNumbering');
        // The name is the whole name — no prefix eating into it.
        expect(nodeName(numbering)).toBe('Contoso.Plugins.ProjectNumbering: Create of contoso_project');
        expect(nodeRank(numbering)).toBe('#1');
        expect(nodeTail(numbering)).toBe('sync · plugin');
        // The rank is right-aligned in its fixed gutter, the tail right-aligned at the row's end.
        const texts = descendants(numbering, 'text');
        expect(attr(texts[0], 'text-anchor')).toBe('end');
        expect(attr(texts[1], 'text-anchor')).toBe('end');
        expect(attr(texts[2], 'text-anchor')).toBeUndefined();
        expect(Number(attr(texts[2], 'x'))).toBeGreaterThan(Number(attr(texts[0], 'x')));
        // The tooltip still carries the full name plus the facts, for hovering in a browser.
        expect(nodeTitle(numbering)).toBe('Contoso.Plugins.ProjectNumbering: Create of contoso_project — plugin · rank 1 · sync');

        // An item without a rank has no rank text at all, and its name starts at the same x.
        const rule = findNode(root, 'Project code — autonumber');
        expect(nodeRank(rule)).toBe('');
        expect(nodeTail(rule)).toBe('rule · autonumber');
        expect(attr(descendants(rule, 'text')[1], 'x')).toBe(attr(texts[2], 'x'));
        for (const node of itemNodes(root)) expect(nodeName(node)).not.toContain('\n');
    });

    it('distinguishes disabled and heuristic items from exact, enabled ones', () => {
        const root = parse(pipelineSvg(sampleMap(), 'Update'));
        const disabledNode = findNode(root, 'Contoso.Plugins.ProjectAuditTrail');
        const enabledNode = findNode(root, 'Contoso.Plugins.ProjectRollup');
        const heuristicNode = findNode(root, 'Validate budget');
        const rowRect = (node: XmlEl): XmlEl => descendants(node, 'rect')[0];
        const markRect = (node: XmlEl): XmlEl => descendants(node, 'rect')[1];

        // Disabled: dashed outline, faded mode marker, muted ink, and the tail says so.
        expect(attr(rowRect(disabledNode), 'stroke-dasharray')).toBe('5 3');
        expect(Number(attr(markRect(disabledNode), 'fill-opacity'))).toBeLessThan(1);
        expect(nodeTail(disabledNode)).toBe('off · async · plugin');
        expect(nodeRank(disabledNode)).toBe('#2');
        expect(nodeTitle(disabledNode)).toContain('disabled');

        // Exact + enabled: solid outline, full opacity.
        expect(attr(rowRect(enabledNode), 'stroke-dasharray')).toBeUndefined();
        expect(attr(markRect(enabledNode), 'fill-opacity')).toBe('1');

        // Heuristic (parsed from workflow XAML): dotted outline and a "≈" marker, not the dashes.
        expect(attr(rowRect(heuristicNode), 'stroke-dasharray')).toBe('1 2');
        expect(nodeName(heuristicNode)).toBe('≈ Validate budget');

        // Mode drives the marker colour, and the legend explains only what is drawn.
        expect(attr(markRect(enabledNode), 'fill')).not.toBe(attr(markRect(heuristicNode), 'fill'));
        const legend = descendants(root, 'text')
            .map((t) => t.text)
            .filter((t) => t === 'sync' || t === 'async' || t === 'real-time' || t === 'rule' || t === 'off = disabled' || t === '≈ inferred');
        // Each mode also appears in a row tail, so filter to the legend's own trailing run.
        expect(legend.slice(-6)).toEqual(['rule', 'sync', 'async', 'real-time', 'off = disabled', '≈ inferred']);
        expect(legend).not.toContain('client');
    });

    it('caps each stage and draws a "+N more" node for the rest', () => {
        const svg = pipelineSvg(sampleMap(), 'Update', { maxItemsPerStage: 1 });
        const root = parse(svg);
        const labels = itemNodes(root).map(nodeName);
        // Post-operation and after-commit each hold two items, so each keeps one and adds a marker.
        expect(labels.filter((l) => l === '+1 more')).toHaveLength(2);
        expect(itemNodes(root)).toHaveLength(6);
        // The header still reports the true count, so nothing looks lost.
        const postop = stageGroups(root).find((g) => g.attrs['data-stage'] === 'postoperation') as XmlEl;
        expect(descendants(postop, 'text')[0].text).toBe('Post-operation (sync) (2)');
        expect(child(findNode(root, '1 more items are not drawn'), 'rect')).toBeDefined();
        // A cap below 1 is meaningless; it is clamped rather than producing an empty band.
        expect(pipelineSvg(sampleMap(), 'Update', { maxItemsPerStage: 0 })).toBe(pipelineSvg(sampleMap(), 'Update', { maxItemsPerStage: 1 }));
    });

    it('returns an empty string for an event with no items', () => {
        const map = sampleMap();
        expect(pipelineSvg(map, 'Merge')).toBe('');
        expect(pipelineSvg(map, 'Custom:contoso_Approve')).toBe('');
        // A pipeline row that exists but is empty is still nothing to draw.
        const empty: LogicMap = { ...map, pipeline: { ...map.pipeline, Merge: emptyPipelineRow() } };
        expect(pipelineSvg(empty, 'Merge')).toBe('');
    });

    it('escapes hostile record names instead of emitting markup', () => {
        const map = sampleMap();
        // Dataverse names are free text: markup, quotes, ampersands and line breaks are all legal.
        const evil = hostileItem({ name: `<script>alert("x")</script> & 'it\`s' <img src=x onerror=alert(1)>` });
        map.items.push(evil);
        map.pipeline.Create.preoperation.push(evil);
        const svg = pipelineSvg(map, 'Create');

        expect(svg).not.toContain('<script');
        expect(svg).not.toContain('</script>');
        // "onerror" survives as escaped text, which is inert; what must never exist is a real tag
        // carrying an event handler (or any attribute the name managed to introduce).
        expect(svg).not.toMatch(/<[a-zA-Z][^>]*\son[a-z]+=/);
        expect(svg).toContain('&lt;script&gt;');
        expect(svg).toContain('&quot;');
        expect(svg).toContain('&amp;');
        expect(svg).toContain('&apos;');
        // Every `<` in the output opens a real tag; nothing else may introduce one.
        expect(svg).not.toMatch(/<(?![a-zA-Z/])/);
        // ... and the value cannot terminate an attribute either: it never reaches one, and the
        // document still parses with the node present.
        const root = parse(svg);
        expect(root.name).toBe('svg');
        expect(itemNodes(root)).toHaveLength(7);
        const node = findNode(root, '<script>');
        expect(nodeTitle(node)).toBe(`<script>alert("x")</script> & 'it\`s' <img src=x onerror=alert(1)> — plugin · rank 9 · sync`);
        for (const rect of descendants(root, 'rect')) expect(attr(rect, 'fill')).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('flattens a name that tries to forge structure, and never leaks configuration or raw data', () => {
        const svg = pipelineSvg(hostileMap(), 'Create');
        const root = parse(svg);
        expect(itemNodes(root)).toHaveLength(7);
        const node = findNode(root, 'Evil');
        // Line breaks and tabs are collapsed, so the label stays on one line inside its row.
        expect(nodeName(node)).not.toMatch(/[\r\n\t]/);
        expect(nodeTitle(node)).toBe(`${HOSTILE_NAME.replace(/\s+/g, ' ')} — plugin · rank 9 · sync`);
        expect(nodeTitle(node)).not.toContain('\n');
        // The diagram draws names and modes only: no details, no raw payload.
        expect(svg).not.toContain(UNSECURE_CONFIG);
        expect(svg).not.toContain(RAW_MARKER);
    });

    it('prefixes node ids on request, dropping anything that is not id-safe', () => {
        // A document embeds one figure per event, so the positional ids need a per-event prefix.
        const svg = pipelineSvg(sampleMap(), 'Create', { idPrefix: 'pipeline-create:"evil"-' });
        const ids = descendants(parse(svg), 'g')
            .map((g) => g.attrs.id)
            .filter((id): id is string => id !== undefined);
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) expect(id).toMatch(/^pipeline-createevil-n\d+$/);
        expect(svg).not.toContain('"evil"');
    });

    it('is deterministic', () => {
        expect(pipelineSvg(sampleMap(), 'Update')).toBe(pipelineSvg(sampleMap(), 'Update'));
        expect(pipelineSvg(hostileMap(), 'Create')).toBe(pipelineSvg(hostileMap(), 'Create'));
        expect(pipelineSvg(realisticMap(), 'Create')).toBe(pipelineSvg(realisticMap(), 'Create'));
        const map = sampleMap();
        const once = pipelineSvg(map, 'FormLoad', { width: 500, maxItemsPerStage: 2 });
        expect(pipelineSvg(map, 'FormLoad', { width: 500, maxItemsPerStage: 2 })).toBe(once);
        // Integer geometry: no floating point ever reaches the serialized coordinates.
        expect(once).not.toMatch(/(?:x|y|x1|y1|x2|y2|width|height)="[-\d]*\.\d/);
    });
});

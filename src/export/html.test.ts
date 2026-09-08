import { describe, expect, it } from 'vitest';
import type { EventName, LogicMap } from '../domain/model';
import { emptyPipelineRow } from '../domain/model';
import { HOSTILE_NAME, RAW_MARKER, UNSECURE_CONFIG, hostileItem, hostileMap, sampleMap } from '../fixtures/logicmap.sample';
import { parseXml, descendants } from '../xml/xml';
import { escapeHtml, toHtml } from './html';

/** Section anchors, in the order the document must present them (same order as toMarkdown). */
const SECTION_IDS = ['smells', 'pipeline', 'forms', 'columns', 'data-rules', 'touched-by', 'apps', 'other-dependencies', 'source-errors'];
/** Every `<h2 id=…>`: the contents block, the legend and the nine sections. */
const H2_COUNT = SECTION_IDS.length + 2;

/** A name that would execute or break out of an attribute if it were written through unescaped. */
const MARKUP_NAME = `<script>alert(1)</script> "quoted" & 'apostrophe' <img src=x onerror=alert(2)>`;

/**
 * `hostileMap()` (line breaks in a step name) plus values that carry real markup in every place a
 * Dataverse string reaches the document: an item line, a table cell, a smell, a source error, an
 * app row and — the attribute case — a pipeline event name used to build a heading `id`.
 */
function injectedMap(): LogicMap {
    const map = hostileMap();
    const evil = hostileItem({ id: 'a1b2c3d4-0005-4000-8000-000000000005', name: MARKUP_NAME });
    map.items.push(evil);
    map.pipeline.Create.preoperation.push(evil);
    map.columns.contoso_name.touchedBy = [...map.columns.contoso_name.touchedBy, evil.id];
    map.pipeline['Custom:evil" onmouseover="alert(3)' as EventName] = { ...emptyPipelineRow(), preoperation: [evil] };
    map.smells.push({ id: 'smell:injected', code: 'disabled-clutter', severity: 'warning', message: `${MARKUP_NAME} is disabled`, explanation: MARKUP_NAME, itemIds: [evil.id] });
    map.sourceErrors.push({ source: 'forms', message: MARKUP_NAME, kind: 'error' });
    map.apps.push({ id: 'e0e0e0e0-0001-4000-8000-000000000001', name: MARKUP_NAME, uniqueName: MARKUP_NAME, isManaged: false, state: 'Active' });
    map.environment = { name: MARKUP_NAME, url: 'https://contoso-dev.crm.dynamics.com' };
    return map;
}

/**
 * Values of every attribute the browser would FETCH: `src=` anywhere, and `href=` outside an
 * anchor (so `<link href>` counts). An `<a href>` is a hyperlink the reader may choose to click,
 * inert until then, so it does not affect whether the document renders offline with no network.
 */
function resourceAttributes(html: string): string[] {
    const withoutAnchors = html.replace(/<a\s[^>]*>/gi, '<a>');
    return [...withoutAnchors.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
}

/** Values of every `<a href>` in the document. */
function anchorHrefs(html: string): string[] {
    return [...html.matchAll(/<a\s[^>]*href="([^"]*)"/gi)].map((m) => m[1]);
}

function countOf(html: string, needle: string): number {
    return html.split(needle).length - 1;
}

describe('escapeHtml', () => {
    it('escapes the five characters that matter in content and in attributes', () => {
        expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
        // `&` is replaced first, so nothing is double-escaped.
        expect(escapeHtml('a & b')).toBe('a &amp; b');
        expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    });
});

describe('toHtml', () => {
    it('is one complete document with a head, a title naming the table and environment, and one inline style', () => {
        const html = toHtml(sampleMap());
        expect(html.startsWith('<!doctype html>\n<html lang="en">\n')).toBe(true);
        expect(html).toContain('<meta charset="utf-8" />');
        expect(html).toContain('<title>Table Logic Map — Project (contoso_project) — Contoso DEV</title>');
        expect(countOf(html, '<style>')).toBe(1);
        expect(html).toContain('@media print');
        expect(html.trimEnd().endsWith('</html>')).toBe(true);
    });

    it('renders the title block, the contents, the legend and every section heading in order', () => {
        const html = toHtml(sampleMap());
        expect(html).toContain('<h1>Table Logic Map — Project (contoso_project)</h1>');
        expect(html).toContain('Environment: Contoso DEV (https://contoso-dev.crm.dynamics.com) · Generated: 2026-03-01T10:00:00.000Z');
        expect(html).toContain('Custom · User-owned · Audit on · Duplicate detection off · Change tracking on · Activities on · Notes on');
        expect(html).toContain('3 plugin steps · 2 workflows (1 real-time / 1 background) · 2 flows · 1 business rule · 2 forms (2 handlers, 1 PCF, 1 component) · 1 key · 1 duplicate rule · 2 cascades');
        expect(html).toContain('<h2 id="contents">Contents</h2>');
        expect(html).toContain('<h2 id="legend">Legend</h2>');
        const positions = SECTION_IDS.map((id) => html.indexOf(`<h2 id="${id}">`));
        for (const [i, pos] of positions.entries()) expect(pos, SECTION_IDS[i]).toBeGreaterThan(0);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        // Contents links point at those anchors and carry the counts.
        for (const id of SECTION_IDS) expect(html).toContain(`<a href="#${id}">`);
        expect(html).toContain('<h2 id="smells">Smells <span class="count">(3)</span></h2>');
        expect(countOf(html, '<h2 id=')).toBe(H2_COUNT);
    });

    it('carries the same facts as the Markdown export: pipeline, forms, columns, data rules, touchers, apps, errors', () => {
        const html = toHtml(sampleMap());
        // Pipeline: one h3 per event, stage headings with the order note, item lines with rank and badge.
        expect(html).toContain('<h3 id="pipeline-create">Create</h3>');
        expect(html).toContain('<h3 id="pipeline-update">Update</h3>');
        expect(html).toContain('<h4>Post-operation (sync) <span class="note">(Same rank — order between plugins and real-time workflows is not guaranteed)</span></h4>');
        expect(html).toContain('<h4>After commit (async) <span class="note">(After commit — order not guaranteed)</span></h4>');
        expect(html).toContain('<strong>#1</strong> <span class="name">Contoso.Plugins.ProjectRollup: Update of contoso_project</span> — plugin step · <span class="badge badge-sync">sync</span> · enabled · filtering: contoso_budget, contoso_status');
        expect(html).toContain('images: PostImage (Post: contoso_budget); PreImage (Pre: all columns)');
        expect(html).toContain('<span class="off">disabled</span>');
        expect(html).toContain('smells: realtime-plus-plugin');
        // Smells keep message and explanation.
        expect(html).toContain('<code>cascade-chain</code> — Cascade delete chain: contoso_project → contoso_task continues 2 levels deep');
        expect(html).toContain('Disabled steps, draft processes and disabled handlers do not run');
        // Forms.
        expect(html).toContain('Project (Main · Active · default)</h3>');
        expect(html).toContain('<h4>Handlers</h4>');
        expect(html).toContain('<td>Contoso.Project.onRegionChange</td>');
        expect(html).toContain('Libraries: contoso_/scripts/project.js');
        expect(html).toContain('Business rules: Default region (form)');
        // Columns (with-logic default) and data rules.
        expect(html).toContain('<td>contoso_budget</td>');
        expect(html).toContain('autonumber PRJ-{SEQNUM:5}');
        expect(html).toContain('<h3 id="rules-keys">Keys</h3>');
        expect(html).toContain('Project code (Active): contoso_code');
        expect(html).toContain('contoso_project → contoso_task (via contoso_projectid)');
        expect(html).toContain('Auditing: effective (organization on, table on)');
        expect(html).toContain('<h3 id="rules-required-columns">Required columns</h3>');
        expect(html).toContain('contoso_name (Name), contoso_projectid (Project), ownerid (Owner)');
        // Touched by, apps, dependencies, source errors.
        expect(html).toContain('<h3 id="touched-write">Write</h3>');
        expect(html).toContain('<h3 id="touched-read">Read</h3>');
        expect(html).toContain('Flows and actions that read or write contoso_project without being triggered by it.');
        expect(html).toContain('<td>Contoso Field Service</td>');
        expect(html).toContain('<strong>customApis</strong> (permission): HTTP 403: Principal user is missing prvReadCustomAPI privilege — this map is missing what that source would have found');
    });

    it('is self-contained: no scripts and no external resource references', () => {
        for (const html of [toHtml(sampleMap()), toHtml(sampleMap(), { includeDiagrams: true, includeConfiguration: true, fullColumnList: true })]) {
            expect(html.toLowerCase()).not.toContain('<script');
            expect(html.toLowerCase()).not.toContain('<link');
            expect(html).not.toContain('@import');
            expect(html).not.toContain('url(http');
            expect(html).not.toMatch(/\son[a-z]+="/i);
            // The environment URL appears as text, but nothing is ever *loaded* from the network.
            for (const value of resourceAttributes(html)) expect(value.startsWith('#')).toBe(true);
        }
    });

    it('never writes the raw payload and redacts the unsecure configuration unless asked', () => {
        const html = toHtml(sampleMap());
        expect(html).not.toContain(RAW_MARKER);
        expect(html).not.toContain(UNSECURE_CONFIG);
        expect(html).toContain('config: [configuration omitted]');
        expect(html).toContain('secure config: set (never exported)');
        const withConfig = toHtml(sampleMap(), { includeConfiguration: true });
        expect(withConfig).toContain(`config: ${UNSECURE_CONFIG}`);
        expect(withConfig).not.toContain(RAW_MARKER);
        // The IFrame URL arrives already redacted from the source and stays that way.
        expect(html).toContain('https://portal.contoso.com/projects?…');
        expect(html).not.toContain('token=');
    });

    it('is deterministic across calls', () => {
        expect(toHtml(sampleMap())).toBe(toHtml(sampleMap()));
        expect(toHtml(sampleMap(), { includeDiagrams: true, fullColumnList: true })).toBe(toHtml(sampleMap(), { includeDiagrams: true, fullColumnList: true }));
        expect(toHtml(injectedMap())).toBe(toHtml(injectedMap()));
    });

    it('escapes every Dataverse value so a crafted record name cannot inject markup', () => {
        const html = toHtml(injectedMap());
        expect(html.toLowerCase()).not.toContain('<script');
        expect(html.toLowerCase()).not.toContain('<img');
        // An escaped event name keeps the text ` onmouseover=&quot;`; what must never appear is a
        // real attribute, i.e. the same text followed by an unescaped double quote.
        expect(html).not.toMatch(/\son[a-z]+="/i);
        // The name is present, escaped, in the item line, the smell, the error list and a table cell.
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;quoted&quot; &amp; &#39;apostrophe&#39;');
        expect(countOf(html, '&lt;script&gt;')).toBeGreaterThan(3);
        // Line breaks in a name are flattened, never emitted raw.
        expect(html).toContain('Evil ## Injected heading - fake item | pipe tab');
        expect(html).not.toContain(HOSTILE_NAME);
        // Heading ids stay slugs even when the event name carries quotes and markup.
        for (const id of [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1])) expect(id).toMatch(/^[A-Za-z0-9-]+$/);
        // The document still has exactly its own headings — nothing forged one.
        expect(countOf(html, '<h2 id=')).toBe(H2_COUNT);
    });

    it('produces well-formed markup (parsed as XML: every tag closes, attributes are quoted)', () => {
        // The document is HTML, not XML, but it is written XML-clean (void elements self-closed) so
        // parseXml is a cheap structural check: an unescaped `<` or a stray `"` breaks the parse.
        const html = toHtml(injectedMap());
        const root = parseXml(html.slice(html.indexOf('<html')));
        expect(root?.name).toBe('html');
        expect(descendants(root, 'h1')).toHaveLength(1);
        expect(descendants(root, 'h2')).toHaveLength(H2_COUNT);
        expect(descendants(root, 'table').length).toBeGreaterThan(0);
        expect(descendants(root, 'script')).toHaveLength(0);
    });

    it('renders the pipeline diagram only when includeDiagrams is set', () => {
        const plain = toHtml(sampleMap());
        expect(plain).not.toContain('<figure');
        const withDiagrams = toHtml(sampleMap(), { includeDiagrams: true });
        expect(withDiagrams.length).toBeGreaterThanOrEqual(plain.length);
        // pipelineSvg (htmlDiagram) owns the drawing; here we only prove the wrapper is right and
        // that events it declines to draw (empty string) are skipped.
        const figures = countOf(withDiagrams, '<figure class="diagram">');
        expect(figures).toBe(countOf(withDiagrams, '<figcaption>'));
        expect(figures).toBe(countOf(withDiagrams, '</figure>'));
        expect(figures).toBeGreaterThan(0);
        expect(figures).toBeLessThanOrEqual(Object.keys(sampleMap().pipeline).length);
        expect(withDiagrams).toContain('<svg');
        expect(withDiagrams).toContain('<figcaption>Execution order for Create</figcaption>');
    });

    it('lets the diagram shrink to the page instead of being clipped when printed', () => {
        // The figure is drawn 820px wide; the printed column (A4/Letter less the 16mm @page
        // margin) is about 675px. Without a scaling rule the right end of every row - the
        // kind/mode tail and the tail of a long name - is cut off the paper, which would swap the
        // truncation problem for a clipping one.
        const html = toHtml(sampleMap(), { includeDiagrams: true });
        expect(html).toContain('figure.diagram svg { max-width: 100%; height: auto; }');
        // Scaling only works because every figure carries a viewBox matching its width/height.
        // Scoped to the diagram figures: the footer's brand mark is deliberately a small render of
        // a fixed 32x32 artwork, so its viewBox does not (and should not) match its size.
        const figures = html.match(/<figure class="diagram">[\s\S]*?<\/figure>/g) ?? [];
        expect(figures.length).toBeGreaterThan(0);
        for (const figure of figures) {
            for (const svg of figure.match(/<svg[^>]*>/g) ?? []) {
                const width = /\swidth="(\d+)"/.exec(svg)?.[1];
                const height = /\sheight="(\d+)"/.exec(svg)?.[1];
                expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
            }
        }
    });

    it('carries the VerseBlocks attribution as the only outbound link', () => {
        const html = toHtml(sampleMap(), { includeDiagrams: true });
        expect(html).toContain('Generated by Table Logic Map');
        // Every other href is an in-document anchor; only the attribution points outward, and it
        // is a hyperlink rather than a fetched resource, so the document still renders offline.
        const external = anchorHrefs(html).filter((href) => !href.startsWith('#'));
        expect(external).toEqual(['https://www.verseblocks.com']);
        for (const value of resourceAttributes(html)) expect(value.startsWith('#')).toBe(true);
    });

    it('gives every element a unique id and every contents link a target, diagrams included', () => {
        // Word and HTML validators both reject repeated ids; the diagrams' positional node ids
        // (n1, n2, …) only stay unique because each figure is rendered with its event's prefix.
        for (const map of [sampleMap(), injectedMap()]) {
            const html = toHtml(map, { includeDiagrams: true });
            const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
            expect(ids.length).toBeGreaterThan(0);
            expect(new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`).toBe(ids.length);
            const targets = new Set(ids);
            for (const href of resourceAttributes(html)) {
                expect(href.startsWith('#')).toBe(true);
                expect(targets.has(href.slice(1)), `dangling link ${href}`).toBe(true);
            }
        }
    });

    it('limits the column table to columns with logic unless fullColumnList is set', () => {
        const withLogic = toHtml(sampleMap());
        const full = toHtml(sampleMap(), { fullColumnList: true });
        const total = Object.keys(sampleMap().columns).length;
        expect(withLogic).toContain(`of ${total} columns with logic (triggers, touched by, required, secured, audited or computed).`);
        expect(withLogic).not.toContain('<td>contoso_startdate</td>');
        expect(full).toContain(`All ${total} columns.`);
        expect(full).toContain('<td>contoso_startdate</td>');
        expect(countOf(full, '<tr>')).toBeGreaterThan(countOf(withLogic, '<tr>'));
        expect(full).toContain(`<h2 id="columns">Columns <span class="count">(${total})</span></h2>`);
    });
});

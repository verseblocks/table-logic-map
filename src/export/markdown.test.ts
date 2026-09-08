import { describe, expect, it } from 'vitest';
import { HOSTILE_NAME, IDS, RAW_MARKER, UNSECURE_CONFIG, hostileItem, hostileMap, sampleMap } from '../fixtures/logicmap.sample';
import { escapeCell, itemToMarkdown, toMarkdown } from './markdown';

const SECTIONS = ['## Smells', '## Pipeline', '## Forms', '## Columns', '## Data rules', '## Touched by', '## Apps', '## Other dependencies', '## Source errors'];

function section(md: string, heading: string): string {
    const start = md.indexOf(`\n${heading}\n`);
    expect(start, `section ${heading}`).toBeGreaterThanOrEqual(0);
    const rest = md.slice(start + 1);
    const next = rest.indexOf('\n## ', heading.length);
    return next >= 0 ? rest.slice(0, next) : rest;
}

describe('toMarkdown', () => {
    it('matches the golden snapshot', () => {
        expect(toMarkdown(sampleMap())).toMatchSnapshot();
    });

    it('matches the golden snapshot with every option on', () => {
        expect(toMarkdown(sampleMap(), { includeDiagrams: true, includeConfiguration: true, fullColumnList: true })).toMatchSnapshot();
    });

    it('starts with the title and header lines, then every section in order', () => {
        const md = toMarkdown(sampleMap());
        expect(md.startsWith('# Table Logic Map — Project (contoso_project)\n')).toBe(true);
        expect(md).toContain('Environment: Contoso DEV (https://contoso-dev.crm.dynamics.com) · Generated: 2026-03-01T10:00:00.000Z');
        expect(md).toContain('Custom · User-owned · Audit on · Duplicate detection off · Change tracking on · Activities on · Notes on');
        expect(md).toContain('3 plugin steps · 2 workflows (1 real-time / 1 background) · 2 flows · 1 business rule · 2 forms (2 handlers, 1 PCF, 1 component) · 1 key · 1 duplicate rule · 2 cascades');
        const positions = SECTIONS.map((h) => md.indexOf(`\n${h}\n`));
        for (const p of positions) expect(p).toBeGreaterThan(0);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(md).not.toContain('## Diagrams');
    });

    it('is deterministic across calls', () => {
        expect(toMarkdown(sampleMap())).toBe(toMarkdown(sampleMap()));
        expect(toMarkdown(sampleMap(), { includeDiagrams: true })).toBe(toMarkdown(sampleMap(), { includeDiagrams: true }));
    });

    it('never writes raw data or configuration unless asked', () => {
        const md = toMarkdown(sampleMap());
        expect(md).not.toContain(RAW_MARKER);
        expect(md).not.toContain(UNSECURE_CONFIG);
        expect(md).toContain('config: [configuration omitted]');
        expect(md).toContain('secure config: set (never exported)');
        const withConfig = toMarkdown(sampleMap(), { includeConfiguration: true });
        expect(withConfig).toContain(`config: ${UNSECURE_CONFIG}`);
        expect(withConfig).not.toContain(RAW_MARKER);
        // The IFrame URL stays redacted (query string stripped by the source).
        expect(md).toContain('https://portal.contoso.com/projects?…');
        expect(md).not.toContain('token=');
    });

    it('renders the pipeline per event and stage in execution order with order notes', () => {
        const md = toMarkdown(sampleMap());
        const pipeline = section(md, '## Pipeline');
        const events = [...pipeline.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
        expect(events).toEqual(['Create', 'Update', 'Delete', 'Assign', 'FormLoad', 'FormSave', 'FieldChange', 'Any']);
        const update = pipeline.slice(pipeline.indexOf('### Update'), pipeline.indexOf('### Delete'));
        expect(update).toContain('- **Post-operation (sync)** _(Same rank — order between plugins and real-time workflows is not guaranteed)_');
        expect(update).toContain('- **After commit (async)** _(After commit — order not guaranteed)_');
        expect(update).not.toContain('**Pre-validation**');
        expect(update).toContain('  - **#1** Contoso.Plugins.ProjectRollup: Update of contoso_project — plugin step · sync · enabled · filtering: contoso_budget, contoso_status · assembly: Contoso.Plugins · version: 1.4.0.0 · type: Contoso.Plugins.ProjectRollup · images: PostImage (Post: contoso_budget); PreImage (Pre: all columns) · touches: contoso_margin · smells: realtime-plus-plugin');
        expect(update).toContain('Validate budget — workflow · real-time · enabled · filtering: contoso_budget');
        expect(update).toContain('Contoso.Plugins.ProjectAuditTrail: Update of contoso_project — plugin step · async · disabled · filtering: any column');
        expect(update).toContain('Sync budget to finance — cloud flow · async · enabled · filtering: contoso_budget, contoso_margin · scope: Organization · filter: statecode eq 0');
        // Plugin before the real-time workflow of the same rank; async plugin before the flow after commit.
        expect(update.indexOf('ProjectRollup')).toBeLessThan(update.indexOf('Validate budget'));
        expect(update.indexOf('ProjectAuditTrail')).toBeLessThan(update.indexOf('Sync budget to finance'));
    });

    it('lists smells with message and explanation', () => {
        const smells = section(toMarkdown(sampleMap()), '## Smells');
        expect(smells).toContain('- **info** `cascade-chain` — Cascade delete chain: contoso_project → contoso_task continues 2 levels deep');
        expect(smells).toContain('- **info** `disabled-clutter` — Contoso.Plugins.ProjectAuditTrail: Update of contoso_project is disabled');
        expect(smells).toContain('  - Disabled steps, draft processes and disabled handlers do not run');
        const empty = sampleMap();
        empty.smells = [];
        expect(section(toMarkdown(empty), '## Smells')).toContain('_None_');
    });

    it('renders forms as tables and escapes pipes in cells', () => {
        const forms = section(toMarkdown(sampleMap()), '## Forms');
        expect(forms).toContain('### Project (Main · Active · default)');
        expect(forms).toContain('### Project quick create (Quick Create · Active)');
        expect(forms).toContain('Libraries: contoso_/scripts/project.js');
        expect(forms).toContain('| onchange | contoso_region | Contoso.Project.onRegionChange | contoso_/scripts/project.js | yes | yes | "EMEA\\|APAC" |');
        expect(forms).not.toContain('"EMEA|APAC"');
        expect(forms).toContain('| PCF | Contoso.Controls.BudgetGauge | contoso_budget | General › Financials |');
        expect(forms).toContain('| IFrame | IFrame: IFRAME_Portal |');
        expect(forms).toContain('Business rules: Default region (form)');
        expect(escapeCell('a|b\nc')).toBe('a\\|b c');
    });

    it('limits the column table to columns with logic unless fullColumnList is set', () => {
        const columns = section(toMarkdown(sampleMap()), '## Columns');
        expect(columns).toContain('| contoso_budget | Budget | Money | audited | simple | Contoso.Plugins.ProjectRollup: Update of contoso_project, Sync budget to finance, Validate budget | Contoso.Controls.BudgetGauge, Margin, Validate budget |');
        expect(columns).toContain('| contoso_code | Project code | String | — | autonumber PRJ-{SEQNUM:5} |');
        expect(columns).not.toContain('contoso_startdate');
        const full = section(toMarkdown(sampleMap(), { fullColumnList: true }), '## Columns');
        expect(full).toContain('| contoso_startdate | Start date | DateTime |');
        expect(full).toContain('| contoso_enddate |');
    });

    it('renders data rules: keys, duplicate rules, cascades, field security, audit, required', () => {
        const rules = section(toMarkdown(sampleMap()), '## Data rules');
        expect(rules).toContain('### Keys\n\n- Project code (Active): contoso_code');
        expect(rules).toContain('- Projects with the same name (Published) — contoso_project ↔ contoso_project\n  - contoso_name ↔ contoso_name (Exact Match, ignore blanks)');
        expect(rules).toContain('- contoso_project → contoso_task (via contoso_projectid)\n  - Assign: Cascade\n  - Delete: Cascade (chain depth 2)');
        expect(rules).toContain('- Finance managers: contoso_confidentialnotes (read Allowed, create Not Allowed, update Allowed)');
        expect(rules).toContain('- Auditing: effective (organization on, table on)');
        expect(rules).toContain('- Audited columns: contoso_budget, contoso_name');
        expect(rules).toContain('### Required columns\n\n- contoso_name (Name), contoso_projectid (Project), ownerid (Owner)');
    });

    it('groups external touchers by access, lists apps, unclassified dependencies and source errors', () => {
        const md = toMarkdown(sampleMap());
        const touched = section(md, '## Touched by');
        expect(touched).toContain('### Write\n\n- Close stale projects — cloud flow · disabled · trigger: recurrence · operations: ListRecords (List_stale_projects), UpdateRecord (Apply_to_each/Update_project) · touches: statecode, statuscode');
        expect(touched).toContain('### Read\n\n- Weekly project digest — cloud flow · enabled · trigger: recurrence · operations: ListRecords (List_projects)');
        const apps = section(md, '## Apps');
        expect(apps).toContain('| Contoso Field Service | contoso_FieldService | Active | yes |\n| Project Hub | contoso_ProjectHub | Active | no |');
        const deps = section(md, '## Other dependencies');
        expect(deps).toContain(`| Saved Query (26) | Active Projects | ${IDS.viewActive} |`);
        expect(deps).not.toContain('Validate budget');
        expect(section(md, '## Source errors')).toContain('- **customApis** (permission): HTTP 403: Principal user is missing prvReadCustomAPI privilege — this map is missing what that source would have found');
    });

    it('appends one mermaid block per event only with includeDiagrams', () => {
        const md = toMarkdown(sampleMap(), { includeDiagrams: true });
        const diagrams = section(md, '## Diagrams');
        const blocks = diagrams.match(/```mermaid\nflowchart LR\n[\s\S]*?```/g) ?? [];
        expect(blocks).toHaveLength(Object.keys(sampleMap().pipeline).length);
        expect(diagrams).toContain('### Create\n\n```mermaid\nflowchart LR\n');
        expect(toMarkdown(sampleMap())).not.toContain('```mermaid');
    });

    it('flattens record names so a crafted name cannot forge Markdown structure', () => {
        const md = toMarkdown(hostileMap(), { includeDiagrams: true, fullColumnList: true });
        const plain = toMarkdown(sampleMap(), { includeDiagrams: true, fullColumnList: true });
        // No new headings and no extra list items came from the name.
        expect(md).not.toContain('\n## Injected heading');
        expect(md).not.toContain('\n- fake item');
        expect(md.match(/^#{1,3} /gm)?.length).toBe(plain.match(/^#{1,3} /gm)?.length);
        expect(md).not.toContain('\r');
        // The name is still readable, on one line.
        expect(md).toContain('**#9** Evil ## Injected heading - fake item | pipe tab — plugin step');
        // Every row of the Columns table keeps its 7 cells: the pipe in the name is escaped in cells.
        const columns = section(md, '## Columns');
        const cellCounts = new Set(
            columns
                .split('\n')
                .filter((l) => l.startsWith('|'))
                .map((l) => l.replace(/\\\|/g, '').split('|').length),
        );
        expect([...cellCounts]).toEqual([9]);
        const nameRow = columns.split('\n').find((l) => l.startsWith('| contoso_name |'))!;
        expect(nameRow.replace(/\\\|/g, '').split('|')).toHaveLength(9);
        expect(nameRow).toContain('Evil ## Injected heading - fake item \\| pipe tab');
    });

    it('flattens the item name in itemToMarkdown and mermaid labels', () => {
        const map = hostileMap();
        const md = itemToMarkdown(hostileItem(), map);
        expect(md.split('\n').every((l, i) => i === 0 || l.startsWith('  - '))).toBe(true);
        expect(md).not.toContain('\n## ');
        expect(md.startsWith('- **Evil ## Injected heading - fake item | pipe tab** (plugin step)')).toBe(true);
        expect(HOSTILE_NAME).toContain('\n');
        const diagrams = section(toMarkdown(map, { includeDiagrams: true }), '## Diagrams');
        for (const label of [...diagrams.matchAll(/^\s*n\d+\["(.*)"\]$/gm)].map((m) => m[1])) expect(label).not.toMatch(/["[\]|{}]/);
    });

    it('handles an empty map without throwing', () => {
        const map = sampleMap();
        map.items = [];
        map.pipeline = {};
        map.forms = [];
        map.columns = {};
        map.externalTouchers = [];
        map.apps = [];
        map.dependencies = [];
        map.smells = [];
        map.sourceErrors = [];
        const md = toMarkdown(map, { includeDiagrams: true });
        expect(md).toContain('0 plugin steps · 0 workflows (0 real-time / 0 background) · 0 flows');
        for (const h of [...SECTIONS, '## Diagrams']) expect(md).toContain(`\n${h}\n`);
        expect(md.match(/_None_/g)?.length).toBeGreaterThan(8);
    });
});

describe('itemToMarkdown', () => {
    it('produces a self-contained bullet with the well-known fields and flattened details', () => {
        const map = sampleMap();
        const item = map.items.find((i) => i.id === IDS.pluginNumbering)!;
        const md = itemToMarkdown(item, map);
        expect(md.startsWith('- **Contoso.Plugins.ProjectNumbering: Create of contoso_project** (plugin step)\n')).toBe(true);
        expect(md).toContain('  - Table: Project (contoso_project)');
        expect(md).toContain('  - Event: Create');
        expect(md).toContain('  - Stage: Pre-operation');
        expect(md).toContain('  - Mode: sync');
        expect(md).toContain('  - Rank: 1');
        expect(md).toContain('  - Enabled: yes');
        expect(md).toContain('  - Filtering attributes: —');
        expect(md).toContain('  - Touches columns: contoso_code');
        expect(md).toContain('  - Confidence: exact');
        expect(md).toContain(`  - Source: sdkmessageprocessingstep ${IDS.pluginNumbering}`);
        expect(md).toContain('  - assembly: Contoso.Plugins');
        expect(md).toContain('  - images: {"name":"PreImage","alias":"pre","type":"Pre","attributes":["contoso_code","contoso_name"]}');
        expect(md).toContain('  - hasSecureConfig: true');
        expect(md).toContain('  - unsecureConfig: [configuration omitted]');
        expect(md).not.toContain(UNSECURE_CONFIG);
        expect(md).not.toContain(RAW_MARKER);
        expect(md.split('\n').every((l, i) => i === 0 || l.startsWith('  - '))).toBe(true);
    });

    it('lists arrays as comma lists and smells as messages', () => {
        const map = sampleMap();
        const item = map.items.find((i) => i.id === IDS.pluginRollup)!;
        const md = itemToMarkdown(item, map);
        expect(md).toContain('  - Filtering attributes: contoso_budget, contoso_status');
        expect(md).toContain('  - Smells: Real-time workflow and sync plugin both on Update / Post-operation (sync)');
        const workflow = map.items.find((i) => i.groupId === IDS.workflowValidate)!;
        expect(itemToMarkdown(workflow, map)).toContain('  - activities: Condition, StopWorkflow');
        expect(itemToMarkdown(workflow, map)).toContain(`  - Group: ${IDS.workflowValidate}`);
    });
});

describe('attribution', () => {
    it('closes the report with a VerseBlocks footer', () => {
        const md = toMarkdown(sampleMap());
        expect(md.trimEnd().endsWith('Generated by [Table Logic Map](https://www.verseblocks.com) — VerseBlocks')).toBe(true);
        // One rule separates it, so it reads as a footer wherever the file is pasted.
        const lines = md.trimEnd().split(/\r?\n/);
        expect(lines[lines.length - 3]).toBe('---');
        expect(lines[lines.length - 2]).toBe('');
    });
});

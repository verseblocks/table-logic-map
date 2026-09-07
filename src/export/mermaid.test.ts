import { describe, expect, it } from 'vitest';
import { sampleMap } from '../fixtures/logicmap.sample';
import { sanitizeLabel, toMermaid } from './mermaid';

describe('toMermaid', () => {
    it('draws one subgraph per non-empty stage and chains the execution stages', () => {
        const md = toMermaid(sampleMap(), 'Update');
        expect(md.startsWith('flowchart LR\n')).toBe(true);
        // Update: Pre-operation (duplicate rule), Post-operation (plugin + real-time workflow), After commit (async plugin + flow), Always (key).
        const subgraphs = [...md.matchAll(/^\s*subgraph (\w+)\["([^"]*)"\]$/gm)].map((m) => m[1]);
        expect(subgraphs).toEqual(['preoperation', 'postoperation', 'postcommit', 'always']);
        expect((md.match(/^\s*end$/gm) ?? []).length).toBe(4);
        expect(md).toContain('    n2["#1 Contoso.Plugins.ProjectRollup: Update of contoso_project"]');
        // `always` is not part of the execution chain.
        expect(md).toContain('\n  preoperation --> postoperation --> postcommit');
        expect(md).not.toContain('always -->');
        expect(md).not.toContain('--> always');
    });

    it('labels nodes "#rank name" with sequential deterministic ids', () => {
        const md = toMermaid(sampleMap(), 'Create');
        const nodes = [...md.matchAll(/^\s*(n\d+)\["([^"]*)"\]$/gm)].map((m) => [m[1], m[2]]);
        expect(nodes.map((n) => n[0])).toEqual(nodes.map((_, i) => `n${i + 1}`));
        const numbering = nodes.map((n) => n[1]).find((l) => l.startsWith('#1 Contoso.Plugins.ProjectNumbering'));
        expect(numbering).toBeDefined();
        expect(numbering).toHaveLength(60);
        expect(numbering?.endsWith('…')).toBe(true);
        expect(md).toContain('\n  preoperation --> postcommit');
        expect(toMermaid(sampleMap(), 'Create')).toBe(md);
    });

    it('escapes quotes, brackets and pipes in labels and truncates long names', () => {
        const md = toMermaid(sampleMap(), 'Create');
        expect(md).toContain(`["Notify PM 'on create' (v2)"]`);
        const lines = md.split('\n').filter((l) => /^\s*n\d+\[/.test(l));
        for (const line of lines) {
            const label = /\["(.*)"\]$/.exec(line)?.[1] ?? '';
            expect(label).not.toMatch(/["[\]|{}]/);
            expect(label.length).toBeLessThanOrEqual(60);
        }
        expect(sanitizeLabel('x'.repeat(80))).toHaveLength(60);
        expect(sanitizeLabel('a "b" [c] {d} e|f')).toBe("a 'b' (c) (d) e/f");
    });

    it('uses valid arrow syntax between subgraph ids only', () => {
        const md = toMermaid(sampleMap(), 'Update');
        const edges = md.split('\n').filter((l) => l.includes('-->'));
        expect(edges).toHaveLength(1);
        expect(edges[0]).toMatch(/^ {2}[a-z]+( --> [a-z]+)+$/);
    });

    it('falls back to a single node for an event without logic', () => {
        expect(toMermaid(sampleMap(), 'Merge')).toBe('flowchart LR\n  none[No logic on Merge]');
        expect(toMermaid(sampleMap(), 'Custom:contoso_Approve')).toBe('flowchart LR\n  none[No logic on Custom:contoso_Approve]');
    });
});

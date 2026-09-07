/**
 * Guards the two build outputs that must coexist in dist/: the UI bundle (dist/index.html plus a
 * single IIFE script, no type="module") and the headless MCP entry (dist/headless.js).
 *
 * `npm run dev-watch` runs the UI build with `--mode development --watch`; Vite re-empties the
 * output directory on every rebuild, so `emptyOutDir` must be off in that mode or dist/headless.js
 * disappears and every headless MCP invocation fails until the next full build.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadConfigFromFile } from 'vite';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function uiBuild(mode: string) {
    const loaded = await loadConfigFromFile({ command: 'build', mode }, resolve(root, 'vite.config.mts'), root);
    return loaded?.config.build ?? {};
}

describe('UI vite config', () => {
    it('does not empty dist/ in development (watch) mode, so dist/headless.js survives a rebuild', async () => {
        expect((await uiBuild('development')).emptyOutDir).toBe(false);
    });

    it('still cleans dist/ for the production build', async () => {
        expect((await uiBuild('production')).emptyOutDir).toBe(true);
    });

    it('keeps the single-IIFE output PPTB requires (no ESM / type="module")', async () => {
        const build = await uiBuild('production');
        expect(build.rollupOptions?.output).toMatchObject({ format: 'iife' });
    });
});

describe('build scripts', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };

    it('dev-watch produces the headless bundle as well as the UI bundle', () => {
        expect(pkg.scripts['dev-watch']).toContain('build:headless');
    });

    it('the production build writes the UI bundle before the headless bundle (only the UI build cleans dist/)', () => {
        const build = pkg.scripts.build;
        expect(build.indexOf('build:ui')).toBeLessThan(build.indexOf('build:headless'));
    });
});

describe('pptb.config.json prefill', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'pptb.config.json'), 'utf8')) as {
        invocation: { prefill: { properties: Record<string, { type: string; description: string }> } };
    };

    it('declares every input the headless entry accepts', () => {
        const props = config.invocation.prefill.properties;
        expect(Object.keys(props).sort()).toEqual(['entityName', 'events', 'includeDiagrams', 'includeSystemSteps', 'maxSyncItems']);
        expect(props.includeDiagrams.type).toBe('boolean');
        expect(props.maxSyncItems.type).toBe('number');
    });

    it('tells the caller how event names are matched', () => {
        expect(config.invocation.prefill.properties.events.description).toContain('case-insensitive');
        expect(config.invocation.prefill.properties.events.description).toContain('Custom:');
    });
});

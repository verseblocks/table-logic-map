/**
 * Regenerate docs/assets/sample-logic-map.html from the anonymized fixture.
 *
 * The exporters are TypeScript, so this compiles them to a temp directory with the project's own
 * tsc and runs the compiled output. Keeps the committed sample in step with the code that makes it.
 *
 * Usage: node scripts/render-sample.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'tlm-sample-'));

try {
    // Compile the export + domain + fixture graph to CommonJS; no emit-on-error tolerance.
    execFileSync(
        process.execPath,
        [
            resolve(root, 'node_modules', 'typescript', 'bin', 'tsc'),
            'src/export/html.ts',
            'src/fixtures/logicmap.sample.ts',
            '--outDir',
            out,
            '--module',
            'commonjs',
            '--target',
            'ES2022',
            '--moduleResolution',
            'node',
            '--skipLibCheck',
            '--esModuleInterop',
            '--resolveJsonModule',
        ],
        { cwd: root, stdio: 'inherit' },
    );

    const { toHtml } = await import(pathToFileURL(join(out, 'export', 'html.js')).href);
    const { sampleMap } = await import(pathToFileURL(join(out, 'fixtures', 'logicmap.sample.js')).href);

    const html = toHtml(sampleMap(), { includeDiagrams: true });
    const target = join(root, 'docs', 'assets', 'sample-logic-map.html');
    mkdirSync(join(root, 'docs', 'assets'), { recursive: true });
    writeFileSync(target, html, 'utf8');

    const figures = (html.match(/<figure class="diagram">/g) ?? []).length;
    const truncated = (html.match(/<text[^>]*>[^<]*…[^<]*<\/text>/g) ?? []).length;
    console.log(`wrote ${target}`);
    console.log(`  ${Math.round(html.length / 1024)} KB · ${(html.match(/<h2/g) ?? []).length} sections · ${figures} diagrams · ${truncated} truncated labels`);
    console.log(`  scripts: ${(html.match(/<script/g) ?? []).length} · external resources: ${(html.match(/\s(?:src)="https?:/g) ?? []).length}`);
} finally {
    rmSync(out, { recursive: true, force: true });
}

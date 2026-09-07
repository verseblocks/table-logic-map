// Runs the same checks as `npx pptb-validate` but skips URL reachability checks so the
// package can be validated before the GitHub repository exists / while offline.
// The published `pptb-validate` CLI (1.0.x) has no --skip-url-checks flag, hence this script.
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { validatePackageJson, validatePPTBConfig } = require('@pptb/validate');

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

let failed = false;
function print(title, result) {
    console.log(`\n${title}`);
    for (const e of result.errors) console.error(`  ERROR   ${e}`);
    for (const w of result.warnings) console.warn(`  WARNING ${w}`);
    if (result.errors.length === 0 && result.warnings.length === 0) console.log('  OK');
    else if (result.valid) console.log('  OK (with warnings)');
    if (!result.valid) failed = true;
}

print('package.json (URL checks skipped)', await validatePackageJson(pkg, { skipUrlChecks: true }));

const configPath = resolve(root, 'pptb.config.json');
if (existsSync(configPath)) {
    print('pptb.config.json', validatePPTBConfig(JSON.parse(readFileSync(configPath, 'utf8'))));
} else {
    console.log('\npptb.config.json not found (optional)');
}

// Extra structural checks that the registry performs after `npm run build`.
const distChecks = [
    ['dist/index.html', 'main entry'],
    [`dist/${pkg.icon}`, 'icon referenced by package.json#icon'],
    ['dist/headless.js', 'agents.headlessEntry'],
];
console.log('\ndist/ structure');
for (const [rel, what] of distChecks) {
    const ok = existsSync(resolve(root, rel));
    console.log(`  ${ok ? 'OK     ' : 'MISSING'} ${rel} (${what})`);
    if (!ok) failed = true;
}
if (existsSync(resolve(root, 'dist/index.html'))) {
    const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
    const moduleScripts = /<script[^>]*type="module"/.test(html);
    const scriptCount = (html.match(/<script[^>]*src=/g) || []).length;
    console.log(`  ${moduleScripts ? 'ERROR  ' : 'OK     '} no type="module" scripts`);
    console.log(`  ${scriptCount === 1 ? 'OK     ' : 'WARNING'} single script bundle (found ${scriptCount})`);
    if (moduleScripts) failed = true;
}

process.exit(failed ? 1 : 0);

/**
 * End-to-end test of the agent/MCP surface against a RUNNING Power Platform ToolBox.
 *
 * This is the check that fixtures cannot do: it drives the real PPTB MCP server, which loads
 * dist/headless.js in Node, resolves a real Dataverse connection and runs the real queries.
 *
 * Prerequisites (both are GUI actions inside PPTB):
 *   1. Debug -> Load Local Tool -> select this project's ROOT folder.
 *   2. MCP Server -> Start.
 *
 * Usage:
 *   node scripts/mcp-test.mjs [--table account] [--connection "APL Sales Dev"] [--port 7339]
 *
 * The access token is read from PPTB's own user-settings.json, so nothing has to be pasted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(arg('port', 7339));
const HOST = arg('host', '127.0.0.1');
const TABLE = arg('table', 'account');
const CONNECTION = arg('connection', 'APL Sales Dev');
const TOOL_NAME = arg('tool', 'table-logic-map');
const ENDPOINT = `http://${HOST}:${PORT}/`;

function readToken() {
    const explicit = arg('token', '');
    if (explicit) return explicit;
    const appData = process.env.APPDATA ?? '';
    const path = join(appData, 'powerplatform-toolbox', 'user-settings.json');
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    const token = settings.mcpAccessToken;
    if (!token) throw new Error(`No mcpAccessToken in ${path}. Start the MCP server in PPTB once to generate one.`);
    return token;
}

const TOKEN = readToken();
let nextId = 1;

/** One JSON-RPC round trip. The transport may answer as JSON or as a single SSE frame. */
async function rpc(method, params, { notify = false } = {}) {
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: nextId++, method, params };
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'x-mcp-auth-token': TOKEN,
        },
        body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error('401 Unauthorized — the access token does not match PPTB settings.');
    if (notify) return undefined;
    const text = await res.text();
    if (!res.ok && !text.trim().startsWith('{') && !text.includes('data:')) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    // Streamable HTTP may answer with an SSE frame; take the last `data:` payload.
    const payload = text.includes('data:')
        ? text
              .split(/\r?\n/)
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .filter(Boolean)
              .pop()
        : text;
    let json;
    try {
        json = JSON.parse(payload);
    } catch {
        throw new Error(`Could not parse response: ${text.slice(0, 300)}`);
    }
    if (json.error) throw new Error(`${method} failed: ${JSON.stringify(json.error).slice(0, 300)}`);
    return json.result;
}

/** Pull the tool's payload out of an MCP tool result (structuredContent, else the text block). */
function payloadOf(result) {
    if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
    const text = result?.content?.find?.((c) => c.type === 'text')?.text;
    if (typeof text === 'string') {
        try {
            return JSON.parse(text);
        } catch {
            return { text };
        }
    }
    return result ?? {};
}

async function callTool(input, meta) {
    const result = await rpc('tools/call', {
        name: TOOL_NAME,
        arguments: { ...input, __pptb: { mode: 'two-way', executionMode: 'headless', connectionName: CONNECTION, ...meta } },
    });
    let payload = payloadOf(result);
    // A headless run may answer with a job handle; poll it until it finishes.
    const jobId = payload.jobId ?? payload.id;
    if (jobId && !payload.logicMap) {
        for (let i = 0; i < 120; i++) {
            const res = await fetch(`http://${HOST}:${PORT}/mcp/jobs/${jobId}`, { headers: { 'x-mcp-auth-token': TOKEN } });
            if (res.ok) {
                const job = await res.json();
                if (job.status === 'completed' || job.status === 'failed' || job.result || job.error) {
                    payload = job.result ? payloadOf(job.result) : job;
                    break;
                }
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    return { result, payload, isError: result?.isError === true };
}

const checks = [];
const check = (name, ok, detail = '') => {
    checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
    process.stdout.write(`${ok ? 'PASS  ' : 'FAIL  '}${name}${detail ? `  [${String(detail).slice(0, 160)}]` : ''}\n`);
};

console.log(`MCP endpoint : ${ENDPOINT}`);
console.log(`Tool         : ${TOOL_NAME}`);
console.log(`Table        : ${TABLE}`);
console.log(`Connection   : ${CONNECTION}\n`);

try {
    await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'table-logic-map-mcp-test', version: '1.0.0' },
    });
    await rpc('notifications/initialized', {}, { notify: true }).catch(() => undefined);
    check('MCP handshake', true);
} catch (err) {
    console.error(`\nCannot reach the MCP server: ${err.message}`);
    console.error('In PPTB: MCP Server -> Start, and Debug -> Load Local Tool -> this project root.');
    process.exit(2);
}

// 1. Discovery
let listed = [];
try {
    const tools = await rpc('tools/list', {});
    listed = (tools?.tools ?? []).map((t) => t.name);
    check(`discovery lists ${TOOL_NAME}`, listed.includes(TOOL_NAME), listed.join(', ') || 'no tools');
} catch (err) {
    check('discovery', false, err.message);
}
if (!listed.includes(TOOL_NAME)) {
    console.error('\nThe tool is not discoverable. Load it in PPTB (Debug -> Load Local Tool -> project root) and re-run.');
    process.exit(2);
}

// 2. The real run
let good;
try {
    good = await callTool({ entityName: TABLE });
    const map = good.payload.logicMap;
    check('headless two-way returns a map', map?.schemaVersion === 1, good.payload.error ?? JSON.stringify(good.payload).slice(0, 200));
    check('markdown returned', typeof good.payload.markdown === 'string' && good.payload.markdown.length > 0);
    if (map) {
        const errs = map.sourceErrors ?? [];
        check('no source errors', errs.length === 0, errs.map((e) => `${e.source}: ${e.message}`).join(' | ') || 'none');
        console.log(`\n  items=${map.items?.length ?? 0} forms=${map.forms?.length ?? 0} columns=${Object.keys(map.columns ?? {}).length} apps=${map.apps?.length ?? 0} deps=${map.dependencies?.length ?? 0} requests=${map.stats?.requests ?? '?'} in ${map.stats?.durationMs ?? '?'}ms`);
        const kinds = {};
        for (const i of map.items ?? []) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
        console.log(`  kinds: ${Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join(' ') || '(none)'}\n`);
        // The two items that could only be confirmed against a live org.
        check('plugin steps source ran (verified.md #2)', !errs.some((e) => e.source === 'pluginSteps'), errs.find((e) => e.source === 'pluginSteps')?.message ?? 'clean');
        check('dependencies source ran (verified.md #8)', !errs.some((e) => e.source === 'dependencies'), errs.find((e) => e.source === 'dependencies')?.message ?? 'clean');
    }
    const serialized = JSON.stringify(good.payload);
    check('no plugin configuration leaked', !/AccountKey=|Server=tcp:|Password=/i.test(serialized));
} catch (err) {
    check('headless two-way run', false, err.message);
}

// 3. Input validation
try {
    const bad = await callTool({ entityName: "account')/Attributes" });
    check('rejects a malformed entityName', typeof bad.payload.error === 'string' && !bad.payload.logicMap, bad.payload.error ?? '');
} catch (err) {
    check('rejects a malformed entityName', /entityName/i.test(err.message), err.message);
}
try {
    const bad = await callTool({ entityName: TABLE, events: ['Modify'] });
    check('rejects an unknown event name', typeof bad.payload.error === 'string' && /Modify/.test(bad.payload.error), bad.payload.error ?? '');
} catch (err) {
    check('rejects an unknown event name', /Modify/.test(err.message), err.message);
}
try {
    const lower = await callTool({ entityName: TABLE, events: ['create'] });
    check('accepts a lower-case event name', lower.payload.logicMap?.schemaVersion === 1, lower.payload.error ?? '');
} catch (err) {
    check('accepts a lower-case event name', false, err.message);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${failed.length === 0 ? `ALL ${checks.length} CHECKS PASSED` : `${failed.length} of ${checks.length} FAILED`}`);
if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}
process.exit(failed.length === 0 ? 0 : 1);

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DataverseRequestError, type ClientStats, type DataverseClient, type Row } from '../data/client';
import type { Logger, TableFacts } from '../domain/model';
import type { SourceContext } from './types';
import { SERVICE_ENDPOINTS_PATH, filtersPath, imagesPath, pluginStepsSource, primaryStepsPath, stepsByFilterPath } from './pluginSteps';
import { SOURCES } from './index';
import { buildLogicMap } from '../domain/buildLogicMap';
import { makeFakeClient as makeRoutedClient } from './testUtils';

const fixture = (name: string): Row[] => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', name), 'utf8')) as Row[];
const STEPS = fixture('pluginsteps.steps.json');
const IMAGES = fixture('pluginsteps.images.json');
const ENDPOINTS = fixture('pluginsteps.serviceendpoints.json');

const TABLE: TableFacts = {
    logicalName: 'contoso_project',
    entitySetName: 'contoso_projects',
    metadataId: 'aaaaaaaa-0000-4000-8000-000000000001',
    displayName: 'Project',
    schemaName: 'contoso_Project',
    ownership: 'UserOwned',
    isActivity: false,
    isCustom: true,
    isCustomizable: true,
    isBpfEntity: false,
    audit: false,
    changeTracking: false,
    duplicateDetection: false,
    hasNotes: true,
    hasActivities: true,
};

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

type QueryHandler = (path: string) => Row[] | Promise<Row[]>;

/** Minimal in-memory DataverseClient: `query` is routed through `handler`, every call is recorded. */
function makeFakeClient(handler: QueryHandler): DataverseClient & { calls: string[] } {
    const calls: string[] = [];
    const stats: ClientStats = { requests: 0, retries: 0, cacheHits: 0 };
    const unsupported = (name: string) => async () => Promise.reject(new Error(`${name} not expected in this test`));
    return {
        calls,
        stats,
        query: async (p) => {
            calls.push(p);
            stats.requests++;
            return handler(p);
        },
        queryOne: async (p) => {
            calls.push(p);
            stats.requests++;
            const rows = await handler(p);
            return rows[0] ?? {};
        },
        queryRaw: async (p) => {
            calls.push(p);
            stats.requests++;
            return { value: await handler(p) };
        },
        entityMetadata: unsupported('entityMetadata'),
        allEntities: unsupported('allEntities'),
        relatedMetadata: unsupported('relatedMetadata'),
        fetchXml: unsupported('fetchXml'),
    };
}

function makeCtx(client: DataverseClient, overrides: Partial<SourceContext> = {}): SourceContext {
    return {
        client,
        table: TABLE,
        org: {},
        options: {},
        knownColumns: new Set(),
        customApiNames: new Set(['contoso_RecalculateProject']),
        environmentUrl: 'https://org.crm.dynamics.com',
        logger: silentLogger,
        ...overrides,
    };
}

/** Routes the standard happy-path queries: steps, images (by step id), service endpoints. */
function happyHandler(steps: Row[] = STEPS): QueryHandler {
    return (p) => {
        if (p.startsWith('sdkmessageprocessingsteps?')) return steps;
        if (p.startsWith('sdkmessageprocessingstepimages?')) {
            return IMAGES.filter((img) => p.includes(String(img._sdkmessageprocessingstepid_value)));
        }
        if (p === SERVICE_ENDPOINTS_PATH) return ENDPOINTS;
        throw new Error(`unexpected query ${p}`);
    };
}

describe('pluginSteps source', () => {
    // Both sources feed ctx.customApiNames (custom APIs and classic Action unique names). Missing
    // `processes` here made a step on an Action map to `Custom:<name>` or `Message:<name>`
    // depending on which query returned first, so the same table produced different maps.
    it('declares its dependency on every source that populates customApiNames', () => {
        expect(pluginStepsSource.name).toBe('pluginSteps');
        expect(pluginStepsSource.after).toEqual(['customApis', 'processes']);
        // The orchestrator only awaits sources that are registered under those names.
        for (const dep of pluginStepsSource.after ?? []) expect(SOURCES.map((s) => s.name)).toContain(dep);
    });

    it('issues the §5.8 query with the navigation filter and maps every step', async () => {
        const client = makeFakeClient(happyHandler());
        const result = await pluginStepsSource.run(makeCtx(client));

        expect(client.calls[0]).toBe(
            "sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode,rank,filteringattributes,statecode,statuscode,configuration,supporteddeployment,asyncautodelete,description,ismanaged,ishidden,_impersonatinguserid_value,_sdkmessageprocessingstepsecureconfigid_value,_eventhandler_value,_plugintypeid_value&$expand=sdkmessagefilterid($select=primaryobjecttypecode,secondaryobjecttypecode),sdkmessageid($select=name),plugintypeid($select=typename,assemblyname,friendlyname,version,_pluginassemblyid_value)&$filter=sdkmessagefilterid/primaryobjecttypecode eq 'contoso_project' or sdkmessagefilterid/secondaryobjecttypecode eq 'contoso_project'",
        );
        expect(client.calls[0]).toBe(primaryStepsPath('contoso_project'));
        expect(result.items).toHaveLength(STEPS.length);
        expect(result.warnings).toBeUndefined();
        expect(result.items.every((i) => i.kind === 'plugin' && i.confidence === 'exact' && i.source.table === 'sdkmessageprocessingstep')).toBe(true);
    });

    it('maps a sync pre-operation Create step', async () => {
        const client = makeFakeClient(happyHandler());
        const { items } = await pluginStepsSource.run(makeCtx(client));
        const numbering = items.find((i) => i.id === '11111111-1111-4111-8111-000000000001')!;
        expect(numbering).toMatchObject({
            name: 'Contoso.Plugins.ProjectNumbering: Create of contoso_project',
            event: 'Create',
            stage: 'preoperation',
            order: 1,
            mode: 'sync',
            enabled: true,
            filteringAttributes: [],
            source: { table: 'sdkmessageprocessingstep', id: '11111111-1111-4111-8111-000000000001' },
        });
        expect(numbering.details).toMatchObject({
            message: 'Create',
            handlerType: 'plugin',
            pluginType: 'Contoso.Plugins.ProjectNumbering',
            assembly: 'Contoso.Plugins',
            assemblyVersion: '1.0.0.0',
            friendlyName: 'ProjectNumbering',
            unsecureConfig: '{"prefix":"PRJ","apiKey":"do-not-leak"}',
            hasSecureConfig: false,
            images: [],
            deployment: 'Server',
            asyncAutoDelete: false,
            primaryEntity: 'contoso_project',
            role: 'primary',
            isHidden: false,
            isManaged: false,
            description: 'Assigns the project number.',
            stageCode: 20,
            modeCode: 0,
        });
        expect(numbering.details.secondaryEntity).toBeUndefined();
        expect(numbering.details.runAsUser).toBeUndefined();
    });

    it('splits/sorts filtering attributes, attaches images and flags secure config on a disabled Update step', async () => {
        const client = makeFakeClient(happyHandler());
        const { items } = await pluginStepsSource.run(makeCtx(client));
        const rollup = items.find((i) => i.id === '11111111-1111-4111-8111-000000000002')!;
        expect(rollup).toMatchObject({ event: 'Update', stage: 'postoperation', order: 2, mode: 'sync', enabled: false });
        expect(rollup.filteringAttributes).toEqual(['contoso_budget', 'contoso_status']);
        expect(rollup.details.hasSecureConfig).toBe(true);
        expect(rollup.details.deployment).toBe('Both');
        expect(rollup.details.images).toEqual([
            { name: 'PostImage', alias: 'PostImage', type: 'Post', attributes: ['contoso_budget'] },
            { name: 'PreImage', alias: 'PreImage', type: 'Pre', attributes: ['contoso_budget', 'contoso_status'] },
        ]);
        expect(rollup.details.unsecureConfig).toBeUndefined();
    });

    it('maps async post-operation steps to postcommit with run-as user and auto-delete', async () => {
        const client = makeFakeClient(happyHandler());
        const { items } = await pluginStepsSource.run(makeCtx(client));
        const notify = items.find((i) => i.id === '11111111-1111-4111-8111-000000000003')!;
        expect(notify).toMatchObject({ event: 'Update', stage: 'postcommit', mode: 'async', enabled: true, filteringAttributes: ['ownerid'] });
        expect(notify.details).toMatchObject({ asyncAutoDelete: true, runAsUser: '77777777-7777-4777-8777-000000000001', stageCode: 40, modeCode: 1 });
        expect(notify.details.images).toEqual([{ name: 'Target', alias: 'Target', type: 'Both', attributes: [] }]);
    });

    it('maps custom API messages to Custom: events and unknown messages to Message:', async () => {
        const client = makeFakeClient(happyHandler());
        const { items } = await pluginStepsSource.run(makeCtx(client));
        const recalc = items.find((i) => i.id === '11111111-1111-4111-8111-000000000004')!;
        expect(recalc.event).toBe('Custom:contoso_RecalculateProject');
        expect(recalc.stage).toBe('mainoperation');
        const mail = items.find((i) => i.id === '11111111-1111-4111-8111-000000000009')!;
        expect(mail.event).toBe('Message:SendEmail');
        expect(mail.details.isHidden).toBe(false); // plain boolean `ishidden` is tolerated too
    });

    it('resolves service endpoints and webhooks with redacted URLs', async () => {
        const client = makeFakeClient(happyHandler());
        const { items } = await pluginStepsSource.run(makeCtx(client));
        expect(client.calls.filter((c) => c === SERVICE_ENDPOINTS_PATH)).toHaveLength(1);

        const webhook = items.find((i) => i.id === '11111111-1111-4111-8111-000000000005')!;
        expect(webhook).toMatchObject({ kind: 'plugin', event: 'Delete', stage: 'postcommit', mode: 'async' });
        expect(webhook.details.handlerType).toBe('webhook');
        expect(webhook.details.endpoint).toEqual({
            name: 'Contoso Webhook',
            contract: 8,
            contractLabel: 'Webhook',
            url: 'https://hooks.contoso.example/api/project?…',
            messageFormat: 'Text XML',
        });
        expect(webhook.details.pluginType).toBeUndefined();

        const bus = items.find((i) => i.id === '11111111-1111-4111-8111-000000000006')!;
        expect(bus.details.handlerType).toBe('serviceendpoint');
        expect(bus.details.endpoint).toMatchObject({ name: 'Contoso Service Bus Queue', contract: 2, contractLabel: 'Queue', url: 'sb://contoso.servicebus.windows.net/' });
        expect(JSON.stringify(items)).not.toContain('SECRET-KEY');
    });

    it('flags hidden system steps from the managed property and secondary-entity registrations', async () => {
        const client = makeFakeClient(happyHandler());
        const { items } = await pluginStepsSource.run(makeCtx(client));
        const hidden = items.find((i) => i.id === '11111111-1111-4111-8111-000000000007')!;
        expect(hidden.details).toMatchObject({ isHidden: true, isManaged: true, pluginType: 'Microsoft.Crm.Extensibility.InternalOperationPlugin' });
        expect(hidden.event).toBe('RetrieveMultiple');

        const guard = items.find((i) => i.id === '11111111-1111-4111-8111-000000000008')!;
        expect(guard).toMatchObject({ event: 'Update', stage: 'prevalidation', order: 5 });
        expect(guard.details).toMatchObject({ role: 'secondary', primaryEntity: 'contoso_task', secondaryEntity: 'contoso_project', deployment: 'Microsoft Dynamics 365 Client for Outlook Only' });
    });

    it('never queries secure configuration and strips configuration from raw', async () => {
        const client = makeFakeClient(happyHandler());
        const result = await pluginStepsSource.run(makeCtx(client));
        expect(client.calls.some((c) => /secureconfigs?\b|sdkmessageprocessingstepsecureconfig\?/i.test(c))).toBe(false);
        const raw = result.raw as { steps: Row[]; images: Row[]; serviceEndpoints: Row[] };
        expect(raw.steps).toHaveLength(STEPS.length);
        expect(raw.steps.every((s) => !('configuration' in s))).toBe(true);
        expect(raw.steps[0]._sdkmessageprocessingstepsecureconfigid_value).toBeNull();
        expect(JSON.stringify(raw)).not.toContain('do-not-leak');
        expect(JSON.stringify(raw)).not.toContain('SECRET-KEY');
        expect(raw.images).toHaveLength(IMAGES.length);
    });

    it('sorts items deterministically by event, stage, rank and name', async () => {
        const client = makeFakeClient(happyHandler([...STEPS].reverse()));
        const { items } = await pluginStepsSource.run(makeCtx(client));
        expect(items.map((i) => i.id)).toEqual([
            '11111111-1111-4111-8111-000000000001', // Create / preoperation
            '11111111-1111-4111-8111-000000000006', // Create / postcommit (service bus)
            '11111111-1111-4111-8111-000000000008', // Update / prevalidation
            '11111111-1111-4111-8111-000000000002', // Update / postoperation
            '11111111-1111-4111-8111-000000000003', // Update / postcommit
            '11111111-1111-4111-8111-000000000005', // Delete / postcommit (webhook)
            '11111111-1111-4111-8111-000000000007', // RetrieveMultiple
            '11111111-1111-4111-8111-000000000004', // Custom:contoso_RecalculateProject
            '11111111-1111-4111-8111-000000000009', // Message:SendEmail
        ]);
    });

    it('chunks image lookups by 20 step ids and skips them when there are no steps', async () => {
        const many: Row[] = Array.from({ length: 45 }, (_, n) => ({
            ...STEPS[0],
            sdkmessageprocessingstepid: `11111111-1111-4111-8111-${String(n + 100).padStart(12, '0')}`,
            name: `Step ${n}`,
        }));
        const client = makeFakeClient(happyHandler(many));
        const { items } = await pluginStepsSource.run(makeCtx(client));
        expect(items).toHaveLength(45);
        const imageCalls = client.calls.filter((c) => c.startsWith('sdkmessageprocessingstepimages?'));
        expect(imageCalls).toHaveLength(3);
        expect(imageCalls[0]).toBe(imagesPath(many.slice(0, 20).map((s) => String(s.sdkmessageprocessingstepid))));
        expect(imageCalls[0]).toMatch(/\$filter=_sdkmessageprocessingstepid_value eq 11111111-1111-4111-8111-000000000100 or /);
        // No service endpoint lookup when every step has a plugin type.
        expect(client.calls).not.toContain(SERVICE_ENDPOINTS_PATH);

        const empty = makeFakeClient(happyHandler([]));
        const none = await pluginStepsSource.run(makeCtx(empty));
        expect(none.items).toEqual([]);
        expect(empty.calls).toHaveLength(1);
    });

    it('falls back to sdkmessagefilters when the navigation filter is rejected with 400', async () => {
        const filters: Row[] = Array.from({ length: 25 }, (_, n) => ({
            sdkmessagefilterid: `33333333-3333-4333-8333-${String(n + 1).padStart(12, '0')}`,
            primaryobjecttypecode: n === 5 ? 'contoso_task' : 'contoso_project',
            secondaryobjecttypecode: n === 5 ? 'contoso_project' : 'none',
        }));
        // Steps come back without the expanded filter; the source re-attaches it from hop 1.
        const stepsByFilter = STEPS.map((s) => {
            const { sdkmessagefilterid, ...rest } = s;
            return { ...rest, _sdkmessagefilterid_value: (sdkmessagefilterid as Row).sdkmessagefilterid };
        });
        const client = makeFakeClient((p) => {
            if (p.startsWith('sdkmessageprocessingsteps?') && p.includes('sdkmessagefilterid/primaryobjecttypecode')) {
                throw new DataverseRequestError("0x80060888: Could not find a property named 'primaryobjecttypecode'", 'badrequest', p);
            }
            if (p.startsWith('sdkmessagefilters?')) return filters;
            if (p.startsWith('sdkmessageprocessingsteps?')) return stepsByFilter.filter((s) => p.includes(String(s._sdkmessagefilterid_value)));
            return happyHandler()(p);
        });
        const result = await pluginStepsSource.run(makeCtx(client));

        expect(client.calls[1]).toBe(filtersPath('contoso_project'));
        expect(client.calls[1]).toBe("sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode,secondaryobjecttypecode&$filter=primaryobjecttypecode eq 'contoso_project' or secondaryobjecttypecode eq 'contoso_project'");
        const stepCalls = client.calls.filter((c) => c.startsWith('sdkmessageprocessingsteps?') && c.includes('_sdkmessagefilterid_value'));
        expect(stepCalls).toHaveLength(2); // 25 filters → chunks of 20 + 5
        expect(stepCalls[0]).toBe(stepsByFilterPath(filters.slice(0, 20).map((f) => String(f.sdkmessagefilterid))));
        expect(stepCalls[0]).toContain("$filter=_sdkmessagefilterid_value eq 33333333-3333-4333-8333-000000000001 or _sdkmessagefilterid_value eq 33333333-3333-4333-8333-000000000002");
        expect(stepCalls[0]).not.toContain("eq '3333"); // GUIDs unquoted
        expect(stepCalls[0]).not.toContain('sdkmessagefilterid($select'); // no filter expansion in the fallback
        expect(stepCalls[0]).toContain('$expand=sdkmessageid($select=name),plugintypeid(');

        expect(result.warnings).toHaveLength(1);
        expect(result.warnings?.[0]).toMatch(/sdkmessagefilterid\/primaryobjecttypecode was rejected/);
        expect(result.items).toHaveLength(STEPS.length);
        const guard = result.items.find((i) => i.id === '11111111-1111-4111-8111-000000000008')!;
        expect(guard.details).toMatchObject({ role: 'secondary', primaryEntity: 'contoso_task', secondaryEntity: 'contoso_project' });
        const numbering = result.items.find((i) => i.id === '11111111-1111-4111-8111-000000000001')!;
        expect(numbering.details).toMatchObject({ role: 'primary', primaryEntity: 'contoso_project' });
    });

    it('propagates permission errors instead of falling back', async () => {
        const client = makeFakeClient((p) => {
            throw new DataverseRequestError('0x80040220: Principal user is missing prvReadSdkMessageProcessingStep privilege', 'permission', p);
        });
        await expect(pluginStepsSource.run(makeCtx(client))).rejects.toMatchObject({ name: 'DataverseRequestError', kind: 'permission' });
        expect(client.calls).toHaveLength(1);
    });
});

/**
 * Regression: a plugin step registered on a classic Action's message used to map to `Custom:<name>`
 * or `Message:<name>` depending on whether the `processes` query (which discovers Action unique
 * names) happened to finish before the steps query. The `after: ['customApis', 'processes']`
 * declaration only helps if buildLogicMap really awaits it, so this drives the orchestrator with a
 * deliberately slow `workflows` route.
 */
describe('plugin steps on a classic Action message', () => {
    const STEP_ID = '22222222-2222-4222-8222-000000000001';
    const ACTION_STEP: Row = {
        sdkmessageprocessingstepid: STEP_ID,
        name: 'Contoso.Plugins.OnApprove: contoso_Approve of contoso_project',
        stage: 30,
        mode: 0,
        rank: 1,
        statecode: 0,
        statuscode: 1,
        filteringattributes: null,
        configuration: null,
        ishidden: { Value: false },
        ismanaged: false,
        sdkmessageid: { name: 'contoso_Approve' },
        sdkmessagefilterid: { primaryobjecttypecode: 'contoso_project', secondaryobjecttypecode: 'none' },
        plugintypeid: { typename: 'Contoso.Plugins.OnApprove', assemblyname: 'Contoso.Plugins' },
    };
    const ACTION_WORKFLOW: Row = {
        workflowid: '33333333-3333-4333-8333-000000000001',
        name: 'Approve project',
        category: 3,
        type: 1,
        primaryentity: 'contoso_project',
        statecode: 1,
        mode: 0,
        uniquename: 'contoso_Approve',
    };
    const ENTITY_METADATA: Row = {
        LogicalName: 'contoso_project',
        SchemaName: 'contoso_Project',
        EntitySetName: 'contoso_projects',
        MetadataId: TABLE.metadataId,
        DisplayName: { UserLocalizedLabel: { Label: 'Project' } },
        OwnershipType: 'UserOwned',
        IsCustomEntity: true,
    };

    /** Runs the whole orchestrator with the `workflows` queries delayed by `delayMs`. */
    async function buildWithSlowProcesses(delayMs: number) {
        const base = makeRoutedClient([
            { match: /EntityDefinitions\(LogicalName='contoso_project'\)$/, response: ENTITY_METADATA },
            { match: 'sdkmessageprocessingsteps?', response: [ACTION_STEP] },
            { match: "primaryentity eq 'contoso_project'", response: [ACTION_WORKFLOW] },
        ]);
        const client: DataverseClient = {
            ...base,
            query: async (path, opts) => {
                if (path.startsWith('workflows')) await new Promise((resolve) => setTimeout(resolve, delayMs));
                return base.query(path, opts);
            },
        };
        return buildLogicMap(client, 'contoso_project');
    }

    it('maps the step to Custom:<uniquename> even when the processes query is the slowest one', async () => {
        const map = await buildWithSlowProcesses(30);
        expect(map.items.find((i) => i.id === STEP_ID)?.event).toBe('Custom:contoso_Approve');
        // The Action item and the step must land on the same event bucket.
        expect(map.items.find((i) => i.kind === 'action')?.event).toBe('Custom:contoso_Approve');
    });

    it('produces the same event when the processes query is fast', async () => {
        const map = await buildWithSlowProcesses(0);
        expect(map.items.find((i) => i.id === STEP_ID)?.event).toBe('Custom:contoso_Approve');
    });
});

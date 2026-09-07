/**
 * Plugin steps (`sdkmessageprocessingstep`) registered on the table: plugins, Azure service
 * endpoints (Service Bus / Event Hub / Event Grid) and webhooks.
 *
 * Dataverse semantics used here:
 *  - A step is bound to an SDK message through an `sdkmessagefilter` row naming the primary (and,
 *    for a few messages, the secondary) entity. Filtering on the expanded navigation property is
 *    tried first (docs/verified.md #2); on a 400 we fall back to `sdkmessagefilters` → step ids.
 *  - `stage` 10/20/30/40 map to the pipeline stages; `mode` 1 on stage 40 runs after commit
 *    through the async service (`postcommit`).
 *  - `eventhandler` is a polymorphic lookup: a plugin type (expanded through `plugintypeid`) or a
 *    service endpoint. Steps without a plugin type are matched against `serviceendpoints`.
 *  - Secure configuration lives in `sdkmessageprocessingstepsecureconfig` and is NEVER read; we
 *    only report whether the step has one. `ishidden` is a managed property (`{ Value }`).
 */
import { chunk, classifyError, errorMessage, odataString, type Row } from '../data/client';
import { IMAGE_TYPE_LABEL, STAGE_FOR_STEP, STEP_DEPLOYMENT_LABEL, STEP_MODE, STEP_STAGE_LABEL, STEP_STATE, messageToEvent } from '../domain/codes';
import { STAGE_ORDER, compareEvents, compareItems, type LogicItem } from '../domain/model';
import type { Source, SourceContext, SourceResult } from './types';
import { boolValue, redactUrl, splitAttributeList, str } from './types';

const STEP_SELECT =
    'sdkmessageprocessingstepid,name,stage,mode,rank,filteringattributes,statecode,statuscode,configuration,supporteddeployment,asyncautodelete,description,ismanaged,ishidden,_impersonatinguserid_value,_sdkmessageprocessingstepsecureconfigid_value,_eventhandler_value,_plugintypeid_value';
const FILTER_EXPAND = 'sdkmessagefilterid($select=primaryobjecttypecode,secondaryobjecttypecode)';
const HANDLER_EXPAND = 'sdkmessageid($select=name),plugintypeid($select=typename,assemblyname,friendlyname,version,_pluginassemblyid_value)';
const IMAGE_SELECT = 'name,entityalias,imagetype,attributes,_sdkmessageprocessingstepid_value';
export const SERVICE_ENDPOINTS_PATH = 'serviceendpoints?$select=serviceendpointid,name,contract,url,messageformat';

/** Ids per `$filter=... or ...` chunk (keeps the URL well under the length limit). */
const ID_CHUNK = 20;

// serviceendpoint.contract
export const SERVICE_ENDPOINT_CONTRACT_LABEL: Record<number, string> = {
    1: 'OneWay',
    2: 'Queue',
    3: 'Rest',
    4: 'TwoWay',
    5: 'Topic',
    6: 'Queue (Persistent)',
    7: 'Event Hub',
    8: 'Webhook',
    9: 'Event Grid',
};
const WEBHOOK_CONTRACT = 8;
// serviceendpoint.messageformat
const MESSAGE_FORMAT_LABEL: Record<number, string> = { 1: 'Binary XML', 2: 'JSON', 3: 'Text XML' };

export type HandlerType = 'plugin' | 'serviceendpoint' | 'webhook';

export interface StepImageDetails {
    name: string;
    alias: string;
    type: 'Pre' | 'Post' | 'Both' | string;
    /** Sorted, lower-cased attribute list; empty means "all attributes". */
    attributes: string[];
}

export interface EndpointDetails {
    name?: string;
    contract?: number;
    contractLabel?: string;
    /** Query string redacted (webhook URLs often carry keys). */
    url?: string;
    messageFormat?: string;
}

// ---------------------------------------------------------------------------
// Query builders (exported for tests)
// ---------------------------------------------------------------------------

/** §5.8 primary query: filter on the expanded `sdkmessagefilterid` navigation. */
export function primaryStepsPath(table: string): string {
    const t = odataString(table);
    return `sdkmessageprocessingsteps?$select=${STEP_SELECT}&$expand=${FILTER_EXPAND},${HANDLER_EXPAND}&$filter=sdkmessagefilterid/primaryobjecttypecode eq ${t} or sdkmessagefilterid/secondaryobjecttypecode eq ${t}`;
}

/** Fallback hop 1: the message filters that name the table. */
export function filtersPath(table: string): string {
    const t = odataString(table);
    return `sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode,secondaryobjecttypecode&$filter=primaryobjecttypecode eq ${t} or secondaryobjecttypecode eq ${t}`;
}

/** Fallback hop 2: steps by filter id (GUIDs unquoted); `_sdkmessagefilterid_value` is added so rows can be joined back to their filter. */
export function stepsByFilterPath(filterIds: readonly string[]): string {
    const filter = filterIds.map((id) => `_sdkmessagefilterid_value eq ${id}`).join(' or ');
    return `sdkmessageprocessingsteps?$select=${STEP_SELECT},_sdkmessagefilterid_value&$expand=${HANDLER_EXPAND}&$filter=${filter}`;
}

export function imagesPath(stepIds: readonly string[]): string {
    const filter = stepIds.map((id) => `_sdkmessageprocessingstepid_value eq ${id}`).join(' or ');
    return `sdkmessageprocessingstepimages?$select=${IMAGE_SELECT}&$filter=${filter}`;
}

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function row(value: unknown): Row | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : undefined;
}

function guid(value: unknown): string | undefined {
    const s = str(value);
    return s ? s.replace(/[{}]/g, '').trim().toLowerCase() : undefined;
}

/** Drop `undefined` values so every item carries the same key set and JSON output is stable. */
function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
    return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface LoadedSteps {
    rows: Row[];
    warnings: string[];
}

/** Primary query with the two-hop fallback (docs/verified.md #2). */
async function loadSteps(ctx: SourceContext): Promise<LoadedSteps> {
    const table = ctx.table.logicalName;
    const opts = { signal: ctx.signal };
    try {
        return { rows: await ctx.client.query(primaryStepsPath(table), opts), warnings: [] };
    } catch (err) {
        if (classifyError(err) !== 'badrequest') throw err;
        ctx.logger.warn(`pluginSteps: navigation filter rejected (${errorMessage(err)}); falling back to sdkmessagefilters`);
    }

    const filters = await ctx.client.query(filtersPath(table), opts);
    const filterById = new Map<string, Row>();
    for (const f of filters) {
        const id = guid(f.sdkmessagefilterid);
        if (id) filterById.set(id, f);
    }
    const ids = [...filterById.keys()].sort();
    const pages = await Promise.all(chunk(ids, ID_CHUNK).map((part) => ctx.client.query(stepsByFilterPath(part), opts)));
    // Re-attach the filter row so the mapping below sees the same shape as the expanded query.
    const rows: Row[] = [];
    for (const page of pages) {
        for (const step of page) {
            const filterId = guid(step._sdkmessagefilterid_value);
            const filter = filterId ? filterById.get(filterId) : undefined;
            rows.push(filter ? { ...step, sdkmessagefilterid: filter } : step);
        }
    }
    return { rows, warnings: [`Plugin steps: filtering on sdkmessagefilterid/primaryobjecttypecode was rejected; used ${ids.length} message filter(s) in ${pages.length} request(s) instead.`] };
}

async function loadImages(ctx: SourceContext, stepIds: readonly string[]): Promise<Row[]> {
    if (stepIds.length === 0) return [];
    const pages = await Promise.all(chunk(stepIds, ID_CHUNK).map((part) => ctx.client.query(imagesPath(part), { signal: ctx.signal })));
    return pages.flat();
}

/** Service endpoints keyed by id (one call; the client caches it for the run). */
async function loadEndpoints(ctx: SourceContext): Promise<Map<string, Row>> {
    const rows = await ctx.client.query(SERVICE_ENDPOINTS_PATH, { signal: ctx.signal });
    const byId = new Map<string, Row>();
    for (const r of rows) {
        const id = guid(r.serviceendpointid);
        if (id) byId.set(id, r);
    }
    return byId;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toImage(img: Row): StepImageDetails {
    const type = num(img.imagetype);
    return {
        name: str(img.name) ?? str(img.entityalias) ?? '',
        alias: str(img.entityalias) ?? '',
        type: type !== undefined ? (IMAGE_TYPE_LABEL[type] ?? String(type)) : '',
        attributes: splitAttributeList(img.attributes),
    };
}

function toEndpoint(endpoint: Row): EndpointDetails {
    const contract = num(endpoint.contract);
    const format = num(endpoint.messageformat);
    return compact({
        name: str(endpoint.name),
        contract,
        contractLabel: contract !== undefined ? (SERVICE_ENDPOINT_CONTRACT_LABEL[contract] ?? String(contract)) : undefined,
        url: redactUrl(str(endpoint.url)),
        messageFormat: format !== undefined ? (MESSAGE_FORMAT_LABEL[format] ?? String(format)) : undefined,
    }) as EndpointDetails;
}

function toItem(step: Row, images: readonly Row[], endpoints: ReadonlyMap<string, Row>, ctx: SourceContext): LogicItem | undefined {
    const id = guid(step.sdkmessageprocessingstepid);
    if (!id) return undefined;

    const table = ctx.table.logicalName.toLowerCase();
    const filter = row(step.sdkmessagefilterid);
    const primaryEntity = str(filter?.primaryobjecttypecode)?.toLowerCase();
    const secondaryEntity = str(filter?.secondaryobjecttypecode)?.toLowerCase();
    const role: 'primary' | 'secondary' = primaryEntity !== table && secondaryEntity === table ? 'secondary' : 'primary';

    const message = str(row(step.sdkmessageid)?.name) ?? '';
    const pluginType = row(step.plugintypeid);
    const handlerId = guid(step._eventhandler_value);
    // No plugin type + an event handler id → a service endpoint / webhook registration.
    const endpoint = !pluginType && handlerId ? endpoints.get(handlerId) : undefined;
    const handlerType: HandlerType = endpoint ? (num(endpoint.contract) === WEBHOOK_CONTRACT ? 'webhook' : 'serviceendpoint') : 'plugin';

    const stageCode = num(step.stage) ?? 40;
    const modeCode = num(step.mode) ?? STEP_MODE.Sync;
    const deployment = num(step.supporteddeployment);
    const typeName = str(pluginType?.typename);
    const name = str(step.name) ?? `${typeName ?? str(endpoint?.name) ?? 'Step'}: ${message} of ${primaryEntity ?? table}`;

    const details = compact({
        message,
        handlerType,
        pluginType: typeName,
        assembly: str(pluginType?.assemblyname),
        assemblyVersion: str(pluginType?.version),
        friendlyName: str(pluginType?.friendlyname),
        endpoint: endpoint ? toEndpoint(endpoint) : undefined,
        unsecureConfig: str(step.configuration),
        hasSecureConfig: !!guid(step._sdkmessageprocessingstepsecureconfigid_value),
        images: images.map(toImage).sort((a, b) => a.name.localeCompare(b.name) || a.alias.localeCompare(b.alias)),
        deployment: deployment !== undefined ? (STEP_DEPLOYMENT_LABEL[deployment] ?? String(deployment)) : undefined,
        asyncAutoDelete: boolValue(step.asyncautodelete),
        runAsUser: guid(step._impersonatinguserid_value),
        primaryEntity,
        secondaryEntity: secondaryEntity && secondaryEntity !== 'none' ? secondaryEntity : undefined,
        role,
        isHidden: boolValue(step.ishidden),
        isManaged: boolValue(step.ismanaged),
        description: str(step.description),
        stageCode,
        stageLabel: STEP_STAGE_LABEL[stageCode],
        modeCode,
        statusCode: num(step.statuscode),
    });

    return {
        id,
        kind: 'plugin',
        name,
        event: messageToEvent(message, ctx.customApiNames),
        stage: STAGE_FOR_STEP(stageCode, modeCode),
        order: num(step.rank),
        enabled: num(step.statecode) === STEP_STATE.Enabled,
        mode: stageCode === 40 && modeCode === STEP_MODE.Async ? 'async' : 'sync',
        filteringAttributes: splitAttributeList(step.filteringattributes),
        confidence: 'exact',
        details,
        source: { table: 'sdkmessageprocessingstep', id },
    };
}

/** Raw copy of a step row without the (possibly sensitive) unsecure configuration. */
function redactStep(step: Row): Row {
    const { configuration: _configuration, ...rest } = step;
    return rest;
}

function redactEndpoint(endpoint: Row): Row {
    return { ...endpoint, url: redactUrl(str(endpoint.url)) ?? null };
}

function compareStepItems(a: LogicItem, b: LogicItem): number {
    return compareEvents(a.event, b.event) || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || compareItems(a, b);
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export const pluginStepsSource: Source = {
    name: 'pluginSteps',
    // ctx.customApiNames decides whether a step's message becomes `Custom:<name>` or
    // `Message:<name>`, and it is filled by TWO sources: `customApis` (Custom API messages) and
    // `processes` (classic Action unique names, workflow category 3). Both must have completed
    // before the steps are mapped, otherwise a step registered on an Action lands on a different
    // event depending on which query returned first — the map differed between runs.
    after: ['customApis', 'processes'],
    async run(ctx: SourceContext): Promise<SourceResult> {
        const { rows, warnings } = await loadSteps(ctx);
        const stepIds = [...new Set(rows.map((r) => guid(r.sdkmessageprocessingstepid)).filter((id): id is string => !!id))].sort();

        const needsEndpoints = rows.some((r) => !row(r.plugintypeid) && guid(r._eventhandler_value));
        const [imageRows, endpoints] = await Promise.all([loadImages(ctx, stepIds), needsEndpoints ? loadEndpoints(ctx) : Promise.resolve(new Map<string, Row>())]);

        const imagesByStep = new Map<string, Row[]>();
        for (const img of imageRows) {
            const stepId = guid(img._sdkmessageprocessingstepid_value);
            if (!stepId) continue;
            (imagesByStep.get(stepId) ?? imagesByStep.set(stepId, []).get(stepId)!).push(img);
        }

        const items: LogicItem[] = [];
        const seen = new Set<string>();
        for (const step of rows) {
            const item = toItem(step, imagesByStep.get(guid(step.sdkmessageprocessingstepid) ?? '') ?? [], endpoints, ctx);
            if (!item || seen.has(item.id)) continue;
            seen.add(item.id);
            items.push(item);
        }
        items.sort(compareStepItems);

        const usedEndpoints = [...endpoints.values()].map(redactEndpoint).sort((a, b) => String(a.serviceendpointid).localeCompare(String(b.serviceendpointid)));
        return {
            items,
            warnings: warnings.length > 0 ? warnings : undefined,
            raw: { steps: rows.map(redactStep), images: imageRows, serviceEndpoints: usedEndpoints },
        };
    },
};

/**
 * classify — pure assembly of a LogicMap from source results.
 *
 * Responsibilities (see design guide §6 and docs/verified.md #10):
 *  1. Collect `LogicItem[]` from all sources (sources already emit one item per event; `groupId`
 *     ties multi-event registrations; this step only de-duplicates ids).
 *  2. Event synonyms (`expandSynonyms`): Update items filtered on `statecode` are additionally shown
 *     under `SetState`, on `ownerid` under `Assign`; Update items without filtering attributes are
 *     flagged `details.firesOnAnyUpdate = true`.
 *  3. Pipeline (`buildPipeline`): `pipeline[event][stage]` sorted the way Dataverse runs them —
 *     sync stages by rank (plugins before real-time workflows of equal rank, real-time workflows
 *     default to rank 1), `postcommit` grouped async plugins → background workflows → flows → rest.
 *  4. Column index (`indexColumns`): `triggers` / `touchedBy` per column.
 *  5. Smells (`detectSmells`): badges with a one-line message and an explanation.
 *  6. Business rules → forms and dependency classification against produced ids.
 *
 * `rederive(map, items)` recomputes everything derived from `items` and is idempotent; `filterMap`
 * uses it after dropping items. Nothing here touches the DOM or Dataverse.
 *
 * Everything on the map is ordered deterministically: sources are merged in `ALL_SOURCES` order and
 * `items` is sorted with `compareItemsForDisplay` (event → stage → execution order), so two runs of
 * the same table produce identical maps no matter which source finished first.
 *
 * Detail keys read from items (emitted by the sources, guide §5):
 *  - `formId` (businessrule / formscript / pcf): the form a rule or handler belongs to.
 *  - `scope` (businessrule): `form` | `allforms` | `entity` as written by the `processes` source;
 *    only `entity` rules are evaluated server-side as well (they also carry `serverSide: true` on
 *    their Create/Update items).
 *  - `child`, `parent`, `behaviour`, `action`, `chainDepth` (cascade): relationship facts.
 *  - `filterExpression` (flow): the Dataverse trigger's OData filter.
 *  - `isHidden` (plugin): Microsoft/system steps hidden by default (used by filterMap).
 *  - `synonymOf` / `firesOnAnyUpdate` are written by this module.
 */
import type {
    BuildOptions,
    DependencyInfo,
    EventName,
    FormInfo,
    LogicItem,
    LogicKind,
    LogicMap,
    LogicMapStats,
    OrgSettings,
    Smell,
    SmellCode,
    SourceError,
    SourceName,
    Stage,
    TableFacts,
    WellKnownEvent,
} from '../domain/model';
import { ALL_SOURCES, STAGE_LABEL, STAGE_ORDER, compareEvents, compareItems, createEmptyMap, emptyPipelineRow } from '../domain/model';
import type { SourceResult } from '../sources/types';

export interface ClassifyInput {
    table: TableFacts;
    org: OrgSettings;
    environment: { name: string; url: string };
    generatedAt: string;
    results: Array<{ name: SourceName; result: SourceResult }>;
    sourceErrors: SourceError[];
    options: BuildOptions;
    stats: LogicMapStats;
}

export interface RederiveOptions {
    /** Threshold for the `too-many-sync` smell. Default 5. */
    maxSyncItems?: number;
}

const DEFAULT_MAX_SYNC_ITEMS = 5;
const MAX_RANK = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------
// Small predicates shared by the pipeline and the smells
// ---------------------------------------------------------------------------

/** Real-time workflows are registered as sync steps internally (rank 1 unless changed). */
function isRealtimeWorkflow(item: LogicItem): boolean {
    return item.kind === 'workflow' && item.mode === 'realtime';
}

/** A plugin step that runs inside the transaction (any stage but `postcommit`, not async). */
function isSyncPlugin(item: LogicItem): boolean {
    return item.kind === 'plugin' && item.stage !== 'postcommit' && item.mode !== 'async';
}

/** Items that block the save: sync plugin steps and real-time workflows. */
function isSyncMode(item: LogicItem): boolean {
    return item.mode === 'sync' || item.mode === 'realtime';
}

function hasNoFilters(item: LogicItem): boolean {
    return !item.filteringAttributes || item.filteringAttributes.length === 0;
}

function isSynonym(item: LogicItem): boolean {
    return typeof item.details.synonymOf === 'string';
}

/** The registration an item belongs to (multi-event registrations share `groupId`). */
function groupKey(item: LogicItem): string {
    return item.groupId ?? item.id;
}

/** GUID comparison key: lower-case, no braces. */
function normalizeId(id: string): string {
    return id.replace(/[{}]/g, '').toLowerCase();
}

function stringDetail(item: LogicItem, key: string): string | undefined {
    const v = item.details[key];
    return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function sortedUnique(values: Iterable<string>): string[] {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const k = key(item);
        const bucket = groups.get(k);
        if (bucket) bucket.push(item);
        else groups.set(k, [item]);
    }
    return groups;
}

function eventStageKey(item: LogicItem): string {
    return `${item.event}:${item.stage}`;
}

// ---------------------------------------------------------------------------
// 2. Event synonyms
// ---------------------------------------------------------------------------

interface Synonym {
    column: string;
    event: WellKnownEvent;
    suffix: string;
}

/** Update filtering attributes that make a step fire on another message too. */
const SYNONYMS: readonly Synonym[] = [
    // SetState is executed as an Update of statecode/statuscode on modern Dataverse.
    { column: 'statecode', event: 'SetState', suffix: 'setstate' },
    // Assign is executed as an Update of ownerid.
    { column: 'ownerid', event: 'Assign', suffix: 'assign' },
];

/** Kinds for which "Update without filtering attributes" means "fires on any column". */
const FIRES_ON_ANY_UPDATE_KINDS: ReadonlySet<LogicItem['kind']> = new Set(['plugin', 'workflow', 'flow']);

/**
 * Add synonym items for Update registrations and flag unfiltered Update items.
 *
 * - Update + `statecode` → a `SetState` twin (`${id}:setstate`), Update + `ownerid` → an `Assign`
 *   twin (`${id}:assign`), each sharing the original's group (`groupId` or id) with
 *   `details.synonymOf`. No twin is added when the group already covers that event (e.g. a
 *   workflow registered on Update and SetState explicitly) or when its id is in `excludeIds`
 *   (used by `rederive` so a twin dropped by a view filter is not resurrected).
 * - Update items of kind plugin/workflow/flow with no filtering attributes get
 *   `details.firesOnAnyUpdate = true`.
 *
 * Input objects are never mutated; unchanged items are returned as-is.
 */
export function expandSynonyms(items: LogicItem[], excludeIds?: ReadonlySet<string>): LogicItem[] {
    const eventsByGroup = new Map<string, Set<EventName>>();
    for (const item of items) {
        const key = groupKey(item);
        const events = eventsByGroup.get(key);
        if (events) events.add(item.event);
        else eventsByGroup.set(key, new Set([item.event]));
    }

    const out: LogicItem[] = [];
    for (const item of items) {
        if (item.event !== 'Update') {
            out.push(item);
            continue;
        }
        const filters = item.filteringAttributes ?? [];
        let current = item;
        if (filters.length === 0 && FIRES_ON_ANY_UPDATE_KINDS.has(item.kind) && item.details.firesOnAnyUpdate !== true) {
            current = { ...item, details: { ...item.details, firesOnAnyUpdate: true } };
        }
        out.push(current);

        const groupEvents = eventsByGroup.get(groupKey(item));
        for (const synonym of SYNONYMS) {
            if (!filters.includes(synonym.column)) continue;
            const id = `${item.id}:${synonym.suffix}`;
            if (excludeIds?.has(id) || groupEvents?.has(synonym.event)) continue;
            groupEvents?.add(synonym.event);
            const { smells: _smells, ...base } = current;
            out.push({
                ...base,
                id,
                event: synonym.event,
                groupId: item.groupId ?? item.id,
                details: { ...current.details, synonymOf: item.id },
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// 3. Pipeline
// ---------------------------------------------------------------------------

/** Rank used for ordering inside a synchronous stage (real-time workflows default to rank 1). */
function effectiveRank(item: LogicItem): number {
    if (isRealtimeWorkflow(item)) return item.order ?? 1;
    return item.order ?? MAX_RANK;
}

/** Ties at equal rank: plugins first, then real-time workflows, then anything else. */
function rankClass(item: LogicItem): number {
    if (item.kind === 'plugin') return 0;
    if (isRealtimeWorkflow(item)) return 1;
    return 2;
}

function compareSyncStage(a: LogicItem, b: LogicItem): number {
    const rank = effectiveRank(a) - effectiveRank(b);
    if (rank !== 0) return rank;
    const cls = rankClass(a) - rankClass(b);
    if (cls !== 0) return cls;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** After commit everything is effectively concurrent; group by kind for readability. */
function postcommitGroup(item: LogicItem): number {
    switch (item.kind) {
        case 'plugin':
            return 0;
        case 'workflow':
            return 1;
        case 'flow':
            return 2;
        default:
            return 3;
    }
}

function comparePostcommit(a: LogicItem, b: LogicItem): number {
    return postcommitGroup(a) - postcommitGroup(b) || compareItems(a, b);
}

function stageComparator(stage: Stage): (a: LogicItem, b: LogicItem) => number {
    return stage === 'postcommit' ? comparePostcommit : compareSyncStage;
}

const STAGE_INDEX: ReadonlyMap<Stage, number> = new Map(STAGE_ORDER.map((stage, i) => [stage, i]));

function stageIndex(stage: Stage): number {
    return STAGE_INDEX.get(stage) ?? STAGE_ORDER.length;
}

/**
 * Total order for the flat `items` list: the order Dataverse runs them (event in display order,
 * then stage, then the same comparator the matching pipeline cell uses), with the id as the final
 * tie-break. Sources finish in whatever order the network returns, so `items` is sorted with this
 * before anything is derived from it — otherwise the JSON export, the headless payload and the
 * smells that read the first item of a group would differ between two runs of the same table.
 */
export function compareItemsForDisplay(a: LogicItem, b: LogicItem): number {
    const event = compareEvents(a.event, b.event);
    if (event !== 0) return event;
    const stage = stageIndex(a.stage) - stageIndex(b.stage);
    if (stage !== 0) return stage;
    return stageComparator(a.stage)(a, b) || a.id.localeCompare(b.id);
}

/** A new array of `items` in deterministic execution order (`compareItemsForDisplay`). */
export function sortItems(items: readonly LogicItem[]): LogicItem[] {
    return [...items].sort(compareItemsForDisplay);
}

/** `pipeline[event][stage]` with events in display order and items in execution order. */
export function buildPipeline(items: LogicItem[]): LogicMap['pipeline'] {
    const rows: LogicMap['pipeline'] = {};
    for (const item of items) {
        const row = (rows[item.event] ??= emptyPipelineRow());
        row[item.stage].push(item);
    }
    const ordered: LogicMap['pipeline'] = {};
    const events = Object.keys(rows).sort((a, b) => compareEvents(a as EventName, b as EventName));
    for (const event of events) {
        const row = rows[event];
        for (const stage of STAGE_ORDER) row[stage] = [...row[stage]].sort(stageComparator(stage));
        ordered[event] = row;
    }
    return ordered;
}

export const NOTE_AFTER_COMMIT = 'After commit — order not guaranteed';
export const NOTE_SAME_RANK = 'Same rank — order between plugins and real-time workflows is not guaranteed';

/**
 * Caveat for a pipeline cell (`pipeline[event]`, or the cell's items directly), or undefined when
 * the displayed order is the real execution order.
 */
export function stageOrderNote(row: Record<Stage, LogicItem[]> | LogicItem[], stage: Stage): string | undefined {
    const items = Array.isArray(row) ? row : row[stage];
    if (stage === 'postcommit') return items.length >= 2 ? NOTE_AFTER_COMMIT : undefined;
    const pluginRanks = new Set(items.filter(isSyncPlugin).map(effectiveRank));
    const shared = items.some((i) => isRealtimeWorkflow(i) && pluginRanks.has(effectiveRank(i)));
    return shared ? NOTE_SAME_RANK : undefined;
}

// ---------------------------------------------------------------------------
// 4. Column index
// ---------------------------------------------------------------------------

/** Rebuild `triggers` / `touchedBy` for the columns already on the map (unknown columns are ignored). */
export function indexColumns(map: LogicMap, items: LogicItem[]): LogicMap['columns'] {
    const triggers = new Map<string, string[]>();
    const touched = new Map<string, string[]>();
    for (const item of items) {
        for (const c of item.filteringAttributes ?? []) (triggers.get(c) ?? triggers.set(c, []).get(c)!).push(item.id);
        for (const c of item.touchesColumns ?? []) (touched.get(c) ?? touched.set(c, []).get(c)!).push(item.id);
    }
    const columns: LogicMap['columns'] = {};
    for (const name of Object.keys(map.columns).sort((a, b) => a.localeCompare(b))) {
        columns[name] = { ...map.columns[name], triggers: sortedUnique(triggers.get(name) ?? []), touchedBy: sortedUnique(touched.get(name) ?? []) };
    }
    return columns;
}

// ---------------------------------------------------------------------------
// 5. Smells
// ---------------------------------------------------------------------------

function smellId(code: SmellCode, key: string): string {
    return `smell:${code}:${key}`;
}

function makeSmell(code: SmellCode, key: string, severity: Smell['severity'], message: string, explanation: string, itemIds: Iterable<string>, where?: { event: EventName; stage: Stage }): Smell {
    return { id: smellId(code, key), code, severity, message, explanation, itemIds: sortedUnique(itemIds), ...(where ?? {}) };
}

function compareSmells(a: Smell, b: Smell): number {
    return a.code.localeCompare(b.code) || a.id.localeCompare(b.id);
}

const FILTERABLE_KINDS: ReadonlySet<LogicItem['kind']> = new Set(['plugin', 'workflow', 'flow']);

/** Sync plugin steps / real-time workflows / flows registered on Update with no filtering attributes. */
function smellUpdateNoFilter(items: LogicItem[]): Smell[] {
    return items
        .filter((i) => i.event === 'Update' && FILTERABLE_KINDS.has(i.kind) && isSyncMode(i) && hasNoFilters(i))
        .map((i) =>
            makeSmell(
                'update-no-filter',
                i.id,
                'warning',
                `${i.name} runs on every Update (no filtering attributes)`,
                'Synchronous logic without filtering attributes executes on every update of every column, adding latency to each save and firing for unrelated changes. Register filtering attributes so it runs only when relevant columns change.',
                [i.id],
                { event: i.event, stage: i.stage },
            ),
        );
}

/** More than `max` items that block the save on one event/stage. */
function smellTooManySync(items: LogicItem[], max: number): Smell[] {
    const smells: Smell[] = [];
    for (const [, cell] of groupBy(items, eventStageKey)) {
        const sync = cell.filter(isSyncMode);
        if (sync.length <= max) continue;
        const { event, stage } = sync[0];
        smells.push(
            makeSmell(
                'too-many-sync',
                `${event}:${stage}`,
                'warning',
                `${sync.length} synchronous items on ${event} / ${STAGE_LABEL[stage]} (threshold ${max})`,
                'Every synchronous plugin step and real-time workflow runs inside the save transaction. Many of them on one message and stage add up to slow saves, lock contention and hard-to-reason-about interactions; consider consolidating or moving non-critical work to asynchronous steps or flows.',
                sync.map((i) => i.id),
                { event, stage },
            ),
        );
    }
    return smells;
}

/**
 * Kinds whose `enabled: false` describes a platform setting (auditing switched off, an alternate
 * key whose index is still pending/failed) rather than a leftover registration — not clutter.
 */
const NOT_CLUTTER_KINDS: ReadonlySet<LogicKind> = new Set<LogicKind>(['audit', 'key']);

/** Disabled steps / draft processes / disabled handlers that still exist. */
function smellDisabledClutter(items: LogicItem[]): Smell[] {
    return items
        .filter((i) => i.enabled === false && !isSynonym(i) && !NOT_CLUTTER_KINDS.has(i.kind))
        .map((i) =>
            makeSmell(
                'disabled-clutter',
                i.id,
                'info',
                `${i.name} is disabled`,
                'Disabled steps, draft processes and disabled handlers do not run but still show up in solutions, exports and the maker portal. They mislead readers about what the table does; remove them or document why they are kept.',
                [i.id],
                { event: i.event, stage: i.stage },
            ),
        );
}

/** A real-time workflow and a sync plugin on the same event/stage: ordering is rank-based and easy to get wrong. */
function smellRealtimePlusPlugin(items: LogicItem[]): Smell[] {
    const smells: Smell[] = [];
    for (const [, cell] of groupBy(items, eventStageKey)) {
        const plugins = cell.filter(isSyncPlugin);
        const workflows = cell.filter(isRealtimeWorkflow);
        if (plugins.length === 0 || workflows.length === 0) continue;
        const { event, stage } = cell[0];
        smells.push(
            makeSmell(
                'realtime-plus-plugin',
                `${event}:${stage}`,
                'info',
                `Real-time workflow and sync plugin both on ${event} / ${STAGE_LABEL[stage]}`,
                'Dataverse runs real-time workflows as sync steps interleaved with plugins by execution order (rank 1 unless changed). When both exist on the same message and stage the effective order depends on ranks that are set in two different designers, so it is easy to break. Prefer one mechanism per message/stage or make the ranks explicit.',
                [...plugins, ...workflows].map((i) => i.id),
                { event, stage },
            ),
        );
    }
    return smells;
}

/** Flows triggered on Update with neither filtering attributes nor a filter expression. */
function smellFlowUpdateUnfiltered(items: LogicItem[]): Smell[] {
    return items
        .filter((i) => i.kind === 'flow' && i.event === 'Update' && hasNoFilters(i) && stringDetail(i, 'filterExpression') === undefined)
        .map((i) =>
            makeSmell(
                'flow-update-unfiltered',
                i.id,
                'warning',
                `Flow ${i.name} triggers on every Update (no columns, no filter expression)`,
                'A Dataverse "row is modified" trigger without "Select columns" or a filter expression starts a run for every update of every column, burning flow runs and API capacity and often looping on its own updates. Restrict the trigger to the relevant columns or rows.',
                [i.id],
                { event: i.event, stage: i.stage },
            ),
        );
}

/** A cascade item that deletes child rows (`Delete: Cascade` on a 1:N where this table is the parent). */
function isOutboundCascadeDelete(item: LogicItem): boolean {
    if (item.kind !== 'cascade' || stringDetail(item, 'child') === undefined) return false;
    const action = stringDetail(item, 'action');
    if (action !== undefined ? action !== 'Delete' : item.event !== 'Delete') return false;
    const behaviour = stringDetail(item, 'behaviour');
    return behaviour === undefined || behaviour === 'Cascade';
}

/** The informational "this table is deleted when parent X is deleted" item (N:1 side). */
function isInboundCascadeDelete(item: LogicItem): boolean {
    return item.kind === 'cascade' && item.event === 'Delete' && stringDetail(item, 'parent') !== undefined;
}

/**
 * Cascade delete chains of two or more levels. We only see one level of relationships, so a chain
 * is flagged conservatively when an outbound cascade delete
 *  - points back at this table (self-referential hierarchy: unbounded depth), or
 *  - carries `details.chainDepth >= 2` (the relationships source walked the child's cascades), or
 *  - coexists with an inbound cascade delete (parent → this table → child is already two levels).
 */
function smellCascadeChain(items: LogicItem[], tableLogicalName: string): Smell[] {
    const inbound = items.filter(isInboundCascadeDelete);
    const smells: Smell[] = [];
    for (const item of items.filter(isOutboundCascadeDelete)) {
        const child = stringDetail(item, 'child') ?? '';
        const depth = typeof item.details.chainDepth === 'number' ? item.details.chainDepth : undefined;
        const selfReferential = child.toLowerCase() === tableLogicalName.toLowerCase();
        const deep = depth !== undefined && depth >= 2;
        if (!selfReferential && !deep && inbound.length === 0) continue;
        const reason = selfReferential
            ? `${tableLogicalName} → ${child} is self-referential (deleting a row deletes its whole subtree)`
            : deep
              ? `${tableLogicalName} → ${child} continues ${depth} levels deep`
              : `${stringDetail(inbound[0], 'parent')} → ${tableLogicalName} → ${child}`;
        smells.push(
            makeSmell(
                'cascade-chain',
                item.id,
                'info',
                `Cascade delete chain: ${reason}`,
                'Cascade delete removes child rows inside the same transaction, and each level fires the children\'s own delete logic (plugins, workflows, flows, further cascades). Chains of two or more levels make a single delete expensive, hard to predict and impossible to undo; consider Restrict or RemoveLink on one of the levels.',
                [item.id, ...(selfReferential || deep ? [] : inbound.map((i) => i.id))],
                { event: item.event, stage: item.stage },
            ),
        );
    }
    return smells;
}

/**
 * A business rule Dataverse also evaluates server-side. The `processes` source records the scope
 * explicitly (`details.scope` = `form` | `allforms` | `entity`, from `workflow.scope`) and marks the
 * server-side Create/Update items with `serverSide: true`. A missing `formId` is *not* a signal:
 * all-forms rules (client-only) and rules whose form id could not be read also have `formId: null`.
 */
function isEntityScopedRule(item: LogicItem): boolean {
    if (item.kind !== 'businessrule') return false;
    if (item.details.serverSide === true) return true;
    return stringDetail(item, 'scope')?.toLowerCase() === 'entity';
}

/** Entity-scoped business rules (which also run server-side) and JS onchange handlers on the same column. */
function smellBrPlusJs(items: LogicItem[]): Smell[] {
    const rulesByColumn = new Map<string, string[]>();
    for (const item of items) {
        if (!isEntityScopedRule(item)) continue;
        for (const c of [...(item.touchesColumns ?? []), ...(item.filteringAttributes ?? [])]) (rulesByColumn.get(c) ?? rulesByColumn.set(c, []).get(c)!).push(item.id);
    }
    const scriptsByColumn = new Map<string, string[]>();
    for (const item of items) {
        if (item.kind !== 'formscript' || item.event !== 'FieldChange') continue;
        for (const c of item.filteringAttributes ?? []) (scriptsByColumn.get(c) ?? scriptsByColumn.set(c, []).get(c)!).push(item.id);
    }
    const smells: Smell[] = [];
    for (const [column, ruleIds] of rulesByColumn) {
        const scriptIds = scriptsByColumn.get(column);
        if (!scriptIds) continue;
        smells.push(
            makeSmell(
                'br-plus-js',
                column,
                'info',
                `Entity-scoped business rule and form script both act on ${column}`,
                'An entity-scoped business rule runs on the form and again on the server, while the JavaScript onchange handler only runs on the form. Two mechanisms on the same column make the effective behaviour depend on execution order and on where the change came from (form, API, flow); keep one owner per column.',
                [...ruleIds, ...scriptIds],
            ),
        );
    }
    return smells;
}

/** All smells, sorted by code then id so exports diff cleanly. */
export function detectSmells(map: LogicMap, items: LogicItem[], options: BuildOptions): LogicMap['smells'] {
    const max = options.maxSyncItems ?? DEFAULT_MAX_SYNC_ITEMS;
    return [
        ...smellUpdateNoFilter(items),
        ...smellTooManySync(items, max),
        ...smellDisabledClutter(items),
        ...smellRealtimePlusPlugin(items),
        ...smellFlowUpdateUnfiltered(items),
        ...smellCascadeChain(items, map.table.logicalName),
        ...smellBrPlusJs(items),
    ].sort(compareSmells);
}

/** Write `item.smells` from the smell list (and drop stale ids so re-derivation is idempotent). */
function attachSmells(items: LogicItem[], smells: Smell[]): LogicItem[] {
    const byItem = new Map<string, string[]>();
    for (const smell of smells) for (const id of smell.itemIds) (byItem.get(id) ?? byItem.set(id, []).get(id)!).push(smell.id);
    return items.map((item) => {
        const ids = byItem.get(item.id);
        if (ids) return { ...item, smells: sortedUnique(ids) };
        if (item.smells === undefined) return item;
        const { smells: _stale, ...rest } = item;
        return rest;
    });
}

// ---------------------------------------------------------------------------
// 6. Business rules → forms, dependencies
// ---------------------------------------------------------------------------

/**
 * One representative item id per business rule (the `FormLoad` item, else the group's first item)
 * together with the form it is scoped to (`details.formId`; undefined = entity scope).
 */
function businessRuleRepresentatives(items: LogicItem[]): Array<{ id: string; formId?: string }> {
    const groups = groupBy(items.filter((i) => i.kind === 'businessrule'), groupKey);
    const reps: Array<{ id: string; formId?: string }> = [];
    for (const [, group] of groups) {
        const sorted = [...group].sort(compareItems);
        const rep = sorted.find((i) => i.id.endsWith(':FormLoad')) ?? sorted.find((i) => i.event === 'FormLoad') ?? sorted[0];
        const formId = group.map((i) => stringDetail(i, 'formId')).find((f) => f !== undefined);
        reps.push({ id: rep.id, formId });
    }
    return reps;
}

/** Form-scoped rules attach to their form; entity-scoped rules attach to every form. */
function attachBusinessRules(forms: FormInfo[], items: LogicItem[]): FormInfo[] {
    const reps = businessRuleRepresentatives(items);
    return forms.map((form) => {
        const formKey = normalizeId(form.id);
        const ids = reps.filter((r) => r.formId === undefined || normalizeId(r.formId) === formKey).map((r) => r.id);
        return { ...form, businessRules: sortedUnique(ids) };
    });
}

/** Mark dependencies whose object id matches an item id, source record id, group id or form id. */
function classifyDependencies(dependencies: DependencyInfo[], items: LogicItem[], forms: FormInfo[]): DependencyInfo[] {
    const index = new Map<string, string>();
    const claim = (key: string, itemId: string) => {
        const k = normalizeId(key);
        if (!index.has(k)) index.set(k, itemId);
    };
    // Precedence: item id, then the Dataverse record id, then the group id, then form ids.
    for (const item of items) claim(item.id, item.id);
    for (const item of items) if (item.source.id) claim(item.source.id, item.id);
    for (const [groupId, group] of groupBy(items.filter((i) => i.groupId !== undefined), groupKey)) claim(groupId, [...group].sort(compareItems)[0].id);
    for (const form of forms) claim(form.id, form.id);

    return dependencies.map((dep) => {
        const { itemId: _previous, ...rest } = dep;
        const hit = index.get(normalizeId(dep.objectId));
        return hit !== undefined ? { ...rest, classified: true, itemId: hit } : { ...rest, classified: false };
    });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Recompute everything derived from `items` on an existing map: synonyms, smells, pipeline, column
 * index, forms' business-rule links and dependency classification. Idempotent:
 * `rederive(rederive(m, i).items)` deep-equals `rederive(m, i)`. Synonym twins that were present on
 * `map.items` but are missing from `items` were removed on purpose (view filter) and stay removed.
 */
export function rederive(map: LogicMap, items: LogicItem[], options: RederiveOptions = {}): LogicMap {
    const present = new Set(items.map((i) => i.id));
    const droppedSynonyms = new Set(map.items.filter((i) => isSynonym(i) && !present.has(i.id)).map((i) => i.id));
    // Sort first: every derivation below (smells that read the first item of a group, the pipeline,
    // the column index, `items` itself) then depends only on the item set, not on source timing.
    const expanded = sortItems(expandSynonyms(items, droppedSynonyms));
    const smells = detectSmells(map, expanded, { maxSyncItems: options.maxSyncItems });
    const finalItems = attachSmells(expanded, smells);
    return {
        ...map,
        items: finalItems,
        smells,
        pipeline: buildPipeline(finalItems),
        columns: indexColumns(map, finalItems),
        forms: attachBusinessRules(map.forms, finalItems),
        dependencies: classifyDependencies(map.dependencies, finalItems, map.forms),
    };
}

function compareDependencies(a: DependencyInfo, b: DependencyInfo): number {
    return a.componentType - b.componentType || normalizeId(a.objectId).localeCompare(normalizeId(b.objectId));
}

const SOURCE_INDEX: ReadonlyMap<SourceName, number> = new Map(ALL_SOURCES.map((name, i) => [name, i]));

/** Position of a source in the documented pipeline order; unknown names sort last, alphabetically. */
function sourceIndex(name: SourceName): number {
    return SOURCE_INDEX.get(name) ?? ALL_SOURCES.length;
}

function compareSources(a: SourceName, b: SourceName): number {
    return sourceIndex(a) - sourceIndex(b) || a.localeCompare(b);
}

/**
 * `sourceErrors` and `stats.sourcesDone` are appended by the orchestrator as parallel sources
 * finish, i.e. in network-timing order. Sort them (a source can appear once in each, and a source
 * may report several errors, so nothing is dropped) so re-exports of the same table diff cleanly.
 */
function sortSourceErrors(errors: readonly SourceError[]): SourceError[] {
    return [...errors].sort((a, b) => compareSources(a.source, b.source) || a.kind.localeCompare(b.kind) || a.message.localeCompare(b.message));
}

/** Merge all source results into a LogicMap and derive pipeline, index, smells and links. */
export function classify(input: ClassifyInput): LogicMap {
    const map = createEmptyMap(input.table, input.environment, input.generatedAt);
    map.org = input.org;
    map.sourceErrors = sortSourceErrors(input.sourceErrors);
    map.stats = { ...input.stats, sourcesDone: [...input.stats.sourcesDone].sort(compareSources) };

    // Merge in a fixed source order, never in completion order: it decides which source wins a
    // duplicate item id, a duplicate column and the `views` block, and the key order of `raw`.
    const results = [...input.results].sort((a, b) => compareSources(a.name, b.name));

    const items: LogicItem[] = [];
    const seen = new Set<string>();
    for (const { result } of results) {
        for (const item of result.items) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            items.push(item);
        }
        if (result.columns) for (const c of result.columns) map.columns[c.logicalName] = c;
        if (result.forms) map.forms.push(...result.forms);
        if (result.relationships) map.relationships.push(...result.relationships);
        if (result.externalTouchers) map.externalTouchers.push(...result.externalTouchers);
        if (result.apps) map.apps.push(...result.apps);
        if (result.dependencies) map.dependencies.push(...result.dependencies);
        if (result.views) map.views = result.views;
    }
    const raw: NonNullable<LogicMap['raw']> = {};
    for (const { name, result } of results) if (result.raw !== undefined) raw[name] = result.raw;
    if (Object.keys(raw).length > 0) map.raw = raw;

    // Orders below carry no meaning; sort so re-runs and exports diff cleanly.
    map.forms.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    map.apps.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    map.relationships.sort((a, b) => a.kind.localeCompare(b.kind) || a.schemaName.localeCompare(b.schemaName));
    map.dependencies.sort(compareDependencies);
    map.externalTouchers.sort(compareItems);

    return rederive(map, items, { maxSyncItems: input.options.maxSyncItems });
}

/**
 * Business process flow definition parser (design guide §5.6, docs/verified.md #4).
 *
 * A BPF (`workflow.category` 4) is stored as designer XAML in `workflow.xaml`. The tree nests
 * `mxswa:ActivityReference` elements whose `DisplayName` encodes the node type:
 *   `EntityStep<n>: <entitylogicalname>` → `StageStep<n>: <stage name>` → `StepStep<n>: <step name>`
 *   → `Sequence ControlStep<n>` containing `mcwb:Control` (`DataFieldName`, `ControlDisplayName`).
 * `mcwo:StepLabel` collections carry the localised labels shown in the designer, `x:String`
 * properties carry `StageId` / `StageCategory` / `NextStageId`, and `mcwb:StageRelationship`
 * links stages across entities (`AttributeName`, `RelationshipName`, `SourceStageId`, `TargetStageId`).
 * This walk is `exact`. `clientdata` (designer JSON, shape not documented) is only used when the
 * XAML yields no stages, and is then `heuristic`.
 */
import { attr, children, descendants, localName, parseXml, type XmlEl } from '../xml/xml';
import { activityProperty, activityPropertyElement, displayNameKind, isActivityReference, simpleClassName, splitDisplayName } from './workflowXaml';

export interface BpfStep {
    /** Designer label (`mcwo:StepLabel` description) or, failing that, the control / step display name. */
    name: string;
    /** Column logical name bound by the step control, when any. */
    field?: string;
    /** `IsProcessRequired` property. */
    required?: boolean;
}

export interface BpfStage {
    name: string;
    /** Entity logical name of the enclosing `EntityStep`. */
    entity?: string;
    /** Step names in document order. */
    steps: string[];
    /** Column logical names bound by the stage's step controls, sorted unique. */
    fields?: string[];
    /** Designer `StageId` (the `processstage` id), when present. */
    id?: string;
    /** `StageCategory` option value as text (`0` Qualify, `1` Develop, `2` Propose, `3` Close, ...), when present. */
    category?: string;
    /** Per-step detail (parallel to `steps`). */
    stepDetails?: BpfStep[];
}

export interface BpfRelationship {
    /** Lookup column on the target entity that points back to the source entity. */
    attribute: string;
    /** Relationship schema name. */
    relationship: string;
    /** Source / target stage names (falls back to the raw stage id when the stage is not in this definition). */
    sourceStage: string;
    targetStage: string;
    sourceStageId?: string;
    targetStageId?: string;
}

export interface BpfSummary {
    stages: BpfStage[];
    /** Entity logical names in order of first appearance. */
    entities: string[];
    confidence: 'exact' | 'heuristic';
    /** Cross-entity stage relationships (`mcwb:StageRelationship`). */
    relationships?: BpfRelationship[];
    /** All columns bound by step controls across stages, sorted unique. */
    fields?: string[];
}

type NodeKind = 'entity' | 'stage' | 'step';

/** Node type from the DisplayName prefix (`EntityStep3`, `StageStep4`, `StepStep5`) or the activity class. */
function nodeKind(el: XmlEl): NodeKind | undefined {
    const byName = (displayNameKind(attr(el, 'DisplayName')) ?? '').toLowerCase();
    if (byName === 'entity') return 'entity';
    if (byName === 'stage') return 'stage';
    if (byName === 'step') return 'step';
    const cls = simpleClassName(attr(el, 'AssemblyQualifiedName'));
    if (cls === 'EntityComposite') return 'entity';
    if (cls === 'StageComposite') return 'stage';
    if (cls === 'StepComposite') return 'step';
    return undefined;
}

/** First `mcwo:StepLabel` description of a stage/step activity (document order = base language first). */
function stepLabel(el: XmlEl): string | undefined {
    const collection = activityPropertyElement(el, 'StepLabels');
    const label = collection ? children(collection, 'StepLabel')[0] : undefined;
    return label ? attr(label, 'Description')?.trim() || undefined : undefined;
}

function firstControlName(el: XmlEl): string | undefined {
    const control = descendants(el, 'Control')[0];
    return control ? attr(control, 'ControlDisplayName')?.trim() || undefined : undefined;
}

interface WalkContext {
    entity?: string;
    stage?: BpfStage;
    step?: BpfStep;
}

interface Accumulator {
    stages: BpfStage[];
    entities: string[];
    relationships: BpfRelationship[];
}

function visitEntity(el: XmlEl, ctx: WalkContext, acc: Accumulator): WalkContext {
    const entity = splitDisplayName(attr(el, 'DisplayName')).label.trim().toLowerCase();
    if (!entity) return ctx;
    if (!acc.entities.includes(entity)) acc.entities.push(entity);
    return { ...ctx, entity };
}

function visitStage(el: XmlEl, ctx: WalkContext, acc: Accumulator): WalkContext {
    const stage: BpfStage = {
        name: splitDisplayName(attr(el, 'DisplayName')).label || stepLabel(el) || `Stage ${acc.stages.length + 1}`,
        steps: [],
        fields: [],
        stepDetails: [],
    };
    if (ctx.entity) stage.entity = ctx.entity;
    const id = activityProperty(el, 'StageId');
    const category = activityProperty(el, 'StageCategory');
    if (id) stage.id = id.toLowerCase();
    if (category) stage.category = category;
    acc.stages.push(stage);
    return { ...ctx, stage, step: undefined };
}

function visitStep(el: XmlEl, ctx: WalkContext): WalkContext {
    if (!ctx.stage) return ctx;
    const label = splitDisplayName(attr(el, 'DisplayName')).label;
    // The designer names every step "New Step"; the StepLabel / control label is what users see.
    const step: BpfStep = { name: stepLabel(el) || firstControlName(el) || label || `Step ${ctx.stage.steps.length + 1}` };
    const required = activityProperty(el, 'IsProcessRequired');
    if (required !== undefined) step.required = /^true$/i.test(required);
    ctx.stage.steps.push(step.name);
    ctx.stage.stepDetails?.push(step);
    return { ...ctx, step };
}

function visitControl(el: XmlEl, ctx: WalkContext): void {
    const field = attr(el, 'DataFieldName')?.trim().toLowerCase();
    if (!field || !ctx.stage) return;
    if (ctx.step && !ctx.step.field) ctx.step.field = field;
    ctx.stage.fields?.push(field);
}

function visitRelationship(el: XmlEl, acc: Accumulator): void {
    const attribute = attr(el, 'AttributeName')?.trim().toLowerCase() ?? '';
    const relationship = attr(el, 'RelationshipName')?.trim() ?? '';
    if (!attribute && !relationship) return;
    const source = attr(el, 'SourceStageId')?.trim().toLowerCase();
    const target = attr(el, 'TargetStageId')?.trim().toLowerCase();
    const rel: BpfRelationship = { attribute, relationship, sourceStage: source ?? '', targetStage: target ?? '' };
    if (source) rel.sourceStageId = source;
    if (target) rel.targetStageId = target;
    acc.relationships.push(rel);
}

function visit(el: XmlEl, ctx: WalkContext, acc: Accumulator): void {
    let next = ctx;
    const name = localName(el);
    if (isActivityReference(el)) {
        const kind = nodeKind(el);
        if (kind === 'entity') next = visitEntity(el, ctx, acc);
        else if (kind === 'stage') next = visitStage(el, ctx, acc);
        else if (kind === 'step') next = visitStep(el, ctx);
    } else if (name === 'Control') {
        visitControl(el, ctx);
    } else if (name === 'StageRelationship') {
        visitRelationship(el, acc);
    }
    for (const c of el.children) visit(c, next, acc);
}

/** Regex fallback for XAML the parser rejects: DisplayName prefixes in document order, controls, relationships. */
function regexFallback(text: string, acc: Accumulator): void {
    let ctx: WalkContext = {};
    const re = /\bDisplayName="(EntityStep|StageStep|StepStep)\d*:\s*([^"]*)"|\bDataFieldName="([^"]*)"|<\w*:?StageRelationship\b([^<>]*)>/g;
    for (const m of text.matchAll(re)) {
        if (m[1] === 'EntityStep') {
            const entity = m[2].trim().toLowerCase();
            if (entity && !acc.entities.includes(entity)) acc.entities.push(entity);
            ctx = { entity };
        } else if (m[1] === 'StageStep') {
            const stage: BpfStage = { name: m[2].trim(), steps: [], fields: [], stepDetails: [] };
            if (ctx.entity) stage.entity = ctx.entity;
            acc.stages.push(stage);
            ctx = { ...ctx, stage, step: undefined };
        } else if (m[1] === 'StepStep') {
            if (ctx.stage) {
                const step: BpfStep = { name: m[2].trim() || `Step ${ctx.stage.steps.length + 1}` };
                ctx.stage.steps.push(step.name);
                ctx.stage.stepDetails?.push(step);
                ctx = { ...ctx, step };
            }
        } else if (m[3] !== undefined) {
            const field = m[3].trim().toLowerCase();
            if (field && ctx.stage) {
                if (ctx.step && !ctx.step.field) ctx.step.field = field;
                ctx.stage.fields?.push(field);
            }
        } else if (m[4] !== undefined) {
            const attrs = m[4];
            const get = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(attrs)?.[1]?.trim();
            const attribute = get('AttributeName')?.toLowerCase() ?? '';
            const relationship = get('RelationshipName') ?? '';
            if (!attribute && !relationship) continue;
            const source = get('SourceStageId')?.toLowerCase();
            const target = get('TargetStageId')?.toLowerCase();
            const rel: BpfRelationship = { attribute, relationship, sourceStage: source ?? '', targetStage: target ?? '' };
            if (source) rel.sourceStageId = source;
            if (target) rel.targetStageId = target;
            acc.relationships.push(rel);
        }
    }
}

// ---------------------------------------------------------------------------
// clientdata (designer JSON) — heuristic
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstString(obj: JsonObject, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

/** Designer lists are either plain arrays or `{ list: [...] }` wrappers. */
function asList(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (isObject(value) && Array.isArray(value.list)) return value.list;
    return [];
}

const NAME_KEYS = ['name', 'displayName', 'label', 'stageName', 'stepName', 'description', 'title'];
const ENTITY_KEYS = ['entity', 'entityName', 'entityLogicalName', 'primaryEntity', 'logicalName', 'entitylogicalname'];
const FIELD_KEYS = ['attribute', 'attributeName', 'dataFieldName', 'field', 'fieldName', 'logicalName', 'datafieldname'];

interface StagesArray {
    list: unknown[];
    /** Entity named on the object holding the array (or an ancestor), inherited by stages without their own. */
    entity?: string;
}

/** Depth-first search for the first `stages` array anywhere in the JSON. */
function findStagesArray(node: unknown, inherited?: string, depth = 0): StagesArray | undefined {
    if (depth > 12) return undefined;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findStagesArray(item, inherited, depth + 1);
            if (found) return found;
        }
        return undefined;
    }
    if (!isObject(node)) return undefined;
    const entity = firstString(node, ENTITY_KEYS) ?? inherited;
    const direct = asList(node.stages);
    if (direct.length > 0) return { list: direct, entity };
    for (const value of Object.values(node)) {
        const found = findStagesArray(value, entity, depth + 1);
        if (found) return found;
    }
    return undefined;
}

function stageFromJson(item: unknown, index: number, inheritedEntity?: string): BpfStage | undefined {
    if (!isObject(item)) return undefined;
    const stage: BpfStage = { name: firstString(item, NAME_KEYS) ?? `Stage ${index + 1}`, steps: [], fields: [], stepDetails: [] };
    const entity = (firstString(item, ENTITY_KEYS) ?? inheritedEntity)?.toLowerCase();
    if (entity) stage.entity = entity;
    const id = firstString(item, ['id', 'stageId', 'processStageId']);
    if (id) stage.id = id.toLowerCase();
    for (const raw of asList(item.steps)) {
        const step: BpfStep = { name: '' };
        if (typeof raw === 'string') step.name = raw.trim();
        else if (isObject(raw)) {
            const field = firstString(raw, FIELD_KEYS)?.toLowerCase();
            step.name = firstString(raw, NAME_KEYS) ?? field ?? '';
            if (field) step.field = field;
            if (typeof raw.required === 'boolean') step.required = raw.required;
        }
        if (!step.name) continue;
        stage.steps.push(step.name);
        stage.stepDetails?.push(step);
        if (step.field) stage.fields?.push(step.field);
    }
    return stage;
}

/** Objects whose `type`/`stepType` says "stage" (designer trees without a `stages` array). */
function collectTypedStages(node: unknown, out: unknown[], depth = 0): void {
    if (depth > 12) return;
    if (Array.isArray(node)) {
        for (const item of node) collectTypedStages(item, out, depth + 1);
        return;
    }
    if (!isObject(node)) return;
    const type = firstString(node, ['type', 'stepType', '$type', 'kind']);
    if (type && /stage/i.test(type)) out.push(node);
    for (const value of Object.values(node)) collectTypedStages(value, out, depth + 1);
}

function stagesFromClientData(clientData: string): BpfStage[] {
    let json: unknown;
    try {
        json = JSON.parse(clientData);
    } catch {
        return [];
    }
    let found = findStagesArray(json);
    if (!found) {
        const typed: unknown[] = [];
        collectTypedStages(json, typed);
        found = { list: typed, entity: isObject(json) ? firstString(json, ENTITY_KEYS) : undefined };
    }
    const inherited = found.entity?.toLowerCase();
    return found.list.map((item, i) => stageFromJson(item, i, inherited)).filter((s): s is BpfStage => s !== undefined);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function uniqueSorted(values: Iterable<string>): string[] {
    return [...new Set(values)].sort();
}

function finish(stages: BpfStage[], relationships: BpfRelationship[], entitiesInOrder: string[], confidence: 'exact' | 'heuristic'): BpfSummary {
    const entities = [...entitiesInOrder];
    for (const stage of stages) {
        if (stage.fields) stage.fields = uniqueSorted(stage.fields);
        if (stage.entity && !entities.includes(stage.entity)) entities.push(stage.entity);
    }
    const byId = new Map<string, string>();
    for (const stage of stages) if (stage.id) byId.set(stage.id, stage.name);
    for (const rel of relationships) {
        rel.sourceStage = (rel.sourceStageId && byId.get(rel.sourceStageId)) || rel.sourceStage;
        rel.targetStage = (rel.targetStageId && byId.get(rel.targetStageId)) || rel.targetStage;
    }
    return {
        stages,
        entities,
        confidence,
        relationships,
        fields: uniqueSorted(stages.flatMap((s) => s.fields ?? [])),
    };
}

/**
 * Summarise a business process flow. The XAML walk is authoritative (`exact`); `clientData` is
 * consulted only when the XAML yields no stages (`heuristic`). Both inputs may be null/empty.
 */
export function parseBpfDefinition(clientData: string | null | undefined, xaml: string | null | undefined): BpfSummary {
    const text = typeof xaml === 'string' ? xaml : '';
    const acc: Accumulator = { stages: [], entities: [], relationships: [] };
    const root = parseXml(text);
    if (root) visit(root, {}, acc);
    let confidence: 'exact' | 'heuristic' = 'exact';
    if (acc.stages.length === 0 && text.trim()) {
        regexFallback(text, acc);
        confidence = 'heuristic';
    }
    if (acc.stages.length > 0) return finish(acc.stages, acc.relationships, acc.entities, confidence);

    const fromJson = typeof clientData === 'string' && clientData.trim() ? stagesFromClientData(clientData) : [];
    return finish(fromJson, acc.relationships, acc.entities, 'heuristic');
}

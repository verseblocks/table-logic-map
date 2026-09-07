/**
 * Classic workflow XAML parser (design guide §5.6, docs/verified.md #3).
 *
 * Background and real-time workflows are stored as WF4 XAML in `workflow.xaml`. The classic
 * designer emits a tree of `mxswa:ActivityReference` elements whose `AssemblyQualifiedName`
 * names the CRM activity class (`UpdateEntity`, `CreateEntity`, `AssignEntity`, `SetState`,
 * `SendEmail`, ...) and whose `DisplayName` carries the designer step label
 * (`UpdateStep4: Update Project`). Column access is explicit in the tree:
 *  - `mxswa:GetEntityProperty Attribute="…" EntityName="…"` reads a column (conditions, operands);
 *  - `mxswa:SetEntityProperty Attribute="…" EntityName="…"` writes a column inside Update/Create;
 *  - `SetAttributeValue` activity references carry the column in `<InArgument x:Key="Attribute">`.
 * Column references buried in VB expression strings (`InputEntities("primaryEntity")("contoso_name")`)
 * are deliberately NOT extracted, so everything here is labelled `heuristic`.
 *
 * The generic XAML helpers exported below are shared with the business rule and BPF parsers.
 */
import { attr, descendants, localName, parseXml, walk, type XmlEl } from '../xml/xml';

export interface WorkflowXamlSummary {
    /** Read + written columns, filtered by `knownColumns` (when non-empty) and by `primaryEntity` (when given). Sorted. */
    touchesColumns: string[];
    /** Designer step display names (`UpdateStep4: Update Project`) in document order. */
    steps: string[];
    confidence: 'exact' | 'heuristic';
    /** Columns read through `GetEntityProperty`, all entities, sorted unique. */
    reads?: string[];
    /** Columns written through `SetEntityProperty` / `SetAttributeValue`, all entities, sorted unique. */
    writes?: string[];
    /** Read + written attributes grouped by entity logical name (`*` when the entity could not be determined). */
    attributesByEntity?: Record<string, string[]>;
    /** Distinct CRM activity class names (`UpdateEntity`, `CreateEntity`, `SendEmail`, custom activities ...), sorted. */
    activities?: string[];
    /** Entity logical names created by `CreateEntity` / `SendEmail` activities, sorted. */
    createsEntities?: string[];
    /** Step labels without the designer prefix (`Update Project`), in document order (parallel to `steps`). */
    stepLabels?: string[];
}

export interface WorkflowXamlOptions {
    /** When set, only attributes on this entity (or on an unknown entity) count towards `touchesColumns`. */
    primaryEntity?: string;
}

/** Key used in `attributesByEntity` when the entity of an attribute access is unknown. */
export const UNKNOWN_ENTITY = '*';

// ---------------------------------------------------------------------------
// Shared XAML helpers (also used by businessRuleXaml.ts and bpfDefinition.ts)
// ---------------------------------------------------------------------------

/** True for a designer `mxswa:ActivityReference` element (any namespace prefix). */
export function isActivityReference(el: XmlEl): boolean {
    return localName(el) === 'ActivityReference';
}

/** `Microsoft.Crm.Workflow.Activities.UpdateEntity, Microsoft.Crm.Workflow, Version=…` → `UpdateEntity`. */
export function simpleClassName(assemblyQualifiedName: string | null | undefined): string | undefined {
    if (!assemblyQualifiedName) return undefined;
    // Generic types look like `Ns.Foo`1[[…]]`; keep the part before the backtick.
    const typeName = assemblyQualifiedName.split(',')[0].split('`')[0].trim();
    if (!typeName) return undefined;
    const dot = typeName.lastIndexOf('.');
    const simple = dot >= 0 ? typeName.slice(dot + 1) : typeName;
    return simple || undefined;
}

/** Value of the `x:Key` attribute (tolerating a different prefix for the XAML namespace). */
export function xamlKey(el: XmlEl): string | undefined {
    for (const [k, v] of Object.entries(el.attrs)) {
        if (k === 'x:Key' || k === 'Key' || k.endsWith(':Key')) return v;
    }
    return undefined;
}

/**
 * Text of an argument/property element. The designer usually writes the value as text
 * (`<InArgument x:Key="Attribute">contoso_name</InArgument>`); typed values may instead be
 * nested `Literal` / `ReferenceLiteral` elements with a `Value` attribute.
 */
export function argumentText(el: XmlEl): string {
    if (el.text) return el.text;
    for (const d of descendants(el)) {
        const value = attr(d, 'Value');
        if (value) return value;
        if (d.text) return d.text;
    }
    return '';
}

function memberChildren(activity: XmlEl, suffix: '.Arguments' | '.Properties'): XmlEl[] {
    return activity.children.filter((c) => localName(c).endsWith(suffix)).flatMap((c) => c.children);
}

/** Named argument of an activity reference: `<mxswa:ActivityReference.Arguments><InArgument x:Key="EntityName">…`. */
export function activityArgument(activity: XmlEl, key: string): string | undefined {
    const lower = key.toLowerCase();
    const arg = memberChildren(activity, '.Arguments').find((a) => xamlKey(a)?.toLowerCase() === lower);
    return arg ? argumentText(arg) : undefined;
}

/** Named property element of an activity reference (`sco:Collection`, `x:String`, `x:Boolean`, `x:Null` ...). */
export function activityPropertyElement(activity: XmlEl, key: string): XmlEl | undefined {
    const lower = key.toLowerCase();
    return memberChildren(activity, '.Properties').find((p) => xamlKey(p)?.toLowerCase() === lower);
}

/** Scalar property value of an activity reference (`<x:String x:Key="StageId">…</x:String>`); undefined for `x:Null`. */
export function activityProperty(activity: XmlEl, key: string): string | undefined {
    const prop = activityPropertyElement(activity, key);
    if (!prop || localName(prop) === 'Null') return undefined;
    return prop.text || attr(prop, 'Value') || undefined;
}

/** `UpdateStep4: Update Project` → `{ prefix: 'UpdateStep4', label: 'Update Project' }` (split on the first colon). */
export function splitDisplayName(displayName: string | null | undefined): { prefix: string; label: string } {
    const name = (displayName ?? '').trim();
    const i = name.indexOf(':');
    if (i < 0) return { prefix: name, label: name };
    return { prefix: name.slice(0, i).trim(), label: name.slice(i + 1).trim() };
}

/** Designer node kind encoded in the DisplayName prefix: `SetVisibilityStep4: …` → `SetVisibility`, `EntityStep3: lead` → `Entity`. */
export function displayNameKind(displayName: string | null | undefined): string | undefined {
    const { prefix } = splitDisplayName(displayName);
    const kind = prefix.replace(/Step\d*$/i, '').replace(/\d+$/, '');
    return kind || undefined;
}

// ---------------------------------------------------------------------------
// Workflow parser
// ---------------------------------------------------------------------------

/** Plumbing classes the designer emits around real activities; never reported as `activities`. */
const STRUCTURAL_CLASSES = new Set([
    'StepComposite',
    'ConditionSequence',
    'ConditionBranch',
    'Condition',
    'EvaluateExpression',
    'SetAttributeValue',
    'GetEntityProperty',
    'SetEntityProperty',
    'ReferenceLiteral',
    'Sequence',
    'Workflow',
    'EntityComposite',
    'StageComposite',
    'StageRelationshipCollectionComposite',
]);

/** Activities that create a record whose entity is named by the `EntityName` argument. */
const CREATING_CLASSES: Record<string, string | undefined> = { CreateEntity: undefined, SendEmail: 'email' };

type UseKind = 'read' | 'write' | 'unknown';

interface AttributeUse {
    attribute: string;
    entity: string;
    kind: UseKind;
}

interface Accumulator {
    uses: AttributeUse[];
    steps: string[];
    activities: Set<string>;
    creates: Set<string>;
}

function newAccumulator(): Accumulator {
    return { uses: [], steps: [], activities: new Set(), creates: new Set() };
}

function isEmpty(acc: Accumulator): boolean {
    return acc.uses.length === 0 && acc.steps.length === 0 && acc.activities.size === 0 && acc.creates.size === 0;
}

function addUse(acc: Accumulator, attribute: string | undefined, entity: string | undefined, kind: UseKind): void {
    const name = attribute?.trim().toLowerCase();
    if (!name) return;
    acc.uses.push({ attribute: name, entity: entity?.trim().toLowerCase() || UNKNOWN_ENTITY, kind });
}

/** Entity of the closest enclosing activity that declares an `EntityName` argument (Update/Create/... wrappers). */
function nearestEntityName(el: XmlEl): string | undefined {
    for (let p = el.parent; p; p = p.parent) {
        if (!isActivityReference(p)) continue;
        const name = activityArgument(p, 'EntityName');
        if (name) return name;
    }
    return undefined;
}

function recordActivity(acc: Accumulator, cls: string | undefined, displayName: string, entityName: string | undefined, attributeArg: string | undefined): void {
    const looksLikeStep = /^\w+Step\d+\s*:/.test(displayName);
    if (cls === 'StepComposite' || (!cls && looksLikeStep)) {
        if (displayName) acc.steps.push(displayName);
        return;
    }
    if (cls && !STRUCTURAL_CLASSES.has(cls)) acc.activities.add(cls);
    if (cls === 'SetAttributeValue') addUse(acc, attributeArg, entityName, 'write');
    if (cls && cls in CREATING_CLASSES) {
        const created = entityName || CREATING_CLASSES[cls];
        if (created) acc.creates.add(created.toLowerCase());
    }
}

function walkTree(root: XmlEl, acc: Accumulator): void {
    walk(root, (el) => {
        const name = localName(el);
        if (name === 'GetEntityProperty' || name === 'SetEntityProperty') {
            addUse(acc, attr(el, 'Attribute'), attr(el, 'EntityName') || nearestEntityName(el), name === 'GetEntityProperty' ? 'read' : 'write');
            return;
        }
        if (!isActivityReference(el)) return;
        const cls = simpleClassName(attr(el, 'AssemblyQualifiedName'));
        const entityName = activityArgument(el, 'EntityName') || (cls === 'SetAttributeValue' ? nearestEntityName(el) : undefined);
        recordActivity(acc, cls, attr(el, 'DisplayName') ?? '', entityName, activityArgument(el, 'Attribute'));
    });
}

/**
 * Regex fallback over the raw text for XAML that fast-xml-parser rejects (truncated or otherwise
 * malformed). Direction is taken from the element name; activity arguments are read from the text
 * chunk that follows each `ActivityReference` start tag (the designer writes `.Arguments` before
 * the nested `.Properties`).
 */
function regexFallback(text: string, acc: Accumulator): void {
    // `(?:>|$)` also accepts a final tag cut off mid-attribute (the usual reason parsing failed).
    const tagRe = /<([\w.:-]+)\b([^<>]*)(?:>|$)/g;
    for (const m of text.matchAll(tagRe)) {
        const local = m[1].replace(/^[^:]*:/, '');
        const attrs = m[2];
        const attribute = /\bAttribute="([^"]*)"/.exec(attrs)?.[1];
        if (!attribute) continue;
        const entity = /\bEntityName="([^"]*)"/.exec(attrs)?.[1];
        const kind: UseKind = local === 'GetEntityProperty' ? 'read' : local === 'SetEntityProperty' ? 'write' : 'unknown';
        addUse(acc, attribute, entity, kind);
    }
    const chunks = text.split(/(?=<\w*:?ActivityReference\s)/);
    for (const chunk of chunks) {
        if (!/^<\w*:?ActivityReference\s/.test(chunk)) continue;
        const cls = simpleClassName(/\bAssemblyQualifiedName="([^"]*)"/.exec(chunk)?.[1]);
        const displayName = /\bDisplayName="([^"]*)"/.exec(chunk)?.[1] ?? '';
        const entityName = /x:Key="EntityName"[^>]*>([^<]*)</.exec(chunk)?.[1];
        const attributeArg = /x:Key="Attribute"[^>]*>([^<]*)</.exec(chunk)?.[1];
        recordActivity(acc, cls, displayName, entityName, attributeArg);
    }
}

function uniqueSorted(values: Iterable<string>): string[] {
    return [...new Set(values)].sort();
}

function summarize(acc: Accumulator, knownColumns: ReadonlySet<string>, options?: WorkflowXamlOptions): WorkflowXamlSummary {
    const primary = options?.primaryEntity?.trim().toLowerCase();
    const byEntity = new Map<string, Set<string>>();
    for (const use of acc.uses) {
        const set = byEntity.get(use.entity) ?? new Set<string>();
        set.add(use.attribute);
        byEntity.set(use.entity, set);
    }
    const attributesByEntity: Record<string, string[]> = {};
    for (const entity of [...byEntity.keys()].sort()) attributesByEntity[entity] = uniqueSorted(byEntity.get(entity) ?? []);

    const touches = acc.uses
        .filter((u) => !primary || u.entity === primary || u.entity === UNKNOWN_ENTITY)
        .map((u) => u.attribute)
        .filter((a) => knownColumns.size === 0 || knownColumns.has(a));

    return {
        touchesColumns: uniqueSorted(touches),
        steps: acc.steps,
        confidence: 'heuristic',
        reads: uniqueSorted(acc.uses.filter((u) => u.kind === 'read').map((u) => u.attribute)),
        writes: uniqueSorted(acc.uses.filter((u) => u.kind === 'write').map((u) => u.attribute)),
        attributesByEntity,
        activities: uniqueSorted(acc.activities),
        createsEntities: uniqueSorted(acc.creates),
        stepLabels: acc.steps.map((s) => splitDisplayName(s).label),
    };
}

/**
 * Summarise a classic workflow definition. `knownColumns` (logical names of the table being
 * mapped) filters `touchesColumns`; pass an empty set to keep every attribute. Use
 * `options.primaryEntity` to exclude attributes written on other entities (e.g. the `subject` of a
 * task created by the workflow) from `touchesColumns`.
 */
export function parseWorkflowXaml(xaml: string | null | undefined, knownColumns: ReadonlySet<string>, options?: WorkflowXamlOptions): WorkflowXamlSummary {
    const acc = newAccumulator();
    const text = typeof xaml === 'string' ? xaml : '';
    const root = parseXml(text);
    if (root) walkTree(root, acc);
    if ((!root || isEmpty(acc)) && text.trim()) regexFallback(text, acc);
    return summarize(acc, knownColumns, options);
}

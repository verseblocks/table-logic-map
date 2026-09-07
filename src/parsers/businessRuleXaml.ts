/**
 * Business rule XAML parser (design guide §5.6, docs/verified.md #3).
 *
 * Business rules (`workflow.category` 2) are stored as the same designer XAML as classic workflows:
 * a `StepComposite` per designer step wrapping an `ActivityReference` whose class name is the rule
 * action (`Microsoft.Crm.Workflow.BusinessRules.SetVisibility`, `SetRequiredLevel`, `SetDefaultValue`,
 * `SetValue`, `LockUnlock`, `ShowErrorMessage`, `SetDisplayMode`, `SetBusinessRequired`,
 * `Recommendation`). Conditions read columns through `mxswa:GetEntityProperty`. The exact element
 * names are not documented, so matching is tolerant (class simple name OR `DisplayName` prefix,
 * case-insensitive, `Step<n>` / `Action` / `Activity` suffixes ignored) and the result is `heuristic`.
 */
import { attr, descendants, localName, parseXml, walk, type XmlEl } from '../xml/xml';
import { activityArgument, argumentText, displayNameKind, isActivityReference, simpleClassName, splitDisplayName, xamlKey } from './workflowXaml';

export interface BusinessRuleAction {
    /** Canonical action type (`SetVisibility`, `SetRequiredLevel`, `SetDefaultValue`, `SetValue`, `LockUnlock`, `ShowErrorMessage`, `SetDisplayMode`, `SetBusinessRequired`, `Recommendation`). */
    type: string;
    /** Target column logical name, when the action names one. */
    column?: string;
    /** Action argument as written in the XAML (`True`, `Required`, an error message, a value expression ...). */
    detail?: string;
}

export interface BusinessRuleSummary {
    /** Actions in document order (if-branch actions first, then else-branch). */
    actions: BusinessRuleAction[];
    /** Columns read by conditions, sorted unique. */
    conditionColumns: string[];
    /** Action columns ∪ condition columns ∪ action operand reads, filtered by `knownColumns` when non-empty. Sorted. */
    touchesColumns: string[];
    confidence: 'exact' | 'heuristic';
    /** Scope hint found inside the XAML; usually undefined — rely on `workflow.scope` / `_formid_value`. */
    scope?: 'form' | 'entity';
    /** Number of condition branches (`ConditionBranch` activities: if / else if / else). */
    branches?: number;
    /** Designer step labels (`StepComposite` display names without the prefix), document order. */
    stepLabels?: string[];
}

/** Normalised (lower-case, suffix-stripped) names → canonical action type. */
const ACTION_TYPES: Record<string, string> = {
    setvisibility: 'SetVisibility',
    setrequiredlevel: 'SetRequiredLevel',
    setdefaultvalue: 'SetDefaultValue',
    setvalue: 'SetValue',
    lockunlock: 'LockUnlock',
    lock: 'LockUnlock',
    unlock: 'LockUnlock',
    showerrormessage: 'ShowErrorMessage',
    setdisplaymode: 'SetDisplayMode',
    setbusinessrequired: 'SetBusinessRequired',
    recommendation: 'Recommendation',
    setrecommendation: 'Recommendation',
    showrecommendation: 'Recommendation',
    createrecommendation: 'Recommendation',
};

/** Argument keys that carry the action's value, per type, followed by a generic list. */
const DETAIL_KEYS: Record<string, string[]> = {
    SetVisibility: ['Visibility', 'Visible', 'IsVisible'],
    SetRequiredLevel: ['RequiredLevel', 'Required'],
    SetDefaultValue: ['Value', 'DefaultValue'],
    SetValue: ['Value'],
    LockUnlock: ['Lock', 'Locked', 'Disabled'],
    ShowErrorMessage: ['ErrorMessage', 'Message'],
    SetDisplayMode: ['DisplayMode', 'Mode'],
    SetBusinessRequired: ['RequiredLevel', 'Required', 'BusinessRequired'],
    Recommendation: ['Message', 'RecommendationText', 'Text', 'Recommendation'],
};
const GENERIC_DETAIL_KEYS = ['Visibility', 'RequiredLevel', 'Value', 'Lock', 'ErrorMessage', 'DisplayMode', 'Message'];

/** Map a class simple name or DisplayName kind (`SetVisibilityStep4`, `SetVisibilityAction`) to a canonical action type. */
export function normalizeActionType(name: string | null | undefined): string | undefined {
    if (!name) return undefined;
    let n = name.trim().toLowerCase().replace(/\d+$/, '');
    n = n.replace(/step$/, '').replace(/\d+$/, '');
    n = n.replace(/(?:action|activity)$/, '');
    return ACTION_TYPES[n];
}

function classOf(el: XmlEl): string | undefined {
    return simpleClassName(attr(el, 'AssemblyQualifiedName'));
}

function actionTypeOf(el: XmlEl): string | undefined {
    if (!isActivityReference(el)) return undefined;
    return normalizeActionType(classOf(el)) ?? normalizeActionType(displayNameKind(attr(el, 'DisplayName')));
}

function isConditionActivity(el: XmlEl): boolean {
    const cls = classOf(el) ?? displayNameKind(attr(el, 'DisplayName')) ?? '';
    return /^condition/i.test(cls);
}

function isConditionBranch(el: XmlEl): boolean {
    return isActivityReference(el) && /^conditionbranch/i.test(classOf(el) ?? displayNameKind(attr(el, 'DisplayName')) ?? '');
}

/** Role of the closest enclosing activity: an action operand or a condition read. Bare reads count as conditions. */
function nearestRole(el: XmlEl): 'action' | 'condition' {
    for (let p = el.parent; p; p = p.parent) {
        if (!isActivityReference(p)) continue;
        if (actionTypeOf(p)) return 'action';
        if (isConditionActivity(p)) return 'condition';
    }
    return 'condition';
}

function hasNestedAction(el: XmlEl): boolean {
    return descendants(el, 'ActivityReference').some((d) => actionTypeOf(d) !== undefined);
}

const LOGICAL_NAME = /^[a-z][a-z0-9_]*$/i;

/** Target column: `Attribute` argument/attribute, else a bound `mcwb:Control`, else a plain `Control` argument. */
function actionColumn(el: XmlEl): string | undefined {
    const direct = activityArgument(el, 'Attribute') || attr(el, 'Attribute');
    if (direct && LOGICAL_NAME.test(direct)) return direct.toLowerCase();
    for (const control of descendants(el, 'Control')) {
        const field = attr(control, 'DataFieldName') || attr(control, 'ControlId');
        if (field && LOGICAL_NAME.test(field)) return field.toLowerCase();
    }
    const control = activityArgument(el, 'Control');
    return control && LOGICAL_NAME.test(control) ? control.toLowerCase() : undefined;
}

function actionDetail(el: XmlEl, type: string): string | undefined {
    for (const key of [...(DETAIL_KEYS[type] ?? []), ...GENERIC_DETAIL_KEYS]) {
        const value = activityArgument(el, key);
        if (value) return value;
    }
    return undefined;
}

/** A `Scope` argument/attribute mentioning "entity" or "form" (rarely present; the source uses `workflow.scope`). */
function scopeHint(root: XmlEl): 'form' | 'entity' | undefined {
    for (const el of descendants(root)) {
        const value = xamlKey(el)?.toLowerCase() === 'scope' ? argumentText(el) : attr(el, 'Scope');
        if (!value) continue;
        if (/entity/i.test(value)) return 'entity';
        if (/form/i.test(value)) return 'form';
    }
    return undefined;
}

interface Accumulator {
    actions: BusinessRuleAction[];
    conditionColumns: Set<string>;
    actionReads: Set<string>;
    stepLabels: string[];
    branches: number;
}

function newAccumulator(): Accumulator {
    return { actions: [], conditionColumns: new Set(), actionReads: new Set(), stepLabels: [], branches: 0 };
}

function isEmpty(acc: Accumulator): boolean {
    return acc.actions.length === 0 && acc.conditionColumns.size === 0 && acc.stepLabels.length === 0;
}

function walkTree(root: XmlEl, acc: Accumulator): void {
    walk(root, (el) => {
        const name = localName(el);
        if (isActivityReference(el)) {
            if (isConditionBranch(el)) acc.branches++;
            if (classOf(el) === 'StepComposite') {
                const label = splitDisplayName(attr(el, 'DisplayName')).label;
                if (label) acc.stepLabels.push(label);
            }
            const type = actionTypeOf(el);
            // Emit the innermost matching activity only: the StepComposite wrapper shares the prefix.
            if (type && !hasNestedAction(el)) {
                const action: BusinessRuleAction = { type };
                const column = actionColumn(el);
                const detail = actionDetail(el, type);
                if (column) action.column = column;
                if (detail) action.detail = detail;
                acc.actions.push(action);
            }
            return;
        }
        if (name === 'GetEntityProperty') {
            const attribute = attr(el, 'Attribute')?.toLowerCase();
            if (attribute) (nearestRole(el) === 'action' ? acc.actionReads : acc.conditionColumns).add(attribute);
            return;
        }
        if (name === 'Control') {
            const field = attr(el, 'DataFieldName')?.toLowerCase();
            if (field && nearestRole(el) === 'condition') acc.conditionColumns.add(field);
        }
    });
}

/** Regex fallback for XAML the parser rejects: one chunk per `ActivityReference` start tag. */
function regexFallback(text: string, acc: Accumulator): void {
    for (const chunk of text.split(/(?=<\w*:?ActivityReference\s)/)) {
        if (!/^<\w*:?ActivityReference\s/.test(chunk)) continue;
        const cls = simpleClassName(/\bAssemblyQualifiedName="([^"]*)"/.exec(chunk)?.[1]);
        const displayName = /\bDisplayName="([^"]*)"/.exec(chunk)?.[1];
        if (/conditionbranch/i.test(cls ?? displayNameKind(displayName) ?? '')) acc.branches++;
        if (cls === 'StepComposite') {
            const label = splitDisplayName(displayName).label;
            if (label) acc.stepLabels.push(label);
            continue;
        }
        const type = normalizeActionType(cls) ?? (cls ? undefined : normalizeActionType(displayNameKind(displayName)));
        if (!type) continue;
        const action: BusinessRuleAction = { type };
        const column = /x:Key="Attribute"[^>]*>([^<]*)</.exec(chunk)?.[1] ?? /\bDataFieldName="([^"]*)"/.exec(chunk)?.[1];
        if (column && LOGICAL_NAME.test(column)) action.column = column.toLowerCase();
        for (const key of [...(DETAIL_KEYS[type] ?? []), ...GENERIC_DETAIL_KEYS]) {
            const value = new RegExp(`x:Key="${key}"[^>]*>([^<]*)<`).exec(chunk)?.[1]?.trim();
            if (value) {
                action.detail = value;
                break;
            }
        }
        acc.actions.push(action);
    }
    for (const m of text.matchAll(/<\w*:?GetEntityProperty\b[^<>]*\bAttribute="([^"]*)"/g)) {
        const attribute = m[1].trim().toLowerCase();
        if (attribute) acc.conditionColumns.add(attribute);
    }
}

/**
 * Summarise a business rule definition. `knownColumns` (logical names of the table being mapped)
 * filters `touchesColumns`; pass an empty set to keep every column.
 */
export function parseBusinessRuleXaml(xaml: string | null | undefined, knownColumns: ReadonlySet<string>): BusinessRuleSummary {
    const acc = newAccumulator();
    const text = typeof xaml === 'string' ? xaml : '';
    const root = parseXml(text);
    if (root) walkTree(root, acc);
    if ((!root || isEmpty(acc)) && text.trim()) regexFallback(text, acc);

    const conditionColumns = [...acc.conditionColumns].sort();
    const touched = new Set<string>([...conditionColumns, ...acc.actionReads]);
    for (const action of acc.actions) if (action.column) touched.add(action.column);
    const touchesColumns = [...touched].filter((c) => knownColumns.size === 0 || knownColumns.has(c)).sort();

    const summary: BusinessRuleSummary = {
        actions: acc.actions,
        conditionColumns,
        touchesColumns,
        confidence: 'heuristic',
        branches: acc.branches,
        stepLabels: acc.stepLabels,
    };
    const scope = root ? scopeHint(root) : undefined;
    if (scope) summary.scope = scope;
    return summary;
}

/**
 * Dependency cross-check — `RetrieveDependenciesForDelete` on the table (component type 1 =
 * Entity) lists every solution component that depends on it: forms, views, charts, relationships,
 * plugin steps, workflows, SDK message filters, apps … The classifier marks the ones we already
 * produced as items (`classified`); the rest form the "Other dependencies" completeness safety net.
 *
 * The function is called through `queryOne` with a hand-built URL because PPTB's `execute()`
 * quotes string parameters, which breaks the `Edm.Guid` parameter (docs/verified.md #8).
 * Component type labels come from `codes.COMPONENT_TYPE_LABEL`; environment-specific numbers are
 * resolved from the `solutioncomponent.componenttype` option set (one call, errors swallowed).
 */
import { errorMessage, type Row } from '../data/client';
import { COMPONENT_TYPE_LABEL } from '../domain/codes';
import type { DependencyInfo } from '../domain/model';
import type { Source, SourceContext, SourceResult } from './types';
import { label } from './types';

export const COMPONENT_TYPE_OPTIONSET_PATH =
    "EntityDefinitions(LogicalName='solutioncomponent')/Attributes(LogicalName='componenttype')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)";

// dependency.dependencytype
export const DEPENDENCY_TYPE_LABEL: Record<number, string> = { 0: 'None', 1: 'Solution Internal', 2: 'Published', 4: 'Unpublished' };

/** GUID unquoted — `@id='...'` would be rejected for an Edm.Guid parameter. */
export function dependenciesPath(metadataId: string): string {
    return `RetrieveDependenciesForDelete(ObjectId=@id,ComponentType=@ct)?@id=${normalizeGuid(metadataId) ?? metadataId}&@ct=1`;
}

/** One normalised `dependency` row (also the Raw tab payload). */
export interface DependencyRow {
    componentType: number;
    componentTypeName?: string;
    objectId: string;
    dependencyType?: number;
    dependencyTypeName?: string;
    requiredComponentType?: number;
    requiredComponentObjectId?: string;
}

// ---------------------------------------------------------------------------
// Response normalisation
// ---------------------------------------------------------------------------

function row(value: unknown): Row | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : undefined;
}

function normalizeGuid(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const s = value.replace(/[{}]/g, '').trim().toLowerCase();
    return s || undefined;
}

/** Unwrap SDK-style wrappers: `{ Value: 92 }` (OptionSetValue) and `{ Id: '...' }` (EntityReference). */
function scalar(value: unknown): unknown {
    const r = row(value);
    if (!r) return value;
    if ('Value' in r) return r.Value;
    if ('Id' in r) return r.Id;
    return value;
}

function toNumber(value: unknown): number | undefined {
    const v = scalar(value);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v);
    return undefined;
}

/** Entities may come as plain objects or as `{ Attributes: [{ key, value }] }` key/value lists. */
function flattenEntity(entity: Row): Row {
    const attributes = entity.Attributes;
    if (!Array.isArray(attributes)) return entity;
    const out: Row = {};
    for (const pair of attributes) {
        const p = row(pair);
        if (!p) continue;
        const key = typeof p.key === 'string' ? p.key : typeof p.Key === 'string' ? p.Key : undefined;
        if (!key) continue;
        out[key] = 'value' in p ? p.value : p.Value;
    }
    return out;
}

/** Accept `{ EntityCollection: { Entities } }`, `{ Entities }` and `{ value }` response shapes. */
export function extractDependencyEntities(body: Row): Row[] {
    const collection = row(body.EntityCollection);
    const candidates: unknown[] = [collection?.Entities, collection?.value, body.Entities, body.value];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.map(row).filter((e): e is Row => !!e).map(flattenEntity);
        }
    }
    return [];
}

export function toDependencyRow(entity: Row): DependencyRow | undefined {
    const componentType = toNumber(entity.dependentcomponenttype);
    const objectId = normalizeGuid(scalar(entity.dependentcomponentobjectid));
    if (componentType === undefined || !objectId) return undefined;
    const dependencyType = toNumber(entity.dependencytype);
    const out: DependencyRow = { componentType, objectId };
    if (dependencyType !== undefined) {
        out.dependencyType = dependencyType;
        out.dependencyTypeName = DEPENDENCY_TYPE_LABEL[dependencyType] ?? String(dependencyType);
    }
    const requiredType = toNumber(entity.requiredcomponenttype);
    if (requiredType !== undefined) out.requiredComponentType = requiredType;
    const requiredId = normalizeGuid(scalar(entity.requiredcomponentobjectid));
    if (requiredId) out.requiredComponentObjectId = requiredId;
    return out;
}

// ---------------------------------------------------------------------------
// Component type labels
// ---------------------------------------------------------------------------

/** Environment-specific labels from the `solutioncomponent.componenttype` option set; empty on any failure. */
async function loadComponentTypeLabels(ctx: SourceContext): Promise<Map<number, string>> {
    const labels = new Map<number, string>();
    try {
        const body = await ctx.client.queryOne(COMPONENT_TYPE_OPTIONSET_PATH, { signal: ctx.signal });
        const options = row(body.OptionSet)?.Options;
        if (!Array.isArray(options)) return labels;
        for (const option of options) {
            const o = row(option);
            const value = toNumber(o?.Value);
            const text = label(o?.Label);
            if (value !== undefined && text) labels.set(value, text);
        }
    } catch (err) {
        ctx.logger.warn(`dependencies: could not resolve component type labels (${errorMessage(err)})`);
    }
    return labels;
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export const dependenciesSource: Source = {
    name: 'dependencies',
    async run(ctx: SourceContext): Promise<SourceResult> {
        const metadataId = ctx.table.metadataId;
        if (!metadataId) return { items: [], dependencies: [], warnings: ['Dependencies: table MetadataId is unknown; skipped.'] };

        // Errors (400 / missing privilege) propagate — the orchestrator records them as a source error.
        const body = await ctx.client.queryOne(dependenciesPath(metadataId), { signal: ctx.signal });
        const rows = extractDependencyEntities(body)
            .map(toDependencyRow)
            .filter((d): d is DependencyRow => !!d);

        const unknownTypes = new Set(rows.map((d) => d.componentType).filter((t) => !(t in COMPONENT_TYPE_LABEL)));
        const envLabels = unknownTypes.size > 0 ? await loadComponentTypeLabels(ctx) : new Map<number, string>();
        const nameOf = (type: number): string | undefined => COMPONENT_TYPE_LABEL[type] ?? envLabels.get(type);

        // De-duplicate (the same component can depend through several dependency rows) and sort.
        const byKey = new Map<string, DependencyInfo>();
        for (const d of rows) {
            const key = `${d.componentType}:${d.objectId}`;
            if (byKey.has(key)) continue;
            const info: DependencyInfo = { componentType: d.componentType, objectId: d.objectId, classified: false };
            const typeName = nameOf(d.componentType);
            if (typeName) info.componentTypeName = typeName;
            if (d.dependencyType !== undefined) {
                info.dependencyType = d.dependencyType;
                if (d.dependencyTypeName) info.dependencyTypeName = d.dependencyTypeName;
            }
            byKey.set(key, info);
        }
        const dependencies = [...byKey.values()].sort((a, b) => a.componentType - b.componentType || a.objectId.localeCompare(b.objectId));

        const raw = rows
            .map((d) => ({ ...d, componentTypeName: nameOf(d.componentType) }))
            .sort((a, b) => a.componentType - b.componentType || a.objectId.localeCompare(b.objectId) || (a.dependencyType ?? 0) - (b.dependencyType ?? 0));

        return { items: [], dependencies, raw: { path: dependenciesPath(metadataId), dependencies: raw } };
    },
};

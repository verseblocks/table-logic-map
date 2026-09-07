/**
 * Relationships of the table and the cascade rules they carry.
 *
 *  - `OneToManyRelationships` (this table is the parent / ReferencedEntity): every
 *    `CascadeConfiguration` action that is not `NoCascade` becomes a `cascade` item on the platform
 *    event it hangs off (Delete, Assign, Share, Unshare, Merge, Reparent → Update, RollupView →
 *    RetrieveMultiple, Archive → Delete). `RemoveLink` and `Restrict` are reported too: they change
 *    what a Delete does to the children.
 *  - `ManyToOneRelationships` (this table is the child): an informational item on `Delete` when the
 *    parent cascades its delete down to this table.
 *  - `ManyToManyRelationships`: summaries only.
 *
 * All three lists are also returned as `RelationshipSummary` rows (sorted by schema name).
 *
 * Cascade chains (design guide §6): a delete that cascades to a child which cascades on to a
 * grandchild is what makes a single delete expensive. One extra level is walked — for every child
 * this table cascade-deletes into, its own `OneToManyRelationships` are read (one cached metadata
 * request per distinct child, capped at `CASCADE_WALK_LIMIT`) — and the outbound Delete item then
 * carries `details.chainDepth = 2` plus the grandchildren, which is what the `cascade-chain` smell
 * reports. Tables with no cascade delete cost no extra request at all.
 */
import { classifyError, errorMessage, type Row } from '../data/client';
import { CASCADE_ACTION_EVENT } from '../domain/codes';
import type { LogicItem, RelationshipSummary } from '../domain/model';
import type { Source, SourceContext, SourceResult } from './types';
import { str } from './types';

export const ONE_MANY_PROPS = ['SchemaName', 'ReferencedEntity', 'ReferencedAttribute', 'ReferencingEntity', 'ReferencingAttribute', 'CascadeConfiguration', 'IsCustomRelationship'];
export const MANY_MANY_PROPS = ['SchemaName', 'Entity1LogicalName', 'Entity2LogicalName', 'IntersectEntityName', 'IsCustomRelationship'];
/** Cascade actions in the order they are reported. Unknown actions in `CascadeConfiguration` are ignored. */
export const CASCADE_ACTIONS = ['Assign', 'Delete', 'Merge', 'Reparent', 'Share', 'Unshare', 'RollupView', 'Archive'] as const;
/** Upper bound on the child tables whose cascades are walked (one metadata request each). */
export const CASCADE_WALK_LIMIT = 25;
/** Grandchildren listed on the item; the full number is always reported as `grandchildCount`. */
const GRANDCHILDREN_LISTED = 20;

/** One level of the cascade-delete walk: the tables the CHILD cascade-deletes into. */
export interface CascadeChain {
    grandchildren: readonly string[];
}

/** `CascadeConfiguration` → `{ Assign: 'Cascade', Delete: 'RemoveLink', ... }` (string values only). */
export function cascadeMap(row: Row): Record<string, string> {
    const cfg = row.CascadeConfiguration;
    const out: Record<string, string> = {};
    if (cfg && typeof cfg === 'object') {
        for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
    }
    return out;
}

function bySchemaName(a: { schemaName: string }, b: { schemaName: string }): number {
    return a.schemaName.localeCompare(b.schemaName);
}

/**
 * Items for one 1:N relationship where this table is the parent. `chain` (when the child's own
 * cascades were walked) adds `chainDepth`/`grandchildren` to the Delete item: parent → child →
 * grandchild is depth 2, the level the `cascade-chain` smell reports.
 */
export function outboundCascadeItems(row: Row, chain?: CascadeChain): LogicItem[] {
    const schemaName = str(row.SchemaName) ?? '';
    const child = str(row.ReferencingEntity) ?? '';
    const via = str(row.ReferencingAttribute) ?? '';
    const isCustom = row.IsCustomRelationship === true;
    const cascade = cascadeMap(row);
    const items: LogicItem[] = [];
    for (const action of CASCADE_ACTIONS) {
        const behaviour = cascade[action];
        const event = CASCADE_ACTION_EVENT[action];
        if (!behaviour || behaviour === 'NoCascade' || !event) continue;
        // Only a cascading Delete continues into the child's own cascade-delete children.
        const grandchildren = action === 'Delete' && behaviour === 'Cascade' ? (chain?.grandchildren ?? []) : [];
        const chainDetails =
            grandchildren.length > 0 ? { chainDepth: 2, grandchildren: grandchildren.slice(0, GRANDCHILDREN_LISTED), grandchildCount: grandchildren.length } : undefined;
        items.push({
            id: `cascade:${schemaName}:${action}`,
            kind: 'cascade',
            name: `${action} → ${behaviour} to ${child}`,
            event,
            groupId: schemaName,
            stage: 'always',
            enabled: true,
            mode: 'rule',
            confidence: 'exact',
            details: { child, via, behaviour, action, relationship: schemaName, isCustom, ...chainDetails },
            source: { table: 'relationship', id: str(row.MetadataId) ?? schemaName },
        });
    }
    return items;
}

/** Informational item for an N:1 relationship whose parent cascades Delete down to this table. */
export function inboundDeleteItem(row: Row): LogicItem | undefined {
    const cascade = cascadeMap(row);
    if (cascade.Delete !== 'Cascade') return undefined;
    const schemaName = str(row.SchemaName) ?? '';
    const parent = str(row.ReferencedEntity) ?? '';
    return {
        id: `cascade:${schemaName}:inbound-delete`,
        kind: 'cascade',
        name: `Deleted with parent ${parent}`,
        event: 'Delete',
        groupId: schemaName,
        stage: 'always',
        enabled: true,
        mode: 'rule',
        confidence: 'exact',
        details: { parent, via: str(row.ReferencingAttribute) ?? '', behaviour: 'Cascade', direction: 'inbound', relationship: schemaName, isCustom: row.IsCustomRelationship === true },
        source: { table: 'relationship', id: str(row.MetadataId) ?? schemaName },
    };
}

function lookupSummary(row: Row, kind: 'OneToMany' | 'ManyToOne'): RelationshipSummary {
    return {
        schemaName: str(row.SchemaName) ?? '',
        kind,
        relatedTable: (kind === 'OneToMany' ? str(row.ReferencingEntity) : str(row.ReferencedEntity)) ?? '',
        referencingAttribute: str(row.ReferencingAttribute),
        cascade: cascadeMap(row),
        isCustom: row.IsCustomRelationship === true,
    };
}

function manyToManySummary(row: Row, table: string): RelationshipSummary {
    const e1 = str(row.Entity1LogicalName) ?? '';
    const e2 = str(row.Entity2LogicalName) ?? '';
    return {
        schemaName: str(row.SchemaName) ?? '',
        kind: 'ManyToMany',
        relatedTable: e1 === table ? e2 : e1,
        isCustom: row.IsCustomRelationship === true,
    };
}

function compactLookup(row: Row): Row {
    return {
        SchemaName: row.SchemaName,
        ReferencedEntity: row.ReferencedEntity,
        ReferencedAttribute: row.ReferencedAttribute,
        ReferencingEntity: row.ReferencingEntity,
        ReferencingAttribute: row.ReferencingAttribute,
        CascadeConfiguration: cascadeMap(row),
        IsCustomRelationship: row.IsCustomRelationship === true,
    };
}

function compactManyToMany(row: Row): Row {
    return {
        SchemaName: row.SchemaName,
        Entity1LogicalName: row.Entity1LogicalName,
        Entity2LogicalName: row.Entity2LogicalName,
        IntersectEntityName: row.IntersectEntityName,
        IsCustomRelationship: row.IsCustomRelationship === true,
    };
}

/** Tables this table cascade-deletes into (sorted, de-duplicated) — the children to walk. */
function cascadeDeleteChildren(rows: readonly Row[]): string[] {
    return [...new Set(rows.filter((r) => cascadeMap(r).Delete === 'Cascade').map((r) => str(r.ReferencingEntity)).filter((c): c is string => c !== undefined))].sort();
}

/**
 * One level down: for each child, the tables IT cascade-deletes into. Metadata reads are cached by
 * the client, a failure on one child only costs that child's chain (never the relationships), and
 * the number of children is capped so a hub table cannot fire dozens of extra requests.
 */
async function walkChildCascades(ctx: SourceContext, children: readonly string[], warnings: string[]): Promise<Map<string, CascadeChain>> {
    const walked = children.slice(0, CASCADE_WALK_LIMIT);
    if (children.length > walked.length) {
        warnings.push(`Cascade-delete chains were checked for the first ${CASCADE_WALK_LIMIT} of ${children.length} child tables only`);
    }
    const results = await Promise.all(
        walked.map(async (child): Promise<{ child: string; chain?: CascadeChain; error?: string }> => {
            try {
                const rows = await ctx.client.relatedMetadata(child, 'OneToManyRelationships', ONE_MANY_PROPS);
                return { child, chain: { grandchildren: cascadeDeleteChildren(rows) } };
            } catch (err) {
                if (classifyError(err) === 'aborted') throw err;
                return { child, error: errorMessage(err) };
            }
        }),
    );
    const chains = new Map<string, CascadeChain>();
    // `walked` order (sorted) drives the output so warnings do not depend on which request lost the race.
    for (const { child, chain, error } of results) {
        if (chain) chains.set(child, chain);
        else warnings.push(`Cascade chain below '${child}' could not be read: ${error ?? 'unknown error'}`);
    }
    return chains;
}

export const relationshipsSource: Source = {
    name: 'relationships',
    async run(ctx): Promise<SourceResult> {
        const table = ctx.table.logicalName;
        const [oneToMany, manyToOne, manyToMany] = await Promise.all([
            ctx.client.relatedMetadata(table, 'OneToManyRelationships', ONE_MANY_PROPS),
            ctx.client.relatedMetadata(table, 'ManyToOneRelationships', ONE_MANY_PROPS),
            ctx.client.relatedMetadata(table, 'ManyToManyRelationships', MANY_MANY_PROPS),
        ]);
        const sortRows = (rows: Row[]) => [...rows].sort((a, b) => String(a.SchemaName ?? '').localeCompare(String(b.SchemaName ?? '')));
        const outbound = sortRows(oneToMany);
        const inbound = sortRows(manyToOne);
        const nn = sortRows(manyToMany);

        const warnings: string[] = [];
        const chains = await walkChildCascades(ctx, cascadeDeleteChildren(outbound), warnings);

        const items: LogicItem[] = [];
        for (const row of outbound) items.push(...outboundCascadeItems(row, chains.get(str(row.ReferencingEntity) ?? '')));
        for (const row of inbound) {
            const item = inboundDeleteItem(row);
            if (item) items.push(item);
        }
        const relationships: RelationshipSummary[] = [
            ...outbound.map((r) => lookupSummary(r, 'OneToMany')),
            ...inbound.map((r) => lookupSummary(r, 'ManyToOne')),
            ...nn.map((r) => manyToManySummary(r, table)),
        ].sort(bySchemaName);

        return {
            items,
            relationships,
            warnings: warnings.length > 0 ? warnings : undefined,
            raw: {
                oneToMany: outbound.map(compactLookup),
                manyToOne: inbound.map(compactLookup),
                manyToMany: nn.map(compactManyToMany),
                // child → the tables that child cascade-deletes into (sorted; empty = chain stops there).
                cascadeChains: Object.fromEntries([...chains].sort(([a], [b]) => a.localeCompare(b)).map(([child, chain]) => [child, chain.grandchildren])),
            },
        };
    },
};

/**
 * Alternate keys (EntityKeyMetadata). A key enforces uniqueness of its attribute set on Create and
 * Update once its database index is `Active`; `Pending` / `InProgress` / `Failed` keys exist but do
 * not enforce anything yet, so they are reported disabled. One item per event, tied by `groupId`.
 */
import type { Row } from '../data/client';
import type { LogicItem, WellKnownEvent } from '../domain/model';
import type { Source, SourceResult } from './types';
import { label, str } from './types';

export const KEY_PROPS = ['SchemaName', 'DisplayName', 'KeyAttributes', 'EntityKeyIndexStatus', 'LogicalName', 'MetadataId'];
const KEY_EVENTS: readonly WellKnownEvent[] = ['Create', 'Update'];

function keyAttributes(row: Row): string[] {
    const list: unknown[] = Array.isArray(row.KeyAttributes) ? row.KeyAttributes : [];
    return [...new Set(list.filter((a): a is string => typeof a === 'string').map((a) => a.toLowerCase()))].sort();
}

function compactRow(row: Row): Row {
    return {
        MetadataId: row.MetadataId,
        SchemaName: row.SchemaName,
        LogicalName: row.LogicalName,
        DisplayName: label(row.DisplayName),
        KeyAttributes: keyAttributes(row),
        EntityKeyIndexStatus: row.EntityKeyIndexStatus,
    };
}

/** Two items (Create, Update) for one key; `groupId` is the key's MetadataId. */
export function keyItems(table: string, row: Row): LogicItem[] {
    const schemaName = str(row.SchemaName) ?? str(row.LogicalName) ?? '';
    const id = str(row.MetadataId) ?? `${table}:${schemaName}`;
    const displayName = label(row.DisplayName, schemaName);
    const status = str(row.EntityKeyIndexStatus) ?? 'Active';
    const attributes = keyAttributes(row);
    return KEY_EVENTS.map((event) => ({
        id: `key:${id}:${event}`,
        kind: 'key',
        name: displayName,
        event,
        groupId: id,
        stage: 'always',
        enabled: status === 'Active',
        mode: 'rule',
        touchesColumns: attributes,
        confidence: 'exact',
        details: { schemaName, displayName, status, logicalName: str(row.LogicalName), attributes },
        source: { table: 'entitykey', id },
    }));
}

export const keysSource: Source = {
    name: 'keys',
    async run(ctx): Promise<SourceResult> {
        const table = ctx.table.logicalName;
        const keys = await ctx.client.relatedMetadata(table, 'Keys', KEY_PROPS);
        const sorted = [...keys].sort((a, b) => String(a.SchemaName ?? '').localeCompare(String(b.SchemaName ?? '')) || String(a.MetadataId ?? '').localeCompare(String(b.MetadataId ?? '')));
        const items = sorted.flatMap((row) => keyItems(table, row));
        return { items, raw: sorted.map(compactRow) };
    },
};

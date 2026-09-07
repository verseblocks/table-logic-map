/**
 * Table metadata → `TableFacts` (design guide §5.1). One `EntityDefinitions(LogicalName='x')`
 * request; buildLogicMap treats a missing table as fatal because every other source needs the facts.
 */
import type { Source } from './types';
import { label, boolValue } from './types';
import type { TableFacts } from '../domain/model';

const PROPS = ['LogicalName', 'SchemaName', 'DisplayName', 'EntitySetName', 'MetadataId', 'OwnershipType', 'IsCustomEntity', 'IsActivity', 'HasActivities', 'HasNotes', 'IsAuditEnabled', 'ChangeTrackingEnabled', 'IsDuplicateDetectionEnabled', 'IsBPFEntity', 'PrimaryIdAttribute', 'PrimaryNameAttribute', 'IsCustomizable', 'ObjectTypeCode'];

export const tableMetaSource: Source = {
    name: 'tableMeta',
    async run(ctx) {
        const m = await ctx.client.entityMetadata(ctx.table.logicalName, PROPS);
        const facts: TableFacts = {
            logicalName: String(m.LogicalName ?? ctx.table.logicalName),
            schemaName: String(m.SchemaName ?? ''),
            entitySetName: String(m.EntitySetName ?? ''),
            metadataId: String(m.MetadataId ?? ''),
            displayName: label(m.DisplayName, String(m.LogicalName ?? ctx.table.logicalName)),
            primaryIdAttribute: typeof m.PrimaryIdAttribute === 'string' ? m.PrimaryIdAttribute : undefined,
            primaryNameAttribute: typeof m.PrimaryNameAttribute === 'string' ? m.PrimaryNameAttribute : undefined,
            objectTypeCode: typeof m.ObjectTypeCode === 'number' ? m.ObjectTypeCode : undefined,
            ownership: String(m.OwnershipType ?? ''),
            isActivity: m.IsActivity === true,
            isCustom: m.IsCustomEntity === true,
            isCustomizable: boolValue(m.IsCustomizable, true),
            isBpfEntity: m.IsBPFEntity === true,
            audit: boolValue(m.IsAuditEnabled),
            changeTracking: m.ChangeTrackingEnabled === true,
            duplicateDetection: m.IsDuplicateDetectionEnabled === true,
            hasNotes: m.HasNotes === true,
            hasActivities: m.HasActivities === true,
        };
        return { items: [], tableFacts: facts, raw: m };
    },
};

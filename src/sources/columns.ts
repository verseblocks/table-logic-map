/**
 * Columns of the table (AttributeMetadata) and the data rules that live on them.
 *
 * The request deliberately carries **no** property list: derived properties such as
 * `FormulaDefinition`, `SourceType` and `AutoNumberFormat` are only returned when no `$select`
 * is applied (docs/verified.md #7). Shadow attributes (`AttributeOf` set: `*name`, `*_base`, yomi)
 * are not real columns and are skipped.
 *
 * Items produced per column:
 *  - `formula` / `calculated` / `rollup` (SourceType 3 / 1 / 2): event `Any`, stage `always`.
 *    Formula and calculated definitions are scanned for column names (heuristic); rollups aggregate
 *    related rows and are reported `exact` without column guesses.
 *  - `autonumber`: the platform fills the value in the pre-operation stage of Create.
 *  - `requiredcolumn`: ApplicationRequired / SystemRequired is enforced by forms, not the API,
 *    so it sits on `FormSave` / `client`. The primary key (Uniqueidentifier) is skipped.
 */
import type { Row } from '../data/client';
import { ATTRIBUTE_SOURCE_TYPE } from '../domain/codes';
import type { ColumnInfo, LogicItem } from '../domain/model';
import { extractFormulaColumns } from '../parsers/formula';
import type { Source, SourceContext, SourceResult } from './types';
import { boolValue, label, str } from './types';

export const REQUIRED_LEVEL_NOTE = 'Required level is enforced by forms/UI, not by the API';
const REQUIRED_LEVELS = new Set(['ApplicationRequired', 'SystemRequired']);

/** `RequiredLevel` is a managed property: `{ Value: 'None' | 'Recommended' | 'ApplicationRequired' | 'SystemRequired', ... }`. */
export function requiredLevel(row: Row): string {
    const rl = row.RequiredLevel;
    if (rl && typeof rl === 'object' && 'Value' in rl) {
        const v = (rl as { Value: unknown }).Value;
        if (typeof v === 'string') return v;
    }
    return 'None';
}

/** Attributes with `AttributeOf` are virtual companions of another column (e.g. `ownerid` → `owneridname`). */
export function isShadowAttribute(row: Row): boolean {
    return str(row.AttributeOf) !== undefined;
}

export function toColumnInfo(row: Row): ColumnInfo {
    const logicalName = str(row.LogicalName) ?? '';
    const sourceType = typeof row.SourceType === 'number' ? ATTRIBUTE_SOURCE_TYPE[row.SourceType] : undefined;
    const autoNumber = str(row.AutoNumberFormat);
    const col: ColumnInfo = {
        logicalName,
        displayName: label(row.DisplayName, logicalName),
        type: str(row.AttributeType) ?? 'Unknown',
        required: REQUIRED_LEVELS.has(requiredLevel(row)),
        secured: row.IsSecured === true,
        audited: boolValue(row.IsAuditEnabled),
        sourceType: sourceType ?? 'simple',
        isCustom: row.IsCustomAttribute === true,
        triggers: [],
        touchedBy: [],
    };
    if (autoNumber) col.autoNumber = autoNumber;
    return col;
}

function columnItems(ctx: SourceContext, row: Row, col: ColumnInfo, known: ReadonlySet<string>): LogicItem[] {
    const table = ctx.table.logicalName;
    const source = { table: 'attribute', id: str(row.MetadataId) };
    const items: LogicItem[] = [];

    if (col.sourceType !== 'simple') {
        const kind = col.sourceType;
        const formula = str(row.FormulaDefinition);
        // Rollups aggregate related rows; only formula / calculated definitions reference this table's columns.
        const heuristic = kind === 'formula' || kind === 'calculated';
        const item: LogicItem = {
            id: `${kind}:${table}:${col.logicalName}`,
            kind,
            name: col.displayName,
            event: 'Any',
            stage: 'always',
            enabled: true,
            mode: 'rule',
            confidence: heuristic ? 'heuristic' : 'exact',
            details: { column: col.logicalName, displayName: col.displayName, formula, sourceType: kind },
            source,
        };
        if (heuristic) item.touchesColumns = extractFormulaColumns(formula, known);
        items.push(item);
    }

    if (col.autoNumber) {
        items.push({
            id: `autonumber:${table}:${col.logicalName}`,
            kind: 'autonumber',
            name: col.displayName,
            event: 'Create',
            stage: 'preoperation',
            enabled: true,
            mode: 'rule',
            confidence: 'exact',
            touchesColumns: [col.logicalName],
            details: { column: col.logicalName, displayName: col.displayName, format: col.autoNumber },
            source,
        });
    }

    if (col.required && col.type !== 'Uniqueidentifier') {
        items.push({
            id: `requiredcolumn:${table}:${col.logicalName}`,
            kind: 'requiredcolumn',
            name: col.displayName,
            event: 'FormSave',
            stage: 'client',
            enabled: true,
            mode: 'client',
            confidence: 'exact',
            touchesColumns: [col.logicalName],
            details: { column: col.logicalName, displayName: col.displayName, level: requiredLevel(row), note: REQUIRED_LEVEL_NOTE },
            source,
        });
    }
    return items;
}

function compactRow(row: Row): Row {
    return {
        LogicalName: row.LogicalName,
        AttributeType: row.AttributeType,
        RequiredLevel: requiredLevel(row),
        IsSecured: row.IsSecured === true,
        IsAuditEnabled: boolValue(row.IsAuditEnabled),
        SourceType: typeof row.SourceType === 'number' ? row.SourceType : null,
        AutoNumberFormat: str(row.AutoNumberFormat) ?? null,
        hasFormula: str(row.FormulaDefinition) !== undefined,
    };
}

export const columnsSource: Source = {
    name: 'columns',
    async run(ctx): Promise<SourceResult> {
        const attributes = await ctx.client.relatedMetadata(ctx.table.logicalName, 'Attributes');
        const rows = attributes.filter((a) => !isShadowAttribute(a) && str(a.LogicalName)).sort((a, b) => String(a.LogicalName).localeCompare(String(b.LogicalName)));
        const columns = rows.map(toColumnInfo);
        // Known columns come from this very result (ctx.knownColumns is still empty while we run).
        const known = new Set(columns.map((c) => c.logicalName));
        const items: LogicItem[] = [];
        rows.forEach((row, i) => items.push(...columnItems(ctx, row, columns[i], known)));
        return { items, columns, raw: rows.map(compactRow) };
    },
};

/**
 * Formula column reference extraction (design guide §5.2, docs/verified.md #7).
 *
 * `AttributeMetadata.FormulaDefinition` holds the Power Fx expression of a formula column
 * (`SourceType` 3). Power Fx references columns by logical name (`contoso_budget`) or, as the
 * maker UI writes them, by display name in single quotes (`'Budget Amount'`); string literals use
 * double quotes with `""` as the escape; line and block comments are ignored. We match tokens
 * against the table's known logical names, which is heuristic: a column called e.g. `name` also
 * matches the Power Fx `Name` function.
 */

/** `contoso_budgetamount` → `budgetamount`; system columns have no publisher prefix and are returned unchanged. */
function withoutPrefix(logicalName: string): string {
    return logicalName.replace(/^[a-z0-9]+_/, '');
}

/**
 * Resolve a single-quoted identifier (`'Budget Amount'`, `'contoso_budget'`) to known logical names.
 * A display name matches when, lower-cased with non-alphanumerics removed, it equals a known
 * logical name or a known logical name without its publisher prefix (exact full-name matches win).
 */
function resolveQuotedIdentifier(identifier: string, knownColumns: ReadonlySet<string>): string[] {
    const quoted = identifier.trim().toLowerCase();
    if (!quoted) return [];
    if (knownColumns.has(quoted)) return [quoted];
    const compact = quoted.replace(/[^a-z0-9_]/g, '');
    if (!compact) return [];
    if (knownColumns.has(compact)) return [compact];
    const matches: string[] = [];
    for (const column of knownColumns) if (withoutPrefix(column) === compact) matches.push(column);
    return matches;
}

/**
 * Logical names of `knownColumns` referenced by a Power Fx formula, sorted unique. Tokens inside
 * double-quoted string literals and comments are ignored. Returns `[]` for empty input or when no
 * columns are known.
 */
export function extractFormulaColumns(formula: string | null | undefined, knownColumns: ReadonlySet<string>): string[] {
    if (typeof formula !== 'string' || !formula.trim() || knownColumns.size === 0) return [];
    const found = new Set<string>();

    // 1. Drop double-quoted string literals ("" escapes a quote), then comments.
    let text = formula.replace(/"(?:[^"]|"")*"/g, ' ');
    text = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

    // 2. Single-quoted identifiers: display names or logical names ('' escapes a quote).
    text = text.replace(/'((?:[^']|'')*)'/g, (_match, inner: string) => {
        for (const column of resolveQuotedIdentifier(inner.replace(/''/g, "'"), knownColumns)) found.add(column);
        return ' ';
    });

    // 3. Plain identifiers, matched case-insensitively against logical names.
    for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
        const token = m[0].toLowerCase();
        if (knownColumns.has(token)) found.add(token);
    }
    return [...found].sort();
}

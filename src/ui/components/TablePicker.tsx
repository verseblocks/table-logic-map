/**
 * Searchable table picker: free text matches display *and* logical name; a "Recent" group lists
 * the last tables run on this connection. Selecting (or pressing Enter on an exact/single match)
 * runs the map.
 */
import { Combobox, Option, OptionGroup, Spinner, Text } from '@fluentui/react-components';
import { useMemo, useState } from 'react';
import { useAppStore, type TableSummary } from '../store';

function matches(t: TableSummary, q: string): boolean {
    return t.logicalName.includes(q) || t.displayName.toLowerCase().includes(q) || t.schemaName.toLowerCase().includes(q);
}

/** Exact logical name beats display-name prefix beats anything else, so Enter is predictable. */
function rank(t: TableSummary, q: string): number {
    if (t.logicalName === q) return 0;
    if (t.logicalName.startsWith(q)) return 1;
    if (t.displayName.toLowerCase().startsWith(q)) return 2;
    return 3;
}

export function TablePicker() {
    const tables = useAppStore((s) => s.tables);
    const tablesStatus = useAppStore((s) => s.tablesStatus);
    const tablesError = useAppStore((s) => s.tablesError);
    const recent = useAppStore((s) => s.recent);
    const selectedTable = useAppStore((s) => s.selectedTable);
    const selectTable = useAppStore((s) => s.selectTable);
    const runMap = useAppStore((s) => s.runMap);
    const running = useAppStore((s) => s.run.status === 'running');

    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);

    const byName = useMemo(() => new Map(tables.map((t) => [t.logicalName, t])), [tables]);
    const q = query.trim().toLowerCase();

    const filtered = useMemo(() => {
        const list = q ? tables.filter((t) => matches(t, q)) : tables;
        const sorted = q ? [...list].sort((a, b) => rank(a, q) - rank(b, q) || a.displayName.localeCompare(b.displayName)) : list;
        return sorted;
    }, [tables, q]);

    const recentTables = useMemo(() => recent.map((name) => byName.get(name)).filter((t): t is TableSummary => !!t && (!q || matches(t, q))), [recent, byName, q]);

    const selectedSummary = selectedTable ? byName.get(selectedTable) : undefined;
    const displayValue = selectedSummary ? `${selectedSummary.displayName} (${selectedSummary.logicalName})` : (selectedTable ?? '');

    const choose = (logicalName: string) => {
        selectTable(logicalName);
        setQuery('');
        setOpen(false);
        void runMap(logicalName);
    };

    const onEnter = () => {
        if (!q) return;
        const exact = byName.get(q);
        const target = exact ?? (filtered.length === 1 ? filtered[0] : filtered.find((t) => rank(t, q) <= 1));
        if (target) choose(target.logicalName);
    };

    /**
     * Fluent merges its own trigger keydown handler *before* this one (`useTriggerSlot` ->
     * `mergeCallbacks(useTriggerKeydown(...), trigger.onKeyDown)`), and with the popup open Enter is
     * its `CloseSelect` action: it selects the active (arrow-highlighted / type-ahead) option and
     * fires `onOptionSelect`, which already runs that table. Running the free-text match on top of
     * that would build a *different* table and cancel the first run, so the free-text fallback must
     * only apply when Fluent has no option it will act on. `aria-activedescendant` on the input is
     * the activedescendant utilities' own record of that option (@fluentui/react-combobox 9.17.5);
     * the disabled "No table matches" option is highlightable but never selected, so it does not
     * count. `e.defaultPrevented` cannot be used: Fluent calls `preventDefault()` for the
     * `Open` action too.
     */
    const fluentWillSelectOption = (input: HTMLInputElement): boolean => {
        const activeId = input.getAttribute('aria-activedescendant');
        if (!activeId) return false;
        const option = input.ownerDocument.getElementById(activeId);
        if (!option) return false;
        return option.getAttribute('aria-disabled') !== 'true' && !option.hasAttribute('disabled');
    };

    // Every matching table is rendered: a Dataverse org has on the order of a thousand tables and
    // truncating the list hides the very one someone is hunting for. The listbox scrolls and the
    // search box narrows, so browsing stays practical. If this ever becomes slow on a very large
    // org, virtualize the listbox (react-virtual is already a dependency) rather than capping it.
    const shown = filtered;

    return (
        <div className="tlm-row tlm-row-nowrap" style={{ flex: '1 1 320px', minWidth: 240, maxWidth: 560 }}>
            <Combobox
                aria-label="Table"
                placeholder={tablesStatus === 'loading' ? 'Loading tables…' : 'Search tables by display or logical name'}
                freeform
                open={open}
                onOpenChange={(_, data) => setOpen(data.open)}
                value={open || query ? query : displayValue}
                selectedOptions={selectedTable ? [selectedTable] : []}
                onInput={(e) => {
                    setQuery((e.target as HTMLInputElement).value);
                    setOpen(true);
                }}
                onOptionSelect={(_, data) => {
                    if (data.optionValue) choose(data.optionValue);
                }}
                onKeyDown={(e) => {
                    if (e.key !== 'Enter' || !q) return;
                    if (open && fluentWillSelectOption(e.currentTarget)) return; // Fluent already chose the highlighted option
                    e.preventDefault();
                    onEnter();
                }}
                onBlur={() => setQuery('')}
                disabled={tablesStatus === 'loading'}
                style={{ flex: '1 1 auto', minWidth: 0 }}
                listbox={{ style: { maxHeight: 360 } }}
            >
                {recentTables.length > 0 && (
                    <OptionGroup label="Recent">
                        {recentTables.map((t) => (
                            <Option key={`recent:${t.logicalName}`} value={t.logicalName} text={`${t.displayName} (${t.logicalName})`}>
                                {t.displayName} <span className="tlm-muted">({t.logicalName})</span>
                            </Option>
                        ))}
                    </OptionGroup>
                )}
                <OptionGroup label={q ? `Matches (${filtered.length})` : `All tables (${tables.length})`}>
                    {shown.map((t) => (
                        <Option key={t.logicalName} value={t.logicalName} text={`${t.displayName} (${t.logicalName})`}>
                            {t.displayName} <span className="tlm-muted">({t.logicalName})</span>
                        </Option>
                    ))}
                    {shown.length === 0 && (
                        <Option key="__none" value="__none" text="" disabled>
                            No table matches "{query}"
                        </Option>
                    )}
                </OptionGroup>
            </Combobox>
            {tablesStatus === 'loading' && <Spinner size="tiny" aria-label="Loading tables" />}
            {running && <Spinner size="tiny" aria-label="Building map" />}
            {tablesStatus === 'error' && (
                <Text size={200} style={{ color: 'var(--colorPaletteRedForeground1)' }} title={tablesError}>
                    Could not load tables
                </Text>
            )}
        </div>
    );
}

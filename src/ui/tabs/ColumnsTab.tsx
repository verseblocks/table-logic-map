/** Columns tab: searchable grid of columns with Triggers / Touched by chips; virtualised over 200 rows. */
import { Badge, SearchBox, Switch, Text } from '@fluentui/react-components';
import { useMemo, useState } from 'react';
import type { ColumnInfo } from '../../domain/model';
import { useItemIndex, useVisibleMap } from '../hooks/useVisibleMap';
import { ItemChips } from '../components/Chips';
import { EmptyState, PartialSkeleton } from '../components/Primitives';
import { VirtualList, type VirtualColumn } from '../components/VirtualList';

const COLUMNS: readonly VirtualColumn[] = [
    { key: 'logicalName', label: 'Logical name', width: 'minmax(180px, 1.2fr)' },
    { key: 'displayName', label: 'Display name', width: 'minmax(160px, 1fr)' },
    { key: 'type', label: 'Type', width: '110px' },
    { key: 'required', label: 'Required', width: '70px' },
    { key: 'secured', label: 'Secured', width: '70px' },
    { key: 'audited', label: 'Audited', width: '70px' },
    { key: 'sourceType', label: 'Source', width: '90px' },
    { key: 'autoNumber', label: 'Autonumber', width: '130px' },
    { key: 'triggers', label: 'Triggers', width: 'minmax(200px, 1.4fr)' },
    { key: 'touchedBy', label: 'Touched by', width: 'minmax(200px, 1.4fr)' },
];

function yesNo(v: boolean) {
    return v ? <Badge size="small" appearance="tint" color="brand">yes</Badge> : <span className="tlm-muted">—</span>;
}

export function ColumnsTab() {
    const map = useVisibleMap();
    const index = useItemIndex();
    const [search, setSearch] = useState('');
    const [onlyLogic, setOnlyLogic] = useState(false);

    const rows = useMemo(() => {
        const all = Object.values(map?.columns ?? {}).sort((a, b) => a.logicalName.localeCompare(b.logicalName));
        const q = search.trim().toLowerCase();
        return all.filter((c) => {
            if (onlyLogic && c.triggers.length === 0 && c.touchedBy.length === 0 && c.sourceType === 'simple' && !c.autoNumber && !c.secured) return false;
            return !q || c.logicalName.includes(q) || c.displayName.toLowerCase().includes(q) || c.type.toLowerCase().includes(q);
        });
    }, [map, search, onlyLogic]);

    if (!map) return <EmptyState title="No table selected" />;
    const total = Object.keys(map.columns).length;
    if (total === 0) {
        return (
            <>
                <EmptyState title="No columns loaded yet" hint="Column metadata appears as soon as the Columns source completes." />
                <PartialSkeleton map={map} />
            </>
        );
    }

    const renderCell = (c: ColumnInfo, col: VirtualColumn) => {
        switch (col.key) {
            case 'logicalName':
                return (
                    <code title={c.isCustom ? `${c.logicalName} (custom)` : c.logicalName}>{c.logicalName}</code>
                );
            case 'displayName':
                return <span title={c.displayName}>{c.displayName}</span>;
            case 'type':
                return c.type;
            case 'required':
                return yesNo(c.required);
            case 'secured':
                return yesNo(c.secured);
            case 'audited':
                return yesNo(c.audited);
            case 'sourceType':
                return c.sourceType === 'simple' ? <span className="tlm-muted">simple</span> : <Badge size="small" appearance="tint" color="important">{c.sourceType}</Badge>;
            case 'autoNumber':
                return c.autoNumber ? <code title={c.autoNumber}>{c.autoNumber}</code> : <span className="tlm-muted">—</span>;
            case 'triggers':
                return <ItemChips ids={c.triggers} index={index} max={4} />;
            case 'touchedBy':
                return <ItemChips ids={c.touchedBy} index={index} max={4} />;
            default:
                return null;
        }
    };

    return (
        <div className="tlm-fill">
            <div className="tlm-row" role="toolbar" aria-label="Column filters">
                <SearchBox size="small" placeholder="Search columns" value={search} onChange={(_, d) => setSearch(d.value)} style={{ minWidth: 220 }} aria-label="Search columns" />
                <Switch label="Only columns with logic" checked={onlyLogic} onChange={(_, d) => setOnlyLogic(d.checked)} />
                <Text size={200} className="tlm-muted">
                    {rows.length} of {total} columns
                </Text>
            </div>
            {rows.length === 0 ? (
                <EmptyState title="No columns match" />
            ) : (
                <div style={{ flex: '1 1 auto', minHeight: 0 }}>
                    <VirtualList rows={rows} columns={COLUMNS} rowKey={(c) => c.logicalName} renderCell={renderCell} rowHeight={32} ariaLabel="Columns" />
                </div>
            )}
            <PartialSkeleton map={map} rows={1} />
        </div>
    );
}

/** Everything tab: flat, virtualised list of every visible item with kind/event/stage/enabled filters. */
import { Dropdown, Option, SearchBox, Text } from '@fluentui/react-components';
import { useMemo, useState } from 'react';
import { STAGE_LABEL, STAGE_ORDER, compareEvents, compareItems, type EventName, type LogicItem, type LogicKind, type Stage } from '../../domain/model';
import { itemMatches, useVisibleMap } from '../hooks/useVisibleMap';
import { useAppStore } from '../store';
import { KIND_LABEL, KIND_ORDER } from '../theme';
import { DisabledBadge, HeuristicBadge, ModeBadge } from '../components/Badges';
import { AttributeChips } from '../components/Chips';
import { KindIcon } from '../components/KindIcon';
import { EmptyState, PartialSkeleton } from '../components/Primitives';
import { VirtualList, type VirtualColumn } from '../components/VirtualList';

const COLUMNS: readonly VirtualColumn[] = [
    { key: 'kind', label: 'Kind', width: '150px' },
    { key: 'name', label: 'Name', width: 'minmax(220px, 2fr)' },
    { key: 'event', label: 'Event', width: '120px' },
    { key: 'stage', label: 'Stage', width: '150px' },
    { key: 'mode', label: 'Mode', width: '90px' },
    { key: 'rank', label: 'Rank', width: '55px' },
    { key: 'enabled', label: 'Enabled', width: '80px' },
    { key: 'filtering', label: 'Filtering', width: 'minmax(200px, 1.5fr)' },
    { key: 'confidence', label: 'Confidence', width: '90px' },
];

type EnabledFilter = 'all' | 'enabled' | 'disabled';

export function EverythingTab() {
    const map = useVisibleMap();
    const selectItem = useAppStore((s) => s.selectItem);
    const selectedItemId = useAppStore((s) => s.selectedItemId);
    const [search, setSearch] = useState('');
    const [kinds, setKinds] = useState<LogicKind[]>([]);
    const [events, setEvents] = useState<EventName[]>([]);
    const [stages, setStages] = useState<Stage[]>([]);
    const [enabled, setEnabled] = useState<EnabledFilter>('all');

    const allEvents = useMemo(() => [...new Set((map?.items ?? []).map((i) => i.event))].sort(compareEvents), [map]);
    const allKinds = useMemo(() => KIND_ORDER.filter((k) => map?.items.some((i) => i.kind === k)), [map]);

    const rows = useMemo(() => {
        const kindSet = kinds.length ? new Set(kinds) : undefined;
        const eventSet = events.length ? new Set(events) : undefined;
        const stageSet = stages.length ? new Set(stages) : undefined;
        return (map?.items ?? [])
            .filter((i) => (!kindSet || kindSet.has(i.kind)) && (!eventSet || eventSet.has(i.event)) && (!stageSet || stageSet.has(i.stage)))
            .filter((i) => enabled === 'all' || (enabled === 'enabled') === i.enabled)
            .filter((i) => itemMatches(i, search))
            .sort((a, b) => compareEvents(a.event, b.event) || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || compareItems(a, b));
    }, [map, kinds, events, stages, enabled, search]);

    if (!map) return <EmptyState title="No table selected" />;

    const renderCell = (item: LogicItem, col: VirtualColumn) => {
        switch (col.key) {
            case 'kind':
                return (
                    <span className="tlm-row tlm-row-nowrap" style={{ gap: 4 }}>
                        <KindIcon kind={item.kind} size={14} />
                        {KIND_LABEL[item.kind]}
                    </span>
                );
            case 'name':
                return (
                    <span title={item.name} style={{ fontWeight: 600, textDecoration: item.enabled ? undefined : 'line-through' }}>
                        {item.name}
                    </span>
                );
            case 'event':
                return item.event;
            case 'stage':
                return STAGE_LABEL[item.stage];
            case 'mode':
                return <ModeBadge mode={item.mode} />;
            case 'rank':
                return item.order !== undefined ? `#${item.order}` : '';
            case 'enabled':
                return item.enabled ? 'yes' : <DisabledBadge enabled={false} />;
            case 'filtering':
                return item.filteringAttributes && item.filteringAttributes.length > 0 ? <AttributeChips values={item.filteringAttributes} max={3} /> : <span className="tlm-muted">—</span>;
            case 'confidence':
                return item.confidence === 'heuristic' ? <HeuristicBadge confidence="heuristic" /> : <span className="tlm-muted">exact</span>;
            default:
                return null;
        }
    };

    return (
        <div className="tlm-fill">
            <div className="tlm-row" role="toolbar" aria-label="Item filters">
                <SearchBox size="small" placeholder="Search" value={search} onChange={(_, d) => setSearch(d.value)} style={{ minWidth: 200 }} aria-label="Search items" />
                <Dropdown size="small" multiselect placeholder="All kinds" aria-label="Kind" selectedOptions={kinds} onOptionSelect={(_, d) => setKinds(d.selectedOptions as LogicKind[])} style={{ minWidth: 150 }} button={kinds.length ? `${kinds.length} kinds` : undefined}>
                    {allKinds.map((k) => (
                        <Option key={k} value={k} text={KIND_LABEL[k]}>
                            {KIND_LABEL[k]}
                        </Option>
                    ))}
                </Dropdown>
                <Dropdown size="small" multiselect placeholder="All events" aria-label="Event" selectedOptions={events} onOptionSelect={(_, d) => setEvents(d.selectedOptions as EventName[])} style={{ minWidth: 140 }} button={events.length ? `${events.length} events` : undefined}>
                    {allEvents.map((e) => (
                        <Option key={e} value={e} text={e}>
                            {e}
                        </Option>
                    ))}
                </Dropdown>
                <Dropdown size="small" multiselect placeholder="All stages" aria-label="Stage" selectedOptions={stages} onOptionSelect={(_, d) => setStages(d.selectedOptions as Stage[])} style={{ minWidth: 150 }} button={stages.length ? `${stages.length} stages` : undefined}>
                    {STAGE_ORDER.map((s) => (
                        <Option key={s} value={s} text={STAGE_LABEL[s]}>
                            {STAGE_LABEL[s]}
                        </Option>
                    ))}
                </Dropdown>
                <Dropdown size="small" aria-label="Enabled" selectedOptions={[enabled]} value={enabled === 'all' ? 'Enabled and disabled' : enabled === 'enabled' ? 'Enabled only' : 'Disabled only'} onOptionSelect={(_, d) => setEnabled((d.optionValue as EnabledFilter) ?? 'all')} style={{ minWidth: 150 }}>
                    <Option value="all">Enabled and disabled</Option>
                    <Option value="enabled">Enabled only</Option>
                    <Option value="disabled">Disabled only</Option>
                </Dropdown>
                <Text size={200} className="tlm-muted">
                    {rows.length} of {map.items.length} items
                </Text>
            </div>
            {rows.length === 0 ? (
                <EmptyState title={map.items.length === 0 ? 'No logic on this table' : 'Nothing matches the current filters'} />
            ) : (
                <div style={{ flex: '1 1 auto', minHeight: 0 }}>
                    <VirtualList rows={rows} columns={COLUMNS} rowKey={(i) => i.id} renderCell={renderCell} rowHeight={32} onRowClick={(i) => selectItem(i.id)} isSelected={(i) => i.id === selectedItemId} ariaLabel="All items" />
                </div>
            )}
            <PartialSkeleton map={map} rows={1} />
        </div>
    );
}

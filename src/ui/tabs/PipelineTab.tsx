/**
 * Pipeline tab: event pills → one card per event → one row per stage (STAGE_ORDER) with the
 * items in execution order. Search / kind filters are local to the view; enabled-only and
 * system-step switches live in the store because export honours them too.
 */
import { Card, CardHeader, Dropdown, Option, SearchBox, Switch, Text, ToggleButton, Tooltip } from '@fluentui/react-components';
import { useMemo } from 'react';
import { stageOrderNote } from '../../classify';
import { STAGE_LABEL, STAGE_ORDER, compareEvents, type EventName, type LogicItem, type LogicKind, type LogicMap, type Smell, type Stage } from '../../domain/model';
import { itemMatches, useVisibleMap } from '../hooks/useVisibleMap';
import { useAppStore } from '../store';
import { KIND_LABEL, KIND_ORDER } from '../theme';
import { ItemRow, itemCaption } from '../components/ItemRow';
import { EmptyState, PartialSkeleton } from '../components/Primitives';

interface EventBucket {
    event: EventName;
    rows: Record<Stage, LogicItem[]>;
    count: number;
}

function buildBuckets(map: LogicMap, search: string, kinds: readonly LogicKind[]): EventBucket[] {
    const kindSet = kinds.length > 0 ? new Set(kinds) : undefined;
    const keep = (i: LogicItem) => (!kindSet || kindSet.has(i.kind)) && itemMatches(i, search);
    const events = Object.keys(map.pipeline) as EventName[];
    return events
        .sort(compareEvents)
        .map((event) => {
            const source = map.pipeline[event];
            const rows = {} as Record<Stage, LogicItem[]>;
            let count = 0;
            for (const stage of STAGE_ORDER) {
                rows[stage] = (source?.[stage] ?? []).filter(keep);
                count += rows[stage].length;
            }
            return { event, rows, count };
        })
        .filter((b) => b.count > 0);
}

function EventCard({ bucket, smells }: { bucket: EventBucket; smells: ReadonlyMap<string, Smell> }) {
    return (
        <Card size="small" appearance="filled" role="region" aria-label={`${bucket.event} pipeline`}>
            <CardHeader
                header={
                    <Text weight="semibold" size={400}>
                        {bucket.event}
                    </Text>
                }
                description={<Text size={200} className="tlm-muted">{bucket.count} {bucket.count === 1 ? 'item' : 'items'}</Text>}
            />
            <div>
                {STAGE_ORDER.map((stage) => {
                    const items = bucket.rows[stage];
                    const note = stageOrderNote(items, stage);
                    return (
                        <div key={stage} className="tlm-stage-row">
                            <div className="tlm-stage-label">{STAGE_LABEL[stage]}</div>
                            <div className="tlm-stage-items">
                                {items.length === 0 ? (
                                    <span className="tlm-stage-empty" aria-label="no items">
                                        —
                                    </span>
                                ) : (
                                    items.map((item) => <ItemRow key={item.id} item={item} smells={smells} caption={itemCaption(item)} />)
                                )}
                                {note && (
                                    <Text size={100} className="tlm-muted" style={{ paddingLeft: 6 }}>
                                        {note}
                                    </Text>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

export function PipelineTab() {
    const map = useVisibleMap();
    const filters = useAppStore((s) => s.filters);
    const setFilters = useAppStore((s) => s.setFilters);
    const running = useAppStore((s) => s.run.status === 'running');
    const smells = useMemo(() => new Map((map?.smells ?? []).map((s) => [s.id, s])), [map]);
    const buckets = useMemo(() => (map ? buildBuckets(map, filters.search, filters.kinds) : []), [map, filters.search, filters.kinds]);
    const total = buckets.reduce((n, b) => n + b.count, 0);
    const shown = filters.event ? buckets.filter((b) => b.event === filters.event) : buckets;
    // A selected event/kind that this map has no items for (e.g. carried over from the table that
    // was open before) must stay visible, otherwise the view is empty with no filter to un-tick.
    const eventPills = useMemo(() => {
        const events = buckets.map((b) => ({ event: b.event, count: b.count }));
        return filters.event && !events.some((e) => e.event === filters.event) ? [...events, { event: filters.event, count: 0 }] : events;
    }, [buckets, filters.event]);
    const availableKinds = useMemo(() => KIND_ORDER.filter((k) => filters.kinds.includes(k) || map?.items.some((i) => i.kind === k)), [map, filters.kinds]);

    if (!map) {
        return running ? <PartialSkeleton map={undefined} /> : <EmptyState title="No table selected" hint="Choose a table in the header to build its logic map." />;
    }

    return (
        <div>
            <div className="tlm-row" style={{ marginBottom: 8 }} role="toolbar" aria-label="Pipeline filters">
                <SearchBox size="small" placeholder="Search name, details, columns" value={filters.search} onChange={(_, d) => setFilters({ search: d.value })} style={{ minWidth: 220 }} aria-label="Search items" />
                <Dropdown
                    size="small"
                    multiselect
                    placeholder="All kinds"
                    aria-label="Kind filter"
                    selectedOptions={filters.kinds}
                    onOptionSelect={(_, d) => setFilters({ kinds: d.selectedOptions as LogicKind[] })}
                    style={{ minWidth: 160 }}
                    button={filters.kinds.length > 0 ? `${filters.kinds.length} ${filters.kinds.length === 1 ? 'kind' : 'kinds'}` : undefined}
                >
                    {availableKinds.map((k) => (
                        <Option key={k} value={k} text={KIND_LABEL[k]}>
                            {KIND_LABEL[k]}
                        </Option>
                    ))}
                </Dropdown>
                <Switch label="Enabled only" checked={filters.enabledOnly} onChange={(_, d) => setFilters({ enabledOnly: d.checked })} />
                <Tooltip content="Include hidden Microsoft/system plugin steps (ishidden)" relationship="description" withArrow>
                    <Switch label="Show Microsoft/system steps" checked={filters.showSystemSteps} onChange={(_, d) => setFilters({ showSystemSteps: d.checked })} />
                </Tooltip>
            </div>
            <div className="tlm-row" style={{ marginBottom: 12 }} role="group" aria-label="Events">
                <ToggleButton size="small" shape="circular" checked={!filters.event} onClick={() => setFilters({ event: undefined })}>
                    All events ({total})
                </ToggleButton>
                {eventPills.map((b) => (
                    <ToggleButton key={b.event} size="small" shape="circular" checked={filters.event === b.event} onClick={() => setFilters({ event: filters.event === b.event ? undefined : b.event })}>
                        {b.event} ({b.count})
                    </ToggleButton>
                ))}
            </div>
            {shown.length === 0 ? (
                <EmptyState title={map.items.length === 0 ? 'No logic on this table' : 'Nothing matches the current filters'} hint={map.items.length === 0 ? 'No plugins, processes, flows, form logic or data rules were found.' : 'Clear the search, kind or event filters to see more.'} />
            ) : (
                <div className="tlm-card-stack">
                    {shown.map((b) => (
                        <EventCard key={b.event} bucket={b} smells={smells} />
                    ))}
                </div>
            )}
            <PartialSkeleton map={map} />
        </div>
    );
}

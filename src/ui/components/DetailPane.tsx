/**
 * Right-hand detail pane for the selected item. Width is dragged via the left handle;
 * the pane can collapse to a slim strip without losing the selection.
 */
import { Badge, Button, Switch, Text, Tooltip } from '@fluentui/react-components';
import { CopyRegular, DismissRegular, OpenRegular, PanelRightContractRegular, PanelRightExpandRegular } from '@fluentui/react-icons';
import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { STAGE_LABEL, type LogicItem, type Smell } from '../../domain/model';
import { useSelectedItem } from '../hooks/useVisibleMap';
import { useAppStore } from '../store';
import { DETAIL_PANE_DEFAULT_WIDTH, DETAIL_PANE_MIN_WIDTH, KIND_LABEL } from '../theme';
import { HeuristicBadge, ModeBadge, SmellBadge } from './Badges';
import { AttributeChips } from './Chips';
import { DetailsRenderer } from './DetailsRenderer';
import { KindIcon } from './KindIcon';
import { JsonBlock } from './Primitives';

function useDragWidth(initial: number) {
    const [width, setWidth] = useState(initial);
    const [dragging, setDragging] = useState(false);
    const startX = useRef(0);
    const startW = useRef(initial);

    const onPointerDown = useCallback(
        (e: ReactPointerEvent<HTMLDivElement>) => {
            startX.current = e.clientX;
            startW.current = width;
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
        },
        [width],
    );
    const onPointerMove = useCallback(
        (e: ReactPointerEvent<HTMLDivElement>) => {
            if (!dragging) return;
            const max = Math.max(DETAIL_PANE_MIN_WIDTH, window.innerWidth - 320);
            setWidth(Math.min(max, Math.max(DETAIL_PANE_MIN_WIDTH, startW.current + (startX.current - e.clientX))));
        },
        [dragging],
    );
    const stop = useCallback(() => setDragging(false), []);
    return { width, dragging, handleProps: { onPointerDown, onPointerMove, onPointerUp: stop, onPointerCancel: stop } };
}

function HeaderChips({ item }: { item: LogicItem }) {
    return (
        <div className="tlm-row" style={{ gap: 4 }}>
            <Badge size="small" appearance="outline">
                {item.event}
            </Badge>
            <Badge size="small" appearance="outline">
                {STAGE_LABEL[item.stage]}
            </Badge>
            {item.order !== undefined && (
                <Badge size="small" appearance="outline">
                    rank {item.order}
                </Badge>
            )}
            <Badge size="small" appearance="tint" color={item.enabled ? 'success' : 'subtle'}>
                {item.enabled ? 'enabled' : 'disabled'}
            </Badge>
            <HeuristicBadge confidence={item.confidence} />
            {item.confidence === 'exact' && (
                <Badge size="small" appearance="outline" color="subtle">
                    exact
                </Badge>
            )}
        </div>
    );
}

export function DetailPane() {
    const item = useSelectedItem();
    const selectedItemId = useAppStore((s) => s.selectedItemId);
    const selectItem = useAppStore((s) => s.selectItem);
    const collapsed = useAppStore((s) => s.detailCollapsed);
    const setCollapsed = useAppStore((s) => s.setDetailCollapsed);
    const showRaw = useAppStore((s) => s.detailShowRaw);
    const setShowRaw = useAppStore((s) => s.setDetailShowRaw);
    const copyItemMarkdown = useAppStore((s) => s.copyItemMarkdown);
    const openUrl = useAppStore((s) => s.openUrl);
    const smells = useAppStore((s) => s.map?.smells);
    const { width, dragging, handleProps } = useDragWidth(DETAIL_PANE_DEFAULT_WIDTH);

    // Escape closes the pane (only when focus is inside it, to not fight other controls). This is
    // a React handler on purpose: collapsing unmounts the <aside>, so a listener attached in an
    // effect would be lost on the element mounted when the pane is expanded again.
    const onPaneKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
        if (e.key === 'Escape') selectItem(undefined);
    };

    if (!selectedItemId) return null;

    if (collapsed) {
        return (
            <aside className="tlm-detail tlm-detail-collapsed" aria-label="Details (collapsed)" onKeyDown={onPaneKeyDown}>
                <Tooltip content="Expand details" relationship="label" withArrow>
                    <Button appearance="subtle" size="small" icon={<PanelRightExpandRegular />} onClick={() => setCollapsed(false)} aria-label="Expand details" />
                </Tooltip>
                {item && <KindIcon kind={item.kind} />}
            </aside>
        );
    }

    const url = item?.links?.maker ?? item?.links?.record;
    const itemSmells = (item?.smells ?? []).map((id) => smells?.find((s) => s.id === id)).filter((s): s is Smell => !!s);

    return (
        <aside className="tlm-detail" style={{ width }} aria-label="Details" onKeyDown={onPaneKeyDown}>
            <div className="tlm-detail-handle" role="separator" aria-orientation="vertical" aria-label="Resize details pane" data-dragging={dragging} {...handleProps} />
            <div className="tlm-detail-content">
                <div className="tlm-row tlm-row-nowrap">
                    <span className="tlm-grow" />
                    <Tooltip content="Collapse" relationship="label" withArrow>
                        <Button appearance="subtle" size="small" icon={<PanelRightContractRegular />} onClick={() => setCollapsed(true)} aria-label="Collapse details" />
                    </Tooltip>
                    <Tooltip content="Close" relationship="label" withArrow>
                        <Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={() => selectItem(undefined)} aria-label="Close details" />
                    </Tooltip>
                </div>
                {!item ? (
                    <Text className="tlm-muted">This item is no longer in the map (filters changed or the map was rebuilt).</Text>
                ) : (
                    <>
                        <div className="tlm-row tlm-row-nowrap" style={{ alignItems: 'flex-start' }}>
                            <KindIcon kind={item.kind} size={20} />
                            <div className="tlm-grow">
                                <Text size={400} weight="semibold" block style={{ wordBreak: 'break-word' }}>
                                    {item.name}
                                </Text>
                                <Text size={200} className="tlm-muted" block>
                                    {KIND_LABEL[item.kind]}
                                    {item.details.isHidden === true ? ' · Microsoft/system step' : ''}
                                </Text>
                            </div>
                            <ModeBadge mode={item.mode} />
                        </div>
                        <HeaderChips item={item} />
                        {itemSmells.length > 0 && (
                            <div className="tlm-row" style={{ gap: 4 }}>
                                {itemSmells.map((s) => (
                                    <SmellBadge key={s.id} smell={s} showMessage />
                                ))}
                            </div>
                        )}
                        <div className="tlm-row" style={{ gap: 6 }}>
                            {url && (
                                <Button size="small" icon={<OpenRegular />} onClick={() => void openUrl(url)}>
                                    Open in browser
                                </Button>
                            )}
                            <Button size="small" icon={<CopyRegular />} onClick={() => void copyItemMarkdown(item.id)}>
                                Copy as Markdown
                            </Button>
                            <Switch label="Show raw JSON" checked={showRaw} onChange={(_, d) => setShowRaw(d.checked)} style={{ marginLeft: 'auto' }} />
                        </div>
                        {showRaw ? (
                            <JsonBlock value={item} />
                        ) : (
                            <>
                                {item.filteringAttributes && item.filteringAttributes.length > 0 && (
                                    <div>
                                        <Text size={200} className="tlm-muted" block>
                                            Filtering attributes ({item.filteringAttributes.length})
                                        </Text>
                                        <AttributeChips values={item.filteringAttributes} max={20} />
                                    </div>
                                )}
                                {item.touchesColumns && item.touchesColumns.length > 0 && (
                                    <div>
                                        <Text size={200} className="tlm-muted" block>
                                            Touches columns ({item.touchesColumns.length}){item.confidence === 'heuristic' ? ' — heuristic' : ''}
                                        </Text>
                                        <AttributeChips values={item.touchesColumns} max={20} />
                                    </div>
                                )}
                                <DetailsRenderer details={item.details} />
                                <Text size={100} className="tlm-muted" block>
                                    Source: {item.source.table}
                                    {item.source.id ? ` · ${item.source.id}` : ''}
                                    {item.groupId ? ` · group ${item.groupId}` : ''}
                                </Text>
                            </>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
}

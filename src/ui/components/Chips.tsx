/** Chip lists: plain (attribute names) and clickable (items, resolved by id). */
import { Tooltip } from '@fluentui/react-components';
import { useState } from 'react';
import type { LogicItem } from '../../domain/model';
import { useAppStore } from '../store';
import { CHIP_COLLAPSE_AFTER, KIND_LABEL } from '../theme';
import { KindIcon } from './KindIcon';

/** Monospace chips for column names; collapses after `max` with a "+n" toggle. */
export function AttributeChips({ values, max = CHIP_COLLAPSE_AFTER, title }: { values: readonly string[]; max?: number; title?: string }) {
    const [expanded, setExpanded] = useState(false);
    if (values.length === 0) return null;
    const shown = expanded ? values : values.slice(0, max);
    const hidden = values.length - shown.length;
    return (
        <span className="tlm-chips" title={title}>
            {shown.map((v) => (
                <span key={v} className="tlm-chip">
                    {v}
                </span>
            ))}
            {hidden > 0 && (
                <button
                    type="button"
                    className="tlm-chip"
                    onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(true);
                    }}
                    aria-label={`Show ${hidden} more`}
                >
                    +{hidden}
                </button>
            )}
            {expanded && values.length > max && (
                <button
                    type="button"
                    className="tlm-chip"
                    onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(false);
                    }}
                >
                    less
                </button>
            )}
        </span>
    );
}

/** Clickable chip that selects an item (shows the item name; falls back to the id when unknown). */
export function ItemChip({ item, id }: { item?: LogicItem; id: string }) {
    const selectItem = useAppStore((s) => s.selectItem);
    const selected = useAppStore((s) => s.selectedItemId === id);
    const label = item?.name ?? id;
    const tip = item ? `${KIND_LABEL[item.kind]} · ${item.event}` : id;
    return (
        <Tooltip content={tip} relationship="description" withArrow>
            <button type="button" className="tlm-chip" data-selected={selected} onClick={() => selectItem(id)} style={selected ? { borderColor: 'var(--colorBrandStroke1)' } : undefined}>
                {item && <KindIcon kind={item.kind} size={12} />}
                <span style={{ fontFamily: 'inherit' }}>{label}</span>
            </button>
        </Tooltip>
    );
}

/** A row of ItemChips for a list of ids resolved through `index`. */
export function ItemChips({ ids, index, max = 8 }: { ids: readonly string[]; index: Map<string, LogicItem>; max?: number }) {
    const [expanded, setExpanded] = useState(false);
    if (ids.length === 0) return <span className="tlm-muted">—</span>;
    const shown = expanded ? ids : ids.slice(0, max);
    const hidden = ids.length - shown.length;
    return (
        <span className="tlm-chips">
            {shown.map((id) => (
                <ItemChip key={id} id={id} item={index.get(id)} />
            ))}
            {hidden > 0 && (
                <button type="button" className="tlm-chip" onClick={() => setExpanded(true)} aria-label={`Show ${hidden} more`}>
                    +{hidden}
                </button>
            )}
        </span>
    );
}

/** Compact, keyboard-focusable row for one LogicItem (Pipeline stage rows, Touched by lists). */
import { Tooltip } from '@fluentui/react-components';
import type { LogicItem, Smell } from '../../domain/model';
import { useAppStore } from '../store';
import { KIND_LABEL } from '../theme';
import { DisabledBadge, HeuristicBadge, ModeBadge, SmellBadge } from './Badges';
import { AttributeChips } from './Chips';
import { KindIcon } from './KindIcon';

export interface ItemRowProps {
    item: LogicItem;
    /** Smells by id (from the map) so the row can render its badges. */
    smells?: ReadonlyMap<string, Smell>;
    /** Show the event name (useful outside the pipeline cards). */
    showEvent?: boolean;
    /** Extra caption after the name (e.g. plugin image summary). */
    caption?: string;
}

export function ItemRow({ item, smells, showEvent = false, caption }: ItemRowProps) {
    const selectItem = useAppStore((s) => s.selectItem);
    const selected = useAppStore((s) => s.selectedItemId === item.id);
    const itemSmells = (item.smells ?? []).map((id) => smells?.get(id)).filter((s): s is Smell => !!s);
    return (
        <div
            role="button"
            tabIndex={0}
            className="tlm-item-row"
            data-selected={selected}
            data-disabled={!item.enabled}
            data-heuristic={item.confidence === 'heuristic'}
            onClick={() => selectItem(item.id)}
            onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    selectItem(item.id);
                }
            }}
            aria-pressed={selected}
            aria-label={`${KIND_LABEL[item.kind]} ${item.name}`}
        >
            <Tooltip content={KIND_LABEL[item.kind]} relationship="label" withArrow>
                <span style={{ display: 'inline-flex' }}>
                    <KindIcon kind={item.kind} />
                </span>
            </Tooltip>
            {item.order !== undefined && <span className="tlm-rank">#{item.order}</span>}
            <span className="tlm-item-name" title={item.name}>
                {item.name}
            </span>
            {showEvent && <span className="tlm-muted">{item.event}</span>}
            <ModeBadge mode={item.mode} />
            <DisabledBadge enabled={item.enabled} />
            <HeuristicBadge confidence={item.confidence} />
            {caption && <span className="tlm-muted">{caption}</span>}
            {item.filteringAttributes && item.filteringAttributes.length > 0 && <AttributeChips values={item.filteringAttributes} title="Filtering attributes" />}
            {itemSmells.map((s) => (
                <SmellBadge key={s.id} smell={s} />
            ))}
        </div>
    );
}

/** Short caption for a row: plugin images, flow trigger scope, workflow scope... kept tiny on purpose. */
export function itemCaption(item: LogicItem): string | undefined {
    const d = item.details;
    const parts: string[] = [];
    if (Array.isArray(d.images) && d.images.length > 0) {
        const types = d.images.map((img) => (img && typeof img === 'object' && 'type' in img ? String((img as { type: unknown }).type) : '')).filter(Boolean);
        parts.push(`img: ${types.join('/')}`);
    }
    if (typeof d.scope === 'string' && d.scope) parts.push(`${d.scope} scope`);
    if (typeof d.library === 'string' && d.library) parts.push(d.library);
    if (typeof d.column === 'string' && d.column && item.kind !== 'requiredcolumn') parts.push(d.column);
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

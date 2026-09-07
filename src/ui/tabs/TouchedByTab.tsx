/**
 * Touched by tab: flows/actions that read or write this table without being triggered by it,
 * grouped by access. The access is read from `details.access` when the source provides it,
 * otherwise inferred from `details.actions[].kind` / `details.operations`.
 */
import { Text } from '@fluentui/react-components';
import { useMemo } from 'react';
import type { LogicItem } from '../../domain/model';
import { useVisibleMap } from '../hooks/useVisibleMap';
import { ItemRow } from '../components/ItemRow';
import { EmptyState, PartialSkeleton, Section } from '../components/Primitives';

export type Access = 'read' | 'write' | 'read-write';

function normaliseAccess(v: unknown): Access | undefined {
    if (typeof v !== 'string') return undefined;
    const s = v.toLowerCase();
    if (s === 'read') return 'read';
    if (s === 'write') return 'write';
    if (s === 'readwrite' || s === 'read-write' || s === 'read/write' || s === 'both') return 'read-write';
    return undefined;
}

/** Action descriptions of the toucher (labels of the Dataverse operations it performs on this table). */
export function touchActions(item: LogicItem): string[] {
    const d = item.details;
    const out: string[] = [];
    const list = Array.isArray(d.actions) ? d.actions : Array.isArray(d.operations) ? d.operations : Array.isArray(d.actionsOnTable) ? d.actionsOnTable : [];
    for (const a of list) {
        if (typeof a === 'string') out.push(a);
        else if (a && typeof a === 'object') {
            const r = a as Record<string, unknown>;
            const label = [r.label, r.operationId, r.operation, r.name].find((v) => typeof v === 'string' && v);
            const kind = typeof r.kind === 'string' ? r.kind : undefined;
            const path = typeof r.path === 'string' ? r.path : typeof r.actionName === 'string' ? r.actionName : undefined;
            if (label) out.push(`${String(label)}${kind ? ` (${kind})` : ''}${path ? ` — ${path}` : ''}`);
        }
    }
    return [...new Set(out)].sort();
}

export function touchAccess(item: LogicItem): Access {
    const explicit = normaliseAccess(item.details.access);
    if (explicit) return explicit;
    const kinds = new Set<string>();
    const list = Array.isArray(item.details.actions) ? item.details.actions : Array.isArray(item.details.actionsOnTable) ? item.details.actionsOnTable : [];
    for (const a of list) if (a && typeof a === 'object' && typeof (a as { kind?: unknown }).kind === 'string') kinds.add(String((a as { kind: string }).kind).toLowerCase());
    if (item.details.reads === true) kinds.add('read');
    if (item.details.writes === true) kinds.add('write');
    if (kinds.has('read') && kinds.has('write')) return 'read-write';
    if (kinds.has('write')) return 'write';
    if (kinds.has('read')) return 'read';
    return item.touchesColumns && item.touchesColumns.length > 0 ? 'write' : 'read';
}

const GROUPS: { access: Access; title: string; hint: string }[] = [
    { access: 'write', title: 'Write', hint: 'Creates, updates or deletes rows of this table.' },
    { access: 'read-write', title: 'Read and write', hint: 'Reads and modifies rows of this table.' },
    { access: 'read', title: 'Read', hint: 'Only reads rows of this table.' },
];

export function TouchedByTab() {
    const map = useVisibleMap();
    const groups = useMemo(() => {
        const touchers = [...(map?.externalTouchers ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return GROUPS.map((g) => ({ ...g, items: touchers.filter((t) => touchAccess(t) === g.access) }));
    }, [map]);
    if (!map) return <EmptyState title="No table selected" />;
    if (map.externalTouchers.length === 0) {
        return (
            <>
                <EmptyState title="Nothing else touches this table" hint="No cloud flow or action reads or writes this table without being triggered by it." />
                <PartialSkeleton map={map} rows={1} />
            </>
        );
    }
    return (
        <div>
            {groups.map((g) => (
                <Section key={g.access} title={g.title} count={g.items.length}>
                    <Text size={200} className="tlm-muted">
                        {g.hint}
                    </Text>
                    {g.items.length === 0 ? (
                        <span className="tlm-muted">None</span>
                    ) : (
                        g.items.map((item) => {
                            const actions = touchActions(item);
                            return (
                                <div key={item.id}>
                                    <ItemRow item={item} showEvent />
                                    {actions.length > 0 && (
                                        <ul style={{ margin: '0 0 6px 34px', fontSize: 12 }} className="tlm-muted">
                                            {actions.map((a) => (
                                                <li key={a}>{a}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            );
                        })
                    )}
                </Section>
            ))}
            <PartialSkeleton map={map} rows={1} />
        </div>
    );
}

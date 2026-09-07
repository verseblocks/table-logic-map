/**
 * Data rules tab: keys, duplicate rules, cascades (tree), field security profiles, audit, required
 * columns. Everything is derived from the visible map's items (by kind) and `relationships`.
 */
import { Badge, Text } from '@fluentui/react-components';
import { useMemo } from 'react';
import type { LogicItem, LogicMap, RelationshipSummary } from '../../domain/model';
import { useVisibleMap } from '../hooks/useVisibleMap';
import { useAppStore } from '../store';
import { ItemChip } from '../components/Chips';
import { ObjectTable } from '../components/DetailsRenderer';
import { ItemRow } from '../components/ItemRow';
import { EmptyState, PartialSkeleton, Section } from '../components/Primitives';

/** One item per registration (keys and duplicate rules are expanded per event). */
function uniqueByGroup(items: readonly LogicItem[]): LogicItem[] {
    const seen = new Set<string>();
    return items.filter((i) => {
        const k = i.groupId ?? i.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function recordsOf(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)) : [];
}

function KeysSection({ items }: { items: LogicItem[] }) {
    return (
        <Section title="Alternate keys" count={items.length}>
            {items.length === 0 ? (
                <span className="tlm-muted">No alternate keys.</span>
            ) : (
                <div className="tlm-table-wrap">
                    <table className="tlm-table">
                        <thead>
                            <tr>
                                <th>Key</th>
                                <th>Columns</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((k) => (
                                <tr key={k.id}>
                                    <td>
                                        <ItemChip id={k.id} item={k} />
                                    </td>
                                    <td>{Array.isArray(k.details.attributes) ? k.details.attributes.map(String).join(', ') : (k.touchesColumns ?? []).join(', ')}</td>
                                    <td>{String(k.details.status ?? (k.enabled ? 'Active' : 'Inactive'))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Section>
    );
}

function DuplicateRulesSection({ items, map }: { items: LogicItem[]; map: LogicMap }) {
    const effective = map.table.duplicateDetection && map.org.duplicateDetectionEnabled !== false;
    return (
        <Section
            title="Duplicate detection rules"
            count={items.length}
            actions={
                <Badge size="small" appearance="tint" color={effective ? 'success' : 'warning'}>
                    {effective ? 'detection active' : 'detection off'}
                </Badge>
            }
        >
            {!effective && items.length > 0 && (
                <Text size={200} className="tlm-warn-caption">
                    Rules exist but duplicate detection is disabled {map.org.duplicateDetectionEnabled === false ? 'for the organization' : 'for this table'} — they will not run.
                </Text>
            )}
            {items.length === 0 ? (
                <span className="tlm-muted">No duplicate detection rules.</span>
            ) : (
                items.map((rule) => {
                    const conditions = recordsOf(rule.details.conditions);
                    return (
                        <div key={rule.id} className="tlm-section" style={{ marginBottom: 8 }}>
                            <div className="tlm-row">
                                <ItemChip id={rule.id} item={rule} />
                                <span className="tlm-muted">
                                    {String(rule.details.baseTable ?? '')} ↔ {String(rule.details.matchingTable ?? '')} · {String(rule.details.status ?? '')}
                                </span>
                            </div>
                            {conditions.length > 0 ? <ObjectTable rows={conditions} /> : <span className="tlm-muted">No conditions.</span>}
                        </div>
                    );
                })
            )}
        </Section>
    );
}

interface CascadeNode {
    child: string;
    via: string;
    relationship: string;
    actions: Record<string, string>;
    items: LogicItem[];
}

function buildCascadeTree(map: LogicMap, cascadeItems: LogicItem[]): CascadeNode[] {
    const byRel = new Map<string, CascadeNode>();
    const rels: RelationshipSummary[] = map.relationships.filter((r) => r.kind === 'OneToMany');
    for (const r of rels) {
        const actions = Object.fromEntries(Object.entries(r.cascade ?? {}).filter(([, v]) => v !== 'NoCascade'));
        if (Object.keys(actions).length === 0) continue;
        byRel.set(r.schemaName, { child: r.relatedTable, via: r.referencingAttribute ?? '', relationship: r.schemaName, actions, items: [] });
    }
    for (const item of cascadeItems) {
        if (item.details.direction === 'inbound') continue;
        const rel = String(item.details.relationship ?? '');
        const node = byRel.get(rel) ?? { child: String(item.details.child ?? ''), via: String(item.details.via ?? ''), relationship: rel, actions: {}, items: [] };
        if (typeof item.details.action === 'string' && typeof item.details.behaviour === 'string') node.actions[item.details.action] = item.details.behaviour;
        node.items.push(item);
        byRel.set(rel, node);
    }
    return [...byRel.values()].sort((a, b) => a.child.localeCompare(b.child) || a.relationship.localeCompare(b.relationship));
}

function CascadesSection({ map, cascadeItems }: { map: LogicMap; cascadeItems: LogicItem[] }) {
    const selectItem = useAppStore((s) => s.selectItem);
    const tree = useMemo(() => buildCascadeTree(map, cascadeItems), [map, cascadeItems]);
    const inbound = cascadeItems.filter((i) => i.details.direction === 'inbound');
    return (
        <Section title="Cascades" count={tree.length}>
            {tree.length === 0 ? (
                <span className="tlm-muted">No relationship cascades anything from this table.</span>
            ) : (
                <div>
                    <Text weight="semibold">{map.table.logicalName}</Text>
                    <ul className="tlm-tree">
                        {tree.map((n) => (
                            <li key={n.relationship}>
                                <span className="tlm-row" style={{ gap: 6 }}>
                                    <code>{n.child}</code>
                                    <span className="tlm-muted">
                                        via <code>{n.via}</code> ({n.relationship})
                                    </span>
                                    {Object.entries(n.actions)
                                        .sort(([a], [b]) => a.localeCompare(b))
                                        .map(([action, behaviour]) => {
                                            const item = n.items.find((i) => i.details.action === action);
                                            return (
                                                <button key={action} type="button" className="tlm-chip" onClick={item ? () => selectItem(item.id) : undefined} title={item ? 'Show details' : undefined} disabled={!item}>
                                                    {action}: {behaviour}
                                                </button>
                                            );
                                        })}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {inbound.length > 0 && (
                <div style={{ marginTop: 8 }}>
                    <Text size={200} weight="semibold" block>
                        Inbound cascade deletes (deleting the parent deletes rows of this table)
                    </Text>
                    {inbound.map((i) => (
                        <ItemRow key={i.id} item={i} caption={`from ${String(i.details.parent ?? '')} via ${String(i.details.via ?? '')}`} />
                    ))}
                </div>
            )}
        </Section>
    );
}

function FieldSecuritySection({ items }: { items: LogicItem[] }) {
    return (
        <Section title="Field security profiles" count={items.length}>
            {items.length === 0 ? (
                <span className="tlm-muted">No field security profiles touch this table.</span>
            ) : (
                items.map((p) => (
                    <div key={p.id} className="tlm-section" style={{ marginBottom: 8 }}>
                        <ItemChip id={p.id} item={p} />
                        {recordsOf(p.details.permissions).length > 0 ? <ObjectTable rows={recordsOf(p.details.permissions)} /> : <span className="tlm-muted">No permissions.</span>}
                    </div>
                ))
            )}
        </Section>
    );
}

function AuditSection({ map, item }: { map: LogicMap; item?: LogicItem }) {
    const orgOn = map.org.auditEnabled;
    const tableOn = map.table.audit;
    const effective = item ? item.details.effective === true : tableOn && orgOn !== false;
    const audited = Object.values(map.columns).filter((c) => c.audited).length;
    return (
        <Section
            title="Audit"
            actions={
                <Badge size="small" appearance="tint" color={effective ? 'success' : 'subtle'}>
                    {effective ? 'auditing' : 'not auditing'}
                </Badge>
            }
        >
            <div className="tlm-row" style={{ gap: 4 }}>
                <span>Organization: {orgOn === undefined ? 'unknown' : orgOn ? 'on' : 'off'}</span>
                <span className="tlm-sep" />
                <span>Table: {tableOn ? 'on' : 'off'}</span>
                <span className="tlm-sep" />
                <span>{audited} audited columns</span>
                {item && (
                    <>
                        <span className="tlm-sep" />
                        <ItemChip id={item.id} item={item} />
                    </>
                )}
            </div>
            {item && typeof item.details.note === 'string' && (
                <Text size={200} className="tlm-muted">
                    {item.details.note}
                </Text>
            )}
        </Section>
    );
}

function RequiredColumnsSection({ items }: { items: LogicItem[] }) {
    return (
        <Section title="Required columns" count={items.length}>
            {items.length === 0 ? (
                <span className="tlm-muted">No business-required columns.</span>
            ) : (
                <span className="tlm-chips">
                    {items.map((i) => (
                        <ItemChip key={i.id} id={i.id} item={i} />
                    ))}
                </span>
            )}
            {items[0] && typeof items[0].details.note === 'string' && (
                <Text size={200} className="tlm-muted">
                    {items[0].details.note}
                </Text>
            )}
        </Section>
    );
}

export function DataRulesTab() {
    const map = useVisibleMap();
    const byKind = useMemo(() => {
        const items = map?.items ?? [];
        return {
            keys: uniqueByGroup(items.filter((i) => i.kind === 'key')),
            dup: uniqueByGroup(items.filter((i) => i.kind === 'duplicaterule')),
            cascades: items.filter((i) => i.kind === 'cascade'),
            fieldSecurity: items.filter((i) => i.kind === 'fieldsecurity'),
            audit: items.find((i) => i.kind === 'audit'),
            required: items.filter((i) => i.kind === 'requiredcolumn').sort((a, b) => a.name.localeCompare(b.name)),
        };
    }, [map]);
    if (!map) return <EmptyState title="No table selected" />;
    return (
        <div>
            <KeysSection items={byKind.keys} />
            <DuplicateRulesSection items={byKind.dup} map={map} />
            <CascadesSection map={map} cascadeItems={byKind.cascades} />
            <FieldSecuritySection items={byKind.fieldSecurity} />
            <AuditSection map={map} item={byKind.audit} />
            <RequiredColumnsSection items={byKind.required} />
            <PartialSkeleton map={map} rows={1} />
        </div>
    );
}

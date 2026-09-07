/** Forms tab: one card per form with libraries, handlers, PCF/components and applied business rules. */
import { Badge, Card, CardHeader, Text } from '@fluentui/react-components';
import type { FormInfo, LogicItem } from '../../domain/model';
import type { ReactNode } from 'react';
import { useItemIndex, useVisibleMap } from '../hooks/useVisibleMap';
import { useAppStore } from '../store';
import { HeuristicBadge } from '../components/Badges';
import { ItemChip } from '../components/Chips';
import { KindIcon } from '../components/KindIcon';
import { EmptyState, PartialSkeleton } from '../components/Primitives';

function str(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.map(str).join(', ');
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function ClickableRow({ item, children }: { item: LogicItem; children: ReactNode }) {
    const selectItem = useAppStore((s) => s.selectItem);
    const selected = useAppStore((s) => s.selectedItemId === item.id);
    return (
        <tr
            data-clickable="true"
            data-selected={selected}
            tabIndex={0}
            onClick={() => selectItem(item.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectItem(item.id);
                }
            }}
        >
            {children}
        </tr>
    );
}

function HandlersTable({ handlers }: { handlers: LogicItem[] }) {
    if (handlers.length === 0) return <span className="tlm-muted">No event handlers.</span>;
    return (
        <div className="tlm-table-wrap">
            <table className="tlm-table">
                <thead>
                    <tr>
                        <th>Event</th>
                        <th>Attribute / control</th>
                        <th>Function</th>
                        <th>Library</th>
                        <th>Enabled</th>
                        <th>Pass context</th>
                        <th>Parameters</th>
                    </tr>
                </thead>
                <tbody>
                    {handlers.map((h) => (
                        <ClickableRow key={h.id} item={h}>
                            <td>{str(h.details.formEvent ?? h.event)}</td>
                            <td>
                                <code>{str(h.details.attribute ?? h.details.control)}</code>
                            </td>
                            <td>
                                <code>{h.name}</code> <HeuristicBadge confidence={h.confidence} />
                            </td>
                            <td>{str(h.details.library)}</td>
                            <td>{h.enabled ? 'Yes' : 'No'}</td>
                            <td>{str(h.details.passExecutionContext)}</td>
                            <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={str(h.details.parameters)}>
                                {str(h.details.parameters)}
                            </td>
                        </ClickableRow>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ComponentsTable({ items }: { items: LogicItem[] }) {
    if (items.length === 0) return <span className="tlm-muted">No PCF controls or components.</span>;
    return (
        <div className="tlm-table-wrap">
            <table className="tlm-table">
                <thead>
                    <tr>
                        <th>Name / kind</th>
                        <th>Column</th>
                        <th>Location</th>
                        <th>Form factors / parameters</th>
                    </tr>
                </thead>
                <tbody>
                    {items.map((c) => {
                        const d = c.details;
                        const params = d.parameters;
                        const paramSummary = Array.isArray(params)
                            ? `${params.length} parameters`
                            : params && typeof params === 'object'
                              ? Object.keys(params as object)
                                    .slice(0, 6)
                                    .join(', ') + (Object.keys(params as object).length > 6 ? ', …' : '')
                              : '—';
                        const factors = Array.isArray(d.formFactors) ? d.formFactors.map(String).join(', ') : undefined;
                        const location = [d.tab, d.section].filter((v) => typeof v === 'string' && v).join(' › ') || str(d.region);
                        return (
                            <ClickableRow key={c.id} item={c}>
                                <td>
                                    <span className="tlm-row tlm-row-nowrap" style={{ gap: 4 }}>
                                        <KindIcon kind={c.kind} size={14} />
                                        <span>{c.name}</span>
                                        <HeuristicBadge confidence={c.confidence} />
                                    </span>
                                </td>
                                <td>
                                    <code>{str(d.datafieldname ?? d.lookupColumn)}</code>
                                </td>
                                <td>{location}</td>
                                <td>
                                    {factors ? `Form factors: ${factors}` : ''}
                                    {factors && paramSummary !== '—' ? ' · ' : ''}
                                    {paramSummary !== '—' ? paramSummary : ''}
                                    {d.url !== undefined ? ` · ${str(d.url)}` : ''}
                                </td>
                            </ClickableRow>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function FormCard({ form, index }: { form: FormInfo; index: Map<string, LogicItem> }) {
    return (
        <Card size="small" appearance="filled" role="region" aria-label={`Form ${form.name}`}>
            <CardHeader
                header={
                    <span className="tlm-row" style={{ gap: 6 }}>
                        <Text weight="semibold" size={400}>
                            {form.name}
                        </Text>
                        <Badge size="small" appearance="outline">
                            {form.type}
                        </Badge>
                        <Badge size="small" appearance="tint" color={form.state === 'Active' ? 'success' : 'subtle'}>
                            {form.state}
                        </Badge>
                        {form.isDefault && (
                            <Badge size="small" appearance="tint" color="brand">
                                default
                            </Badge>
                        )}
                        {form.isManaged && (
                            <Badge size="small" appearance="outline" color="subtle">
                                managed
                            </Badge>
                        )}
                    </span>
                }
            />
            <div className="tlm-section">
                <Text size={200} weight="semibold">
                    Libraries ({form.libraries.length})
                </Text>
                {form.libraries.length === 0 ? (
                    <span className="tlm-muted">None</span>
                ) : (
                    <span className="tlm-chips">
                        {form.libraries.map((l) => (
                            <span key={l} className="tlm-chip">
                                {l}
                            </span>
                        ))}
                    </span>
                )}
            </div>
            <div className="tlm-section">
                <Text size={200} weight="semibold">
                    Event handlers ({form.handlers.length})
                </Text>
                <HandlersTable handlers={form.handlers} />
            </div>
            <div className="tlm-section">
                <Text size={200} weight="semibold">
                    PCF controls and components ({form.pcf.length + form.components.length})
                </Text>
                <ComponentsTable items={[...form.pcf, ...form.components]} />
            </div>
            <div className="tlm-section" style={{ marginBottom: 0 }}>
                <Text size={200} weight="semibold">
                    Business rules applied ({form.businessRules.length})
                </Text>
                {form.businessRules.length === 0 ? (
                    <span className="tlm-muted">None</span>
                ) : (
                    <span className="tlm-chips">
                        {form.businessRules.map((id) => (
                            <ItemChip key={id} id={id} item={index.get(id)} />
                        ))}
                    </span>
                )}
            </div>
        </Card>
    );
}

export function FormsTab() {
    const map = useVisibleMap();
    const index = useItemIndex();
    if (!map) return <EmptyState title="No table selected" />;
    if (map.forms.length === 0) {
        return (
            <>
                <EmptyState title="No forms with logic" hint="No main, quick create, quick view or card forms were found for this table." />
                <PartialSkeleton map={map} />
            </>
        );
    }
    return (
        <div className="tlm-card-stack">
            {map.forms.map((f) => (
                <FormCard key={f.id} form={f} index={index} />
            ))}
            <PartialSkeleton map={map} />
        </div>
    );
}


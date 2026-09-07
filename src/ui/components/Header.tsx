/**
 * Header: connection badge, table picker, run/cancel/export controls, then three summary lines
 * computed from the visible map (facts, counts, smells).
 */
import { Button, Skeleton, SkeletonItem, Text, Tooltip } from '@fluentui/react-components';
import { ArrowSyncRegular, StopRegular } from '@fluentui/react-icons';
import { useMemo, type ReactNode } from 'react';
import type { LogicItem, LogicMap, Smell } from '../../domain/model';
import { useVisibleMap } from '../hooks/useVisibleMap';
import { useAppStore } from '../store';
import { SmellBadge } from './Badges';
import { ExportMenu } from './ExportMenu';
import { TablePicker } from './TablePicker';

/** Number of distinct registrations (multi-event items share a `groupId`). */
function countGroups(items: readonly LogicItem[]): number {
    return new Set(items.map((i) => i.groupId ?? i.id)).size;
}

export interface MapCounts {
    pluginSteps: number;
    realtimeWorkflows: number;
    backgroundWorkflows: number;
    flows: number;
    businessRules: number;
    forms: number;
    handlers: number;
    pcf: number;
    keys: number;
    cascades: number;
}

export function computeCounts(map: LogicMap): MapCounts {
    const of = (pred: (i: LogicItem) => boolean) => countGroups(map.items.filter(pred));
    return {
        pluginSteps: of((i) => i.kind === 'plugin'),
        realtimeWorkflows: of((i) => i.kind === 'workflow' && i.mode === 'realtime'),
        backgroundWorkflows: of((i) => i.kind === 'workflow' && i.mode !== 'realtime'),
        flows: of((i) => i.kind === 'flow'),
        businessRules: of((i) => i.kind === 'businessrule'),
        forms: map.forms.length,
        handlers: map.forms.reduce((n, f) => n + f.handlers.length, 0),
        pcf: map.forms.reduce((n, f) => n + f.pcf.length, 0),
        keys: of((i) => i.kind === 'key'),
        cascades: map.items.filter((i) => i.kind === 'cascade').length,
    };
}

function plural(n: number, singular: string, pluralWord = `${singular}s`): string {
    return `${n} ${n === 1 ? singular : pluralWord}`;
}

function Line({ children }: { children: ReactNode }) {
    return (
        <div className="tlm-row" style={{ gap: 4, fontSize: 12.5 }}>
            {children}
        </div>
    );
}

function Sep() {
    return <span className="tlm-sep" aria-hidden="true" />;
}

function ConnectionBadge() {
    const connection = useAppStore((s) => s.connection);
    if (!connection) {
        return (
            <Text size={200} className="tlm-muted">
                No active connection
            </Text>
        );
    }
    const color = connection.environmentColor || 'var(--colorNeutralForeground4)';
    return (
        <Tooltip content={connection.url} relationship="description" withArrow>
            <span className="tlm-row tlm-row-nowrap" style={{ gap: 6 }}>
                <span className="tlm-dot" style={{ background: color }} aria-hidden="true" />
                <Text size={300} weight="semibold" style={{ whiteSpace: 'nowrap' }}>
                    {connection.name}
                </Text>
                <Text size={200} className="tlm-muted">
                    {connection.environment}
                </Text>
            </span>
        </Tooltip>
    );
}

function FactsLine({ map }: { map: LogicMap }) {
    const t = map.table;
    const onOff = (v: boolean) => (v ? 'on' : 'off');
    return (
        <Line>
            <Text weight="semibold">{t.displayName}</Text>
            <code className="tlm-muted">({t.logicalName})</code>
            <Sep />
            <span>{t.isCustom ? 'Custom' : 'Standard'}</span>
            <Sep />
            <span>{t.ownership}</span>
            {t.isActivity && (
                <>
                    <Sep />
                    <span>Activity</span>
                </>
            )}
            <Sep />
            <Tooltip content={map.org.auditEnabled === false && t.audit ? 'Table audit is on but organization audit is off — nothing is audited.' : 'Table-level audit flag'} relationship="description" withArrow>
                <span>Audit {onOff(t.audit)}</span>
            </Tooltip>
            <Sep />
            <span>Dup detection {onOff(t.duplicateDetection)}</span>
            <Sep />
            <span>Change tracking {onOff(t.changeTracking)}</span>
            {map.apps.length > 0 && (
                <>
                    <Sep />
                    <span>{plural(map.apps.length, 'app')}</span>
                </>
            )}
        </Line>
    );
}

function CountsLine({ map }: { map: LogicMap }) {
    const c = useMemo(() => computeCounts(map), [map]);
    return (
        <Line>
            <span>{plural(c.pluginSteps, 'plugin step')}</span>
            <Sep />
            <span>{c.realtimeWorkflows} real-time wf</span>
            <Sep />
            <span>{c.backgroundWorkflows} background wf</span>
            <Sep />
            <span>{plural(c.flows, 'flow')}</span>
            <Sep />
            <span>{c.businessRules} BR</span>
            <Sep />
            <span>
                {plural(c.forms, 'form')} ({plural(c.handlers, 'handler')}, {c.pcf} PCF)
            </span>
            <Sep />
            <span>{plural(c.keys, 'key')}</span>
            <Sep />
            <span>{plural(c.cascades, 'cascade')}</span>
            {map.stats.partial && (
                <>
                    <Sep />
                    <span className="tlm-muted">partial — still loading</span>
                </>
            )}
        </Line>
    );
}

function SmellsLine({ map }: { map: LogicMap }) {
    const selectItem = useAppStore((s) => s.selectItem);
    if (map.smells.length === 0) return null;
    const onClick = (smell: Smell) => {
        const first = smell.itemIds[0];
        if (first) selectItem(first);
    };
    return (
        <Line>
            <Text size={200} weight="semibold" className="tlm-muted">
                Smells:
            </Text>
            {map.smells.map((s) => (
                <SmellBadge key={s.id} smell={s} onClick={onClick} showMessage />
            ))}
        </Line>
    );
}

export function Header() {
    const map = useVisibleMap();
    const runStatus = useAppStore((s) => s.run.status);
    const selectedTable = useAppStore((s) => s.selectedTable);
    const runMap = useAppStore((s) => s.runMap);
    const cancel = useAppStore((s) => s.cancel);
    const running = runStatus === 'running';

    return (
        <header className="tlm-header">
            <div className="tlm-row tlm-row-nowrap" style={{ gap: 12 }}>
                <ConnectionBadge />
                <TablePicker />
                <Tooltip content="Re-run the map for this table" relationship="description" withArrow>
                    <Button size="small" icon={<ArrowSyncRegular />} onClick={() => void runMap()} disabled={!selectedTable || running} aria-label="Refresh">
                        Refresh
                    </Button>
                </Tooltip>
                {running && (
                    <Button size="small" icon={<StopRegular />} onClick={cancel} aria-label="Cancel">
                        Cancel
                    </Button>
                )}
                <ExportMenu disabled={!map} />
            </div>
            {map ? (
                <>
                    <FactsLine map={map} />
                    <CountsLine map={map} />
                    <SmellsLine map={map} />
                </>
            ) : running ? (
                <Skeleton aria-label="Loading table facts">
                    <SkeletonItem size={16} style={{ width: '60%' }} />
                    <SkeletonItem size={16} style={{ width: '80%', marginTop: 4 }} />
                </Skeleton>
            ) : (
                <Text size={200} className="tlm-muted">
                    Pick a table to map every plugin, workflow, flow, business rule, form script, PCF control and data rule that runs on it.
                </Text>
            )}
        </header>
    );
}

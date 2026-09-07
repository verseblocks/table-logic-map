/** Compact strip: one pill per source with its status icon, plus elapsed time. Hidden while idle. */
import { Spinner, Text, Tooltip } from '@fluentui/react-components';
import { CheckmarkCircleRegular, CircleRegular, DismissCircleRegular, SkipForwardTabRegular } from '@fluentui/react-icons';
import { ALL_SOURCES, type SourceName, type SourceStatus } from '../../domain/model';
import { useRunElapsed } from '../hooks/useVisibleMap';
import { useAppStore } from '../store';
import { SOURCE_LABEL } from '../theme';

function StatusIcon({ status }: { status: SourceStatus }) {
    switch (status) {
        case 'running':
            return <Spinner size="extra-tiny" aria-label="running" />;
        case 'done':
            return <CheckmarkCircleRegular aria-label="done" />;
        case 'error':
            return <DismissCircleRegular aria-label="error" />;
        case 'skipped':
            return <SkipForwardTabRegular aria-label="skipped" />;
        default:
            return <CircleRegular aria-label="pending" />;
    }
}

export function formatElapsed(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    const s = ms / 1000;
    return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function SourceProgress() {
    const run = useAppStore((s) => s.run);
    const requests = useAppStore((s) => s.map?.stats.requests);
    const elapsed = useRunElapsed();
    if (run.status === 'idle') return null;

    const statusText = run.status === 'running' ? 'Building map' : run.status === 'done' ? 'Done' : run.status === 'cancelled' ? 'Cancelled' : 'Failed';
    return (
        <div className="tlm-progress" role="status" aria-live="polite" aria-label="Source progress">
            <Text size={200} weight="semibold">
                {statusText}
            </Text>
            <Text size={200} className="tlm-muted">
                {formatElapsed(elapsed)}
                {requests !== undefined ? ` · ${requests} requests` : ''}
            </Text>
            {ALL_SOURCES.map((source: SourceName) => {
                const status = run.progress[source];
                const message = run.messages[source];
                const pill = (
                    <span className="tlm-progress-item" data-status={status}>
                        <StatusIcon status={status} />
                        {SOURCE_LABEL[source]}
                    </span>
                );
                return message ? (
                    <Tooltip key={source} content={message} relationship="description" withArrow>
                        {pill}
                    </Tooltip>
                ) : (
                    <span key={source}>{pill}</span>
                );
            })}
            {run.status === 'error' && run.error && (
                <Text size={200} style={{ color: 'var(--colorPaletteRedForeground1)' }}>
                    {run.error}
                </Text>
            )}
        </div>
    );
}

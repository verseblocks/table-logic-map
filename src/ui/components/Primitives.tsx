/** Tiny presentational helpers: empty states, section headings, JSON blocks, partial-map skeletons. */
import { Button, Skeleton, SkeletonItem, Text } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import { useMemo, useState, type ReactNode } from 'react';
import { ALL_SOURCES, type LogicMap } from '../../domain/model';
import { useAppStore } from '../store';
import { SOURCE_LABEL } from '../theme';

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
    return (
        <div className="tlm-empty" role="status">
            <Text size={400} weight="semibold" block>
                {title}
            </Text>
            {hint && (
                <Text size={200} block style={{ marginTop: 4 }}>
                    {hint}
                </Text>
            )}
        </div>
    );
}

export function Section({ title, count, children, actions }: { title: string; count?: number; children: ReactNode; actions?: ReactNode }) {
    return (
        <section className="tlm-section" aria-label={title}>
            <div className="tlm-row">
                <Text size={400} weight="semibold">
                    {title}
                </Text>
                {count !== undefined && <span className="tlm-muted">({count})</span>}
                <span className="tlm-grow" />
                {actions}
            </div>
            {children}
        </section>
    );
}

export function safeStringify(value: unknown, space = 2): string {
    try {
        return JSON.stringify(value, null, space) ?? String(value);
    } catch {
        return String(value);
    }
}

export function JsonBlock({ value, maxBytes }: { value: unknown; maxBytes?: number }) {
    const text = useMemo(() => safeStringify(value), [value]);
    const truncated = maxBytes !== undefined && text.length > maxBytes;
    return (
        <div>
            {truncated && (
                <Text size={200} className="tlm-warn-caption" block>
                    Showing the first {Math.round(maxBytes / 1024)} KB of {Math.round(text.length / 1024)} KB — save the fixture to see everything.
                </Text>
            )}
            <pre className="tlm-pre">{truncated ? text.slice(0, maxBytes) + '\n…' : text}</pre>
        </div>
    );
}

/** Chevron toggle wrapper used for long strings, nested objects and the unsecure configuration. */
export function Collapsible({ label, defaultOpen = false, children, caption }: { label: ReactNode; defaultOpen?: boolean; children: ReactNode; caption?: ReactNode }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <Button appearance="transparent" size="small" icon={open ? <ChevronDownRegular /> : <ChevronRightRegular />} onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ paddingLeft: 0 }}>
                {label}
            </Button>
            {caption && <div style={{ marginLeft: 4 }}>{caption}</div>}
            {open && <div style={{ marginTop: 4 }}>{children}</div>}
        </div>
    );
}

/** Which sources are still pending/running for the current run. */
export function usePendingSources(): string[] {
    const progress = useAppStore((s) => s.run.progress);
    const status = useAppStore((s) => s.run.status);
    if (status !== 'running') return [];
    return ALL_SOURCES.filter((s) => progress[s] === 'pending' || progress[s] === 'running').map((s) => SOURCE_LABEL[s]);
}

/** Skeleton rows shown under a tab while the map is still partial. */
export function PartialSkeleton({ map, rows = 3 }: { map: LogicMap | undefined; rows?: number }) {
    const pending = usePendingSources();
    if (pending.length === 0 || (map && !map.stats.partial)) return null;
    return (
        <div style={{ marginTop: 12 }} aria-busy="true">
            <Text size={200} className="tlm-muted" block>
                Still loading: {pending.join(', ')}
            </Text>
            <Skeleton aria-label="Loading">
                {Array.from({ length: rows }, (_, i) => (
                    <SkeletonItem key={i} size={20} style={{ marginTop: 6 }} />
                ))}
            </Skeleton>
        </div>
    );
}

/** Small badges shared by rows, tables and the detail pane: mode, disabled, heuristic, smells. */
import { Badge, Tooltip } from '@fluentui/react-components';
import { WarningRegular } from '@fluentui/react-icons';
import type { ExecutionMode, Smell } from '../../domain/model';
import { MODE_BADGE } from '../theme';

export function ModeBadge({ mode }: { mode?: ExecutionMode }) {
    if (!mode) return null;
    const m = MODE_BADGE[mode];
    return (
        <Tooltip content={m.hint} relationship="description" withArrow>
            <Badge size="small" appearance="tint" color={m.color}>
                {m.label}
            </Badge>
        </Tooltip>
    );
}

export function DisabledBadge({ enabled }: { enabled: boolean }) {
    if (enabled) return null;
    return (
        <Badge size="small" appearance="outline" color="subtle">
            disabled
        </Badge>
    );
}

export function HeuristicBadge({ confidence }: { confidence: 'exact' | 'heuristic' }) {
    if (confidence !== 'heuristic') return null;
    return (
        <Tooltip content="Inferred by a heuristic parser — verify before relying on it." relationship="description" withArrow>
            <Badge size="small" appearance="outline" color="warning">
                heuristic
            </Badge>
        </Tooltip>
    );
}

/** Warning badge per smell; `onClick` receives the smell (Header uses it to select the first item). */
export function SmellBadge({ smell, onClick, showMessage = false }: { smell: Smell; onClick?: (smell: Smell) => void; showMessage?: boolean }) {
    const content = (
        <div style={{ maxWidth: 360 }}>
            <div style={{ fontWeight: 600 }}>{smell.message}</div>
            <div>{smell.explanation}</div>
        </div>
    );
    const badge = (
        <Badge
            size="small"
            appearance="tint"
            color={smell.severity === 'warning' ? 'warning' : 'informative'}
            icon={<WarningRegular />}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            style={onClick ? { cursor: 'pointer' } : undefined}
            onClick={onClick ? () => onClick(smell) : undefined}
            onKeyDown={
                onClick
                    ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onClick(smell);
                          }
                      }
                    : undefined
            }
        >
            {showMessage ? smell.message : smell.code}
        </Badge>
    );
    return (
        <Tooltip content={content} relationship="description" withArrow>
            {badge}
        </Tooltip>
    );
}

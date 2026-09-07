/**
 * Grid-row list that virtualises with @tanstack/react-virtual once the row count passes a
 * threshold; below it every row is rendered (simpler DOM, better for find-in-page).
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { VIRTUALISE_THRESHOLD } from '../theme';

export interface VirtualColumn {
    key: string;
    label: string;
    /** CSS grid track, e.g. `160px` or `minmax(200px, 1fr)`. */
    width: string;
}

export interface VirtualListProps<T> {
    rows: readonly T[];
    columns: readonly VirtualColumn[];
    rowKey: (row: T) => string;
    renderCell: (row: T, column: VirtualColumn) => ReactNode;
    rowHeight?: number;
    height?: number | string;
    onRowClick?: (row: T) => void;
    isSelected?: (row: T) => boolean;
    threshold?: number;
    ariaLabel: string;
}

export function VirtualList<T>({ rows, columns, rowKey, renderCell, rowHeight = 30, height = '100%', onRowClick, isSelected, threshold = VIRTUALISE_THRESHOLD, ariaLabel }: VirtualListProps<T>) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const virtual = rows.length > threshold;
    const virtualizer = useVirtualizer({
        count: virtual ? rows.length : 0,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan: 12,
    });
    const template = columns.map((c) => c.width).join(' ');

    const renderRow = (row: T, style?: CSSProperties) => {
        const clickable = !!onRowClick;
        return (
            <div
                key={rowKey(row)}
                className="tlm-vrow"
                role="row"
                tabIndex={clickable ? 0 : undefined}
                data-clickable={clickable}
                data-selected={isSelected?.(row) ?? false}
                style={{ gridTemplateColumns: template, height: rowHeight, ...style }}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={
                    clickable
                        ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onRowClick(row);
                              }
                          }
                        : undefined
                }
            >
                {columns.map((c) => (
                    <div key={c.key} role="cell">
                        {renderCell(row, c)}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="tlm-vlist" role="table" aria-label={ariaLabel} aria-rowcount={rows.length} style={{ height }}>
            <div className="tlm-vlist-scroll" ref={scrollRef}>
                <div className="tlm-vrow tlm-vrow-head" role="row" style={{ gridTemplateColumns: template, height: rowHeight }}>
                    {columns.map((c) => (
                        <div key={c.key} role="columnheader">
                            {c.label}
                        </div>
                    ))}
                </div>
                {virtual ? (
                    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                        {virtualizer.getVirtualItems().map((v) => {
                            const row = rows[v.index];
                            if (row === undefined) return null;
                            return renderRow(row, { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` });
                        })}
                    </div>
                ) : (
                    rows.map((row) => renderRow(row))
                )}
            </div>
        </div>
    );
}

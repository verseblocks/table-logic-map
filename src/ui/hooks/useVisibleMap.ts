/**
 * Selector hooks over the store. `useVisibleMap` returns the shared, memoised visible map
 * (`deriveVisibleMap`), so the header, the tab bar and the active tab re-derive it *once* per
 * partial-map tick between them instead of once each — and all of them get the same object.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LogicItem, LogicMap } from '../../domain/model';
import { useAppStore } from '../store';
import { deriveVisibleMap } from '../visibleMap';

export function useVisibleMap(): LogicMap | undefined {
    const map = useAppStore((s) => s.map);
    const showSystemSteps = useAppStore((s) => s.filters.showSystemSteps);
    const enabledOnly = useAppStore((s) => s.filters.enabledOnly);
    // `maxSyncItems` is a persisted setting, not a view filter, but the visible map is re-derived
    // whenever an item is hidden and the `too-many-sync` smell must use the configured threshold.
    const maxSyncItems = useAppStore((s) => s.maxSyncItems);
    return useMemo(
        () => (map ? deriveVisibleMap(map, { includeSystemSteps: showSystemSteps, enabledOnly, maxSyncItems }) : undefined),
        [map, showSystemSteps, enabledOnly, maxSyncItems],
    );
}

/** Index of every item (pipeline items + external touchers) of the *full* map by id. */
export function useItemIndex(): Map<string, LogicItem> {
    const map = useAppStore((s) => s.map);
    return useMemo(() => {
        const index = new Map<string, LogicItem>();
        for (const item of map?.items ?? []) index.set(item.id, item);
        for (const item of map?.externalTouchers ?? []) if (!index.has(item.id)) index.set(item.id, item);
        return index;
    }, [map]);
}

export function useSelectedItem(): LogicItem | undefined {
    const id = useAppStore((s) => s.selectedItemId);
    const index = useItemIndex();
    return id ? index.get(id) : undefined;
}

/** Elapsed milliseconds of the current run, ticking while it is running. */
export function useRunElapsed(): number {
    const status = useAppStore((s) => s.run.status);
    const startedAt = useAppStore((s) => s.run.startedAt);
    const finishedAt = useAppStore((s) => s.run.finishedAt);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (status !== 'running') return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
    }, [status]);
    if (!startedAt) return 0;
    return Math.max(0, (status === 'running' ? now : (finishedAt ?? now)) - startedAt);
}

/** Case-insensitive "does this item match the search text" over name, event, kind and stringified details. */
export function itemMatches(item: LogicItem, search: string): boolean {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (item.name.toLowerCase().includes(q) || item.event.toLowerCase().includes(q) || item.kind.includes(q)) return true;
    if ((item.filteringAttributes ?? []).some((a) => a.includes(q))) return true;
    try {
        return JSON.stringify(item.details).toLowerCase().includes(q);
    } catch {
        return false;
    }
}

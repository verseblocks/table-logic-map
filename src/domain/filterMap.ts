/**
 * View filters applied on top of a full LogicMap. Pure; used by the UI (display + export) and by
 * the headless entry (`includeSystemSteps`, `events`).
 */
import { rederive } from '../classify';
import type { EventName, LogicItem, LogicMap } from './model';

export interface MapFilters {
    /** Keep hidden Microsoft/system plugin steps (`details.isHidden`). Default false. */
    includeSystemSteps?: boolean;
    /** Drop disabled / draft items. Default false. */
    enabledOnly?: boolean;
    /** Keep only these events (custom/message events match exactly). */
    events?: EventName[];
    /**
     * Threshold for the `too-many-sync` smell, forwarded to `rederive`. Callers that built the full
     * map with a configured threshold (the UI setting `smells.maxSyncItems`, the headless input)
     * must pass the same value here, or the filtered map would re-derive with the built-in default.
     */
    maxSyncItems?: number;
}

export function isSystemItem(item: LogicItem): boolean {
    return item.details.isHidden === true;
}

export function filterItems(items: LogicItem[], filters: MapFilters): LogicItem[] {
    const events = filters.events && filters.events.length > 0 ? new Set(filters.events) : undefined;
    return items.filter((item) => {
        if (!filters.includeSystemSteps && isSystemItem(item)) return false;
        if (filters.enabledOnly && !item.enabled) return false;
        if (events && !events.has(item.event)) return false;
        return true;
    });
}

export function filterMap(map: LogicMap, filters: MapFilters): LogicMap {
    const items = filterItems(map.items, filters);
    if (items.length === map.items.length) return map;
    const next = rederive(map, items, { maxSyncItems: filters.maxSyncItems });
    const keep = new Set(items.map((i) => i.id));
    next.forms = map.forms.map((f) => ({
        ...f,
        handlers: f.handlers.filter((h) => keep.has(h.id)),
        pcf: f.pcf.filter((h) => keep.has(h.id)),
        components: f.components.filter((h) => keep.has(h.id)),
        businessRules: f.businessRules.filter((id) => keep.has(id)),
    }));
    next.externalTouchers = filterItems(map.externalTouchers, { ...filters, events: undefined });
    return next;
}

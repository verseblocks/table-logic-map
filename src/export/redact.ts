/**
 * Export-time redaction of plugin configuration (CLAUDE.md / design guide §8).
 *
 * A plugin step's *unsecure* configuration (`sdkmessageprocessingstep.configuration`) is shown in
 * the detail pane but routinely holds connection strings, endpoint URLs and API keys despite its
 * name, so it must not leave the tool unless the caller explicitly asks for it. The *secure*
 * configuration is never fetched at all.
 *
 * This module is the single implementation of that policy so every consumer applies the same rule:
 * the JSON export (`toJson`), the headless MCP payload and the windowed `returnData` payload.
 */
import type { LogicItem, LogicMap, Pipeline, Stage } from '../domain/model';
import { STAGE_ORDER } from '../domain/model';

/** Placeholder written in place of a step's unsecure configuration. */
export const CONFIG_OMITTED = '[configuration omitted]';

export interface RedactOptions {
    /** Keep plugin steps' unsecure configuration strings (never the secure configuration). Default false. */
    includeConfiguration?: boolean;
}

/** True when `details.unsecureConfig` carries a value that would leak. */
function carriesConfiguration(details: Record<string, unknown>): boolean {
    if (!('unsecureConfig' in details)) return false;
    const value = details.unsecureConfig;
    return value !== undefined && value !== null && value !== '' && value !== CONFIG_OMITTED;
}

/**
 * Return a copy of `map` in which every item's `details.unsecureConfig` is replaced by
 * `CONFIG_OMITTED`, unless `includeConfiguration` is set (then the map is returned unchanged).
 *
 * Every place an item can hide is covered: `items`, the `pipeline` rows (which reference the same
 * items), `externalTouchers` and the form-attached items (`handlers`, `pcf`, `components`). Items
 * that carry no configuration are reused by reference, and a map with nothing to redact is returned
 * as-is, so the result is deterministic and the input is never mutated.
 */
export function redactConfiguration(map: LogicMap, opts: RedactOptions = {}): LogicMap {
    if (opts.includeConfiguration) return map;

    // Keyed by item identity so shared references (pipeline rows, form handlers) map to one copy.
    const copies = new Map<LogicItem, LogicItem>();
    const redact = (item: LogicItem): LogicItem => {
        if (!carriesConfiguration(item.details)) return item;
        const existing = copies.get(item);
        if (existing) return existing;
        const copy: LogicItem = { ...item, details: { ...item.details, unsecureConfig: CONFIG_OMITTED } };
        copies.set(item, copy);
        return copy;
    };

    const items = map.items.map(redact);
    const externalTouchers = map.externalTouchers.map(redact);
    const forms = map.forms.map((form) => ({ ...form, handlers: form.handlers.map(redact), pcf: form.pcf.map(redact), components: form.components.map(redact) }));
    const pipeline: Pipeline = {};
    for (const event of Object.keys(map.pipeline)) {
        const row = map.pipeline[event];
        const next = {} as Record<Stage, LogicItem[]>;
        for (const stage of STAGE_ORDER) next[stage] = (row[stage] ?? []).map(redact);
        pipeline[event] = next;
    }

    if (copies.size === 0) return map;
    return { ...map, items, pipeline, forms, externalTouchers };
}

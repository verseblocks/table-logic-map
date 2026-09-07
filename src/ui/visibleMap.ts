/**
 * The one place the UI turns the full `LogicMap` into the *visible* map (view filters applied).
 *
 * Why this wrapper exists on top of `filterMap`:
 *
 *  1. **`smells.maxSyncItems`.** The store builds the full map with `includeSystemSteps: true` and
 *     the configured threshold, so `map.smells` is already correct while nothing is filtered. As
 *     soon as one item is dropped (hidden Microsoft/system steps are dropped by default) the map
 *     has to be re-derived, and the threshold has to travel with the filters or the re-derivation
 *     would fall back to the built-in default. `MapFilters.maxSyncItems` carries it, so header,
 *     tabs, detail badges, exports and the two-way MCP result all report the same smells as the
 *     full map.
 *  2. **Sharing the work.** `useVisibleMap` is called by the header, the tab bar and the active
 *     tab, and `store.visibleMap()` calls it again for export; a `useMemo` per hook instance
 *     therefore re-derives the whole map once *per subscriber* on every progressive `onPartial`
 *     tick. `deriveVisibleMap` adds a module-level single-entry memo keyed by map identity plus
 *     the view options, so one tick costs one derivation and every consumer gets the same
 *     `LogicMap` object (so their own `useMemo(..., [map])` stay warm too).
 */
import { filterMap, type MapFilters } from '../domain/filterMap';
import { stripRaw, type LogicMap } from '../domain/model';
import { toMarkdown } from '../export/markdown';
import { redactConfiguration } from '../export/redact';

export interface ViewOptions extends MapFilters {
    /** `smells.maxSyncItems` setting — threshold for the `too-many-sync` smell. */
    maxSyncItems?: number;
}

/**
 * `filterMap` under the UI-facing name (`ViewOptions` = `MapFilters`). Returns `map` itself when no
 * item is dropped, because the full map was already derived with the configured threshold.
 */
export function applyViewFilters(map: LogicMap, options: ViewOptions): LogicMap {
    return filterMap(map, options);
}

function viewKey(options: ViewOptions): string {
    return [options.includeSystemSteps === true, options.enabledOnly === true, options.maxSyncItems ?? '', (options.events ?? []).join(',')].join('|');
}

let memo: { map: LogicMap; key: string; value: LogicMap } | undefined;

/**
 * Memoised `applyViewFilters`. One entry: every consumer of a given map + view options asks for
 * the same combination, and a new partial map (or a filter change) invalidates it immediately.
 */
export function deriveVisibleMap(map: LogicMap, options: ViewOptions): LogicMap {
    const key = viewKey(options);
    if (memo && memo.map === map && memo.key === key) return memo.value;
    const value = applyViewFilters(map, options);
    memo = { map, key, value };
    return value;
}

/** Test hook: drop the memo so cases do not leak into one another. */
export function resetVisibleMapMemo(): void {
    memo = undefined;
}

/** Options for the windowed two-way MCP payload (`invocation.returnData`). */
export interface AgentPayloadOptions extends ViewOptions {
    /** Render the Mermaid diagram section into the Markdown. */
    includeDiagrams?: boolean;
    /** Terminal-outcome note (build failure, cancellation, timeout); an extra key on the payload. */
    error?: string;
}

/**
 * Build the payload a windowed two-way launch returns. Shape matches `invocation.returnTopic` in
 * pptb.config.json (`logicMap`, `markdown`, plus the optional extra `error` key).
 *
 * Three policies live here so the windowed path cannot drift from the headless one
 * (`twoWayResult` in src/headless.ts): the same view filters and `too-many-sync` threshold as the
 * screen, `raw` stripped (source payloads are not part of the contract), and the plugin
 * configuration redaction of src/export/redact.ts — a step's unsecure configuration never leaves
 * the tool.
 */
export function buildAgentPayload(map: LogicMap, options: AgentPayloadOptions = {}): Record<string, unknown> {
    const { includeDiagrams, error, ...view } = options;
    const visible = redactConfiguration(stripRaw(applyViewFilters(map, view)));
    const payload: Record<string, unknown> = { logicMap: visible, markdown: toMarkdown(visible, { includeDiagrams: includeDiagrams === true }) };
    if (error) payload.error = error;
    return payload;
}

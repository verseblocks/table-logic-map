/**
 * `applyViewFilters` / `deriveVisibleMap` are pure (no DOM, no store), so they are unit-tested
 * here even though the rest of `src/ui` is not.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { LogicItem, LogicMap } from '../domain/model';
import { RAW_MARKER, sampleMap, UNSECURE_CONFIG } from '../fixtures/logicmap.sample';
import { CONFIG_OMITTED } from '../export/redact';
import { applyViewFilters, buildAgentPayload, deriveVisibleMap, resetVisibleMapMemo } from './visibleMap';

const SYNC_EVENT = 'Create';
const SYNC_STAGE = 'preoperation';

/** Sample map + `count` extra synchronous plugin steps on Create/PreOperation + one hidden step. */
function mapWithSyncSteps(count: number): LogicMap {
    const map = sampleMap();
    const template = map.items.find((i) => i.kind === 'plugin' && i.mode === 'sync');
    if (!template) throw new Error('fixture has no synchronous plugin step');
    const clone = (id: string, isHidden: boolean): LogicItem => ({
        ...structuredClone(template),
        id,
        name: `Step ${id}`,
        event: SYNC_EVENT,
        stage: SYNC_STAGE,
        mode: 'sync',
        filteringAttributes: [],
        details: { ...structuredClone(template.details), isHidden },
    });
    const extra = Array.from({ length: count }, (_, n) => clone(`sync-${n}`, false));
    // A hidden Microsoft/system step: the default view drops it, which is what forces filterMap to
    // re-derive the map (and, before the fix, to recompute the smells with the default threshold).
    extra.push(clone('system-step', true));
    return { ...map, items: [...map.items, ...extra] };
}

function tooManySync(map: LogicMap): number {
    return map.smells.filter((s) => s.code === 'too-many-sync' && s.event === SYNC_EVENT && s.stage === SYNC_STAGE).length;
}

describe('applyViewFilters', () => {
    beforeEach(() => resetVisibleMapMemo());

    it('drops hidden system steps and keeps them when asked', () => {
        const map = mapWithSyncSteps(2);
        expect(applyViewFilters(map, { maxSyncItems: 5 }).items.some((i) => i.id === 'system-step')).toBe(false);
        expect(applyViewFilters(map, { includeSystemSteps: true, maxSyncItems: 5 }).items.some((i) => i.id === 'system-step')).toBe(true);
    });

    it('returns the map itself when nothing is filtered (its smells already used the setting)', () => {
        const map = sampleMap();
        expect(applyViewFilters(map, { includeSystemSteps: true, maxSyncItems: 3 })).toBe(map);
    });

    it('re-derives the `too-many-sync` smell with the configured maxSyncItems, not the default 5', () => {
        // 6 synchronous items on one event/stage, one hidden step forcing the re-derivation.
        const map = mapWithSyncSteps(6);
        // Threshold above the count: no smell (the default 5 would have flagged it).
        expect(tooManySync(applyViewFilters(map, { maxSyncItems: 10 }))).toBe(0);
        // Threshold below the count: flagged (the default 5 is also below, so check the message).
        const strict = applyViewFilters(map, { maxSyncItems: 2 });
        expect(tooManySync(strict)).toBe(1);
        expect(strict.smells.find((s) => s.code === 'too-many-sync')?.message).toContain('threshold 2');
    });

    it('threads maxSyncItems onto the items themselves (detail badges read item.smells)', () => {
        const map = mapWithSyncSteps(6);
        const relaxed = applyViewFilters(map, { maxSyncItems: 10 });
        const strict = applyViewFilters(map, { maxSyncItems: 2 });
        const smellsOf = (m: LogicMap) => m.items.find((i) => i.id === 'sync-0')?.smells ?? [];
        expect(smellsOf(relaxed).some((id) => id.includes('too-many-sync'))).toBe(false);
        expect(smellsOf(strict).some((id) => id.includes('too-many-sync'))).toBe(true);
    });

    it('keeps only form handlers that survived the filter', () => {
        const map = mapWithSyncSteps(1);
        const visible = applyViewFilters(map, { enabledOnly: true, maxSyncItems: 5 });
        const ids = new Set(visible.items.map((i) => i.id));
        for (const form of visible.forms) {
            for (const handler of [...form.handlers, ...form.pcf, ...form.components]) expect(ids.has(handler.id)).toBe(true);
            for (const ruleId of form.businessRules) expect(ids.has(ruleId)).toBe(true);
        }
    });
});

describe('deriveVisibleMap', () => {
    beforeEach(() => resetVisibleMapMemo());

    it('derives once per map + view options and hands every consumer the same object', () => {
        const map = mapWithSyncSteps(2);
        const first = deriveVisibleMap(map, { includeSystemSteps: false, enabledOnly: false, maxSyncItems: 5 });
        const second = deriveVisibleMap(map, { includeSystemSteps: false, enabledOnly: false, maxSyncItems: 5 });
        expect(second).toBe(first);
    });

    it('re-derives when the map or any view option changes', () => {
        const map = mapWithSyncSteps(6);
        const base = deriveVisibleMap(map, { maxSyncItems: 10 });
        expect(deriveVisibleMap(map, { maxSyncItems: 2 })).not.toBe(base);
        expect(deriveVisibleMap(map, { enabledOnly: true, maxSyncItems: 10 })).not.toBe(base);
        // A new (partial) map object invalidates the memo even with identical options.
        expect(deriveVisibleMap({ ...map }, { maxSyncItems: 10 })).not.toBe(base);
    });

    it('agrees with applyViewFilters', () => {
        const map = mapWithSyncSteps(6);
        const options = { includeSystemSteps: false, enabledOnly: false, maxSyncItems: 3 };
        expect(deriveVisibleMap(map, options)).toEqual(applyViewFilters(map, options));
    });
});

describe('buildAgentPayload (windowed two-way MCP result)', () => {
    beforeEach(() => resetVisibleMapMemo());

    it('never ships a plugin step unsecure configuration to the agent', () => {
        const payload = buildAgentPayload(sampleMap(), { includeSystemSteps: true });
        const json = JSON.stringify(payload);
        expect(json).not.toContain(UNSECURE_CONFIG);
        expect(json).toContain(CONFIG_OMITTED);
        // The filtered path re-derives the map, so it has to be redacted too.
        const filtered = buildAgentPayload(mapWithSyncSteps(1), {});
        expect(JSON.stringify(filtered)).not.toContain(UNSECURE_CONFIG);
    });

    it('strips the raw source payloads and does not mutate the input map', () => {
        const map = sampleMap();
        const payload = buildAgentPayload(map, { includeSystemSteps: true });
        expect(JSON.stringify(payload)).not.toContain(RAW_MARKER);
        expect((payload.logicMap as LogicMap).raw).toBeUndefined();
        // The caller keeps its own map intact (the UI keeps rendering it after responding).
        expect(map.raw).toBeDefined();
        const item = map.items.find((i) => i.details.unsecureConfig !== undefined);
        expect(item?.details.unsecureConfig).toBe(UNSECURE_CONFIG);
    });

    it('returns the returnTopic shape, with `error` only when an outcome note is given', () => {
        const ok = buildAgentPayload(sampleMap(), {});
        expect(Object.keys(ok).sort()).toEqual(['logicMap', 'markdown']);
        expect(typeof ok.markdown).toBe('string');
        expect('error' in ok).toBe(false);
        const failed = buildAgentPayload(sampleMap(), { error: 'Timed out' });
        expect(failed.error).toBe('Timed out');
    });

    it('applies the configured too-many-sync threshold, like the screen and the exports', () => {
        const map = mapWithSyncSteps(6);
        expect(tooManySync(buildAgentPayload(map, { maxSyncItems: 5 }).logicMap as LogicMap)).toBe(1);
        expect(tooManySync(buildAgentPayload(map, { maxSyncItems: 99 }).logicMap as LogicMap)).toBe(0);
    });
});

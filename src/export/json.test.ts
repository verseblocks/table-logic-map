import { describe, expect, it } from 'vitest';
import type { LogicItem, LogicMap } from '../domain/model';
import { IDS, RAW_MARKER, UNSECURE_CONFIG, sampleMap } from '../fixtures/logicmap.sample';
import { CONFIG_OMITTED, redactConfiguration, toJson } from './json';

/** Sample map with an unsecure configuration on an item in every place an item can hide. */
function mapWithConfigEverywhere(): LogicMap {
    const map = sampleMap();
    map.externalTouchers[0].details.unsecureConfig = UNSECURE_CONFIG;
    map.forms[0].handlers[0].details.unsecureConfig = UNSECURE_CONFIG;
    map.forms[0].pcf[0].details.unsecureConfig = UNSECURE_CONFIG;
    map.forms[0].components[0].details.unsecureConfig = UNSECURE_CONFIG;
    return map;
}

function allItems(map: LogicMap): LogicItem[] {
    const fromPipeline = Object.values(map.pipeline).flatMap((row) => Object.values(row).flat());
    const fromForms = map.forms.flatMap((f) => [...f.handlers, ...f.pcf, ...f.components]);
    return [...map.items, ...map.externalTouchers, ...fromPipeline, ...fromForms];
}

describe('toJson', () => {
    it('redacts plugin unsecure configuration by default', () => {
        const json = toJson(sampleMap());
        expect(json).not.toContain(UNSECURE_CONFIG);
        expect(json).toContain(CONFIG_OMITTED);
        const parsed = JSON.parse(json) as LogicMap;
        const step = parsed.items.find((i) => i.id === IDS.pluginNumbering)!;
        expect(step.details.unsecureConfig).toBe(CONFIG_OMITTED);
        // The pipeline references the same item objects; it must be redacted too.
        const inPipeline = parsed.pipeline.Create.preoperation.find((i) => i.id === IDS.pluginNumbering)!;
        expect(inPipeline.details.unsecureConfig).toBe(CONFIG_OMITTED);
    });

    it('writes the configuration only when it is explicitly requested', () => {
        const json = toJson(sampleMap(), { includeConfiguration: true });
        expect(json).toContain(UNSECURE_CONFIG);
        expect(json).not.toContain(RAW_MARKER);
    });

    it('redacts external touchers and form-attached items as well', () => {
        const json = toJson(mapWithConfigEverywhere());
        expect(json).not.toContain(UNSECURE_CONFIG);
        const parsed = JSON.parse(json) as LogicMap;
        for (const item of allItems(parsed)) {
            if ('unsecureConfig' in item.details) expect(item.details.unsecureConfig).toBe(CONFIG_OMITTED);
        }
    });

    it('never writes the raw payload and is deterministic', () => {
        const json = toJson(sampleMap());
        expect(json).not.toContain(RAW_MARKER);
        expect(JSON.parse(json).raw).toBeUndefined();
        expect(toJson(sampleMap())).toBe(json);
    });

    it('does not mutate the map it is given', () => {
        const map = mapWithConfigEverywhere();
        toJson(map);
        expect(map.items.find((i) => i.id === IDS.pluginNumbering)!.details.unsecureConfig).toBe(UNSECURE_CONFIG);
        expect(map.externalTouchers[0].details.unsecureConfig).toBe(UNSECURE_CONFIG);
        expect(map.forms[0].handlers[0].details.unsecureConfig).toBe(UNSECURE_CONFIG);
        expect(map.raw).toBeDefined();
    });
});

describe('redactConfiguration', () => {
    it('keeps everything else intact and reuses untouched items by reference', () => {
        const map = sampleMap();
        const redacted = redactConfiguration(map);
        expect(redacted).not.toBe(map);
        expect(redacted.items).toHaveLength(map.items.length);
        expect(redacted.smells).toBe(map.smells);
        const rollup = redacted.items.find((i) => i.id === IDS.pluginRollup)!;
        // No configuration on that step: same object, no copy.
        expect(rollup).toBe(map.items.find((i) => i.id === IDS.pluginRollup));
        const numbering = redacted.items.find((i) => i.id === IDS.pluginNumbering)!;
        expect(numbering.name).toBe(map.items.find((i) => i.id === IDS.pluginNumbering)!.name);
        expect(numbering.details.hasSecureConfig).toBe(true);
        // One copy per item, shared with the pipeline row.
        expect(redacted.pipeline.Create.preoperation).toContain(numbering);
    });

    it('returns the map unchanged when configuration is requested or there is nothing to redact', () => {
        const map = sampleMap();
        expect(redactConfiguration(map, { includeConfiguration: true })).toBe(map);
        const clean = sampleMap();
        for (const item of clean.items) delete item.details.unsecureConfig;
        expect(redactConfiguration(clean)).toBe(clean);
    });

    it('leaves an absent, empty or already redacted configuration alone', () => {
        const map = sampleMap();
        const step = map.items.find((i) => i.id === IDS.pluginNumbering)!;
        step.details.unsecureConfig = '';
        expect(redactConfiguration(map).items.find((i) => i.id === IDS.pluginNumbering)!.details.unsecureConfig).toBe('');
        step.details.unsecureConfig = CONFIG_OMITTED;
        expect(redactConfiguration(map)).toBe(map);
    });
});

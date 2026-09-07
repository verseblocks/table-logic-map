import { describe, expect, it, vi } from 'vitest';
import { invokeHeadless, normalizeEntityName, normalizeEvents, normalizeMaxSyncItems, tableError, twoWayResult, type HeadlessContext } from './headless';
import { buildLogicMap } from './domain/buildLogicMap';
import { makeFakeClient } from './sources/testUtils';
import { DataverseRequestError } from './data/client';
import { CONFIG_OMITTED } from './export/redact';
import { sampleMap, UNSECURE_CONFIG } from './fixtures/logicmap.sample';

function ctx(over: Partial<HeadlessContext> = {}): HeadlessContext {
    return {
        toolId: 'table-logic-map',
        toolName: 'Table Logic Map',
        invocationMode: 'two-way',
        updateProgress: vi.fn(),
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        ...over,
    };
}

describe('normalizeEntityName', () => {
    it('accepts logical names and lower-cases them', () => {
        expect(normalizeEntityName('account')).toBe('account');
        expect(normalizeEntityName('  Contoso_Project ')).toBe('contoso_project');
        expect(normalizeEntityName('msdyn_workorder')).toBe('msdyn_workorder');
    });

    it('rejects anything that could rewrite the metadata path or is not a logical name', () => {
        // getEntityMetadata interpolates the value into EntityDefinitions(LogicalName='<value>').
        expect(normalizeEntityName("account')/Attributes?x=('")).toBeUndefined();
        expect(normalizeEntityName('account/attributes')).toBeUndefined();
        expect(normalizeEntityName('Account Name')).toBeUndefined();
        expect(normalizeEntityName('acc#ount')).toBeUndefined();
        expect(normalizeEntityName('1account')).toBeUndefined();
        expect(normalizeEntityName('a'.repeat(65))).toBeUndefined();
        expect(normalizeEntityName(42)).toBeUndefined();
    });
});

describe('normalizeEvents', () => {
    it('matches well-known events case-insensitively', () => {
        expect(normalizeEvents(['create', 'UPDATE', 'fieldchange'])).toEqual({ events: ['Create', 'Update', 'FieldChange'], unknown: [] });
    });

    it('keeps Custom:/Message: message names verbatim and normalises only the prefix', () => {
        expect(normalizeEvents(['custom:contoso_Approve', 'MESSAGE:GrantAccess'])).toEqual({
            events: ['Custom:contoso_Approve', 'Message:GrantAccess'],
            unknown: [],
        });
    });

    it('reports unknown values instead of dropping them silently', () => {
        // A dropped value would leave events=['Create'] and an assistant would never learn about the typo.
        expect(normalizeEvents(['Create', 'Modify', ''])).toEqual({ events: ['Create'], unknown: ['Modify', ''] });
        expect(normalizeEvents(['Created'])).toEqual({ events: undefined, unknown: ['Created'] });
        expect(normalizeEvents(42).unknown).toEqual(['42']);
    });

    it('de-duplicates, accepts a bare string and treats no filter as undefined', () => {
        expect(normalizeEvents(['Create', 'create'])).toEqual({ events: ['Create'], unknown: [] });
        expect(normalizeEvents('update')).toEqual({ events: ['Update'], unknown: [] });
        expect(normalizeEvents(undefined)).toEqual({ events: undefined, unknown: [] });
        expect(normalizeEvents([])).toEqual({ events: undefined, unknown: [] });
    });
});

describe('invokeHeadless input validation', () => {
    // Validation must happen before any Dataverse access: there is no dataverseAPI global in tests,
    // so resolveDataverseApi() would throw if a bad input reached the client.
    it('requires entityName', async () => {
        const result = await invokeHeadless({}, ctx());
        expect(result.error).toContain('entityName is required');
    });

    it('rejects an entityName that is not a table logical name', async () => {
        const result = await invokeHeadless({ entityName: "account')/Attributes?x=('" }, ctx());
        expect(String(result.error)).toContain('entityName must be a table logical name');
        expect(result.logicMap).toBeUndefined();
    });

    it('rejects unknown event names instead of returning an empty map', async () => {
        const result = await invokeHeadless({ entityName: 'account', events: ['create', 'Modify'] }, ctx());
        expect(String(result.error)).toContain('Unknown event(s): Modify');
        expect(String(result.error)).toContain('Custom:');
    });
});

describe('twoWayResult', () => {
    it('redacts plugin unsecure configuration from the payload returned to an assistant', () => {
        const result = twoWayResult(sampleMap());
        const json = JSON.stringify(result.logicMap);
        expect(json).not.toContain(UNSECURE_CONFIG);
        expect(json).toContain(CONFIG_OMITTED);
        expect(result.markdown).not.toContain(UNSECURE_CONFIG);
    });

    it('does not mutate the input map and honours includeDiagrams', () => {
        const map = sampleMap();
        const before = JSON.stringify(map);
        const plain = twoWayResult(map);
        expect(JSON.stringify(map)).toBe(before);
        expect(plain.markdown).not.toContain('```mermaid');
        expect(twoWayResult(map, { includeDiagrams: true }).markdown).toContain('```mermaid');
    });
});

describe('tableError', () => {
    it('names the table in the message and keeps the Dataverse error kind', () => {
        const err = tableError('nope_table', new DataverseRequestError('HTTP 404', 'notfound', 'EntityDefinitions'));
        expect(err.message).toBe("Unable to load table 'nope_table': HTTP 404");
        expect(err).toBeInstanceOf(DataverseRequestError);
        expect((err as DataverseRequestError).kind).toBe('notfound');
    });

    it('wraps plain errors once', () => {
        const wrapped = tableError('account', new Error('boom'));
        expect(wrapped.message).toBe("Unable to load table 'account': boom");
        expect(tableError('account', wrapped)).toBe(wrapped);
    });
});

describe('normalizeMaxSyncItems', () => {
    it('accepts positive integers and floors fractions', () => {
        expect(normalizeMaxSyncItems(3)).toBe(3);
        expect(normalizeMaxSyncItems(7.9)).toBe(7);
    });

    it('falls back to the classifier default for anything else', () => {
        for (const value of [0, -1, NaN, Infinity, '5', null, undefined, {}]) {
            expect(normalizeMaxSyncItems(value)).toBeUndefined();
        }
    });
});

/**
 * A table that does not exist comes back from the platform as a bare `HTTP 404`. buildLogicMap
 * must name the table it failed to load so the UI error state and the headless error read the
 * same, and `tableError()` must not prefix it a second time.
 */
describe('buildLogicMap table-load failure', () => {
    const notFound = () => {
        throw new DataverseRequestError('HTTP 404', 'notfound', "EntityDefinitions(LogicalName='nope_table')");
    };

    it('names the table and keeps the Dataverse error kind', async () => {
        const client = makeFakeClient([{ match: /EntityDefinitions/, response: notFound }]);
        const err = await buildLogicMap(client, 'nope_table').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(DataverseRequestError);
        expect((err as Error).message).toBe("Unable to load table 'nope_table': HTTP 404");
        expect((err as DataverseRequestError).kind).toBe('notfound');
    });

    it('is not prefixed twice when the headless entry wraps it', async () => {
        const client = makeFakeClient([{ match: /EntityDefinitions/, response: notFound }]);
        const err = await buildLogicMap(client, 'nope_table').catch((e: unknown) => e);
        expect(tableError('nope_table', err).message).toBe("Unable to load table 'nope_table': HTTP 404");
    });
});

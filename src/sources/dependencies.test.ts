import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DataverseRequestError, type ClientStats, type DataverseClient, type Row } from '../data/client';
import type { Logger, TableFacts } from '../domain/model';
import type { SourceContext } from './types';
import { COMPONENT_TYPE_OPTIONSET_PATH, dependenciesPath, dependenciesSource, extractDependencyEntities } from './dependencies';

const fixture = (name: string): Row => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', name), 'utf8')) as Row;
const PLAIN = fixture('dependencies.retrievefordelete.json');
const ATTRIBUTES = fixture('dependencies.retrievefordelete.attributes.json');

const METADATA_ID = 'AAAAAAAA-0000-4000-8000-000000000001';
const EXPECTED_PATH = 'RetrieveDependenciesForDelete(ObjectId=@id,ComponentType=@ct)?@id=aaaaaaaa-0000-4000-8000-000000000001&@ct=1';

const OPTION_SET: Row = {
    LogicalName: 'componenttype',
    OptionSet: {
        Options: [
            { Value: 1, Label: { UserLocalizedLabel: { Label: 'Entity' }, LocalizedLabels: [{ Label: 'Entity' }] } },
            { Value: 10021, Label: { UserLocalizedLabel: { Label: 'Contoso Custom Component' }, LocalizedLabels: [{ Label: 'Contoso Custom Component' }] } },
            { Value: 10022, Label: { UserLocalizedLabel: null, LocalizedLabels: [{ Label: 'Fallback Only' }] } },
        ],
    },
};

const TABLE: TableFacts = {
    logicalName: 'contoso_project',
    entitySetName: 'contoso_projects',
    metadataId: METADATA_ID,
    displayName: 'Project',
    schemaName: 'contoso_Project',
    ownership: 'UserOwned',
    isActivity: false,
    isCustom: true,
    isCustomizable: true,
    isBpfEntity: false,
    audit: false,
    changeTracking: false,
    duplicateDetection: false,
    hasNotes: true,
    hasActivities: true,
};

const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

type OneHandler = (path: string) => Row | Promise<Row>;

/** Minimal in-memory DataverseClient: `queryOne` is routed through `handler`, every call is recorded. */
function makeFakeClient(handler: OneHandler): DataverseClient & { calls: string[] } {
    const calls: string[] = [];
    const stats: ClientStats = { requests: 0, retries: 0, cacheHits: 0 };
    const unsupported = (name: string) => async () => Promise.reject(new Error(`${name} not expected in this test`));
    return {
        calls,
        stats,
        queryOne: async (p) => {
            calls.push(p);
            stats.requests++;
            return handler(p);
        },
        queryRaw: async (p) => {
            calls.push(p);
            stats.requests++;
            return handler(p);
        },
        query: async (p) => {
            calls.push(p);
            stats.requests++;
            const body = await handler(p);
            return Array.isArray(body.value) ? (body.value as Row[]) : [];
        },
        entityMetadata: unsupported('entityMetadata'),
        allEntities: unsupported('allEntities'),
        relatedMetadata: unsupported('relatedMetadata'),
        fetchXml: unsupported('fetchXml'),
    };
}

function makeCtx(client: DataverseClient, overrides: Partial<SourceContext> = {}): SourceContext {
    return {
        client,
        table: TABLE,
        org: {},
        options: {},
        knownColumns: new Set(),
        customApiNames: new Set(),
        environmentUrl: 'https://org.crm.dynamics.com',
        logger: silentLogger,
        ...overrides,
    };
}

function handlerFor(body: Row, optionSet: Row | Error = OPTION_SET): OneHandler {
    return (p) => {
        if (p.startsWith('RetrieveDependenciesForDelete(')) return body;
        if (p === COMPONENT_TYPE_OPTIONSET_PATH) {
            if (optionSet instanceof Error) throw optionSet;
            return optionSet;
        }
        throw new Error(`unexpected query ${p}`);
    };
}

describe('dependencies source', () => {
    it('builds the function URL with an unquoted, normalised GUID', () => {
        expect(dependenciesSource.name).toBe('dependencies');
        expect(dependenciesPath(METADATA_ID)).toBe(EXPECTED_PATH);
        expect(dependenciesPath('{aaaaaaaa-0000-4000-8000-000000000001}')).toBe(EXPECTED_PATH);
    });

    it('reads the EntityCollection.Entities shape, de-duplicates, sorts and labels component types', async () => {
        const client = makeFakeClient(handlerFor(PLAIN));
        const result = await dependenciesSource.run(makeCtx(client));

        expect(client.calls[0]).toBe(EXPECTED_PATH);
        expect(result.items).toEqual([]);
        // `dependencyType` / `dependencyTypeName` are optional extras (DependencyInfo), hence the subset match.
        expect(result.dependencies).toMatchObject([
            { componentType: 24, componentTypeName: 'Form', objectId: 'e4e4e4e4-0000-4000-8000-000000000001', classified: false },
            { componentType: 26, componentTypeName: 'Saved Query', objectId: 'c2c2c2c2-0000-4000-8000-000000000001', classified: false },
            { componentType: 29, componentTypeName: 'Workflow', objectId: 'f5f5f5f5-0000-4000-8000-000000000001', classified: false },
            { componentType: 92, componentTypeName: 'SDK Message Processing Step', objectId: '11111111-1111-4111-8111-000000000002', classified: false },
            { componentType: 10021, componentTypeName: 'Contoso Custom Component', objectId: 'd3d3d3d3-0000-4000-8000-000000000001', classified: false },
        ]);
        // The unknown type 10021 triggered exactly one option-set lookup.
        expect(client.calls.filter((c) => c === COMPONENT_TYPE_OPTIONSET_PATH)).toHaveLength(1);
        expect(result.dependencies?.every((d) => !('name' in d) || d.name === undefined)).toBe(true);
    });

    it('reads the Attributes key/value shape (both key/value casings, OptionSetValue and EntityReference wrappers)', async () => {
        const client = makeFakeClient(handlerFor(ATTRIBUTES));
        const result = await dependenciesSource.run(makeCtx(client));
        expect(result.dependencies).toMatchObject([
            { componentType: 10, componentTypeName: 'Entity Relationship', objectId: 'b6b6b6b6-0000-4000-8000-000000000001', classified: false },
            { componentType: 60, componentTypeName: 'System Form', objectId: 'e4e4e4e4-0000-4000-8000-000000000002', classified: false, dependencyType: 2, dependencyTypeName: 'Published' },
        ]);
        // Every type is in the base table, so no option-set lookup.
        expect(client.calls).toEqual([EXPECTED_PATH]);
        const raw = result.raw as { path: string; dependencies: Array<Record<string, unknown>> };
        expect(raw.path).toBe(EXPECTED_PATH);
        expect(raw.dependencies[1]).toMatchObject({ componentType: 60, dependencyType: 2, dependencyTypeName: 'Published', requiredComponentType: 1, requiredComponentObjectId: 'aaaaaaaa-0000-4000-8000-000000000001' });
        expect(raw.dependencies[0]).toMatchObject({ requiredComponentObjectId: 'aaaaaaaa-0000-4000-8000-000000000001' });
    });

    it('tolerates a top-level value array', async () => {
        const body: Row = {
            value: [
                { dependentcomponenttype: 61, dependentcomponentobjectid: '{ABCDEF00-0000-4000-8000-000000000001}', dependencytype: 2 },
                { dependentcomponenttype: '80', dependentcomponentobjectid: 'abcdef00-0000-4000-8000-000000000002' },
                { dependentcomponenttype: 61 }, // no object id → skipped
            ],
        };
        const client = makeFakeClient(handlerFor(body));
        const result = await dependenciesSource.run(makeCtx(client));
        expect(result.dependencies).toEqual([
            { componentType: 61, componentTypeName: 'Web Resource', objectId: 'abcdef00-0000-4000-8000-000000000001', classified: false, dependencyType: 2, dependencyTypeName: 'Published' },
            { componentType: 80, componentTypeName: 'App Module', objectId: 'abcdef00-0000-4000-8000-000000000002', classified: false },
        ]);
        expect(extractDependencyEntities({})).toEqual([]);
        expect(extractDependencyEntities({ EntityCollection: { Entities: 'nope' } })).toEqual([]);
    });

    it('leaves unknown types unlabelled when the option-set lookup fails', async () => {
        const client = makeFakeClient(handlerFor(PLAIN, new DataverseRequestError('HTTP 403', 'permission', COMPONENT_TYPE_OPTIONSET_PATH)));
        const warnings: string[] = [];
        const result = await dependenciesSource.run(makeCtx(client, { logger: { ...silentLogger, warn: (m) => void warnings.push(m) } }));
        const custom = result.dependencies?.find((d) => d.componentType === 10021);
        expect(custom).toMatchObject({ componentType: 10021, objectId: 'd3d3d3d3-0000-4000-8000-000000000001', classified: false });
        expect(custom?.componentTypeName).toBeUndefined();
        expect(result.dependencies?.find((d) => d.componentType === 24)?.componentTypeName).toBe('Form');
        expect(warnings.some((w) => /component type labels/.test(w))).toBe(true);
    });

    it('propagates 400 / permission errors from the function call', async () => {
        const denied = makeFakeClient((p) => {
            throw new DataverseRequestError('0x80040220: Principal user is missing prvReadDependency privilege', 'permission', p);
        });
        await expect(dependenciesSource.run(makeCtx(denied))).rejects.toMatchObject({ name: 'DataverseRequestError', kind: 'permission' });

        const bad = makeFakeClient((p) => {
            throw new DataverseRequestError('HTTP 400', 'badrequest', p);
        });
        await expect(dependenciesSource.run(makeCtx(bad))).rejects.toMatchObject({ kind: 'badrequest' });
    });

    it('skips (with a warning) when the table has no MetadataId', async () => {
        const client = makeFakeClient(handlerFor(PLAIN));
        const result = await dependenciesSource.run(makeCtx(client, { table: { ...TABLE, metadataId: '' } }));
        expect(result.dependencies).toEqual([]);
        expect(result.warnings?.[0]).toMatch(/MetadataId/);
        expect(client.calls).toEqual([]);
    });
});

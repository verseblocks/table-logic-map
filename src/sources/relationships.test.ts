import { describe, expect, it } from 'vitest';
import { DataverseRequestError, type Row } from '../data/client';
import { CASCADE_WALK_LIMIT, MANY_MANY_PROPS, ONE_MANY_PROPS, cascadeMap, relationshipsSource } from './relationships';
import { makeCtx, makeFakeClient, metadataPath, type FakeRoute } from './testUtils';

const cascade = (overrides: Record<string, string> = {}) => ({
    Assign: 'NoCascade',
    Delete: 'RemoveLink',
    Merge: 'NoCascade',
    Reparent: 'NoCascade',
    Share: 'NoCascade',
    Unshare: 'NoCascade',
    RollupView: 'NoCascade',
    Archive: 'NoCascade',
    ...overrides,
});

/** OneToManyRelationshipMetadata where contoso_project is the parent (ReferencedEntity). */
const ONE_TO_MANY: Row[] = [
    {
        MetadataId: 'c1000000-0000-4000-8000-000000000001',
        SchemaName: 'contoso_project_task',
        ReferencedEntity: 'contoso_project',
        ReferencedAttribute: 'contoso_projectid',
        ReferencingEntity: 'contoso_task',
        ReferencingAttribute: 'contoso_projectid',
        CascadeConfiguration: cascade({ Assign: 'Cascade', Delete: 'Cascade', Share: 'Cascade', Unshare: 'Cascade', Reparent: 'Cascade', Merge: 'Cascade', RollupView: 'Cascade' }),
        IsCustomRelationship: true,
    },
    {
        MetadataId: 'c1000000-0000-4000-8000-000000000002',
        SchemaName: 'contoso_project_annotations',
        ReferencedEntity: 'contoso_project',
        ReferencedAttribute: 'contoso_projectid',
        ReferencingEntity: 'annotation',
        ReferencingAttribute: 'objectid',
        CascadeConfiguration: cascade({ Assign: 'Cascade', Delete: 'Cascade', Share: 'Cascade', Unshare: 'Cascade', Reparent: 'Cascade', Merge: 'NoCascade', RollupView: 'NoCascade' }),
        IsCustomRelationship: false,
    },
    {
        MetadataId: 'c1000000-0000-4000-8000-000000000003',
        SchemaName: 'contoso_project_invoice',
        ReferencedEntity: 'contoso_project',
        ReferencedAttribute: 'contoso_projectid',
        ReferencingEntity: 'contoso_invoice',
        ReferencingAttribute: 'contoso_projectid',
        CascadeConfiguration: cascade({ Delete: 'Restrict' }),
        IsCustomRelationship: true,
    },
];

/** ManyToOneRelationshipMetadata where contoso_project is the child (ReferencingEntity). */
const MANY_TO_ONE: Row[] = [
    {
        MetadataId: 'c2000000-0000-4000-8000-000000000001',
        SchemaName: 'contoso_account_project',
        ReferencedEntity: 'account',
        ReferencedAttribute: 'accountid',
        ReferencingEntity: 'contoso_project',
        ReferencingAttribute: 'contoso_customerid',
        CascadeConfiguration: cascade({ Assign: 'Cascade', Delete: 'Cascade', Share: 'Cascade', Unshare: 'Cascade', Reparent: 'Cascade' }),
        IsCustomRelationship: true,
    },
    {
        MetadataId: 'c2000000-0000-4000-8000-000000000002',
        SchemaName: 'owner_contoso_project',
        ReferencedEntity: 'owner',
        ReferencedAttribute: 'ownerid',
        ReferencingEntity: 'contoso_project',
        ReferencingAttribute: 'ownerid',
        CascadeConfiguration: cascade({ Delete: 'NoCascade' }),
        IsCustomRelationship: false,
    },
];

/** ManyToManyRelationshipMetadata. */
const MANY_TO_MANY: Row[] = [
    {
        MetadataId: 'c3000000-0000-4000-8000-000000000001',
        SchemaName: 'contoso_project_contact',
        Entity1LogicalName: 'contoso_project',
        Entity2LogicalName: 'contact',
        IntersectEntityName: 'contoso_project_contact',
        IsCustomRelationship: true,
    },
];

/** Cascade-delete children of `contoso_project`, sorted the way the chain walk visits them. */
const CASCADE_CHILDREN = ['annotation', 'contoso_task'];

describe('relationshipsSource', () => {
    // Only this table's own lists are routed: the one-level chain walk asks for OTHER tables'
    // OneToManyRelationships and gets an empty list unless a test routes it explicitly.
    const routes: FakeRoute[] = [
        { match: metadataPath('contoso_project', 'OneToManyRelationships'), response: ONE_TO_MANY },
        { match: '/ManyToOneRelationships', response: MANY_TO_ONE },
        { match: '/ManyToManyRelationships', response: MANY_TO_MANY },
    ];

    it('requests the three relationship lists with only the needed properties, then walks the cascade-delete children once each', async () => {
        const client = makeFakeClient(routes);
        await relationshipsSource.run(makeCtx({ client }));
        expect(client.calls).toEqual([
            { kind: 'relatedMetadata', path: metadataPath('contoso_project', 'OneToManyRelationships'), props: ONE_MANY_PROPS },
            { kind: 'relatedMetadata', path: metadataPath('contoso_project', 'ManyToOneRelationships'), props: ONE_MANY_PROPS },
            { kind: 'relatedMetadata', path: metadataPath('contoso_project', 'ManyToManyRelationships'), props: MANY_MANY_PROPS },
            // One level down, only for children this table cascade-deletes into (not contoso_invoice: Restrict).
            { kind: 'relatedMetadata', path: metadataPath('annotation', 'OneToManyRelationships'), props: ONE_MANY_PROPS },
            { kind: 'relatedMetadata', path: metadataPath('contoso_task', 'OneToManyRelationships'), props: ONE_MANY_PROPS },
        ]);
        expect(CASCADE_CHILDREN).toEqual(['annotation', 'contoso_task']);
        expect(ONE_MANY_PROPS).toEqual(['SchemaName', 'ReferencedEntity', 'ReferencedAttribute', 'ReferencingEntity', 'ReferencingAttribute', 'CascadeConfiguration', 'IsCustomRelationship']);
        expect(MANY_MANY_PROPS).toEqual(['SchemaName', 'Entity1LogicalName', 'Entity2LogicalName', 'IntersectEntityName', 'IsCustomRelationship']);
    });

    it('emits one cascade item per non-NoCascade action on outbound relationships, plus inbound cascade deletes', async () => {
        const result = await relationshipsSource.run(makeCtx({ client: makeFakeClient(routes) }));
        expect(result.items.map((i) => [i.id, i.event])).toEqual([
            ['cascade:contoso_project_annotations:Assign', 'Assign'],
            ['cascade:contoso_project_annotations:Delete', 'Delete'],
            ['cascade:contoso_project_annotations:Reparent', 'Update'],
            ['cascade:contoso_project_annotations:Share', 'Share'],
            ['cascade:contoso_project_annotations:Unshare', 'Unshare'],
            ['cascade:contoso_project_invoice:Delete', 'Delete'],
            ['cascade:contoso_project_task:Assign', 'Assign'],
            ['cascade:contoso_project_task:Delete', 'Delete'],
            ['cascade:contoso_project_task:Merge', 'Merge'],
            ['cascade:contoso_project_task:Reparent', 'Update'],
            ['cascade:contoso_project_task:Share', 'Share'],
            ['cascade:contoso_project_task:Unshare', 'Unshare'],
            ['cascade:contoso_project_task:RollupView', 'RetrieveMultiple'],
            ['cascade:contoso_account_project:inbound-delete', 'Delete'],
        ]);
        expect(result.items.find((i) => i.id === 'cascade:contoso_project_task:Delete')).toEqual({
            id: 'cascade:contoso_project_task:Delete',
            kind: 'cascade',
            name: 'Delete → Cascade to contoso_task',
            event: 'Delete',
            groupId: 'contoso_project_task',
            stage: 'always',
            enabled: true,
            mode: 'rule',
            confidence: 'exact',
            details: { child: 'contoso_task', via: 'contoso_projectid', behaviour: 'Cascade', action: 'Delete', relationship: 'contoso_project_task', isCustom: true },
            source: { table: 'relationship', id: 'c1000000-0000-4000-8000-000000000001' },
        });
        expect(result.items.find((i) => i.id === 'cascade:contoso_project_invoice:Delete')).toMatchObject({ name: 'Delete → Restrict to contoso_invoice', details: { behaviour: 'Restrict' } });
        expect(result.items.find((i) => i.id === 'cascade:contoso_account_project:inbound-delete')).toEqual({
            id: 'cascade:contoso_account_project:inbound-delete',
            kind: 'cascade',
            name: 'Deleted with parent account',
            event: 'Delete',
            groupId: 'contoso_account_project',
            stage: 'always',
            enabled: true,
            mode: 'rule',
            confidence: 'exact',
            details: { parent: 'account', via: 'contoso_customerid', behaviour: 'Cascade', direction: 'inbound', relationship: 'contoso_account_project', isCustom: true },
            source: { table: 'relationship', id: 'c2000000-0000-4000-8000-000000000001' },
        });
        // The owner relationship does not cascade Delete → no inbound item; N:N never yields items.
        expect(result.items.some((i) => i.id.includes('owner_contoso_project'))).toBe(false);
        expect(result.items.some((i) => i.id.includes('contoso_project_contact'))).toBe(false);
    });

    it('summarises all three relationship kinds sorted by schema name', async () => {
        const result = await relationshipsSource.run(makeCtx({ client: makeFakeClient(routes) }));
        expect(result.relationships).toEqual([
            { schemaName: 'contoso_account_project', kind: 'ManyToOne', relatedTable: 'account', referencingAttribute: 'contoso_customerid', cascade: cascadeMap(MANY_TO_ONE[0]), isCustom: true },
            { schemaName: 'contoso_project_annotations', kind: 'OneToMany', relatedTable: 'annotation', referencingAttribute: 'objectid', cascade: cascadeMap(ONE_TO_MANY[1]), isCustom: false },
            { schemaName: 'contoso_project_contact', kind: 'ManyToMany', relatedTable: 'contact', isCustom: true },
            { schemaName: 'contoso_project_invoice', kind: 'OneToMany', relatedTable: 'contoso_invoice', referencingAttribute: 'contoso_projectid', cascade: cascadeMap(ONE_TO_MANY[2]), isCustom: true },
            { schemaName: 'contoso_project_task', kind: 'OneToMany', relatedTable: 'contoso_task', referencingAttribute: 'contoso_projectid', cascade: cascadeMap(ONE_TO_MANY[0]), isCustom: true },
            { schemaName: 'owner_contoso_project', kind: 'ManyToOne', relatedTable: 'owner', referencingAttribute: 'ownerid', cascade: cascadeMap(MANY_TO_ONE[1]), isCustom: false },
        ]);
        expect(result.raw).toEqual({
            oneToMany: [
                { SchemaName: 'contoso_project_annotations', ReferencedEntity: 'contoso_project', ReferencedAttribute: 'contoso_projectid', ReferencingEntity: 'annotation', ReferencingAttribute: 'objectid', CascadeConfiguration: cascadeMap(ONE_TO_MANY[1]), IsCustomRelationship: false },
                { SchemaName: 'contoso_project_invoice', ReferencedEntity: 'contoso_project', ReferencedAttribute: 'contoso_projectid', ReferencingEntity: 'contoso_invoice', ReferencingAttribute: 'contoso_projectid', CascadeConfiguration: cascadeMap(ONE_TO_MANY[2]), IsCustomRelationship: true },
                { SchemaName: 'contoso_project_task', ReferencedEntity: 'contoso_project', ReferencedAttribute: 'contoso_projectid', ReferencingEntity: 'contoso_task', ReferencingAttribute: 'contoso_projectid', CascadeConfiguration: cascadeMap(ONE_TO_MANY[0]), IsCustomRelationship: true },
            ],
            manyToOne: [
                { SchemaName: 'contoso_account_project', ReferencedEntity: 'account', ReferencedAttribute: 'accountid', ReferencingEntity: 'contoso_project', ReferencingAttribute: 'contoso_customerid', CascadeConfiguration: cascadeMap(MANY_TO_ONE[0]), IsCustomRelationship: true },
                { SchemaName: 'owner_contoso_project', ReferencedEntity: 'owner', ReferencedAttribute: 'ownerid', ReferencingEntity: 'contoso_project', ReferencingAttribute: 'ownerid', CascadeConfiguration: cascadeMap(MANY_TO_ONE[1]), IsCustomRelationship: false },
            ],
            manyToMany: [{ SchemaName: 'contoso_project_contact', Entity1LogicalName: 'contoso_project', Entity2LogicalName: 'contact', IntersectEntityName: 'contoso_project_contact', IsCustomRelationship: true }],
            cascadeChains: { annotation: [], contoso_task: [] },
        });
    });

    it('ignores unknown cascade actions and non-string values', () => {
        expect(cascadeMap({ CascadeConfiguration: { Delete: 'Cascade', Weird: 'Cascade', MetadataId: null } })).toEqual({ Delete: 'Cascade', Weird: 'Cascade' });
        expect(cascadeMap({})).toEqual({});
    });

    it('returns an empty result for a table without relationships and asks for no chain metadata', async () => {
        const client = makeFakeClient();
        const result = await relationshipsSource.run(makeCtx({ client }));
        expect(result).toEqual({ items: [], relationships: [], raw: { oneToMany: [], manyToOne: [], manyToMany: [], cascadeChains: {} } });
        expect(client.calls).toHaveLength(3);
    });

    // The `cascade-chain` smell fires on `details.chainDepth >= 2`; without this walk nothing ever
    // set it, so parent → child → grandchild chains (guide §6) were never reported.
    describe('cascade-delete chain walk', () => {
        /** `contoso_task` cascade-deletes into `contoso_timeentry` (and keeps a Restrict relationship). */
        const TASK_CHILDREN: Row[] = [
            {
                SchemaName: 'contoso_task_timeentry',
                ReferencedEntity: 'contoso_task',
                ReferencingEntity: 'contoso_timeentry',
                ReferencingAttribute: 'contoso_taskid',
                CascadeConfiguration: cascade({ Delete: 'Cascade' }),
                IsCustomRelationship: true,
            },
            {
                SchemaName: 'contoso_task_receipt',
                ReferencedEntity: 'contoso_task',
                ReferencingEntity: 'contoso_receipt',
                ReferencingAttribute: 'contoso_taskid',
                CascadeConfiguration: cascade({ Delete: 'Restrict' }),
                IsCustomRelationship: true,
            },
        ];

        it('marks a two-level chain with chainDepth 2 and the grandchildren, leaving shallow chains untouched', async () => {
            const client = makeFakeClient([{ match: metadataPath('contoso_task', 'OneToManyRelationships'), response: TASK_CHILDREN }, ...routes]);
            const result = await relationshipsSource.run(makeCtx({ client }));

            const deep = result.items.find((i) => i.id === 'cascade:contoso_project_task:Delete')!;
            expect(deep.details).toMatchObject({ chainDepth: 2, grandchildren: ['contoso_timeentry'], grandchildCount: 1 });
            // Only the Delete item continues the chain; Assign/Share on the same relationship do not.
            expect(result.items.find((i) => i.id === 'cascade:contoso_project_task:Assign')!.details).not.toHaveProperty('chainDepth');
            // annotation cascades nothing further → the chain stops there.
            expect(result.items.find((i) => i.id === 'cascade:contoso_project_annotations:Delete')!.details).not.toHaveProperty('chainDepth');
            expect((result.raw as { cascadeChains: Record<string, string[]> }).cascadeChains).toEqual({ annotation: [], contoso_task: ['contoso_timeentry'] });
            expect(result.warnings).toBeUndefined();
        });

        it('keeps the relationships when a child cannot be read and reports it as a warning', async () => {
            const client = makeFakeClient([
                {
                    match: metadataPath('contoso_task', 'OneToManyRelationships'),
                    response: (call) => {
                        throw new DataverseRequestError('HTTP 403', 'permission', call.path);
                    },
                },
                ...routes,
            ]);
            const result = await relationshipsSource.run(makeCtx({ client }));
            expect(result.items.find((i) => i.id === 'cascade:contoso_project_task:Delete')!.details).not.toHaveProperty('chainDepth');
            expect(result.relationships).toHaveLength(6);
            expect(result.warnings).toEqual(["Cascade chain below 'contoso_task' could not be read: HTTP 403"]);
        });

        it('caps the walk on a hub table and says so', async () => {
            const many: Row[] = Array.from({ length: CASCADE_WALK_LIMIT + 5 }, (_, i) => ({
                MetadataId: `c9000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
                SchemaName: `contoso_project_child${String(i).padStart(2, '0')}`,
                ReferencedEntity: 'contoso_project',
                ReferencingEntity: `contoso_child${String(i).padStart(2, '0')}`,
                ReferencingAttribute: 'contoso_projectid',
                CascadeConfiguration: cascade({ Delete: 'Cascade' }),
                IsCustomRelationship: true,
            }));
            const client = makeFakeClient([{ match: metadataPath('contoso_project', 'OneToManyRelationships'), response: many }]);
            const result = await relationshipsSource.run(makeCtx({ client }));
            expect(client.calls.filter((c) => c.path.includes('contoso_child')).length).toBe(CASCADE_WALK_LIMIT);
            expect(result.warnings).toEqual([`Cascade-delete chains were checked for the first ${CASCADE_WALK_LIMIT} of ${many.length} child tables only`]);
        });
    });
});

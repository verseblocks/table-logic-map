import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBpfDefinition } from './bpfDefinition';
import { parseXml } from '../xml/xml';

const xaml = readFileSync(join(__dirname, '../fixtures/bpf.leadtoopportunity.xaml'), 'utf8');

describe('parseBpfDefinition (real fixture)', () => {
    const result = parseBpfDefinition(null, xaml);

    it('is exact and lists entities in order of first appearance', () => {
        expect(result.confidence).toBe('exact');
        expect(result.entities).toEqual(['lead', 'opportunity']);
    });

    it('walks stages with their entity, steps and fields', () => {
        const names = result.stages.map((s) => s.name);
        expect(names).toEqual(['Lead / Walk In', 'Discover Needs', 'Vehicles Of Interest', 'Test Drive', 'Develop Proposal', 'Close']);
        expect(result.stages[0].entity).toBe('lead');
        expect(result.stages[0].id).toBe('67cc7334-7133-4f07-bd04-55e4f8687bcf');
        expect(result.stages[0].category).toBe('0');
        expect(result.stages[0].steps).toEqual(['Existing Contact?', 'Budget']);
        expect(result.stages[0].fields).toEqual(['budgetstatus', 'parentcontactid']);
        expect(result.stages[0].stepDetails).toEqual([
            { name: 'Existing Contact?', field: 'parentcontactid', required: false },
            { name: 'Budget', field: 'budgetstatus', required: false },
        ]);
        const discover = result.stages.find((s) => s.name === 'Discover Needs');
        expect(discover?.entity).toBe('opportunity');
        expect(discover?.stepDetails?.[0]).toEqual({ name: 'Est. Close Date', field: 'estimatedclosedate', required: true });
        for (const stage of result.stages.slice(1)) expect(stage.entity).toBe('opportunity');
    });

    it('collects all fields sorted and unique', () => {
        expect(result.fields).toEqual(expect.arrayContaining(['parentcontactid', 'budgetstatus', 'estimatedclosedate', 'finaldecisiondate']));
        expect(result.fields).toEqual([...(result.fields ?? [])].sort());
        expect(new Set(result.fields).size).toBe(result.fields?.length);
    });

    it('resolves stage relationships to stage names', () => {
        expect(result.relationships).toHaveLength(1);
        expect(result.relationships?.[0]).toEqual({
            attribute: 'originatingleadid',
            relationship: 'opportunity_originating_lead',
            sourceStage: 'Lead / Walk In',
            targetStage: 'Discover Needs',
            sourceStageId: '67cc7334-7133-4f07-bd04-55e4f8687bcf',
            targetStageId: 'b2e7ff63-0764-42f5-93bb-d4247c35d88d',
        });
    });

    it('prefers the XAML over clientdata and is deterministic', () => {
        const withJson = parseBpfDefinition('{"stages":[{"name":"Ignored"}]}', xaml);
        expect(withJson).toEqual(result);
        expect(parseBpfDefinition(null, xaml)).toEqual(result);
    });
});

describe('parseBpfDefinition (fallbacks)', () => {
    it('returns an empty heuristic result when both inputs are empty', () => {
        for (const [cd, x] of [
            [null, null],
            [undefined, undefined],
            ['', ''],
            ['   ', 'not xml'],
        ] as const) {
            const r = parseBpfDefinition(cd, x);
            expect(r).toEqual({ stages: [], entities: [], confidence: 'heuristic', relationships: [], fields: [] });
        }
    });

    it('uses clientdata JSON only when the XAML yields no stages', () => {
        const clientData = JSON.stringify({
            steps: {
                list: [
                    {
                        type: 'EntityStep',
                        entity: 'account',
                        stages: [
                            { name: 'Qualify', entityName: 'Account', steps: { list: [{ name: 'Name', attribute: 'name', required: true }, 'Phone'] } },
                            { displayName: 'Develop', steps: [{ dataFieldName: 'revenue' }] },
                        ],
                    },
                ],
            },
        });
        const r = parseBpfDefinition(clientData, '');
        expect(r.confidence).toBe('heuristic');
        expect(r.entities).toEqual(['account']);
        expect(r.stages.map((s) => s.name)).toEqual(['Qualify', 'Develop']);
        expect(r.stages[0].entity).toBe('account');
        expect(r.stages[0].steps).toEqual(['Name', 'Phone']);
        expect(r.stages[0].fields).toEqual(['name']);
        expect(r.stages[0].stepDetails?.[0]).toEqual({ name: 'Name', field: 'name', required: true });
        // Inherits the entity of the enclosing designer object.
        expect(r.stages[1].entity).toBe('account');
        expect(r.stages[1].steps).toEqual(['revenue']);
        expect(r.fields).toEqual(['name', 'revenue']);
    });

    it('ignores unparseable clientdata', () => {
        expect(parseBpfDefinition('{not json', null).stages).toEqual([]);
        expect(parseBpfDefinition('[1,2,3]', null).stages).toEqual([]);
    });

    it('falls back to regexes when the XAML cannot be parsed', () => {
        const broken = `<mxswa:Workflow>
  <mcwb:StageRelationship AttributeName="originatingleadid" RelationshipName="opportunity_originating_lead" SourceStageId="S1" TargetStageId="S2" />
  <mxswa:ActivityReference DisplayName="EntityStep3: lead">
    <mxswa:ActivityReference DisplayName="StageStep4: Qualify">
      <mxswa:ActivityReference DisplayName="StepStep5: New Step">
        <mcwb:Control DataFieldName="parentcontactid" ControlDisplayName="Existing Contact?" Parameters="&lt;p`;
        expect(parseXml(broken)).toBeNull();
        const r = parseBpfDefinition(null, broken);
        expect(r.confidence).toBe('heuristic');
        expect(r.entities).toEqual(['lead']);
        expect(r.stages).toHaveLength(1);
        expect(r.stages[0]).toMatchObject({ name: 'Qualify', entity: 'lead', steps: ['New Step'], fields: ['parentcontactid'] });
        expect(r.relationships?.[0]).toMatchObject({ attribute: 'originatingleadid', relationship: 'opportunity_originating_lead', sourceStage: 's1', targetStage: 's2' });
    });
});

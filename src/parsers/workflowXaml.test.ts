import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activityArgument, displayNameKind, parseWorkflowXaml, simpleClassName, splitDisplayName } from './workflowXaml';
import { parseXml } from '../xml/xml';

const xaml = readFileSync(join(__dirname, '../fixtures/workflow.realtime.xaml'), 'utf8');
const known = new Set(['contoso_budget', 'contoso_flagged', 'contoso_reviewdate', 'contoso_name']);

describe('parseWorkflowXaml (fixture)', () => {
    const result = parseWorkflowXaml(xaml, known);

    it('classifies writes and reads', () => {
        expect(result.writes).toEqual(expect.arrayContaining(['contoso_flagged', 'contoso_reviewdate']));
        expect(result.reads).toEqual(expect.arrayContaining(['contoso_budget']));
        expect(result.confidence).toBe('heuristic');
    });

    it('filters touchesColumns by known columns and ignores columns inside VB expressions', () => {
        // contoso_name only appears inside a VB expression string, so it is not a structured read.
        expect(result.touchesColumns).toEqual(['contoso_budget', 'contoso_flagged', 'contoso_reviewdate']);
    });

    it('groups attributes by entity and keeps other entities out of touchesColumns', () => {
        expect(result.attributesByEntity?.task).toEqual(['regardingobjectid', 'subject']);
        expect(result.attributesByEntity?.email).toEqual(['subject']);
        expect(result.attributesByEntity?.contoso_project).toEqual(['contoso_budget', 'contoso_flagged', 'contoso_reviewdate']);
        expect(result.touchesColumns).not.toContain('subject');
        expect(result.touchesColumns).not.toContain('regardingobjectid');
    });

    it('lists activity classes and created entities', () => {
        expect(result.activities).toEqual(expect.arrayContaining(['UpdateEntity', 'AssignEntity', 'CreateEntity', 'SetState', 'SendEmail']));
        expect(result.activities).not.toContain('StepComposite');
        expect(result.activities).not.toContain('ConditionBranch');
        expect([...(result.createsEntities ?? [])].sort()).toEqual(['email', 'task']);
    });

    it('returns designer steps in document order with labels', () => {
        expect(result.steps).toEqual([
            'ConditionStep1: If budget is large',
            'UpdateStep4: Update Project',
            'AssignStep5: Assign to finance',
            'CreateStep6: Create review task',
            'SetStateStep7: Deactivate',
            'SendEmailStep8: Notify owner',
        ]);
        expect(result.stepLabels).toEqual(['If budget is large', 'Update Project', 'Assign to finance', 'Create review task', 'Deactivate', 'Notify owner']);
    });

    it('keeps every attribute when no columns are known, and honours primaryEntity', () => {
        const all = parseWorkflowXaml(xaml, new Set());
        expect(all.touchesColumns).toEqual(['contoso_budget', 'contoso_flagged', 'contoso_reviewdate', 'regardingobjectid', 'subject']);
        const primary = parseWorkflowXaml(xaml, new Set(), { primaryEntity: 'contoso_project' });
        expect(primary.touchesColumns).toEqual(['contoso_budget', 'contoso_flagged', 'contoso_reviewdate']);
    });

    it('is deterministic across runs', () => {
        expect(parseWorkflowXaml(xaml, known)).toEqual(result);
    });
});

describe('parseWorkflowXaml (edge cases)', () => {
    it('returns empty arrays for missing or invalid input', () => {
        for (const input of [null, undefined, '', '   ', 'not xml at all']) {
            const r = parseWorkflowXaml(input, known);
            expect(r.touchesColumns).toEqual([]);
            expect(r.steps).toEqual([]);
            expect(r.reads).toEqual([]);
            expect(r.writes).toEqual([]);
            expect(r.activities).toEqual([]);
            expect(r.createsEntities).toEqual([]);
            expect(r.confidence).toBe('heuristic');
        }
    });

    it('falls back to regexes when the XML cannot be parsed', () => {
        const broken = `<mxswa:Workflow>
  <mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.Activities.StepComposite, Microsoft.Crm.Workflow" DisplayName="UpdateStep1: Update it">
  <mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.Activities.UpdateEntity, Microsoft.Crm.Workflow" DisplayName="UpdateStep1">
    <mxswa:ActivityReference.Arguments><InArgument x:TypeArguments="x:String" x:Key="EntityName">contoso_project</InArgument></mxswa:ActivityReference.Arguments>
  <mxswa:SetEntityProperty Attribute="contoso_flagged" EntityName="contoso_project" Value="[x]" />
  <mxswa:GetEntityProperty Attribute="contoso_budget" EntityName="contoso_project" Value="[broken`;
        expect(parseXml(broken)).toBeNull();
        const r = parseWorkflowXaml(broken, known);
        expect(r.writes).toEqual(['contoso_flagged']);
        expect(r.reads).toEqual(['contoso_budget']);
        expect(r.touchesColumns).toEqual(['contoso_budget', 'contoso_flagged']);
        expect(r.steps).toEqual(['UpdateStep1: Update it']);
        expect(r.activities).toEqual(['UpdateEntity']);
        expect(r.attributesByEntity).toEqual({ contoso_project: ['contoso_budget', 'contoso_flagged'] });
    });

    it('resolves the entity of SetEntityProperty from the enclosing activity when the attribute is missing', () => {
        const partial = `<Activity xmlns:mxswa="x" xmlns:x="y"><mxswa:Workflow>
  <mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.Activities.CreateEntity, Microsoft.Crm.Workflow" DisplayName="CreateStep1">
    <mxswa:ActivityReference.Arguments><InArgument x:TypeArguments="x:String" x:Key="EntityName">task</InArgument></mxswa:ActivityReference.Arguments>
    <mxswa:ActivityReference.Properties><sco:Collection xmlns:sco="z" x:Key="Activities">
      <mxswa:SetEntityProperty Attribute="subject" Value="[1]" />
    </sco:Collection></mxswa:ActivityReference.Properties>
  </mxswa:ActivityReference>
</mxswa:Workflow></Activity>`;
        const r = parseWorkflowXaml(partial, new Set());
        expect(r.attributesByEntity).toEqual({ task: ['subject'] });
        expect(r.createsEntities).toEqual(['task']);
        expect(parseWorkflowXaml(partial, new Set(), { primaryEntity: 'contoso_project' }).touchesColumns).toEqual([]);
    });
});

describe('XAML helpers', () => {
    it('simpleClassName strips namespace, assembly and generic arity', () => {
        expect(simpleClassName('Microsoft.Crm.Workflow.Activities.UpdateEntity, Microsoft.Crm.Workflow, Version=9.0.0.0')).toBe('UpdateEntity');
        expect(simpleClassName('Contoso.Plugins.MyActivity`1[[System.String]], Contoso.Plugins')).toBe('MyActivity');
        expect(simpleClassName('')).toBeUndefined();
        expect(simpleClassName(undefined)).toBeUndefined();
    });

    it('splitDisplayName and displayNameKind read the designer prefix', () => {
        expect(splitDisplayName('UpdateStep4: Update Project')).toEqual({ prefix: 'UpdateStep4', label: 'Update Project' });
        expect(splitDisplayName('ConditionStep1')).toEqual({ prefix: 'ConditionStep1', label: 'ConditionStep1' });
        expect(displayNameKind('SetVisibilityStep4: Show region')).toBe('SetVisibility');
        expect(displayNameKind('EntityStep3: lead')).toBe('Entity');
        expect(displayNameKind('StepStep5: New Step')).toBe('Step');
        expect(displayNameKind(undefined)).toBeUndefined();
    });

    it('activityArgument reads InArgument/OutArgument by x:Key and nested literals', () => {
        const el = parseXml(`<a:ActivityReference xmlns:a="x" xmlns:x="y">
  <a:ActivityReference.Arguments>
    <InArgument x:Key="EntityName">task</InArgument>
    <InArgument x:Key="Type"><a:ReferenceLiteral Value="mxs:Money" /></InArgument>
    <OutArgument x:Key="Entity">[Created]</OutArgument>
  </a:ActivityReference.Arguments>
</a:ActivityReference>`);
        expect(el).not.toBeNull();
        if (!el) return;
        expect(activityArgument(el, 'EntityName')).toBe('task');
        expect(activityArgument(el, 'entityname')).toBe('task');
        expect(activityArgument(el, 'Type')).toBe('mxs:Money');
        expect(activityArgument(el, 'Entity')).toBe('[Created]');
        expect(activityArgument(el, 'Missing')).toBeUndefined();
    });
});

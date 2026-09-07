import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeActionType, parseBusinessRuleXaml } from './businessRuleXaml';
import { parseXml } from '../xml/xml';

const xaml = readFileSync(join(__dirname, '../fixtures/businessrule.form.xaml'), 'utf8');
const known = new Set(['contoso_status', 'contoso_region', 'contoso_budget', 'contoso_progress', 'contoso_name']);

describe('parseBusinessRuleXaml (fixture)', () => {
    const result = parseBusinessRuleXaml(xaml, known);

    it('lists actions in order of appearance with column and detail', () => {
        expect(result.actions).toEqual([
            { type: 'SetVisibility', column: 'contoso_region', detail: 'True' },
            { type: 'SetRequiredLevel', column: 'contoso_region', detail: 'Required' },
            { type: 'SetDefaultValue', column: 'contoso_region', detail: '[New OptionSetValue(100000001)]' },
            { type: 'LockUnlock', column: 'contoso_budget', detail: 'True' },
            { type: 'ShowErrorMessage', column: 'contoso_budget', detail: 'Inactive projects cannot change budget' },
            { type: 'SetValue', column: 'contoso_progress', detail: '[0]' },
        ]);
    });

    it('collects condition columns and the sorted union as touchesColumns', () => {
        expect(result.conditionColumns).toEqual(['contoso_status']);
        expect(result.touchesColumns).toEqual(['contoso_budget', 'contoso_progress', 'contoso_region', 'contoso_status']);
        expect(result.confidence).toBe('heuristic');
    });

    it('counts branches, reports step labels and no scope hint', () => {
        expect(result.branches).toBe(2);
        expect(result.scope).toBeUndefined();
        expect(result.stepLabels).toEqual([
            'If Status equals Active',
            'Show region',
            'Region required',
            'Default region',
            'Lock budget',
            'Inactive projects cannot change budget',
            'Clear progress',
        ]);
    });

    it('filters touchesColumns by known columns only when some are known', () => {
        expect(parseBusinessRuleXaml(xaml, new Set(['contoso_region'])).touchesColumns).toEqual(['contoso_region']);
        expect(parseBusinessRuleXaml(xaml, new Set()).touchesColumns).toEqual(['contoso_budget', 'contoso_progress', 'contoso_region', 'contoso_status']);
    });

    it('is deterministic across runs', () => {
        expect(parseBusinessRuleXaml(xaml, known)).toEqual(result);
    });
});

describe('parseBusinessRuleXaml (edge cases)', () => {
    it('returns an empty summary for missing or invalid input', () => {
        for (const input of [null, undefined, '', 'garbage']) {
            const r = parseBusinessRuleXaml(input, known);
            expect(r.actions).toEqual([]);
            expect(r.conditionColumns).toEqual([]);
            expect(r.touchesColumns).toEqual([]);
            expect(r.branches).toBe(0);
            expect(r.confidence).toBe('heuristic');
        }
    });

    it('matches action types by DisplayName prefix and Control fallback when the class is unfamiliar', () => {
        const alt = `<Activity xmlns:mxswa="a" xmlns:mcwb="b" xmlns:x="c">
  <mxswa:Workflow>
    <mxswa:ActivityReference AssemblyQualifiedName="Contoso.Rules.SetDisplayModeAction, Contoso" DisplayName="SetDisplayModeStep1: Read only">
      <mxswa:ActivityReference.Arguments>
        <InArgument x:Key="DisplayMode">ReadOnly</InArgument>
        <InArgument x:Key="Control"><mcwb:Control ControlId="contoso_name" DataFieldName="contoso_name" /></InArgument>
      </mxswa:ActivityReference.Arguments>
    </mxswa:ActivityReference>
    <mxswa:ActivityReference DisplayName="RecommendationStep2: Suggest">
      <mxswa:ActivityReference.Arguments>
        <InArgument x:Key="Attribute">contoso_region</InArgument>
        <InArgument x:Key="Message">Consider a region</InArgument>
      </mxswa:ActivityReference.Arguments>
    </mxswa:ActivityReference>
    <mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.Activities.ConditionSequence, Microsoft.Crm.Workflow" DisplayName="ConditionStep3">
      <mcwb:Control DataFieldName="contoso_status" />
    </mxswa:ActivityReference>
  </mxswa:Workflow>
</Activity>`;
        const r = parseBusinessRuleXaml(alt, new Set());
        expect(r.actions).toEqual([
            { type: 'SetDisplayMode', column: 'contoso_name', detail: 'ReadOnly' },
            { type: 'Recommendation', column: 'contoso_region', detail: 'Consider a region' },
        ]);
        expect(r.conditionColumns).toEqual(['contoso_status']);
        expect(r.touchesColumns).toEqual(['contoso_name', 'contoso_region', 'contoso_status']);
    });

    it('reads a scope hint when the XAML carries one', () => {
        const scoped = `<Activity xmlns:x="c"><x:String x:Key="Scope">Entity</x:String></Activity>`;
        expect(parseBusinessRuleXaml(scoped, new Set()).scope).toBe('entity');
    });

    it('falls back to regexes when the XML cannot be parsed', () => {
        const broken = `<mxswa:Workflow>
  <mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.Activities.ConditionBranch, Microsoft.Crm.Workflow" DisplayName="ConditionBranchStep2">
  <mxswa:GetEntityProperty Attribute="contoso_status" EntityName="contoso_project" />
  <mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.Activities.StepComposite, Microsoft.Crm.Workflow" DisplayName="SetVisibilityStep4: Show region">
  <mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.BusinessRules.SetVisibility, Microsoft.Crm.Workflow" DisplayName="SetVisibilityStep4">
    <mxswa:ActivityReference.Arguments>
      <InArgument x:TypeArguments="x:String" x:Key="Attribute">contoso_region</InArgument>
      <InArgument x:TypeArguments="x:Boolean" x:Key="Visibility">False</InArgument>
    </mxswa:ActivityReference.Arguments>
  <mxswa:ActivityReference AssemblyQualifiedName="Microsoft.Crm.Workflow.BusinessRules.LockUnlock, Microsoft.Crm.Workflow" DisplayName="LockUnlockStep5">
    <mxswa:ActivityReference.Arguments>
      <InArgument x:Key="Attribute">contoso_budget</InArgument>
      <InArgument x:Key="Lock">True</InArgument>
    </mxswa:ActivityReference.Arguments>
  <mxswa:SetEntityProperty Attribute="broken" Value="[trunc`;
        expect(parseXml(broken)).toBeNull();
        const r = parseBusinessRuleXaml(broken, new Set());
        expect(r.actions).toEqual([
            { type: 'SetVisibility', column: 'contoso_region', detail: 'False' },
            { type: 'LockUnlock', column: 'contoso_budget', detail: 'True' },
        ]);
        expect(r.conditionColumns).toEqual(['contoso_status']);
        expect(r.branches).toBe(1);
        expect(r.stepLabels).toEqual(['Show region']);
        expect(r.touchesColumns).toEqual(['contoso_budget', 'contoso_region', 'contoso_status']);
    });
});

describe('normalizeActionType', () => {
    it('is case-insensitive and ignores Step<n> / Action / Activity suffixes', () => {
        expect(normalizeActionType('SetVisibility')).toBe('SetVisibility');
        expect(normalizeActionType('setvisibilitystep12')).toBe('SetVisibility');
        expect(normalizeActionType('SetRequiredLevelAction')).toBe('SetRequiredLevel');
        expect(normalizeActionType('ShowErrorMessageActivity')).toBe('ShowErrorMessage');
        expect(normalizeActionType('SetBusinessRequired')).toBe('SetBusinessRequired');
        expect(normalizeActionType('Lock')).toBe('LockUnlock');
        expect(normalizeActionType('StepComposite')).toBeUndefined();
        expect(normalizeActionType('Condition')).toBeUndefined();
        expect(normalizeActionType(undefined)).toBeUndefined();
    });
});

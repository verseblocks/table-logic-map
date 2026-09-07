/**
 * Duplicate detection rules where this table is the base or the matching table.
 *
 * A published rule is evaluated before Create and Update (and can block the operation when
 * duplicate detection is on for the organization and the table), hence stage `preoperation`,
 * sync, one item per event tied by `groupId`. Rule conditions are fetched in chunks of 20 rule ids
 * (`_regardingobjectid_value eq <guid>` — GUID literals are unquoted in OData filters).
 */
import { chunk, odataString } from '../data/client';
import type { Row } from '../data/client';
import { DUPLICATE_OPERATOR_LABEL, DUPLICATE_RULE_PUBLISHED, DUPLICATE_RULE_STATUS_LABEL } from '../domain/codes';
import type { LogicItem, WellKnownEvent } from '../domain/model';
import type { Source, SourceContext, SourceResult } from './types';
import { recordUrl, str } from './types';

const RULE_SELECT = 'duplicateruleid,name,statecode,statuscode,baseentityname,matchingentityname,description,ismanaged';
const CONDITION_SELECT = 'baseattributename,matchingattributename,operatorcode,operatorparam,ignoreblankvalues,_regardingobjectid_value';
const RULE_EVENTS: readonly WellKnownEvent[] = ['Create', 'Update'];
export const CONDITION_CHUNK_SIZE = 20;

export function duplicateRulesQuery(table: string): string {
    const t = odataString(table);
    return `duplicaterules?$select=${RULE_SELECT}&$filter=baseentityname eq ${t} or matchingentityname eq ${t}`;
}

export function duplicateRuleConditionsQuery(ruleIds: readonly string[]): string {
    const filter = ruleIds.map((id) => `_regardingobjectid_value eq ${id}`).join(' or ');
    return `duplicateruleconditions?$select=${CONDITION_SELECT}&$filter=${filter}`;
}

export interface DuplicateCondition {
    base: string;
    matching: string;
    operator: string;
    param: number | null;
    ignoreBlank: boolean;
}

function toCondition(row: Row): DuplicateCondition {
    const code = typeof row.operatorcode === 'number' ? row.operatorcode : undefined;
    return {
        base: (str(row.baseattributename) ?? '').toLowerCase(),
        matching: (str(row.matchingattributename) ?? '').toLowerCase(),
        operator: code === undefined ? 'Unknown' : (DUPLICATE_OPERATOR_LABEL[code] ?? String(code)),
        param: typeof row.operatorparam === 'number' ? row.operatorparam : null,
        ignoreBlank: row.ignoreblankvalues === true,
    };
}

function compareConditions(a: DuplicateCondition, b: DuplicateCondition): number {
    return a.base.localeCompare(b.base) || a.matching.localeCompare(b.matching) || a.operator.localeCompare(b.operator);
}

/** Two items (Create, Update) for one rule with its conditions. */
export function duplicateRuleItems(ctx: SourceContext, rule: Row, conditions: DuplicateCondition[]): LogicItem[] {
    const id = str(rule.duplicateruleid) ?? '';
    const table = ctx.table.logicalName;
    const baseTable = str(rule.baseentityname) ?? '';
    const matchingTable = str(rule.matchingentityname) ?? '';
    const statuscode = typeof rule.statuscode === 'number' ? rule.statuscode : undefined;
    // Columns of *this* table that take part in the match: base attributes when we are the base table, else matching.
    const side = baseTable === table ? 'base' : 'matching';
    const touchesColumns = [...new Set(conditions.map((c) => c[side]).filter(Boolean))].sort();
    const details = {
        name: str(rule.name) ?? '',
        description: str(rule.description) ?? '',
        baseTable,
        matchingTable,
        status: statuscode === undefined ? 'Unknown' : (DUPLICATE_RULE_STATUS_LABEL[statuscode] ?? String(statuscode)),
        isManaged: rule.ismanaged === true,
        conditions,
        tableDuplicateDetection: ctx.table.duplicateDetection,
        orgDuplicateDetection: ctx.org.duplicateDetectionEnabled,
    };
    return RULE_EVENTS.map((event) => ({
        id: `dup:${id}:${event}`,
        kind: 'duplicaterule',
        name: str(rule.name) ?? id,
        event,
        groupId: id,
        stage: 'preoperation',
        enabled: statuscode === DUPLICATE_RULE_PUBLISHED,
        mode: 'sync',
        touchesColumns,
        confidence: 'exact',
        details,
        links: { record: recordUrl(ctx.environmentUrl, 'duplicaterule', id) },
        source: { table: 'duplicaterule', id },
    }));
}

function compactRule(row: Row): Row {
    return {
        duplicateruleid: row.duplicateruleid,
        name: row.name,
        statecode: row.statecode,
        statuscode: row.statuscode,
        baseentityname: row.baseentityname,
        matchingentityname: row.matchingentityname,
        ismanaged: row.ismanaged,
    };
}

function compactCondition(row: Row): Row {
    return {
        _regardingobjectid_value: row._regardingobjectid_value,
        baseattributename: row.baseattributename,
        matchingattributename: row.matchingattributename,
        operatorcode: row.operatorcode,
        operatorparam: row.operatorparam,
        ignoreblankvalues: row.ignoreblankvalues,
    };
}

export const duplicateRulesSource: Source = {
    name: 'duplicateRules',
    async run(ctx): Promise<SourceResult> {
        const rules = (await ctx.client.query(duplicateRulesQuery(ctx.table.logicalName), { signal: ctx.signal }))
            .filter((r) => str(r.duplicateruleid))
            .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.duplicateruleid).localeCompare(String(b.duplicateruleid)));
        const ruleIds = rules.map((r) => String(r.duplicateruleid));
        const conditionPages = await Promise.all(chunk(ruleIds, CONDITION_CHUNK_SIZE).map((ids) => ctx.client.query(duplicateRuleConditionsQuery(ids), { signal: ctx.signal })));
        const conditionRows = conditionPages.flat();

        const byRule = new Map<string, DuplicateCondition[]>();
        for (const row of conditionRows) {
            const ruleId = (str(row._regardingobjectid_value) ?? '').toLowerCase();
            (byRule.get(ruleId) ?? byRule.set(ruleId, []).get(ruleId)!).push(toCondition(row));
        }
        const items = rules.flatMap((rule) => duplicateRuleItems(ctx, rule, (byRule.get(String(rule.duplicateruleid).toLowerCase()) ?? []).sort(compareConditions)));
        return { items, raw: { rules: rules.map(compactRule), conditions: conditionRows.map(compactCondition) } };
    },
};

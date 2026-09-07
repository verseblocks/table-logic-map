/**
 * Organization-level settings that gate table logic: auditing and duplicate detection.
 *
 * Dataverse writes audit rows only when auditing is on for the organization AND for the table
 * (and the column — `columns` reports the column flag). The `audit` item makes the effective state
 * visible in the pipeline (event `Any`, stage `always`) instead of hiding it in a settings page.
 * Duplicate detection flags are stored on `org` for the `duplicateRules` source (§5.10).
 */
import type { LogicItem, OrgSettings } from '../domain/model';
import type { Source, SourceResult } from './types';

export const ORG_SETTINGS_QUERY = 'organizations?$select=isauditenabled,isduplicatedetectionenabled,isduplicatedetectionenabledforonlinecreateupdate';

function optionalBool(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

/** One-line explanation of why auditing is (not) effective for the table. */
export function auditNote(orgEnabled: boolean, tableEnabled: boolean): string {
    if (orgEnabled && tableEnabled) return 'Auditing is on for the organization and this table; changes to audited columns are recorded in the audit log.';
    if (!orgEnabled && tableEnabled) return 'Table auditing is on but organization auditing is off, so nothing is recorded.';
    if (orgEnabled && !tableEnabled) return 'Organization auditing is on but this table is not audited.';
    return 'Auditing is off for both the organization and this table.';
}

export const orgSettingsSource: Source = {
    name: 'orgSettings',
    async run(ctx): Promise<SourceResult> {
        const rows = await ctx.client.query(ORG_SETTINGS_QUERY, { signal: ctx.signal });
        // There is exactly one organization row; tolerate an empty response (missing privilege, odd env).
        const row = rows[0] ?? {};
        const org: OrgSettings = {};
        const auditEnabled = optionalBool(row.isauditenabled);
        const dupEnabled = optionalBool(row.isduplicatedetectionenabled);
        const dupOnCreateUpdate = optionalBool(row.isduplicatedetectionenabledforonlinecreateupdate);
        if (auditEnabled !== undefined) org.auditEnabled = auditEnabled;
        if (dupEnabled !== undefined) org.duplicateDetectionEnabled = dupEnabled;
        if (dupOnCreateUpdate !== undefined) org.duplicateDetectionOnCreateUpdate = dupOnCreateUpdate;

        const orgEnabled = auditEnabled === true;
        const tableEnabled = ctx.table.audit === true;
        const effective = orgEnabled && tableEnabled;
        const item: LogicItem = {
            id: `audit:${ctx.table.logicalName}`,
            kind: 'audit',
            name: 'Auditing',
            event: 'Any',
            stage: 'always',
            enabled: effective,
            mode: 'rule',
            confidence: 'exact',
            details: { orgEnabled, tableEnabled, effective, note: auditNote(orgEnabled, tableEnabled) },
            source: { table: 'organization', id: typeof row.organizationid === 'string' ? row.organizationid : undefined },
        };
        const raw = rows.map((r) => ({
            organizationid: r.organizationid,
            isauditenabled: r.isauditenabled,
            isduplicatedetectionenabled: r.isduplicatedetectionenabled,
            isduplicatedetectionenabledforonlinecreateupdate: r.isduplicatedetectionenabledforonlinecreateupdate,
        }));
        return { items: [item], org, raw };
    },
};

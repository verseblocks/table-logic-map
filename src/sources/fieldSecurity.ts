/**
 * Column-level security: `fieldpermission` rows for this table, grouped by field security profile.
 *
 * A secured column (`IsSecured`) is unreadable/unwritable for everyone except members of profiles
 * that grant it; the item per profile lists what the profile grants for which columns. Permission
 * codes: canread / cancreate / canupdate 0 Not Allowed, 4 Allowed; canreadunmasked 0 Not Allowed,
 * 1 One Record, 3 All Records.
 */
import { odataString } from '../data/client';
import { FIELD_PERMISSION_LABEL, FIELD_PERMISSION_UNMASKED_LABEL } from '../domain/codes';
import type { Row } from '../data/client';
import type { LogicItem } from '../domain/model';
import type { Source, SourceResult } from './types';
import { codeLabel, recordUrl, str } from './types';

// Label tables live in domain/codes.ts (single place for numeric-code interpretation); re-exported for consumers.
export { FIELD_PERMISSION_LABEL, FIELD_PERMISSION_UNMASKED_LABEL };

export function fieldPermissionsQuery(table: string): string {
    return `fieldpermissions?$select=fieldpermissionid,attributelogicalname,canread,cancreate,canupdate,canreadunmasked,_fieldsecurityprofileid_value&$filter=entityname eq ${odataString(table)}&$expand=fieldsecurityprofileid($select=name,fieldsecurityprofileid)`;
}

export interface FieldPermission {
    attribute: string;
    canRead: string;
    canCreate: string;
    canUpdate: string;
    canReadUnmasked: string;
}

interface ProfileRef {
    id: string;
    name: string;
}

/** Profile id/name from the lookup value, the expanded navigation or the formatted-value annotation. */
function profileOf(row: Row): ProfileRef | undefined {
    const expanded = row.fieldsecurityprofileid && typeof row.fieldsecurityprofileid === 'object' ? (row.fieldsecurityprofileid as Row) : undefined;
    const id = str(row._fieldsecurityprofileid_value) ?? str(expanded?.fieldsecurityprofileid);
    if (!id) return undefined;
    const name = str(expanded?.name) ?? str(row['_fieldsecurityprofileid_value@OData.Community.Display.V1.FormattedValue']) ?? id;
    return { id: id.toLowerCase(), name };
}

function toPermission(row: Row): FieldPermission {
    return {
        attribute: (str(row.attributelogicalname) ?? '').toLowerCase(),
        canRead: codeLabel(FIELD_PERMISSION_LABEL, row.canread),
        canCreate: codeLabel(FIELD_PERMISSION_LABEL, row.cancreate),
        canUpdate: codeLabel(FIELD_PERMISSION_LABEL, row.canupdate),
        canReadUnmasked: codeLabel(FIELD_PERMISSION_UNMASKED_LABEL, row.canreadunmasked),
    };
}

function profileItem(environmentUrl: string, profile: ProfileRef, permissions: FieldPermission[]): LogicItem {
    const sorted = [...permissions].sort((a, b) => a.attribute.localeCompare(b.attribute));
    return {
        id: `fieldsecurity:${profile.id}`,
        kind: 'fieldsecurity',
        name: profile.name,
        event: 'Any',
        stage: 'always',
        enabled: true,
        mode: 'rule',
        touchesColumns: [...new Set(sorted.map((p) => p.attribute).filter(Boolean))].sort(),
        confidence: 'exact',
        details: { profileId: profile.id, profileName: profile.name, permissions: sorted },
        links: { record: recordUrl(environmentUrl, 'fieldsecurityprofile', profile.id) },
        source: { table: 'fieldsecurityprofile', id: profile.id },
    };
}

function compactRow(row: Row): Row {
    const profile = profileOf(row);
    return {
        fieldpermissionid: row.fieldpermissionid,
        attributelogicalname: row.attributelogicalname,
        canread: row.canread,
        cancreate: row.cancreate,
        canupdate: row.canupdate,
        canreadunmasked: row.canreadunmasked,
        profileId: profile?.id ?? null,
        profileName: profile?.name ?? null,
    };
}

export const fieldSecuritySource: Source = {
    name: 'fieldSecurity',
    async run(ctx): Promise<SourceResult> {
        const rows = await ctx.client.query(fieldPermissionsQuery(ctx.table.logicalName), { signal: ctx.signal });
        const profiles = new Map<string, { profile: ProfileRef; permissions: FieldPermission[] }>();
        for (const row of rows) {
            const profile = profileOf(row);
            if (!profile) continue;
            const entry = profiles.get(profile.id) ?? { profile, permissions: [] };
            entry.permissions.push(toPermission(row));
            profiles.set(profile.id, entry);
        }
        const items = [...profiles.values()]
            .map(({ profile, permissions }) => profileItem(ctx.environmentUrl, profile, permissions))
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return { items, raw: rows.map(compactRow) };
    },
};

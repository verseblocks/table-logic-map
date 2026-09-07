/**
 * Forms → JavaScript handlers, PCF controls and form components (design guide §5.5).
 *
 * One `systemforms` query (paged) returns every form of the table whose `type` carries
 * client-side logic (`LOGIC_FORM_TYPES`: Main, Mobile Express, Quick View, Quick Create, Card,
 * Main interactive). Each form's `formxml` is handed to `parseFormXml`, which yields the
 * `formscript` / `pcf` / `formcomponent` items; this module only maps the systemform row to a
 * `FormInfo` and flattens the items. Business rules are attached later by the classifier
 * (`FormInfo.businessRules` starts empty).
 *
 * `raw` never contains the `formxml` document — only the row header plus per-form counts.
 */
import { odataString } from '../data/client';
import type { Row } from '../data/client';
import { FORM_TYPE, LOGIC_FORM_TYPES } from '../domain/codes';
import type { FormInfo, LogicItem } from '../domain/model';
import { parseFormXml } from '../parsers/formxml';
import type { Source, SourceContext, SourceResult } from './types';
import { str } from './types';

export const FORM_SELECT = 'formid,name,type,formxml,formactivationstate,isdefault,ismanaged,description';

/** `systemform.formactivationstate`: 0 Inactive, 1 Active. */
export const FORM_STATE_ACTIVE = 1;

/** Collection query for the table's logic-bearing forms; `objecttypecode` is the table logical name (string). */
export function systemFormsQuery(table: string): string {
    const typeFilter = LOGIC_FORM_TYPES.map((t) => `type eq ${t}`).join(' or ');
    return `systemforms?$select=${FORM_SELECT}&$filter=objecttypecode eq ${odataString(table)} and (${typeFilter})`;
}

/** Redacted systemform row for the Raw tab: the header columns plus counts, never the `formxml`. */
export interface RawFormRow {
    formid: string;
    name: string;
    type: number;
    typeLabel: string;
    formactivationstate: unknown;
    state: string;
    isdefault: boolean;
    ismanaged: boolean;
    description?: string;
    counts: { libraries: number; handlers: number; pcf: number; components: number };
    /** Parser warnings for this form (unparseable XML), when any. */
    warnings?: string[];
}

/** Dataverse returns bare lower-case GUIDs; strip braces defensively so ids compare across sources. */
function normalizeGuid(value: string): string {
    return value.replace(/[{}]/g, '').trim().toLowerCase();
}

export function formTypeLabel(typeCode: number): string {
    return FORM_TYPE[typeCode] ?? `Type ${typeCode}`;
}

export function formStateLabel(formactivationstate: unknown): string {
    return formactivationstate === FORM_STATE_ACTIVE ? 'Active' : 'Inactive';
}

interface ParsedForm {
    info: FormInfo;
    raw: RawFormRow;
}

/** Map one `systemform` row to a `FormInfo` (with parsed items) and its redacted raw row. */
export function toForm(row: Row, ctx: Pick<SourceContext, 'table' | 'environmentUrl'> & Partial<Pick<SourceContext, 'knownColumns'>>): ParsedForm | undefined {
    const rawId = str(row.formid);
    if (!rawId) return undefined;
    const id = normalizeGuid(rawId);
    const name = str(row.name) ?? id;
    const typeCode = typeof row.type === 'number' ? row.type : Number(row.type ?? -1);
    // A null / missing `formxml` (e.g. a form the caller cannot read) parses to an empty result.
    const formxml = typeof row.formxml === 'string' ? row.formxml : '';
    // `columns` is a wave-1 source, so `ctx.knownColumns` is always populated before `forms` runs;
    // the parser uses it to decide whether a quick view form's lookup is a real column of this table.
    const parsed = parseFormXml(formxml, { formId: id, formName: name, table: ctx.table.logicalName, environmentUrl: ctx.environmentUrl, knownColumns: ctx.knownColumns });

    const info: FormInfo = {
        id,
        name,
        type: formTypeLabel(typeCode),
        typeCode,
        state: formStateLabel(row.formactivationstate),
        isDefault: row.isdefault === true,
        isManaged: row.ismanaged === true,
        libraries: parsed.libraries,
        handlers: parsed.handlers,
        pcf: parsed.pcf,
        components: parsed.components,
        businessRules: [],
    };
    const description = str(row.description);
    if (description) info.description = description;
    const raw: RawFormRow = {
        formid: id,
        name,
        type: typeCode,
        typeLabel: info.type,
        formactivationstate: row.formactivationstate,
        state: info.state,
        isdefault: info.isDefault,
        ismanaged: info.isManaged,
        counts: { libraries: parsed.libraries.length, handlers: parsed.handlers.length, pcf: parsed.pcf.length, components: parsed.components.length },
    };
    if (description) raw.description = description;
    if (parsed.warnings?.length) raw.warnings = parsed.warnings;
    return { info, raw };
}

/** Forms ordered by type code (Main first), then name, then id — stable across runs. */
export function compareForms(a: FormInfo, b: FormInfo): number {
    return a.typeCode - b.typeCode || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Items of one form in the order they are shown: handlers (registration order), PCF, components (layout order). */
function formItems(form: FormInfo): LogicItem[] {
    return [...form.handlers, ...form.pcf, ...form.components];
}

export const formsSource: Source = {
    name: 'forms',
    async run(ctx): Promise<SourceResult> {
        const rows = await ctx.client.query(systemFormsQuery(ctx.table.logicalName), { signal: ctx.signal });
        const parsed: ParsedForm[] = [];
        for (const row of rows) {
            const form = toForm(row, ctx);
            if (form) parsed.push(form);
            else ctx.logger.warn('forms: skipped a systemform row without formid');
        }
        parsed.sort((a, b) => compareForms(a.info, b.info));

        const forms = parsed.map((p) => p.info);
        const items = forms.flatMap(formItems);
        const warnings = parsed.flatMap((p) => (p.raw.warnings ?? []).map((w) => `Form "${p.info.name}": ${w}`));
        ctx.logger.debug(`forms: ${forms.length} forms, ${items.length} items (${warnings.length} warnings)`);

        const result: SourceResult = { items, forms, raw: parsed.map((p) => p.raw) };
        if (warnings.length > 0) result.warnings = warnings;
        return result;
    },
};

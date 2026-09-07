/**
 * Contract every data source implements. Sources are UI-free, run in parallel (bounded by the
 * client's pool), fail independently, and return `LogicItem[]` plus structured extras that the
 * orchestrator merges into the `LogicMap`.
 */
import type { DataverseClient } from '../data/client';
import type { AppInfo, BuildOptions, ColumnInfo, DependencyInfo, FormInfo, LogicItem, LogicMap, Logger, OrgSettings, RelationshipSummary, SourceName, TableFacts } from '../domain/model';

export interface SourceContext {
    client: DataverseClient;
    table: TableFacts;
    org: OrgSettings;
    options: BuildOptions;
    /** Column logical names of the table (populated once `columns` completes; empty before). */
    knownColumns: ReadonlySet<string>;
    /** Unique names of custom APIs + actions bound to this table (populated once `customApis`/`processes` complete). */
    customApiNames: ReadonlySet<string>;
    /** Environment (org) URL without trailing slash, for maker/record links. */
    environmentUrl: string;
    logger: Logger;
    signal?: AbortSignal;
}

export interface SourceResult {
    items: LogicItem[];
    /** Redacted raw records for the Raw tab / fixtures. Never include secure config or full flow clientdata. */
    raw?: unknown;
    columns?: ColumnInfo[];
    forms?: FormInfo[];
    relationships?: RelationshipSummary[];
    /** Flows/actions that touch the table without being triggered by it. */
    externalTouchers?: LogicItem[];
    apps?: AppInfo[];
    dependencies?: DependencyInfo[];
    views?: LogicMap['views'];
    org?: OrgSettings;
    tableFacts?: TableFacts;
    /** Names the source resolved (custom API / action unique names) so later sources can map messages. */
    customApiNames?: string[];
    /** Non-fatal notes surfaced in the UI (e.g. "retried without _formid_value"). */
    warnings?: string[];
}

export interface Source {
    name: SourceName;
    /** Sources listed here must complete (successfully or not) before this one starts. */
    after?: SourceName[];
    run(ctx: SourceContext): Promise<SourceResult>;
}

export const emptyResult = (): SourceResult => ({ items: [] });

/** Build a maker-portal deep link for a record (classic form URL that works for every table). */
export function recordUrl(environmentUrl: string, entityLogicalName: string, id: string): string {
    return `${environmentUrl}/main.aspx?pagetype=entityrecord&etn=${encodeURIComponent(entityLogicalName)}&id=${encodeURIComponent(id.replace(/[{}]/g, ''))}`;
}

/** Classic form editor URL for a system form. */
export function formEditorUrl(environmentUrl: string, entityLogicalName: string, formId: string): string {
    const id = formId.replace(/[{}]/g, '');
    return `${environmentUrl}/main.aspx?pagetype=formeditor&etn=${encodeURIComponent(entityLogicalName)}&extraqs=${encodeURIComponent(`formtype=main&formId=${id}`)}`;
}

/** Strip the query string / fragment from a URL (redaction for webhook, IFrame and web resource URLs). */
export function redactUrl(url: string | null | undefined): string | undefined {
    if (typeof url !== 'string' || !url) return undefined;
    const i = url.search(/[?#]/);
    return i >= 0 ? `${url.slice(0, i)}?…` : url;
}

/** Label helper for metadata `DisplayName` objects. */
export function label(value: unknown, fallback = ''): string {
    if (value && typeof value === 'object') {
        const v = value as { UserLocalizedLabel?: { Label?: string }; LocalizedLabels?: Array<{ Label?: string }> };
        return v.UserLocalizedLabel?.Label ?? v.LocalizedLabels?.[0]?.Label ?? fallback;
    }
    return typeof value === 'string' ? value : fallback;
}

/** Managed-property / boolean-object helper (`{ Value: true }` or plain boolean). */
export function boolValue(value: unknown, defaultValue = false): boolean {
    if (typeof value === 'boolean') return value;
    if (value && typeof value === 'object' && 'Value' in value) {
        const v = (value as { Value: unknown }).Value;
        return typeof v === 'boolean' ? v : defaultValue;
    }
    return defaultValue;
}

/** Narrow an unknown value to a non-empty string (`undefined` otherwise). */
export function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Look a numeric code up in a label table; non-numeric input yields `'Unknown'`, unknown codes their number. */
export function codeLabel(table: Record<number, string>, value: unknown): string {
    return typeof value === 'number' ? (table[value] ?? String(value)) : 'Unknown';
}

/** Normalise a comma-separated attribute list into a sorted, de-duplicated array. */
export function splitAttributeList(value: unknown): string[] {
    if (typeof value !== 'string' || !value.trim()) return [];
    return [...new Set(value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
}

/** Extract candidate column names (`[a-z][a-z0-9_]*` tokens) that exist on the table. */
export function matchKnownColumns(text: string | null | undefined, known: ReadonlySet<string>): string[] {
    if (!text || known.size === 0) return [];
    const found = new Set<string>();
    const re = /[A-Za-z][A-Za-z0-9_]{1,}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const token = m[0].toLowerCase();
        if (known.has(token)) found.add(token);
    }
    return [...found].sort();
}

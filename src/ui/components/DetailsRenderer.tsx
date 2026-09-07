/**
 * Generic renderer for `LogicItem.details` (kind-specific, untyped). Rules:
 *  - primitives → text (booleans as Yes/No, null as —), long strings collapsible;
 *  - arrays of primitives → chips; arrays of objects → small table (union of keys);
 *  - nested objects → collapsible JSON;
 *  - `unsecureConfig` collapsed by default with a warning caption (it may contain connection details).
 */
import { Text } from '@fluentui/react-components';
import { AttributeChips } from './Chips';
import { Collapsible, JsonBlock, safeStringify } from './Primitives';

const LONG_TEXT = 160;
type Primitive = string | number | boolean | null | undefined;

function isPrimitive(v: unknown): v is Primitive {
    return v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** camelCase / snake_case key → "Camel case" label. */
export function humanKey(key: string): string {
    const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function cellText(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (isPrimitive(v)) return String(v);
    if (Array.isArray(v) && v.every(isPrimitive)) return v.map(cellText).join(', ');
    return safeStringify(v, 0);
}

function PrimitiveValue({ value }: { value: Primitive }) {
    if (value === null || value === undefined) return <span className="tlm-muted">—</span>;
    if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
    const text = String(value);
    if (text.length > LONG_TEXT) {
        return (
            <Collapsible label={`${text.slice(0, 60).trimEnd()}… (${text.length} chars)`}>
                <pre className="tlm-pre tlm-long">{text}</pre>
            </Collapsible>
        );
    }
    return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</span>;
}

/** Array of objects → table with the union of keys, in first-seen order. */
export function ObjectTable({ rows }: { rows: Record<string, unknown>[] }) {
    const keys: string[] = [];
    for (const row of rows) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
    return (
        <div className="tlm-table-wrap">
            <table className="tlm-table">
                <thead>
                    <tr>
                        {keys.map((k) => (
                            <th key={k}>{humanKey(k)}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i}>
                            {keys.map((k) => (
                                <td key={k}>{cellText(row[k])}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function DetailValue({ name, value }: { name: string; value: unknown }) {
    if (name === 'unsecureConfig' && typeof value === 'string' && value) {
        return (
            <Collapsible label="Show unsecure configuration" caption={<Text className="tlm-warn-caption">Plugin configuration may contain endpoints or identifiers. Secure configuration is never fetched.</Text>}>
                <pre className="tlm-pre tlm-long">{value}</pre>
            </Collapsible>
        );
    }
    if (isPrimitive(value)) return <PrimitiveValue value={value} />;
    if (Array.isArray(value)) {
        if (value.length === 0) return <span className="tlm-muted">none</span>;
        if (value.every(isPrimitive)) return <AttributeChips values={value.map(cellText)} max={12} />;
        if (value.every(isRecord)) return <ObjectTable rows={value} />;
        return <JsonBlock value={value} />;
    }
    if (isRecord(value)) {
        const entries = Object.entries(value);
        if (entries.length === 0) return <span className="tlm-muted">none</span>;
        return (
            <Collapsible label={`${entries.length} ${entries.length === 1 ? 'field' : 'fields'}`}>
                <JsonBlock value={value} />
            </Collapsible>
        );
    }
    return <span>{String(value)}</span>;
}

export function DetailsRenderer({ details }: { details: Record<string, unknown> }) {
    const entries = Object.entries(details);
    if (entries.length === 0) return <span className="tlm-muted">No details.</span>;
    return (
        <dl className="tlm-kv">
            {entries.map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                    <dt title={k}>{humanKey(k)}</dt>
                    <dd>
                        <DetailValue name={k} value={v} />
                    </dd>
                </div>
            ))}
        </dl>
    );
}

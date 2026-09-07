/**
 * Minimal XML tree used by every parser (form XML, workflow/business-rule XAML, BPF).
 *
 * Built on fast-xml-parser so the browser bundle and the Node headless bundle run the
 * exact same code path (no DOMParser dependency) and unit tests exercise production code.
 */
import { XMLParser } from 'fast-xml-parser';

export interface XmlEl {
    /** Tag name including any namespace prefix, e.g. `mxswa:ActivityReference`. */
    name: string;
    attrs: Record<string, string>;
    children: XmlEl[];
    /** Concatenated direct text/CDATA content, trimmed. */
    text: string;
    parent?: XmlEl;
}

const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    cdataPropName: '#cdata',
    commentPropName: '#comment',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    allowBooleanAttributes: true,
    processEntities: true,
    htmlEntities: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    removeNSPrefix: false,
});

type OrderedNode = Record<string, unknown>;

function toEl(node: OrderedNode, parent?: XmlEl): XmlEl | null {
    const keys = Object.keys(node).filter((k) => k !== ':@');
    const name = keys[0];
    if (!name || name === '#text' || name === '#cdata' || name === '#comment') return null;
    const attrsRaw = (node[':@'] as Record<string, unknown> | undefined) ?? {};
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrsRaw)) attrs[k] = v === true ? '' : String(v ?? '');
    const el: XmlEl = { name, attrs, children: [], text: '', parent };
    const kids = node[name];
    const texts: string[] = [];
    if (Array.isArray(kids)) {
        for (const kid of kids as OrderedNode[]) {
            if (kid && typeof kid === 'object') {
                if ('#text' in kid) texts.push(String(kid['#text'] ?? ''));
                else if ('#cdata' in kid) {
                    const c = kid['#cdata'];
                    if (Array.isArray(c)) for (const t of c as OrderedNode[]) if (t && '#text' in t) texts.push(String(t['#text'] ?? ''));
                    else texts.push(String(c ?? ''));
                } else if ('#comment' in kid) {
                    // ignore
                } else {
                    const child = toEl(kid, el);
                    if (child) el.children.push(child);
                }
            }
        }
    }
    el.text = texts.join('').trim();
    return el;
}

/** Parse an XML document and return its root element, or null when the text is empty/invalid. */
export function parseXml(text: string | null | undefined): XmlEl | null {
    if (!text || !text.trim()) return null;
    let parsed: unknown;
    try {
        parsed = parser.parse(text);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) return null;
    for (const node of parsed as OrderedNode[]) {
        const el = toEl(node);
        if (el) return el;
    }
    return null;
}

/** Tag name without namespace prefix. */
export function localName(el: XmlEl): string {
    const i = el.name.indexOf(':');
    return i >= 0 ? el.name.slice(i + 1) : el.name;
}

function matches(el: XmlEl, name: string): boolean {
    if (name === '*') return true;
    return el.name === name || localName(el) === name || el.name.toLowerCase() === name.toLowerCase() || localName(el).toLowerCase() === name.toLowerCase();
}

/** First direct child with the given (local) name. */
export function child(el: XmlEl | null | undefined, name: string): XmlEl | undefined {
    return el?.children.find((c) => matches(c, name));
}

/** All direct children with the given (local) name (`*` for all). */
export function children(el: XmlEl | null | undefined, name = '*'): XmlEl[] {
    return el ? el.children.filter((c) => matches(c, name)) : [];
}

/** Walk a path of direct children, e.g. path(form, 'tabs', 'tab') → first `tabs/tab`. */
export function path(el: XmlEl | null | undefined, ...names: string[]): XmlEl | undefined {
    let cur: XmlEl | undefined = el ?? undefined;
    for (const n of names) {
        cur = child(cur, n);
        if (!cur) return undefined;
    }
    return cur;
}

/** All descendants (depth-first, document order) with the given (local) name (`*` for all). */
export function descendants(el: XmlEl | null | undefined, name = '*'): XmlEl[] {
    const out: XmlEl[] = [];
    const visit = (n: XmlEl) => {
        for (const c of n.children) {
            if (matches(c, name)) out.push(c);
            visit(c);
        }
    };
    if (el) visit(el);
    return out;
}

/** Depth-first visitor. Return `false` from the callback to stop descending into that node. */
export function walk(el: XmlEl | null | undefined, fn: (node: XmlEl, depth: number) => void | boolean): void {
    const visit = (n: XmlEl, depth: number) => {
        if (fn(n, depth) === false) return;
        for (const c of n.children) visit(c, depth + 1);
    };
    if (el) visit(el, 0);
}

/** Attribute lookup that tolerates case differences (form XML mixes `classId`/`classid`). */
export function attr(el: XmlEl | null | undefined, name: string): string | undefined {
    if (!el) return undefined;
    if (name in el.attrs) return el.attrs[name];
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(el.attrs)) if (k.toLowerCase() === lower) return v;
    return undefined;
}

export function attrBool(el: XmlEl | null | undefined, name: string, defaultValue = false): boolean {
    const v = attr(el, name);
    if (v === undefined) return defaultValue;
    if (v === '') return true;
    return /^(true|1|yes)$/i.test(v);
}

/** Serialize a subtree back to a compact XML string (for the Raw view / fixtures). */
export function toXmlString(el: XmlEl): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const attrs = Object.entries(el.attrs)
        .map(([k, v]) => ` ${k}="${esc(v)}"`)
        .join('');
    if (el.children.length === 0 && !el.text) return `<${el.name}${attrs} />`;
    const inner = (el.text ? esc(el.text) : '') + el.children.map(toXmlString).join('');
    return `<${el.name}${attrs}>${inner}</${el.name}>`;
}

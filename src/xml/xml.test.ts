import { describe, expect, it } from 'vitest';
import { attr, attrBool, child, children, descendants, localName, parseXml, path, toXmlString, walk } from './xml';

const sample = `<?xml version="1.0" encoding="utf-8"?>
<form showImage="true">
  <formLibraries>
    <Library name="contoso_/scripts/project.js" libraryUniqueId="{1}" />
    <Library name="contoso_/scripts/common.js" libraryUniqueId="{2}" />
  </formLibraries>
  <events>
    <event name="onload" application="false" active="false">
      <Handlers>
        <Handler functionName="Contoso.Project.onLoad" libraryName="contoso_/scripts/project.js" handlerUniqueId="{3}" enabled="true" parameters="" passExecutionContext="true" />
      </Handlers>
    </event>
    <event name="onchange" application="false" active="false" attribute="contoso_status">
      <Handlers>
        <Handler functionName="Contoso.Project.onStatusChange" libraryName="contoso_/scripts/project.js" handlerUniqueId="{4}" enabled="false" parameters="&quot;a&quot;, 1" passExecutionContext="true" />
      </Handlers>
    </event>
  </events>
  <tabs>
    <tab name="general" id="{t1}">
      <columns><column width="100%"><sections><section name="main" id="{s1}"><rows><row>
        <cell id="{c1}"><control id="contoso_name" classid="{4273EDBD-AC1D-40d3-9FB2-095C621B552D}" datafieldname="contoso_name" disabled="false" /></cell>
      </row></rows></section></sections></column></columns>
    </tab>
  </tabs>
  <mxswa:Note xmlns:mxswa="clr-namespace:x"><![CDATA[Some <text> here]]></mxswa:Note>
</form>`;

describe('parseXml', () => {
    it('parses elements, attributes, text and CDATA', () => {
        const root = parseXml(sample);
        expect(root?.name).toBe('form');
        expect(attr(root, 'showImage')).toBe('true');
        const libs = children(path(root, 'formLibraries'), 'Library');
        expect(libs.map((l) => attr(l, 'name'))).toEqual(['contoso_/scripts/project.js', 'contoso_/scripts/common.js']);
        const note = child(root, 'Note');
        expect(note?.name).toBe('mxswa:Note');
        expect(localName(note!)).toBe('Note');
        expect(note?.text).toBe('Some <text> here');
    });

    it('decodes entities in attributes', () => {
        const root = parseXml(sample);
        const handlers = descendants(root, 'Handler');
        expect(handlers).toHaveLength(2);
        expect(attr(handlers[1], 'parameters')).toBe('"a", 1');
        expect(attrBool(handlers[0], 'enabled')).toBe(true);
        expect(attrBool(handlers[1], 'enabled')).toBe(false);
        expect(attrBool(handlers[0], 'missing', true)).toBe(true);
    });

    it('walks nested structures in document order', () => {
        const root = parseXml(sample);
        const control = path(root, 'tabs', 'tab', 'columns', 'column', 'sections', 'section', 'rows', 'row', 'cell', 'control');
        expect(attr(control, 'datafieldname')).toBe('contoso_name');
        expect(attr(control, 'ClassId')).toBe('{4273EDBD-AC1D-40d3-9FB2-095C621B552D}');
        const names: string[] = [];
        walk(root, (n, depth) => {
            if (depth <= 1) names.push(n.name);
        });
        expect(names).toEqual(['form', 'formLibraries', 'events', 'tabs', 'mxswa:Note']);
    });

    it('returns null for empty or invalid input', () => {
        expect(parseXml('')).toBeNull();
        expect(parseXml(undefined)).toBeNull();
        expect(parseXml('   ')).toBeNull();
    });

    it('round-trips a small subtree', () => {
        const root = parseXml('<a x="1"><b>t &amp; u</b><c /></a>');
        expect(toXmlString(root!)).toBe('<a x="1"><b>t &amp; u</b><c /></a>');
    });

    it('keeps parent links', () => {
        const root = parseXml(sample);
        const handler = descendants(root, 'Handler')[0];
        expect(handler.parent?.name).toBe('Handlers');
        expect(handler.parent?.parent?.name).toBe('event');
        expect(attr(handler.parent?.parent, 'name')).toBe('onload');
    });
});

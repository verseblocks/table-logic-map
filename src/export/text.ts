/**
 * Text helpers shared by the exporters.
 *
 * Dataverse does not forbid line breaks (or tabs) in record names — `sdkmessageprocessingstep.name`,
 * `workflow.name`, `systemform.name` and friends are free text — so any name interpolated into a
 * Markdown bullet, heading or Mermaid label has to be flattened first. A raw `\n` in a name would
 * otherwise let a single record forge Markdown structure (a new `##` heading, extra list items) in
 * the report and break the Mermaid grammar.
 */

/**
 * Collapse text onto a single line: line breaks and tabs become spaces, runs of whitespace collapse
 * to one, and the result is trimmed. Pure; safe to apply to an already-single-line string.
 */
export function inline(text: string): string {
    return text
        .replace(/[\r\n\t\f\v]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

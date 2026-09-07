/**
 * Mermaid export — one `flowchart LR` per event (design guide §8).
 *
 * Each non-empty pipeline stage becomes a `subgraph` (in `STAGE_ORDER`) holding one node per
 * item, labelled `#rank name`; the execution stages are chained left to right
 * (`client --> prevalidation --> ... --> postcommit`) in the order of the non-empty stages.
 * `always` (data rules that are not stage-bound: keys, cascades, formula columns) is drawn as a
 * subgraph but kept out of the execution chain because it does not run at a point in time.
 *
 * Output is deterministic: node ids are `n1, n2, ...` in stage/item order and the items come from
 * the map's already-sorted pipeline.
 */
import type { EventName, LogicItem, LogicMap, Stage } from '../domain/model';
import { STAGE_LABEL, STAGE_ORDER } from '../domain/model';
import { inline } from './text';

const MAX_LABEL = 60;

/** Stages that form the execution chain (everything but `always`). */
const CHAIN_STAGES: ReadonlySet<Stage> = new Set(STAGE_ORDER.filter((s) => s !== 'always'));

/**
 * Make a label safe inside a quoted Mermaid node/subgraph label: quotes, brackets, braces and
 * pipes have syntactic meaning, so they are replaced; long labels are truncated to 60 characters.
 */
export function sanitizeLabel(text: string): string {
    // Line breaks/tabs are flattened by the shared `inline()` helper (same rule as the Markdown export).
    const cleaned = inline(
        text
            .replace(/["`]/g, "'")
            .replace(/[[{<]/g, '(')
            .replace(/[\]}>]/g, ')')
            .replace(/\|/g, '/'),
    );
    return cleaned.length > MAX_LABEL ? `${cleaned.slice(0, MAX_LABEL - 1)}…` : cleaned;
}

function nodeLabel(item: LogicItem): string {
    const rank = item.order !== undefined ? `#${item.order} ` : '';
    return sanitizeLabel(`${rank}${item.name}`);
}

/** Mermaid flowchart for one event; a single "no logic" node when the event has no items. */
export function toMermaid(map: LogicMap, event: EventName): string {
    const row = map.pipeline[event];
    const stages = row ? STAGE_ORDER.filter((stage) => row[stage].length > 0) : [];
    if (!row || stages.length === 0) return `flowchart LR\n  none[No logic on ${sanitizeLabel(event)}]`;

    const lines: string[] = ['flowchart LR'];
    let next = 1;
    for (const stage of stages) {
        lines.push(`  subgraph ${stage}["${sanitizeLabel(STAGE_LABEL[stage])}"]`);
        for (const item of row[stage]) lines.push(`    n${next++}["${nodeLabel(item)}"]`);
        lines.push('  end');
    }
    const chain = stages.filter((stage) => CHAIN_STAGES.has(stage));
    if (chain.length >= 2) lines.push(`  ${chain.join(' --> ')}`);
    return lines.join('\n');
}

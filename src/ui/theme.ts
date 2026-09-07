/**
 * UI-only lookup tables: labels, badge colours and icons for domain enums.
 * Keeps every component free of "what colour is async?" decisions.
 */
import type { BadgeProps } from '@fluentui/react-components';
import type { ExecutionMode, LogicKind, SourceName } from '../domain/model';

export type BadgeColor = NonNullable<BadgeProps['color']>;

/** Mode badge colour (Fluent Badge `color`). Chosen so neighbouring modes never share a hue. */
export const MODE_BADGE: Record<ExecutionMode, { color: BadgeColor; label: string; hint: string }> = {
    sync: { color: 'brand', label: 'sync', hint: 'Runs inside the transaction; errors roll back the operation.' },
    async: { color: 'informative', label: 'async', hint: 'Queued after commit and run by the async service.' },
    realtime: { color: 'severe', label: 'real-time', hint: 'Real-time workflow: synchronous, inside the transaction.' },
    background: { color: 'subtle', label: 'background', hint: 'Background workflow: queued after commit.' },
    client: { color: 'success', label: 'client', hint: 'Runs in the browser on the form.' },
    instant: { color: 'warning', label: 'instant', hint: 'Manually triggered (instant flow / on-demand process).' },
    rule: { color: 'important', label: 'rule', hint: 'Platform data rule enforced by Dataverse itself.' },
};

export const KIND_LABEL: Record<LogicKind, string> = {
    plugin: 'Plugin step',
    customapi: 'Custom API',
    workflow: 'Workflow',
    action: 'Action',
    flow: 'Cloud flow',
    businessrule: 'Business rule',
    formscript: 'Form script',
    pcf: 'PCF control',
    formcomponent: 'Form component',
    bpf: 'Business process flow',
    duplicaterule: 'Duplicate rule',
    cascade: 'Cascade',
    key: 'Alternate key',
    requiredcolumn: 'Required column',
    formula: 'Formula column',
    rollup: 'Rollup column',
    calculated: 'Calculated column',
    autonumber: 'Autonumber',
    fieldsecurity: 'Field security profile',
    audit: 'Audit',
    app: 'Model-driven app',
};

/** Display order of kinds in dropdowns: execution logic first, data rules last. */
export const KIND_ORDER: readonly LogicKind[] = [
    'plugin',
    'customapi',
    'workflow',
    'action',
    'flow',
    'businessrule',
    'formscript',
    'pcf',
    'formcomponent',
    'bpf',
    'duplicaterule',
    'cascade',
    'key',
    'requiredcolumn',
    'formula',
    'rollup',
    'calculated',
    'autonumber',
    'fieldsecurity',
    'audit',
    'app',
];

export const SOURCE_LABEL: Record<SourceName, string> = {
    tableMeta: 'Table metadata',
    orgSettings: 'Org settings',
    columns: 'Columns',
    keys: 'Keys',
    relationships: 'Relationships',
    forms: 'Forms',
    processes: 'Processes',
    flows: 'Cloud flows',
    pluginSteps: 'Plugin steps',
    customApis: 'Custom APIs',
    duplicateRules: 'Duplicate rules',
    fieldSecurity: 'Field security',
    apps: 'Apps',
    dependencies: 'Dependencies',
    views: 'Views',
};

/** What the map is missing when a source fails (used by the permission banner wording). */
export const SOURCE_MISSING: Record<SourceName, string> = {
    tableMeta: 'the table facts',
    orgSettings: 'organization-level audit and duplicate detection settings',
    columns: 'column metadata, formula/rollup columns and autonumbers',
    keys: 'alternate keys',
    relationships: 'cascade rules',
    forms: 'form scripts, PCF controls and form components',
    processes: 'workflows, actions, business rules and business process flows',
    flows: 'cloud flows',
    pluginSteps: 'server-side plugins',
    customApis: 'custom APIs',
    duplicateRules: 'duplicate detection rules',
    fieldSecurity: 'field security profiles',
    apps: 'model-driven apps',
    dependencies: 'unclassified dependencies',
    views: 'view counts',
};

export const DETAIL_PANE_DEFAULT_WIDTH = 420;
export const DETAIL_PANE_MIN_WIDTH = 280;
/** Above this many rows the Columns / Everything tabs virtualise. */
export const VIRTUALISE_THRESHOLD = 200;
/** Filtering-attribute chips shown before collapsing into "+n". */
export const CHIP_COLLAPSE_AFTER = 5;
/** Raw tab: JSON bigger than this is truncated. */
export const RAW_MAX_BYTES = 200 * 1024;

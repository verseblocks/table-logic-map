/**
 * Hand-built, anonymized `LogicMap` for the custom table `contoso_project` (the manual QA
 * scenario from the design guide §11.2 #2). Used by the export tests (golden snapshot) and
 * usable as a UI preview fixture.
 *
 * Everything is deterministic: fixed GUIDs, a fixed `generatedAt`, arrays sorted the way the
 * classifier sorts them. The pipeline, column index and smell links are derived locally (not
 * through `classify`) so the fixture does not move when the classifier changes.
 */
import type { ColumnInfo, DependencyInfo, EventName, FormInfo, LogicItem, LogicMap, Pipeline, Smell, Stage, TableFacts } from '../domain/model';
import { STAGE_ORDER, compareEvents, compareItems, emptyPipelineRow } from '../domain/model';

/** Marker placed only in `raw`; exports must never contain it. */
export const RAW_MARKER = 'RAW-PAYLOAD-MUST-NOT-EXPORT';
/** Plugin step unsecure configuration; exported only when "include configuration" is ticked. */
export const UNSECURE_CONFIG = 'UNSECURE-CONFIG-VALUE';

export const SAMPLE_TABLE = 'contoso_project';
const ENV_URL = 'https://contoso-dev.crm.dynamics.com';

// Stable ids -------------------------------------------------------------------------------
export const IDS = {
    metadata: '7d3f2a10-0000-4000-8000-00000000c0de',
    pluginNumbering: 'a1b2c3d4-0001-4000-8000-000000000001',
    pluginRollup: 'a1b2c3d4-0002-4000-8000-000000000002',
    pluginAudit: 'a1b2c3d4-0003-4000-8000-000000000003',
    workflowValidate: 'b2c3d4e5-0011-4000-8000-000000000011',
    workflowKickoff: 'b2c3d4e5-0012-4000-8000-000000000012',
    flowNotify: 'c3d4e5f6-0021-4000-8000-000000000021',
    flowSync: 'c3d4e5f6-0022-4000-8000-000000000022',
    flowDigest: 'c3d4e5f6-0023-4000-8000-000000000023',
    flowClose: 'c3d4e5f6-0024-4000-8000-000000000024',
    businessRule: 'd4e5f6a7-0031-4000-8000-000000000031',
    formMain: 'f0a0b0c0-0041-4000-8000-0000000000f1',
    formQuickCreate: 'f0a0b0c0-0042-4000-8000-0000000000f2',
    handlerOnLoad: 'e5f6a7b8-0051-4000-8000-000000000051',
    handlerOnChange: 'e5f6a7b8-0052-4000-8000-000000000052',
    pcfControl: 'e5f6a7b8-0053-4000-8000-000000000053',
    key: 'a7b8c9d0-0061-4000-8000-000000000061',
    duplicateRule: 'b8c9d0e1-0071-4000-8000-000000000071',
    fieldSecurityProfile: 'c9d0e1f2-0081-4000-8000-000000000081',
    appHub: 'd0e1f2a3-0091-4000-8000-000000000091',
    appFieldService: 'd0e1f2a3-0092-4000-8000-000000000092',
    viewActive: 'e1f2a3b4-00a1-4000-8000-0000000000a1',
    relationshipTasks: 'f2a3b4c5-00b1-4000-8000-0000000000b1',
    relationshipAccount: 'f2a3b4c5-00b2-4000-8000-0000000000b2',
} as const;

const RECORD = (table: string, id: string) => `${ENV_URL}/main.aspx?pagetype=entityrecord&etn=${table}&id=${id}`;
const FORM_EDITOR = (formId: string) => `${ENV_URL}/main.aspx?pagetype=formeditor&etn=${SAMPLE_TABLE}&extraqs=formtype%3Dmain%26formId%3D${formId}`;

const TABLE: TableFacts = {
    logicalName: SAMPLE_TABLE,
    entitySetName: 'contoso_projects',
    metadataId: IDS.metadata,
    displayName: 'Project',
    primaryIdAttribute: 'contoso_projectid',
    primaryNameAttribute: 'contoso_name',
    objectTypeCode: 10042,
    schemaName: 'contoso_Project',
    ownership: 'UserOwned',
    isActivity: false,
    isCustom: true,
    isCustomizable: true,
    isBpfEntity: false,
    audit: true,
    changeTracking: true,
    duplicateDetection: false,
    hasNotes: true,
    hasActivities: true,
};

// Columns -----------------------------------------------------------------------------------

function column(logicalName: string, displayName: string, type: string, over: Partial<ColumnInfo> = {}): ColumnInfo {
    return { logicalName, displayName, type, required: false, secured: false, audited: false, sourceType: 'simple', isCustom: logicalName.startsWith('contoso_'), triggers: [], touchedBy: [], ...over };
}

const COLUMNS: ColumnInfo[] = [
    column('contoso_accountid', 'Customer', 'Lookup'),
    column('contoso_budget', 'Budget', 'Money', { audited: true }),
    column('contoso_code', 'Project code', 'String', { autoNumber: 'PRJ-{SEQNUM:5}' }),
    column('contoso_confidentialnotes', 'Confidential notes', 'Memo', { secured: true }),
    column('contoso_enddate', 'End date', 'DateTime'),
    column('contoso_margin', 'Margin', 'Decimal', { sourceType: 'formula' }),
    column('contoso_name', 'Name', 'String', { required: true, audited: true }),
    column('contoso_projectid', 'Project', 'Uniqueidentifier', { required: true }),
    column('contoso_region', 'Region', 'Picklist'),
    column('contoso_startdate', 'Start date', 'DateTime'),
    column('contoso_status', 'Project status', 'Picklist'),
    column('ownerid', 'Owner', 'Owner', { required: true }),
    column('statecode', 'Status', 'State'),
    column('statuscode', 'Status reason', 'Status'),
];

// Items -------------------------------------------------------------------------------------

const pluginNumbering: LogicItem = {
    id: IDS.pluginNumbering,
    kind: 'plugin',
    name: 'Contoso.Plugins.ProjectNumbering: Create of contoso_project',
    event: 'Create',
    stage: 'preoperation',
    order: 1,
    enabled: true,
    mode: 'sync',
    filteringAttributes: [],
    touchesColumns: ['contoso_code'],
    confidence: 'exact',
    details: {
        message: 'Create',
        handlerType: 'plugin',
        pluginType: 'Contoso.Plugins.ProjectNumbering',
        assembly: 'Contoso.Plugins',
        assemblyVersion: '1.4.0.0',
        friendlyName: 'Contoso project numbering',
        unsecureConfig: UNSECURE_CONFIG,
        hasSecureConfig: true,
        images: [{ name: 'PreImage', alias: 'pre', type: 'Pre', attributes: ['contoso_code', 'contoso_name'] }],
        deployment: 'Server',
        asyncAutoDelete: false,
        primaryEntity: SAMPLE_TABLE,
        role: 'primary',
        isHidden: false,
        isManaged: false,
        stageCode: 20,
        stageLabel: 'PreOperation',
        modeCode: 0,
        statusCode: 1,
    },
    links: { record: RECORD('sdkmessageprocessingstep', IDS.pluginNumbering) },
    source: { table: 'sdkmessageprocessingstep', id: IDS.pluginNumbering },
};

const pluginRollup: LogicItem = {
    id: IDS.pluginRollup,
    kind: 'plugin',
    name: 'Contoso.Plugins.ProjectRollup: Update of contoso_project',
    event: 'Update',
    stage: 'postoperation',
    order: 1,
    enabled: true,
    mode: 'sync',
    filteringAttributes: ['contoso_budget', 'contoso_status'],
    touchesColumns: ['contoso_margin'],
    confidence: 'exact',
    details: {
        message: 'Update',
        handlerType: 'plugin',
        pluginType: 'Contoso.Plugins.ProjectRollup',
        assembly: 'Contoso.Plugins',
        assemblyVersion: '1.4.0.0',
        hasSecureConfig: false,
        images: [
            { name: 'PostImage', alias: 'post', type: 'Post', attributes: ['contoso_budget'] },
            { name: 'PreImage', alias: 'pre', type: 'Pre', attributes: [] },
        ],
        deployment: 'Server',
        asyncAutoDelete: false,
        primaryEntity: SAMPLE_TABLE,
        role: 'primary',
        isHidden: false,
        isManaged: false,
        stageCode: 40,
        stageLabel: 'PostOperation',
        modeCode: 0,
        statusCode: 1,
    },
    links: { record: RECORD('sdkmessageprocessingstep', IDS.pluginRollup) },
    source: { table: 'sdkmessageprocessingstep', id: IDS.pluginRollup },
    smells: ['smell:realtime-plus-plugin:Update:postoperation'],
};

const pluginAudit: LogicItem = {
    id: IDS.pluginAudit,
    kind: 'plugin',
    name: 'Contoso.Plugins.ProjectAuditTrail: Update of contoso_project',
    event: 'Update',
    stage: 'postcommit',
    order: 2,
    enabled: false,
    mode: 'async',
    filteringAttributes: [],
    confidence: 'exact',
    details: {
        message: 'Update',
        handlerType: 'plugin',
        pluginType: 'Contoso.Plugins.ProjectAuditTrail',
        assembly: 'Contoso.Plugins',
        assemblyVersion: '1.2.0.0',
        hasSecureConfig: false,
        images: [{ name: 'PreImage', alias: 'pre', type: 'Pre', attributes: [] }],
        deployment: 'Server',
        asyncAutoDelete: true,
        primaryEntity: SAMPLE_TABLE,
        role: 'primary',
        isHidden: false,
        isManaged: false,
        stageCode: 40,
        stageLabel: 'PostOperation',
        modeCode: 1,
        statusCode: 2,
        firesOnAnyUpdate: true,
    },
    links: { record: RECORD('sdkmessageprocessingstep', IDS.pluginAudit) },
    source: { table: 'sdkmessageprocessingstep', id: IDS.pluginAudit },
    smells: [`smell:disabled-clutter:${IDS.pluginAudit}`],
};

const workflowValidate: LogicItem = {
    id: `${IDS.workflowValidate}:Update`,
    kind: 'workflow',
    name: 'Validate budget',
    event: 'Update',
    groupId: IDS.workflowValidate,
    stage: 'postoperation',
    enabled: true,
    mode: 'realtime',
    filteringAttributes: ['contoso_budget'],
    touchesColumns: ['contoso_budget', 'contoso_margin'],
    confidence: 'heuristic',
    details: {
        category: 'Workflow',
        workflowMode: 'Real-time',
        scope: 'Organization',
        state: 'Activated',
        triggerOnCreate: false,
        triggerOnDelete: false,
        triggerOnUpdateAttributes: ['contoso_budget'],
        updateStage: 'Post-operation',
        onDemand: false,
        runAs: 'Owner',
        activities: ['Condition', 'StopWorkflow'],
        steps: ['Check budget', 'Stop with error'],
        isManaged: false,
    },
    links: { record: RECORD('workflow', IDS.workflowValidate) },
    source: { table: 'workflow', id: IDS.workflowValidate },
    smells: ['smell:realtime-plus-plugin:Update:postoperation'],
};

const workflowKickoff: LogicItem = {
    id: `${IDS.workflowKickoff}:Create`,
    kind: 'workflow',
    name: 'Create kickoff tasks',
    event: 'Create',
    groupId: IDS.workflowKickoff,
    stage: 'postcommit',
    enabled: true,
    mode: 'background',
    touchesColumns: ['contoso_accountid', 'contoso_name'],
    confidence: 'heuristic',
    details: {
        category: 'Workflow',
        workflowMode: 'Background',
        scope: 'Organization',
        state: 'Activated',
        triggerOnCreate: true,
        triggerOnDelete: false,
        onDemand: true,
        activities: ['CreateEntity'],
        createsEntities: ['task'],
        steps: ['Create kickoff task'],
        isManaged: false,
    },
    links: { record: RECORD('workflow', IDS.workflowKickoff) },
    source: { table: 'workflow', id: IDS.workflowKickoff },
};

const flowNotify: LogicItem = {
    id: `${IDS.flowNotify}:Create`,
    kind: 'flow',
    name: 'Notify PM "on create" [v2]',
    event: 'Create',
    groupId: IDS.flowNotify,
    stage: 'postcommit',
    enabled: true,
    mode: 'async',
    confidence: 'exact',
    details: {
        category: 'Cloud Flow',
        trigger: 'row',
        message: 'Create',
        scope: 'Organization',
        runAs: 'Flow owner',
        connectionReferences: ['contoso_sharedcommondataserviceforapps', 'contoso_sharedoffice365'],
        actionCount: 6,
        actionsOnTable: [{ path: 'Get_project', name: 'Get_project', operationId: 'GetItem', kind: 'read', label: 'Get a row by ID' }],
        owner: 'Alex Admin',
        state: 'Activated',
        isManaged: false,
    },
    links: { record: RECORD('workflow', IDS.flowNotify) },
    source: { table: 'workflow', id: IDS.flowNotify },
};

const flowSync: LogicItem = {
    id: `${IDS.flowSync}:Update`,
    kind: 'flow',
    name: 'Sync budget to finance',
    event: 'Update',
    groupId: IDS.flowSync,
    stage: 'postcommit',
    enabled: true,
    mode: 'async',
    filteringAttributes: ['contoso_budget', 'contoso_margin'],
    confidence: 'exact',
    details: {
        category: 'Cloud Flow',
        trigger: 'row',
        message: 'Update',
        scope: 'Organization',
        filterExpression: 'statecode eq 0',
        runAs: 'Flow owner',
        connectionReferences: ['contoso_sharedcommondataserviceforapps', 'contoso_sharedsql'],
        actionCount: 4,
        actionsOnTable: [],
        owner: 'Alex Admin',
        state: 'Activated',
        isManaged: false,
    },
    links: { record: RECORD('workflow', IDS.flowSync) },
    source: { table: 'workflow', id: IDS.flowSync },
};

const businessRuleBase = {
    kind: 'businessrule' as const,
    name: 'Default region',
    groupId: IDS.businessRule,
    stage: 'client' as const,
    enabled: true,
    mode: 'rule' as const,
    touchesColumns: ['contoso_region'],
    confidence: 'heuristic' as const,
    details: {
        category: 'Business Rule',
        formId: IDS.formMain,
        formName: 'Project',
        scope: 'Form',
        state: 'Activated',
        actions: ['SetDefaultValue', 'SetVisibility'],
        conditions: ['contoso_accountid'],
        isManaged: false,
    },
    links: { record: RECORD('workflow', IDS.businessRule) },
    source: { table: 'workflow', id: IDS.businessRule },
};

const businessRuleLoad: LogicItem = { ...businessRuleBase, id: `${IDS.businessRule}:FormLoad`, event: 'FormLoad' };
const businessRuleChange: LogicItem = { ...businessRuleBase, id: `${IDS.businessRule}:FieldChange`, event: 'FieldChange', filteringAttributes: ['contoso_accountid'] };

const handlerOnLoad: LogicItem = {
    id: `formscript:${IDS.formMain}:${IDS.handlerOnLoad}`,
    kind: 'formscript',
    name: 'Contoso.Project.onLoad',
    event: 'FormLoad',
    stage: 'client',
    enabled: true,
    mode: 'client',
    confidence: 'exact',
    details: {
        formId: IDS.formMain,
        formName: 'Project',
        formEvent: 'onload',
        library: 'contoso_/scripts/project.js',
        functionName: 'Contoso.Project.onLoad',
        parameters: '',
        passExecutionContext: true,
        handlerId: IDS.handlerOnLoad,
    },
    links: { maker: FORM_EDITOR(IDS.formMain) },
    source: { table: 'systemform', id: IDS.formMain },
};

const handlerOnChange: LogicItem = {
    id: `formscript:${IDS.formMain}:${IDS.handlerOnChange}`,
    kind: 'formscript',
    name: 'Contoso.Project.onRegionChange',
    event: 'FieldChange',
    stage: 'client',
    enabled: true,
    mode: 'client',
    filteringAttributes: ['contoso_region'],
    confidence: 'exact',
    details: {
        formId: IDS.formMain,
        formName: 'Project',
        formEvent: 'onchange',
        attribute: 'contoso_region',
        library: 'contoso_/scripts/project.js',
        functionName: 'Contoso.Project.onRegionChange',
        // A pipe in a parameter string exercises table-cell escaping in the Markdown export.
        parameters: '"EMEA|APAC"',
        passExecutionContext: true,
        handlerId: IDS.handlerOnChange,
    },
    links: { maker: FORM_EDITOR(IDS.formMain) },
    source: { table: 'systemform', id: IDS.formMain },
};

const pcfGauge: LogicItem = {
    id: `pcf:${IDS.formMain}:${IDS.pcfControl}:Contoso.Controls.BudgetGauge`,
    kind: 'pcf',
    name: 'Contoso.Controls.BudgetGauge',
    event: 'FormLoad',
    stage: 'client',
    enabled: true,
    mode: 'client',
    touchesColumns: ['contoso_budget'],
    confidence: 'exact',
    details: {
        formId: IDS.formMain,
        formName: 'Project',
        controlId: 'contoso_budget',
        controlUniqueId: IDS.pcfControl,
        datafieldname: 'contoso_budget',
        formFactors: [0, 1, 2],
        parameters: { max: '1000000', min: '0' },
        isFirstParty: false,
        tab: 'General',
        section: 'Financials',
        region: 'body',
    },
    links: { maker: FORM_EDITOR(IDS.formMain) },
    source: { table: 'systemform', id: IDS.formMain },
};

const iframePortal: LogicItem = {
    id: `formcomponent:${IDS.formMain}:IFRAME_Portal`,
    kind: 'formcomponent',
    name: 'IFrame: IFRAME_Portal',
    event: 'FormLoad',
    stage: 'client',
    enabled: true,
    mode: 'client',
    confidence: 'exact',
    details: {
        formId: IDS.formMain,
        formName: 'Project',
        controlId: 'IFRAME_Portal',
        classId: '{FD2A7985-3187-444E-908D-6624B21F69C0}',
        componentKind: 'IFrame',
        // Query string already redacted by the forms source (`redactUrl`).
        parameters: { Security: 'true', Url: 'https://portal.contoso.com/projects?…' },
        region: 'body',
        tab: 'Portal',
        section: 'Portal',
        disabled: false,
        url: 'https://portal.contoso.com/projects?…',
    },
    links: { maker: FORM_EDITOR(IDS.formMain) },
    source: { table: 'systemform', id: IDS.formMain },
};

const autonumberCode: LogicItem = {
    id: `autonumber:${SAMPLE_TABLE}:contoso_code`,
    kind: 'autonumber',
    name: 'Project code',
    event: 'Create',
    stage: 'preoperation',
    enabled: true,
    mode: 'rule',
    touchesColumns: ['contoso_code'],
    confidence: 'exact',
    details: { column: 'contoso_code', displayName: 'Project code', format: 'PRJ-{SEQNUM:5}' },
    source: { table: 'attribute', id: 'contoso_code' },
};

const formulaMargin: LogicItem = {
    id: `formula:${SAMPLE_TABLE}:contoso_margin`,
    kind: 'formula',
    name: 'Margin',
    event: 'Any',
    stage: 'always',
    enabled: true,
    mode: 'rule',
    touchesColumns: ['contoso_budget'],
    confidence: 'heuristic',
    details: { column: 'contoso_margin', displayName: 'Margin', formula: 'contoso_budget * 0.2', sourceType: 'formula' },
    source: { table: 'attribute', id: 'contoso_margin' },
};

const requiredName: LogicItem = {
    id: `requiredcolumn:${SAMPLE_TABLE}:contoso_name`,
    kind: 'requiredcolumn',
    name: 'Name',
    event: 'FormSave',
    stage: 'client',
    enabled: true,
    mode: 'client',
    touchesColumns: ['contoso_name'],
    confidence: 'exact',
    details: { column: 'contoso_name', displayName: 'Name', level: 'ApplicationRequired', note: 'Required level is enforced by forms and the UI, not by the API.' },
    source: { table: 'attribute', id: 'contoso_name' },
};

const keyBase = {
    kind: 'key' as const,
    name: 'Project code',
    groupId: IDS.key,
    stage: 'always' as const,
    enabled: true,
    mode: 'rule' as const,
    touchesColumns: ['contoso_code'],
    confidence: 'exact' as const,
    details: { schemaName: 'contoso_projectcode_key', displayName: 'Project code', status: 'Active', logicalName: 'contoso_projectcode_key', attributes: ['contoso_code'] },
    source: { table: 'entitykey', id: IDS.key },
};
const keyCreate: LogicItem = { ...keyBase, id: `key:${IDS.key}:Create`, event: 'Create' };
const keyUpdate: LogicItem = { ...keyBase, id: `key:${IDS.key}:Update`, event: 'Update' };

const duplicateRuleBase = {
    kind: 'duplicaterule' as const,
    name: 'Projects with the same name',
    groupId: IDS.duplicateRule,
    stage: 'preoperation' as const,
    enabled: true,
    mode: 'sync' as const,
    touchesColumns: ['contoso_name'],
    confidence: 'exact' as const,
    details: {
        name: 'Projects with the same name',
        description: '',
        baseTable: SAMPLE_TABLE,
        matchingTable: SAMPLE_TABLE,
        status: 'Published',
        isManaged: false,
        conditions: [{ base: 'contoso_name', matching: 'contoso_name', operator: 'Exact Match', param: null, ignoreBlank: true }],
        tableDuplicateDetection: false,
        orgDuplicateDetection: true,
    },
    links: { record: RECORD('duplicaterule', IDS.duplicateRule) },
    source: { table: 'duplicaterule', id: IDS.duplicateRule },
};
const duplicateCreate: LogicItem = { ...duplicateRuleBase, id: `dup:${IDS.duplicateRule}:Create`, event: 'Create' };
const duplicateUpdate: LogicItem = { ...duplicateRuleBase, id: `dup:${IDS.duplicateRule}:Update`, event: 'Update' };

const cascadeDelete: LogicItem = {
    id: 'cascade:contoso_project_tasks:Delete',
    kind: 'cascade',
    name: 'Delete → Cascade to contoso_task',
    event: 'Delete',
    groupId: 'contoso_project_tasks',
    stage: 'always',
    enabled: true,
    mode: 'rule',
    confidence: 'exact',
    details: { child: 'contoso_task', via: 'contoso_projectid', behaviour: 'Cascade', action: 'Delete', relationship: 'contoso_project_tasks', isCustom: true, chainDepth: 2 },
    source: { table: 'relationship', id: IDS.relationshipTasks },
    smells: ['smell:cascade-chain:cascade:contoso_project_tasks:Delete'],
};

const cascadeAssign: LogicItem = {
    id: 'cascade:contoso_project_tasks:Assign',
    kind: 'cascade',
    name: 'Assign → Cascade to contoso_task',
    event: 'Assign',
    groupId: 'contoso_project_tasks',
    stage: 'always',
    enabled: true,
    mode: 'rule',
    confidence: 'exact',
    details: { child: 'contoso_task', via: 'contoso_projectid', behaviour: 'Cascade', action: 'Assign', relationship: 'contoso_project_tasks', isCustom: true },
    source: { table: 'relationship', id: IDS.relationshipTasks },
};

const fieldSecurity: LogicItem = {
    id: `fieldsecurity:${IDS.fieldSecurityProfile}`,
    kind: 'fieldsecurity',
    name: 'Finance managers',
    event: 'Any',
    stage: 'always',
    enabled: true,
    mode: 'rule',
    touchesColumns: ['contoso_confidentialnotes'],
    confidence: 'exact',
    details: {
        profileId: IDS.fieldSecurityProfile,
        profileName: 'Finance managers',
        permissions: [{ attribute: 'contoso_confidentialnotes', canRead: 'Allowed', canCreate: 'Not Allowed', canUpdate: 'Allowed', canReadUnmasked: 'Not Allowed' }],
    },
    links: { record: RECORD('fieldsecurityprofile', IDS.fieldSecurityProfile) },
    source: { table: 'fieldsecurityprofile', id: IDS.fieldSecurityProfile },
};

const audit: LogicItem = {
    id: `audit:${SAMPLE_TABLE}`,
    kind: 'audit',
    name: 'Auditing',
    event: 'Any',
    stage: 'always',
    enabled: true,
    mode: 'rule',
    confidence: 'exact',
    details: { orgEnabled: true, tableEnabled: true, effective: true, note: 'Auditing is on for the organization and for the table; audited columns are recorded on Create, Update and Delete.' },
    source: { table: 'organization', id: '00000000-0000-0000-0000-00000000000a' },
};

const ITEMS: LogicItem[] = [
    pluginNumbering,
    pluginRollup,
    pluginAudit,
    workflowValidate,
    workflowKickoff,
    flowNotify,
    flowSync,
    businessRuleLoad,
    businessRuleChange,
    handlerOnLoad,
    handlerOnChange,
    pcfGauge,
    iframePortal,
    autonumberCode,
    formulaMargin,
    requiredName,
    keyCreate,
    keyUpdate,
    duplicateCreate,
    duplicateUpdate,
    cascadeDelete,
    cascadeAssign,
    fieldSecurity,
    audit,
];

// External touchers (flows that read/write the table without being triggered by it) ----------

const EXTERNAL: LogicItem[] = [
    {
        id: `${IDS.flowClose}:Any`,
        kind: 'flow',
        name: 'Close stale projects',
        event: 'Any',
        groupId: IDS.flowClose,
        stage: 'postcommit',
        enabled: false,
        mode: 'async',
        touchesColumns: ['statecode', 'statuscode'],
        confidence: 'exact',
        details: {
            category: 'Cloud Flow',
            trigger: 'recurrence',
            access: 'write',
            actionsOnTable: [
                { path: 'List_stale_projects', name: 'List_stale_projects', operationId: 'ListRecords', kind: 'read', label: 'List rows' },
                { path: 'Apply_to_each/Update_project', name: 'Update_project', operationId: 'UpdateRecord', kind: 'write', label: 'Update a row' },
            ],
            connectionReferences: ['contoso_sharedcommondataserviceforapps'],
            actionCount: 3,
            state: 'Draft',
            isManaged: false,
        },
        links: { record: RECORD('workflow', IDS.flowClose) },
        source: { table: 'workflow', id: IDS.flowClose },
    },
    {
        id: `${IDS.flowDigest}:Any`,
        kind: 'flow',
        name: 'Weekly project digest',
        event: 'Any',
        groupId: IDS.flowDigest,
        stage: 'postcommit',
        enabled: true,
        mode: 'async',
        confidence: 'exact',
        details: {
            category: 'Cloud Flow',
            trigger: 'recurrence',
            access: 'read',
            actionsOnTable: [{ path: 'List_projects', name: 'List_projects', operationId: 'ListRecords', kind: 'read', label: 'List rows' }],
            connectionReferences: ['contoso_sharedcommondataserviceforapps', 'contoso_sharedoffice365'],
            actionCount: 5,
            state: 'Activated',
            isManaged: false,
        },
        links: { record: RECORD('workflow', IDS.flowDigest) },
        source: { table: 'workflow', id: IDS.flowDigest },
    },
];

// Forms, apps, dependencies, smells ----------------------------------------------------------

const FORMS: FormInfo[] = [
    {
        id: IDS.formMain,
        name: 'Project',
        type: 'Main',
        typeCode: 2,
        state: 'Active',
        isDefault: true,
        isManaged: false,
        libraries: ['contoso_/scripts/project.js'],
        handlers: [handlerOnLoad, handlerOnChange],
        pcf: [pcfGauge],
        components: [iframePortal],
        businessRules: [businessRuleLoad.id],
    },
    {
        id: IDS.formQuickCreate,
        name: 'Project quick create',
        type: 'Quick Create',
        typeCode: 7,
        state: 'Active',
        isDefault: false,
        isManaged: false,
        libraries: [],
        handlers: [],
        pcf: [],
        components: [],
        businessRules: [],
    },
];

const DEPENDENCIES: DependencyInfo[] = [
    { componentType: 26, componentTypeName: 'Saved Query', objectId: IDS.viewActive, name: 'Active Projects', classified: false },
    { componentType: 29, componentTypeName: 'Workflow', objectId: IDS.workflowValidate, name: 'Validate budget', classified: true, itemId: workflowValidate.id },
    { componentType: 92, componentTypeName: 'SDK Message Processing Step', objectId: IDS.pluginNumbering, name: pluginNumbering.name, classified: true, itemId: IDS.pluginNumbering },
];

const SMELLS: Smell[] = [
    {
        id: 'smell:cascade-chain:cascade:contoso_project_tasks:Delete',
        code: 'cascade-chain',
        severity: 'info',
        message: 'Cascade delete chain: contoso_project → contoso_task continues 2 levels deep',
        explanation:
            "Cascade delete removes child rows inside the same transaction, and each level fires the children's own delete logic (plugins, workflows, flows, further cascades). Chains of two or more levels make a single delete expensive, hard to predict and impossible to undo; consider Restrict or RemoveLink on one of the levels.",
        itemIds: [cascadeDelete.id],
        event: 'Delete',
        stage: 'always',
    },
    {
        id: `smell:disabled-clutter:${IDS.pluginAudit}`,
        code: 'disabled-clutter',
        severity: 'info',
        message: 'Contoso.Plugins.ProjectAuditTrail: Update of contoso_project is disabled',
        explanation:
            'Disabled steps, draft processes and disabled handlers do not run but still show up in solutions, exports and the maker portal. They mislead readers about what the table does; remove them or document why they are kept.',
        itemIds: [IDS.pluginAudit],
        event: 'Update',
        stage: 'postcommit',
    },
    {
        id: 'smell:realtime-plus-plugin:Update:postoperation',
        code: 'realtime-plus-plugin',
        severity: 'info',
        message: 'Real-time workflow and sync plugin both on Update / Post-operation (sync)',
        explanation:
            'Dataverse runs real-time workflows as sync steps interleaved with plugins by execution order (rank 1 unless changed). When both exist on the same message and stage the effective order depends on ranks that are set in two different designers, so it is easy to break. Prefer one mechanism per message/stage or make the ranks explicit.',
        itemIds: [IDS.pluginRollup, workflowValidate.id],
        event: 'Update',
        stage: 'postoperation',
    },
];

// Derivations (kept local so the fixture is independent from the classifier) -----------------

function buildPipeline(items: LogicItem[]): Pipeline {
    const rows: Record<string, Record<Stage, LogicItem[]>> = {};
    for (const item of items) (rows[item.event] ??= emptyPipelineRow())[item.stage].push(item);
    const pipeline: Pipeline = {};
    for (const event of Object.keys(rows).sort((a, b) => compareEvents(a as EventName, b as EventName))) {
        const row = rows[event];
        for (const stage of STAGE_ORDER) row[stage] = [...row[stage]].sort(compareItems);
        pipeline[event] = row;
    }
    return pipeline;
}

function indexColumns(columns: ColumnInfo[], items: LogicItem[]): Record<string, ColumnInfo> {
    const out: Record<string, ColumnInfo> = {};
    for (const col of [...columns].sort((a, b) => a.logicalName.localeCompare(b.logicalName))) {
        const triggers = items.filter((i) => i.filteringAttributes?.includes(col.logicalName)).map((i) => i.id);
        const touchedBy = items.filter((i) => i.touchesColumns?.includes(col.logicalName)).map((i) => i.id);
        out[col.logicalName] = { ...col, triggers: [...new Set(triggers)].sort(), touchedBy: [...new Set(touchedBy)].sort() };
    }
    return out;
}

/** A fresh copy of the sample map (callers may mutate it freely). */
export function sampleMap(): LogicMap {
    const items = ITEMS.map((i) => structuredClone(i));
    const forms = FORMS.map((f) => structuredClone(f));
    return {
        schemaVersion: 1,
        generatedAt: '2026-03-01T10:00:00.000Z',
        environment: { name: 'Contoso DEV', url: ENV_URL },
        table: { ...TABLE },
        org: { auditEnabled: true, duplicateDetectionEnabled: true, duplicateDetectionOnCreateUpdate: true },
        items,
        pipeline: buildPipeline(items),
        columns: indexColumns(COLUMNS, items),
        forms,
        relationships: [
            { schemaName: 'contoso_account_projects', kind: 'ManyToOne', relatedTable: 'account', referencingAttribute: 'contoso_accountid', cascade: { Assign: 'NoCascade', Delete: 'RemoveLink', Merge: 'NoCascade', Reparent: 'NoCascade', Share: 'NoCascade', Unshare: 'NoCascade' }, isCustom: true },
            { schemaName: 'contoso_project_tasks', kind: 'OneToMany', relatedTable: 'contoso_task', referencingAttribute: 'contoso_projectid', cascade: { Assign: 'Cascade', Delete: 'Cascade', Merge: 'NoCascade', Reparent: 'NoCascade', Share: 'NoCascade', Unshare: 'NoCascade' }, isCustom: true },
        ],
        externalTouchers: EXTERNAL.map((i) => structuredClone(i)),
        apps: [
            { id: IDS.appFieldService, name: 'Contoso Field Service', uniqueName: 'contoso_FieldService', isManaged: true, state: 'Active' },
            { id: IDS.appHub, name: 'Project Hub', uniqueName: 'contoso_ProjectHub', isManaged: false, state: 'Active' },
        ],
        dependencies: DEPENDENCIES.map((d) => ({ ...d })),
        views: { total: 6, quickFind: 1, names: ['Active Projects', 'All Projects', 'Inactive Projects', 'My Projects', 'Project Lookup View', 'Quick Find Active Projects'] },
        smells: SMELLS.map((s) => structuredClone(s)),
        sourceErrors: [{ source: 'customApis', message: 'HTTP 403: Principal user is missing prvReadCustomAPI privilege', kind: 'permission' }],
        stats: {
            requests: 31,
            durationMs: 4200,
            sourcesDone: ['tableMeta', 'orgSettings', 'columns', 'keys', 'relationships', 'forms', 'processes', 'flows', 'pluginSteps', 'customApis', 'duplicateRules', 'fieldSecurity', 'apps', 'dependencies', 'views'],
            partial: false,
        },
        // Redacted raw payload for the Raw tab; must never reach an export.
        raw: {
            pluginSteps: { steps: [{ sdkmessageprocessingstepid: IDS.pluginNumbering, name: pluginNumbering.name, marker: RAW_MARKER }], images: [] },
            orgSettings: [{ organizationid: '00000000-0000-0000-0000-00000000000a', isauditenabled: true, marker: RAW_MARKER }],
        },
    };
}

// Structure-injection probe -------------------------------------------------------------------

/**
 * A record name that tries to forge Markdown structure. Dataverse does not forbid line breaks in
 * `sdkmessageprocessingstep.name` (or workflow/form names), so an exporter that writes names raw
 * would emit a new `## heading`, extra list items and a broken table row from this one value.
 */
export const HOSTILE_NAME = 'Evil\r\n## Injected heading\n\n- fake item | pipe\ttab';

/**
 * A plugin step named `HOSTILE_NAME` carrying the unsecure-configuration marker. Deliberately kept
 * out of `sampleMap()` (item counts and the golden snapshot stay stable); tests push it into a copy
 * of the map themselves.
 */
export function hostileItem(over: Partial<LogicItem> = {}): LogicItem {
    return {
        id: 'a1b2c3d4-0004-4000-8000-000000000004',
        kind: 'plugin',
        name: HOSTILE_NAME,
        event: 'Create',
        stage: 'preoperation',
        order: 9,
        enabled: true,
        mode: 'sync',
        filteringAttributes: [],
        touchesColumns: ['contoso_name'],
        confidence: 'exact',
        details: {
            message: 'Create',
            handlerType: 'plugin',
            pluginType: `Contoso.Plugins.${HOSTILE_NAME}`,
            assembly: 'Contoso.Plugins',
            unsecureConfig: UNSECURE_CONFIG,
            hasSecureConfig: false,
            images: [],
            primaryEntity: SAMPLE_TABLE,
            role: 'primary',
            isHidden: false,
            isManaged: false,
        },
        source: { table: 'sdkmessageprocessingstep', id: 'a1b2c3d4-0004-4000-8000-000000000004' },
        ...over,
    };
}

/**
 * `sampleMap()` with the hostile-named plugin step added everywhere the classifier would put it:
 * `items`, the Create pipeline row and the column index (so the name also reaches a table cell).
 */
export function hostileMap(): LogicMap {
    const map = sampleMap();
    const item = hostileItem();
    map.items.push(item);
    map.pipeline.Create.preoperation.push(item);
    map.columns.contoso_name.touchedBy = [...map.columns.contoso_name.touchedBy, item.id].sort();
    return map;
}

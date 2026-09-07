/**
 * Code tables for Dataverse system entities used by the sources and parsers.
 *
 * Values marked VERIFY in the design guide are recorded in docs/verified.md with the
 * outcome; keep this file the single place where numeric codes are interpreted.
 */
import type { EventName, Stage, WellKnownEvent } from './model';

// systemform.type
export const FORM_TYPE: Record<number, string> = {
    0: 'Dashboard',
    1: 'AppointmentBook',
    2: 'Main',
    3: 'MiniCampaignBO',
    4: 'Preview',
    5: 'Mobile - Express',
    6: 'Quick View',
    7: 'Quick Create',
    8: 'Dialog',
    9: 'Task Flow',
    10: 'InteractionCentricDashboard',
    11: 'Card',
    12: 'Main - Interactive experience',
    13: 'Contextual Dashboard',
    100: 'Other',
    101: 'MainBackup',
    102: 'AppointmentBookBackup',
    103: 'Power BI Dashboard',
};

/** Form types we query for logic (main, mobile express, quick view, quick create, card, main interactive). */
export const LOGIC_FORM_TYPES: readonly number[] = [2, 5, 6, 7, 11, 12];

// workflow.category
export const WORKFLOW_CATEGORY = {
    Workflow: 0,
    Dialog: 1,
    BusinessRule: 2,
    Action: 3,
    BusinessProcessFlow: 4,
    CloudFlow: 5,
    DesktopFlow: 6,
    AIFlow: 7,
} as const;

export const WORKFLOW_CATEGORY_LABEL: Record<number, string> = {
    0: 'Workflow',
    1: 'Dialog',
    2: 'Business Rule',
    3: 'Action',
    4: 'Business Process Flow',
    5: 'Cloud Flow',
    6: 'Desktop Flow',
    7: 'AI Flow',
};

// workflow.type: 1 Definition, 2 Activation, 3 Template
export const WORKFLOW_TYPE_DEFINITION = 1;
// workflow.mode: 0 Background, 1 Real-time
export const WORKFLOW_MODE = { Background: 0, RealTime: 1 } as const;
// workflow.statecode: 0 Draft, 1 Activated, 2 Suspended
export const WORKFLOW_STATE_LABEL: Record<number, string> = { 0: 'Draft', 1: 'Activated', 2: 'Suspended' };
// workflow.scope: 1 User, 2 Business Unit, 3 Parent: Child Business Units, 4 Organization
export const WORKFLOW_SCOPE_LABEL: Record<number, string> = { 1: 'User', 2: 'Business Unit', 3: 'Parent: Child Business Units', 4: 'Organization' };
// workflow.runas: 0 Owner, 1 Calling User
export const WORKFLOW_RUN_AS_LABEL: Record<number, string> = { 0: 'Owner', 1: 'Calling User' };
// workflow.scope for business rules (category 2): 2 = Entity (server-side + all forms); form-scoped rules carry `formid`
export const BUSINESS_RULE_SCOPE_ENTITY = 2;
// workflow.createstage / updatestage / deletestage: 20 Pre-operation, 40 Post-operation
export const WORKFLOW_STAGE_TO_STAGE: Record<number, Stage> = { 20: 'preoperation', 40: 'postoperation' };

// sdkmessageprocessingstep.stage
export const STEP_STAGE_TO_STAGE: Record<number, Stage> = {
    10: 'prevalidation',
    20: 'preoperation',
    30: 'mainoperation',
    40: 'postoperation',
};
export const STEP_STAGE_LABEL: Record<number, string> = { 10: 'PreValidation', 20: 'PreOperation', 30: 'MainOperation', 40: 'PostOperation' };
// sdkmessageprocessingstep.mode: 0 Synchronous, 1 Asynchronous
export const STEP_MODE = { Sync: 0, Async: 1 } as const;
// sdkmessageprocessingstep.statecode: 0 Enabled, 1 Disabled
export const STEP_STATE = { Enabled: 0, Disabled: 1 } as const;
// sdkmessageprocessingstep.supporteddeployment: 0 Server, 1 Offline, 2 Both
export const STEP_DEPLOYMENT_LABEL: Record<number, string> = { 0: 'Server', 1: 'Microsoft Dynamics 365 Client for Outlook Only', 2: 'Both' };
// sdkmessageprocessingstepimage.imagetype: 0 PreImage, 1 PostImage, 2 Both
export const IMAGE_TYPE_LABEL: Record<number, 'Pre' | 'Post' | 'Both'> = { 0: 'Pre', 1: 'Post', 2: 'Both' };

// Dataverse (Power Automate) trigger `subscriptionRequest/message`
export const FLOW_MESSAGE_TO_EVENTS: Record<number, WellKnownEvent[]> = {
    1: ['Create'],
    2: ['Delete'],
    3: ['Update'],
    4: ['Create', 'Update'],
    5: ['Create', 'Delete'],
    6: ['Update', 'Delete'],
    7: ['Create', 'Update', 'Delete'],
};
// Dataverse trigger `subscriptionRequest/runAs`: 1 Flow owner, 2 Row owner, 3 Modifying user
export const FLOW_RUN_AS_LABEL: Record<number, string> = { 1: 'Flow owner', 2: 'Row owner', 3: 'Modifying user' };
// Dataverse trigger `subscriptionRequest/scope`
export const FLOW_SCOPE_LABEL: Record<number, string> = { 1: 'User', 2: 'Business Unit', 3: 'Parent: Child Business Units', 4: 'Organization' };

// Attribute SourceType: 0 Simple, 1 Calculated, 2 Rollup, 3 Formula (fx)
export const ATTRIBUTE_SOURCE_TYPE: Record<number, 'simple' | 'calculated' | 'rollup' | 'formula'> = {
    0: 'simple',
    1: 'calculated',
    2: 'rollup',
    3: 'formula',
};

// customapi.bindingtype: 0 Global, 1 Entity, 2 EntityCollection
export const CUSTOM_API_BINDING_LABEL: Record<number, string> = { 0: 'Global', 1: 'Entity', 2: 'EntityCollection' };
// customapi.allowedcustomprocessingsteptype: 0 None, 1 Async Only, 2 Sync and Async
export const CUSTOM_API_STEP_TYPE_LABEL: Record<number, string> = { 0: 'None', 1: 'Async Only', 2: 'Sync and Async' };

// fieldpermission.canread / cancreate / canupdate: 0 Not Allowed, 4 Allowed
export const FIELD_PERMISSION_LABEL: Record<number, string> = { 0: 'Not Allowed', 4: 'Allowed' };
// fieldpermission.canreadunmasked: 0 Not Allowed, 1 One Record, 3 All Records
export const FIELD_PERMISSION_UNMASKED_LABEL: Record<number, string> = { 0: 'Not Allowed', 1: 'One Record', 3: 'All Records' };

// duplicaterule.statuscode: 0 Unpublished, 1 Publishing, 2 Published
export const DUPLICATE_RULE_STATUS_LABEL: Record<number, string> = { 0: 'Unpublished', 1: 'Publishing', 2: 'Published' };
export const DUPLICATE_RULE_PUBLISHED = 2;
// duplicaterulecondition.operatorcode
export const DUPLICATE_OPERATOR_LABEL: Record<number, string> = {
    0: 'Exact Match',
    1: 'Same First Characters',
    2: 'Same Last Characters',
    3: 'Same Date',
    4: 'Same Date and Time',
    5: 'Exact Match (Pick List Label)',
    6: 'Exact Match (Pick List Value)',
};

// Cascade behaviours as returned in CascadeConfiguration
export const CASCADE_VALUES = ['NoCascade', 'Cascade', 'Active', 'UserOwned', 'RemoveLink', 'Restrict'] as const;
export type CascadeValue = (typeof CASCADE_VALUES)[number];
/** Cascade actions and the platform event they hang off. */
export const CASCADE_ACTION_EVENT: Record<string, WellKnownEvent> = {
    Delete: 'Delete',
    Assign: 'Assign',
    Share: 'Share',
    Unshare: 'Unshare',
    Merge: 'Merge',
    Reparent: 'Update',
    RollupView: 'RetrieveMultiple',
    Archive: 'Delete',
};

// appmodule.statecode
export const APP_STATE_LABEL: Record<number, string> = { 0: 'Active', 1: 'Inactive' };

// Well-known SDK message names -> EventName
export const MESSAGE_TO_EVENT: Record<string, WellKnownEvent> = {
    Create: 'Create',
    Update: 'Update',
    Delete: 'Delete',
    Assign: 'Assign',
    SetState: 'SetState',
    SetStateDynamicEntity: 'SetState',
    Retrieve: 'Retrieve',
    RetrieveMultiple: 'RetrieveMultiple',
    Associate: 'Associate',
    Disassociate: 'Disassociate',
    Merge: 'Merge',
    GrantAccess: 'Share',
    ModifyAccess: 'Share',
    RevokeAccess: 'Unshare',
    AddToQueue: 'AddToQueue',
    QualifyLead: 'Qualify',
    WinOpportunity: 'Win',
    LoseOpportunity: 'Lose',
    WinQuote: 'Win',
    CloseQuote: 'Lose',
};

/** Map an SDK message name to an EventName; `customApiNames` are unique names of custom APIs / actions. */
export function messageToEvent(message: string, customApiNames?: ReadonlySet<string>): EventName {
    const known = MESSAGE_TO_EVENT[message];
    if (known) return known;
    if (customApiNames?.has(message)) return `Custom:${message}`;
    return `Message:${message}`;
}

// Form XML control class ids (uppercase, with braces) for non-field controls.
// Unknown class ids are shown verbatim; data-bound controls (with datafieldname) are not items.
export const FORM_CONTROL_CLASSID: Record<string, { kind: string; confidence: 'exact' | 'heuristic' }> = {
    '{9FDF5F91-88B1-47F4-AD53-C11EFC01A01D}': { kind: 'Web resource', confidence: 'exact' },
    '{FD2A7985-3187-444E-908D-6624B21F69C0}': { kind: 'IFrame', confidence: 'exact' },
    '{E7A81278-8635-4D9E-8D4D-59480B391C5B}': { kind: 'Subgrid', confidence: 'exact' },
    '{5C5600E0-1D6E-4205-A272-BE80DA87FD42}': { kind: 'Quick view form', confidence: 'exact' },
    '{06375649-C143-495E-A496-C962E5B4488E}': { kind: 'Notes', confidence: 'exact' },
    '{62B0DF79-0464-470F-8AF7-4483CFEA0C7D}': { kind: 'Bing map', confidence: 'exact' },
    '{F9A8A302-114E-466A-B582-6771B2AE0D92}': { kind: 'Knowledge base search', confidence: 'heuristic' },
    '{F3B1E7F2-9D6D-4F55-9E24-2C6E6E3D0F51}': { kind: 'Timeline', confidence: 'heuristic' },
};

// Cloud flow (Power Automate) Dataverse connector ids
export const DATAVERSE_CONNECTOR_IDS = ['shared_commondataserviceforapps', 'shared_commondataservice'] as const;

/** Current Dataverse connector action operationIds that touch a table, with read/write classification. */
export const FLOW_TABLE_OPERATIONS: Record<string, { kind: 'read' | 'write'; entityParam: string; label: string }> = {
    CreateRecord: { kind: 'write', entityParam: 'entityName', label: 'Add a new row' },
    UpdateRecord: { kind: 'write', entityParam: 'entityName', label: 'Update a row' },
    UpdateOnlyRecord: { kind: 'write', entityParam: 'entityName', label: 'Update a row (no upsert)' },
    DeleteRecord: { kind: 'write', entityParam: 'entityName', label: 'Delete a row' },
    GetItem: { kind: 'read', entityParam: 'entityName', label: 'Get a row by ID' },
    ListRecords: { kind: 'read', entityParam: 'entityName', label: 'List rows' },
    AssociateEntities: { kind: 'write', entityParam: 'entityName', label: 'Relate rows' },
    DisassociateEntities: { kind: 'write', entityParam: 'entityName', label: 'Unrelate rows' },
    PerformBoundAction: { kind: 'write', entityParam: 'entityName', label: 'Perform a bound action' },
    UploadFileOrImage: { kind: 'write', entityParam: 'entityName', label: 'Upload a file or image' },
    DownloadFileOrImage: { kind: 'read', entityParam: 'entityName', label: 'Download a file or image' },
    ExecuteChangeset: { kind: 'write', entityParam: 'entityName', label: 'Perform a changeset request' },
    // Legacy connector (shared_commondataservice) uses `table` (plural) as the parameter
    GetItems: { kind: 'read', entityParam: 'table', label: 'List records (legacy)' },
    GetItem_V2: { kind: 'read', entityParam: 'table', label: 'Get record (legacy)' },
    PostItem: { kind: 'write', entityParam: 'table', label: 'Create a new record (legacy)' },
    PatchItem: { kind: 'write', entityParam: 'table', label: 'Update a record (legacy)' },
    DeleteItem: { kind: 'write', entityParam: 'table', label: 'Delete a record (legacy)' },
};

// solutioncomponent.componenttype (base set; environment-specific values resolved at runtime)
export const COMPONENT_TYPE_LABEL: Record<number, string> = {
    1: 'Entity',
    2: 'Attribute',
    3: 'Relationship',
    4: 'Attribute Picklist Value',
    5: 'Attribute Lookup Value',
    6: 'View Attribute',
    7: 'Localized Label',
    8: 'Relationship Extra Condition',
    9: 'Option Set',
    10: 'Entity Relationship',
    11: 'Entity Relationship Role',
    12: 'Entity Relationship Relationships',
    13: 'Managed Property',
    14: 'Entity Key',
    16: 'Privilege',
    17: 'PrivilegeObjectTypeCode',
    20: 'Role',
    21: 'Role Privilege',
    22: 'Display String',
    23: 'Display String Map',
    24: 'Form',
    25: 'Organization',
    26: 'Saved Query',
    29: 'Workflow',
    31: 'Report',
    32: 'Report Entity',
    33: 'Report Category',
    34: 'Report Visibility',
    35: 'Attachment',
    36: 'Email Template',
    37: 'Contract Template',
    38: 'KB Article Template',
    39: 'Mail Merge Template',
    44: 'Duplicate Rule',
    45: 'Duplicate Rule Condition',
    46: 'Entity Map',
    47: 'Attribute Map',
    48: 'Ribbon Command',
    49: 'Ribbon Context Group',
    50: 'Ribbon Customization',
    52: 'Ribbon Rule',
    53: 'Ribbon Tab To Command Map',
    55: 'Ribbon Diff',
    59: 'Saved Query Visualization',
    60: 'System Form',
    61: 'Web Resource',
    62: 'Site Map',
    63: 'Connection Role',
    64: 'Complex Control',
    65: 'Hierarchy Rule',
    66: 'Custom Control',
    68: 'Custom Control Default Config',
    70: 'Field Security Profile',
    71: 'Field Permission',
    80: 'App Module',
    90: 'Plugin Type',
    91: 'Plugin Assembly',
    92: 'SDK Message Processing Step',
    93: 'SDK Message Processing Step Image',
    95: 'Service Endpoint',
    150: 'Routing Rule',
    151: 'Routing Rule Item',
    152: 'SLA',
    153: 'SLA Item',
    154: 'Convert Rule',
    155: 'Convert Rule Item',
    161: 'Mobile Offline Profile',
    162: 'Mobile Offline Profile Item',
    165: 'Similarity Rule',
    166: 'Data Source Mapping',
    201: 'SDKMessage',
    202: 'SDKMessageFilter',
    203: 'SdkMessagePair',
    204: 'SdkMessageRequest',
    205: 'SdkMessageRequestField',
    206: 'SdkMessageResponse',
    207: 'SdkMessageResponseField',
    208: 'Import Map',
    210: 'WebWizard',
    300: 'Canvas App',
    371: 'Connector',
    372: 'Connection Reference',
    380: 'Environment Variable Definition',
    381: 'Environment Variable Value',
    400: 'AI Project Type',
    401: 'AI Project',
    402: 'AI Configuration',
    430: 'Entity Analytics Configuration',
    431: 'Attribute Image Configuration',
    432: 'Entity Image Configuration',
    10003: 'Custom API',
    10004: 'Custom API Request Parameter',
    10005: 'Custom API Response Property',
};

export const STAGE_FOR_STEP = (stage: number, mode: number): Stage => {
    if (stage === 40 && mode === STEP_MODE.Async) return 'postcommit';
    return STEP_STAGE_TO_STAGE[stage] ?? 'postoperation';
};

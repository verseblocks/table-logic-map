# Table Logic Map — Design & Implementation Guide (Power Platform ToolBox tool)

> **Audience:** Claude Code (or any coding agent) building this tool end-to-end.
> **Status:** design + implementation spec, researched against PPTB docs on 2026-09-05. Items marked **VERIFY** must be confirmed against the installed PPTB version and a real Dataverse environment.

---

## 0. How to use this document

1. Read sections 1–3 before writing code.
2. Before every PPTB API call, confirm the signature in `node_modules/@pptb/types`. **Do not invent `toolboxAPI` / `dataverseAPI` methods.** The universal escape hatch is `dataverseAPI.queryData('<relative OData path>')`, which works for record queries and metadata paths alike.
3. If available, install the `tool-dev` skill from the `pptb-agent-skills` repo into `.claude/skills/pptb-tool-dev/`. Scaffold with `yo pptb` (generator-pptb). Do not use `sample-tools` as a scaffold (maintainers consider it outdated).
4. Follow the milestones in section 12; each ends with `npm run build`, `npx pptb-validate` passing, and a manual load in PPTB's Debug loader.
5. This tool is designed to be **agent-invokable from day one** (section 10): keep all business logic in a UI-free domain layer that both the React UI and `invokeHeadless` call.
6. Several parsers are heuristic (business-rule XAML, BPF definitions). Ship them clearly labelled as best-effort in the UI and keep raw source viewable.

---

## 1. Product definition

### 1.1 One-liner
Pick a table; see **everything that runs because of it**, organized the way the platform actually executes it: server pipeline by message and stage (plugins, real-time workflows, custom APIs), after-commit automation (async plugins, background workflows, cloud flows), form-time logic (business rules, JavaScript handlers, PCF controls), data rules (required columns, alternate keys, duplicate detection, cascade behaviours, field security, formula/rollup/autonumber columns), and what else touches the table (flows that read/write it, apps that include it).

### 1.2 Why it matters
This is the first question anyone asks when inheriting an environment ("what fires when an Account is created?") and today the answer requires six tools and a lot of clicking. No PPTB or XrmToolBox tool assembles it in one view. It is also the ideal MCP-exposed tool: an assistant can ask "what runs on `contoso_project`?" and get structured JSON.

### 1.3 Users and jobs
| User | Job |
|---|---|
| Developer debugging "why did this field change?" | Find every server-side and client-side piece of logic that can write the column |
| Consultant onboarding | Inventory logic on the 20 core tables and export it as documentation |
| Architect reviewing performance | Spot sync plugins + real-time workflows + flows stacked on Update |
| AI assistant (via PPTB MCP) | Retrieve a structured logic map to reason about a change |

### 1.4 Non-goals (v1)
- Cross-environment comparison (that is Environment Diff).
- Editing anything. Read-only.
- Deep semantic analysis of plugin code (we only see registration metadata) or canvas app formulas.
- Non-solution-aware cloud flows (they are not in the `workflow` table; backlog via Power Platform API).

### 1.5 Success criteria
- Map for a heavy first-party table (e.g. `account` in a Sales+Service org) renders in < 20 s, with progressive rendering as sources arrive.
- Every item links to enough identity (GUIDs, names) to find it in the maker portal; where possible, an "Open in browser" action.
- The Markdown export for one table is something a consultant would paste into a wiki without editing.
- Headless invocation returns the same JSON the UI renders.

---

## 2. PPTB platform facts (verified from docs, Sept 2026)

### 2.1 Runtime model
- Tool = npm package; `main: index.html` in `dist/`; runs in a **sandboxed iframe** with `window.toolboxAPI`, `window.dataverseAPI`, `window.powerplatformAPI` injected. Single IIFE bundle, no `type="module"`, script at end of `<body>`, all assets bundled and relative (the `yo pptb` Vite config does this).
- Theme via `toolboxAPI.utils.getCurrentTheme()` and `settings:updated` events.
- Single connection is enough for this tool (`connectionTarget` defaults to `'primary'`); do not declare `multiConnection`.

### 2.2 Manifest (`package.json`)
```json
{
  "name": "@yourorg/pptb-table-logic-map",
  "version": "0.1.0",
  "displayName": "Table Logic Map",
  "description": "See everything that runs on a Dataverse table: plugins, workflows, flows, business rules, form scripts, PCF, data rules — organized by event and stage.",
  "main": "index.html",
  "icon": "icons/table-logic-map.svg",
  "license": "MIT",
  "contributors": [{ "name": "<you>", "url": "https://github.com/<you>" }],
  "configurations": {
    "repository": "https://github.com/<you>/pptb-table-logic-map",
    "readmeUrl": "https://raw.githubusercontent.com/<you>/pptb-table-logic-map/main/README.md"
  },
  "features": { "minAPI": "1.2.2" },
  "keywords": ["powerplatform", "dataverse", "toolbox", "plugins", "flows", "business-rules", "documentation"]
}
```
Required fields: `name`, `version`, `displayName`, `description`, `main`, `icon` (SVG, `fill="currentColor"`), `license` (MIT is allowed), `contributors`, `configurations.repository`. `minAPI` 1.2.2 because `openInConnectionBrowser` and the invocation API are 1.2.2+; drop to 1.2.0 if you don't use them. No `cspExceptions`.

### 2.3 `pptb.config.json` (agent exposure — see section 10 for the full file)
Holds `invocation` (prefill/return schemas, capabilities) and `agents` (invokable, modes, headless entry). Validated by `npx pptb-validate` together with `package.json`.

### 2.4 APIs used (exact names)
| Need | Call |
|---|---|
| Connection | `toolboxAPI.connections.getActiveConnection()` → `{ id, name, url, environment, environmentColor?, … }` |
| Events | `toolboxAPI.events.on(handler)` — `connection:updated` → reset and reload table list; `tool:unloaded` → cleanup |
| Table list | `dataverseAPI.getAllEntitiesMetadata(['LogicalName','DisplayName','SchemaName','EntitySetName','IsCustomEntity','IsActivity','OwnershipType','MetadataId','IsCustomizable'])` |
| Table detail | `dataverseAPI.getEntityMetadata(logicalName, true, props[])` |
| Attributes / keys / relationships | `dataverseAPI.getEntityRelatedMetadata(logicalName, 'Attributes' \| 'Keys' \| 'OneToManyRelationships' \| 'ManyToOneRelationships' \| 'ManyToManyRelationships', props?)` |
| Anything else | `dataverseAPI.queryData(odataPath)`; `dataverseAPI.fetchXmlQuery(fetchXml)` |
| Functions | `dataverseAPI.execute({ operationName, operationType: 'function', parameters })` |
| Export | `toolboxAPI.fileSystem.saveFile(defaultName, content, filters?)` |
| Preferences | `toolboxAPI.settings.get/set/getAll/setAll` |
| Toast / clipboard | `toolboxAPI.utils.showNotification(...)`, `copyToClipboard(text)` |
| Open in browser | `toolboxAPI.utils.openInConnectionBrowser(url)` (v1.2.2) |
| Launched by another tool / MCP | `toolboxAPI.invocation.getLaunchContext()` → prefill (e.g. `{ entityName }`), `toolboxAPI.invocation.returnData(obj)` |

### 2.5 Dev loop and publishing
`npm run dev-watch` → PPTB Settings → *Show Debug Menu* → Debug → *Load Local Tool* (project **root**) → Help → *Toggle Tool DevTools*. Rebuilds need close-tab + Load Tool. Publish: `npm run build` → `npx pptb-validate` → `npm publish --access public` → submit at powerplatformtoolbox.com/submit-tool → review → marketplace.

---

## 3. Architecture

```
UI (React 18 + Fluent v9)         Headless entry (dist/headless.js)
   TablePicker · Header · Tabs        invokeHeadless(input, ctx) → buildLogicMap(...)
        │                                   │
        └──────────────► domain/buildLogicMap(client, tableLogicalName, options) ◄──┘
                              │
              ┌───────────────┼────────────────────────────────────────────────┐
              │ sources/      one module per source, each returns SourceResult  │
              │   tableMeta · columns · keys · relationships · forms · views    │
              │   processes (flows/workflows/BR/actions/BPF) · pluginSteps      │
              │   customApis · duplicateRules · fieldSecurity · apps · deps     │
              ├────────────────────────────────────────────────────────────────┤
              │ parsers/      pure: formxml, flowDefinition, workflowXaml,      │
              │               businessRuleXaml, bpfDefinition, formulaColumns   │
              ├────────────────────────────────────────────────────────────────┤
              │ classify/     source items → LogicItem[] with event/stage/order │
              │ model/        LogicMap · LogicItem · Pipeline · ColumnIndex      │
              │ export/       markdown · json · mermaid                          │
              ├────────────────────────────────────────────────────────────────┤
              │ data/         DataverseClient: paging, retry, pool, cache        │
              └────────────────────────────────────────────────────────────────┘
```
Rules:
- `buildLogicMap` is UI-free and returns a `LogicMap`; it accepts a `progress` callback and an `AbortSignal`. UI and headless both call it.
- Sources run **in parallel** (bounded pool) and **fail independently**; a 403 on plugin steps produces a `sourceErrors` entry, not a failed map.
- Parsers are pure functions with fixture tests; heuristic parsers return `confidence: 'exact' | 'heuristic'`.

### 3.1 Project layout
```
src/
  main.tsx · ui/…                     # React app
  headless.ts                         # exports invokeHeadless (built to dist/headless.js as CJS/IIFE, see 10)
  domain/buildLogicMap.ts · model.ts · codes.ts
  sources/*.ts · parsers/*.ts · classify/*.ts · export/*.ts
  data/client.ts · paging.ts · pool.ts
  fixtures/…                          # anonymized JSON/XML fixtures
```
Dependencies: `react`, `react-dom`, `@fluentui/react-components`, `@fluentui/react-icons`, `zustand`, `react-window`; dev `vite`, `typescript`, `vitest`, `@pptb/types`. XML parsing via the browser `DOMParser` (no dependency); in headless (Node) use `fast-xml-parser` behind a small `parseXml()` abstraction so both runtimes share parser code (**VERIFY** the headless runtime is Node: `module.exports` in the docs sample suggests so).

---

## 4. Domain model

```ts
export type LogicKind =
  | 'plugin' | 'customapi' | 'workflow' | 'action' | 'flow' | 'businessrule' | 'formscript'
  | 'pcf' | 'formcomponent' | 'bpf' | 'duplicaterule' | 'cascade' | 'key' | 'requiredcolumn'
  | 'formula' | 'rollup' | 'calculated' | 'autonumber' | 'fieldsecurity' | 'audit' | 'app';

export type EventName =
  | 'Create' | 'Update' | 'Delete' | 'Assign' | 'SetState' | 'Retrieve' | 'RetrieveMultiple'
  | 'Associate' | 'Disassociate' | 'Merge' | 'Share' | 'Unshare' | 'AddToQueue' | 'Qualify' | 'Win' | 'Lose'
  | `Custom:${string}` | `Message:${string}` | 'FormLoad' | 'FormSave' | 'FieldChange' | 'Any';

export type Stage =
  | 'client'            // form-time: business rules, JS handlers, PCF
  | 'prevalidation'     // 10
  | 'preoperation'      // 20 (incl. real-time workflow "before")
  | 'mainoperation'     // 30 (custom API implementation)
  | 'postoperation'     // 40 sync (incl. real-time workflow "after")
  | 'postcommit'        // async plugins, background workflows, cloud flows
  | 'always';           // data rules that are not stage-bound (keys, cascades, autonumber, formula)

export interface LogicItem {
  id: string;                     // GUID or synthetic (`${kind}:${key}`)
  kind: LogicKind;
  name: string;
  event: EventName;               // one item per event; a plugin on Create+Update becomes two items sharing `groupId`
  groupId?: string;
  stage: Stage;
  order?: number;                 // rank for plugins; undefined otherwise
  enabled: boolean;               // step enabled / process activated / handler enabled
  filteringAttributes?: string[]; // columns that trigger it (Update)
  touchesColumns?: string[];      // columns it reads/writes (heuristic where noted)
  confidence: 'exact' | 'heuristic';
  details: Record<string, unknown>; // kind-specific (assembly, type, images, form, library, function, connector, message …)
  links?: { maker?: string; record?: string }; // URLs for openInConnectionBrowser
  source: { table: string; id?: string };
}

export interface LogicMap {
  schemaVersion: 1;
  generatedAt: string;
  environment: { name: string; url: string };
  table: { logicalName: string; displayName: string; entitySetName: string; metadataId: string;
           ownership: string; isActivity: boolean; audit: boolean; changeTracking: boolean;
           duplicateDetection: boolean; hasNotes: boolean; hasActivities: boolean; isCustom: boolean; };
  items: LogicItem[];
  pipeline: Record<EventName, Record<Stage, LogicItem[]>>;  // derived, sorted by order then name
  columns: Record<string, { displayName: string; type: string; required: boolean; secured: boolean; audited: boolean;
                            sourceType: 'simple'|'calculated'|'rollup'|'formula'; autoNumber?: string;
                            triggers: string[]; touchedBy: string[] }>;   // item ids
  forms: Array<{ id: string; name: string; type: string; state: string; libraries: string[];
                 handlers: LogicItem[]; pcf: LogicItem[]; businessRules: string[] }>;
  externalTouchers: LogicItem[];    // flows/actions that read/write this table but are not triggered by it
  apps: Array<{ id: string; name: string; uniqueName: string; isManaged: boolean }>;
  dependencies: Array<{ componentType: number; componentTypeName?: string; objectId: string; name?: string; classified: boolean }>;
  sourceErrors: Array<{ source: string; message: string }>;
  stats: { requests: number; durationMs: number };
}
```

---

## 5. Data acquisition — per source

All sources take `(client, table: TableRef, opts)` where `TableRef = { logicalName, entitySetName, metadataId }`. Page everything (5,000-row pages). Use a pool of 6 concurrent requests.

### 5.1 Table metadata (`sources/tableMeta.ts`)
`getEntityMetadata(logicalName, true, ['LogicalName','SchemaName','DisplayName','EntitySetName','MetadataId','OwnershipType','IsCustomEntity','IsActivity','HasActivities','HasNotes','IsAuditEnabled','ChangeTrackingEnabled','IsDuplicateDetectionEnabled','IsBPFEntity','PrimaryIdAttribute','PrimaryNameAttribute','IsCustomizable'])`.
Also org-level audit: `organizations?$select=isauditenabled` → item `kind: 'audit'` explaining effective auditing (org on AND table on). Use `EntitySetName` for flow action matching (Dataverse connector uses plural names).

### 5.2 Columns (`sources/columns.ts`)
`getEntityRelatedMetadata(t, 'Attributes')` without `$select` (so derived properties come back). Produce `columns[]` and items:
- `SourceType` 1 → `calculated`, 2 → `rollup`, 3 → `formula` (**VERIFY** 3); include `FormulaDefinition` text in `details`; heuristically extract referenced column names from the formula (`\b[a-z0-9_]+\b` tokens that match known logical names) → `touchesColumns`, `confidence: 'heuristic'`.
- `AutoNumberFormat` non-empty → `autonumber` (stage `preoperation`, event `Create`, exact).
- `RequiredLevel.Value === 'ApplicationRequired' | 'SystemRequired'` → `requiredcolumn` (stage `client`; note in details that required level is enforced by forms/UI, not by the API).
- `IsSecured` → link to field security (5.11).
- `IsAuditEnabled.Value` → column flag only.
Skip `AttributeOf`-shadow attributes from the column list.

### 5.3 Alternate keys (`sources/keys.ts`)
`getEntityRelatedMetadata(t, 'Keys', ['SchemaName','DisplayName','KeyAttributes','EntityKeyIndexStatus'])` → `kind: 'key'`, event `Create`/`Update`, stage `always`, `touchesColumns = KeyAttributes`.

### 5.4 Relationships and cascades (`sources/relationships.ts`)
- `OneToManyRelationships` (this table is the parent): for each, `CascadeConfiguration` → items `kind: 'cascade'` for each behaviour that is not `NoCascade`/`RemoveLink`-default, e.g. `Delete: Cascade` → event `Delete`, details `{ child: ReferencingEntity, via: ReferencingAttribute, behaviour }`; `Assign: Cascade` → event `Assign`; `Share/Unshare`, `Merge`, `Reparent`.
- `ManyToOneRelationships` (this table is the child): show "this table is deleted when parent X is deleted" if parent's cascade delete is `Cascade` (informational items, event `Delete`, details `{ parent }`).
- `ManyToManyRelationships`: list only (details), no items.

### 5.5 Forms → scripts, PCF, components (`sources/forms.ts`, `parsers/formxml.ts`)
`systemforms?$select=formid,name,type,formxml,formactivationstate,isdefault,ismanaged,description&$filter=objecttypecode eq '<t>' and (type eq 2 or type eq 5 or type eq 6 or type eq 7 or type eq 11 or type eq 12)`
Parse `formxml` with `DOMParser`:
- `formLibraries/Library[@name]` → `libraries`.
- `events/event[@name][@attribute?][@control?]/Handlers/Handler[@functionName][@libraryName][@enabled][@passExecutionContext][@parameters]` → `formscript` items: event `onload` → `FormLoad`, `onsave` → `FormSave`, `onchange` (attribute) → `FieldChange` with `filteringAttributes=[attribute]`; other events (`tabstatechange`, `onrecordselect`, grid events) → `Event:<name>` in details; stage `client`; `enabled` from `@enabled`.
- Controls: iterate `tabs/tab/columns/column/sections/section/rows/row/cell/control`. For each `control`: `@id`, `@datafieldname`, `@classid`, `@disabled`; `customControl` descriptors live in `controlDescriptions/controlDescription[@forControl]/customControl[@name][@formFactor]` (**VERIFY** location on the installed version) → `pcf` items with `touchesColumns=[datafieldname]`, details `{ formId, controlName, formFactors }`. Well-known class ids: WebResource `{9FDF5F91-88B1-47f4-AD53-C11EFC01A01D}`, IFrame `{FD2A7985-3187-444e-908D-6624B21F69C0}`, Subgrid `{E7A81278-8635-4d9e-8D4D-59480B391C5B}`, QuickForm `{5C5600E0-1D6E-4205-A272-BE80DA87FD42}`, Timeline `{…}` (**VERIFY** GUIDs; anything unknown → show the classid) → `formcomponent` items (embedded web resource / iframe / canvas app) with `details.parameters` (the `<parameters>` children, e.g. `Url`, `RelationshipName`, `TargetEntityType`).
- Header/footer controls likewise.
Also attach business rules to forms (5.6) by `formid` when scoped.

### 5.6 Processes (`sources/processes.ts`)
One paged query for everything with `primaryentity eq '<t>'`, plus a second pass for cloud flows (whose `primaryentity` is often `none`):
`workflows?$select=workflowid,name,category,type,primaryentity,statecode,statuscode,mode,scope,uniquename,description,ismanaged,ondemand,subprocess,triggeroncreate,triggerondelete,triggeronupdateattributelist,createstage,updatestage,deletestage,runas,asyncautodelete,rendererobjecttypecode,clientdata,xaml,_ownerid_value,_formid_value,modifiedon&$filter=type eq 1 and primaryentity eq '<t>'`
If `_formid_value` 400s, retry without it (**VERIFY**).
- **Classic workflow (category 0)** → `workflow` items: `triggeroncreate` → `Create`; `triggerondelete` → `Delete`; `triggeronupdateattributelist` (comma list) → `Update` with `filteringAttributes`; if the list contains `ownerid` also emit `Assign`; if it contains `statecode` also emit `SetState`. `mode` 1 (real-time) → stage `preoperation` when the relevant stage value is 20, `postoperation` when 40; `mode` 0 → stage `postcommit`. `ondemand` → also `event: 'Any'` with `details.onDemand`. Heuristic `touchesColumns`: regex over `xaml` for `Attribute="([a-z0-9_]+)"` and `"([a-z0-9_]+)"` tokens matching known column names, `confidence: 'heuristic'`.
- **Action (category 3)** → `action` items, event `Custom:<uniquename>`, stage `mainoperation`; note actions are invoked, not triggered.
- **Business rule (category 2)** → `businessrule`, stage `client`, event `FormLoad`+`FieldChange`. Scope: if `_formid_value` set → that form; else all forms (or entity scope if `scope`/definition says so — **VERIFY** how entity-scoped BRs are stored; entity scope runs server-side on Create/Update too, in which case also emit `Create`/`Update` at stage `preoperation` with a note). Heuristic parsing of `xaml`: collect `Attribute="…"` targets and action element names (`SetVisibility`, `SetRequiredLevel`, `SetDefaultValue`, `SetValue`, `LockUnlock`, `ShowErrorMessage`, `SetBusinessRequired` — **VERIFY** names) → `details.actions`, `touchesColumns`.
- **BPF (category 4)** → `bpf` items: primary entity flag; parse `clientdata` JSON for stages if present (**VERIFY**), else regex `xaml` for stage display names; details `{ stages, activeStatus }`.
- **Cloud flows (category 5)**: second query without the primaryentity filter: `workflows?$select=workflowid,name,statecode,clientdata,_ownerid_value,modifiedon,ismanaged&$filter=category eq 5 and type eq 1` (paged; in big orgs a few hundred rows; `clientdata` is large — accept it, or first fetch ids+names and then `clientdata` in batches). Parse per 5.7. Emit:
  - `flow` items with event derived from the Dataverse trigger (`message` 1 Create, 2 Delete, 3 Update, 4 Create/Update, 5 Create/Delete, 6 Update/Delete, 7 all → one item per event), stage `postcommit`, `filteringAttributes` from `subscriptionRequest/filteringattributes`, details `{ scope, filterExpression, runAs, connectionReferences, actionCount, owner, state }`.
  - "When an action is performed" (custom API trigger) → `Custom:<apiName>`; "When a row is selected" → `Any` with `details.instant = true`.
  - flows **not** triggered by the table but with actions on it (5.7) → `externalTouchers`.

### 5.7 Flow definition parser (`parsers/flowDefinition.ts`)
`clientdata` → `JSON.parse` → `properties.definition`. Walk `triggers` and recursively `actions` (nested in `Scope`, `If`, `Foreach`, `Until`, `Switch.cases[*].actions`, `default.actions`).
- Dataverse connector ids: `shared_commondataserviceforapps` (current), `shared_commondataservice` (legacy). Identify by `inputs.host.apiId` ending with these, or `inputs.host.connectionName` referencing a connection reference whose `api.name` matches.
- Trigger inputs: `inputs.parameters['subscriptionRequest/entityname']`, `['subscriptionRequest/message']`, `['subscriptionRequest/filteringattributes']`, `['subscriptionRequest/scope']`, `['subscriptionRequest/filterexpression']`, `['subscriptionRequest/runas']`. Action-performed trigger: `['catalogId','categoryId','sdkMessageName','entityname']` (**VERIFY** keys). Row-selected trigger: `['entityname']`.
- Action `operationId` values that touch a table (parameter `entityName` is the **entity set name**): `CreateRecord`, `UpdateRecord`, `UpdateOnlyRecord`, `DeleteRecord`, `GetItem`, `ListRecords`, `AssociateEntities`, `DisassociateEntities`, `PerformBoundAction`, `PerformUnboundAction` (no table), `UploadFileOrImage`, `ExecuteChangeset` (**VERIFY** names on the installed connector version). Classify read vs write.
- Output: `{ triggers: [...], actionsOnTable: [{ path, name, operationId, kind: 'read'|'write' }], connectionReferences: [...] }`. Never log or export full `clientdata` (it may contain hard-coded secrets in parameters).

### 5.8 Plugin steps (`sources/pluginSteps.ts`)
`sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode,rank,filteringattributes,statecode,statuscode,configuration,supporteddeployment,asyncautodelete,description,ismanaged,ishidden,_impersonatinguserid_value,_sdkmessageprocessingstepsecureconfigid_value,_eventhandler_value,_plugintypeid_value&$expand=sdkmessagefilterid($select=primaryobjecttypecode,secondaryobjecttypecode),sdkmessageid($select=name),plugintypeid($select=typename,assemblyname,friendlyname,version,_pluginassemblyid_value)&$filter=sdkmessagefilterid/primaryobjecttypecode eq '<t>' or sdkmessagefilterid/secondaryobjecttypecode eq '<t>'`
(**VERIFY** filtering on the expanded navigation property; fallback: fetch `sdkmessagefilters?$filter=primaryobjecttypecode eq '<t>' or secondaryobjecttypecode eq '<t>'&$select=sdkmessagefilterid` first, then steps with `_sdkmessagefilterid_value eq … or …` in chunks.)
Images: `sdkmessageprocessingstepimages?$select=name,entityalias,imagetype,attributes,_sdkmessageprocessingstepid_value&$filter=_sdkmessageprocessingstepid_value eq … or …` (chunk ids by 20).
Service endpoints / webhooks: when `_eventhandler_value` is not a plugin type, look it up in `serviceendpoints?$select=serviceendpointid,name,contract,url,messageformat` (one call, cache) → details `{ endpoint, contract, url (redact query string) }`.
Mapping: stage 10 → `prevalidation`, 20 → `preoperation`, 30 → `mainoperation`, 40 + mode 0 → `postoperation`, 40 + mode 1 → `postcommit`; event from `sdkmessageid/name` (well-known → `EventName`, custom API names → `Custom:<name>`, others → `Message:<name>`); `order = rank`; `enabled = statecode === 0`; `filteringAttributes` split/sorted; details `{ pluginType, assembly, assemblyVersion, unsecureConfig, hasSecureConfig, images: [{ name, alias, type: Pre|Post|Both, attributes }], deployment, asyncAutoDelete, runAsUser, secondaryEntity, isHidden }`. Hide `ishidden` steps by default ("Show Microsoft/system steps" toggle).

### 5.9 Custom APIs bound to the table (`sources/customApis.ts`)
`customapis?$select=customapiid,name,uniquename,displayname,bindingtype,isfunction,isprivate,allowedcustomprocessingsteptype,executeprivilegename,boundentitylogicalname,_plugintypeid_value&$filter=boundentitylogicalname eq '<t>'` → `customapi` items, event `Custom:<uniquename>`, stage `mainoperation`, details `{ bindingType, isFunction, implementation: plugin type or 'none (flow/none)' }`. Steps registered on the custom API message are picked up by 5.8 (message name = unique name).

### 5.10 Duplicate detection rules (`sources/duplicateRules.ts`)
`duplicaterules?$select=duplicateruleid,name,statecode,statuscode,baseentityname,matchingentityname,description,ismanaged&$filter=baseentityname eq '<t>' or matchingentityname eq '<t>'` + conditions `duplicateruleconditions?$select=baseattributename,matchingattributename,operatorcode,operatorparam,ignoreblankvalues,_regardingobjectid_value&$filter=_regardingobjectid_value eq …` → `duplicaterule` items, events `Create` and `Update`, stage `preoperation` (rules are evaluated before the operation and can block it when duplicate detection is on), `enabled = statuscode === 2 (Published)` (**VERIFY**), `touchesColumns` from conditions, details `{ matchingTable, conditions }`. Also surface the table-level `IsDuplicateDetectionEnabled` and org setting `organizations?$select=isduplicatedetectionenabled,isduplicatedetectionenabledforonlinecreateupdate`.

### 5.11 Field security (`sources/fieldSecurity.ts`)
`fieldpermissions?$select=attributelogicalname,canread,cancreate,canupdate,canreadunmasked,_fieldsecurityprofileid_value&$filter=entityname eq '<t>'&$expand=fieldsecurityprofileid($select=name)` → `fieldsecurity` items per profile, stage `always`, `touchesColumns=[attribute]`. (Column masking rules: `attributemaskingrules` / `maskingrules` — backlog, **VERIFY** entity names.)

### 5.12 Apps that include the table (`sources/apps.ts`)
`appmodulecomponents?$select=_appmoduleid_value,componenttype,objectid&$filter=componenttype eq 1 and objectid eq <MetadataId>` then `appmodules?$select=appmoduleid,name,uniquename,ismanaged,statecode&$filter=appmoduleid eq … or …` → `apps[]`.

### 5.13 Dependency cross-check (`sources/dependencies.ts`)
`execute({ operationName: 'RetrieveDependenciesForDelete', operationType: 'function', parameters: { ObjectId: metadataId, ComponentType: 1 } })` (**VERIFY** parameter passing for unbound functions with GUID/int params; fallback `queryData("RetrieveDependenciesForDelete(ObjectId=@id,ComponentType=@ct)?@id=<guid>&@ct=1")`). Returns `EntityCollection` of `dependency` rows (`dependentcomponenttype`, `dependentcomponentobjectid`, `dependencytype`). Resolve `componenttype` labels from the `solutioncomponent.componenttype` option set (fetch once, cache; custom component types are environment-specific numbers). Mark each dependency `classified: true` when its object id matches an item we already produced; the rest go to the "Other dependencies" list (views, charts, dashboards, relationships, SDK message filters, etc.). This is the completeness safety net.

### 5.14 Views (context only)
`savedqueries?$select=savedqueryid,name,querytype,isdefault,isquickfindquery&$filter=returnedtypecode eq '<t>'` → counts for the header ("14 views, 3 quick find"). No logic items.

---

## 6. Classification and pipeline assembly (`classify/`)

1. Collect `LogicItem[]` from all sources.
2. Expand multi-event registrations into one item per event (`groupId` ties them).
3. Build `pipeline[event][stage]` and sort: plugins by `order` (rank) then name; real-time workflows after plugins of the same stage (Dataverse runs registered plugin steps and real-time workflows in rank order — treat real-time workflows as rank 1 unless a rank is available: **VERIFY**); `postcommit`: async plugins, then background workflows, then flows (all effectively concurrent — label the group "after commit, order not guaranteed").
4. Event synonyms: `SetStateDynamicEntity` → `SetState`; `Assign` from workflows triggered on `ownerid`; `Update` items whose `filteringAttributes` contain `statecode` are additionally shown under `SetState`; `Update` items with empty `filteringAttributes` are flagged `details.firesOnAnyUpdate = true` (performance smell).
5. Column index: for each column, `triggers` = items whose `filteringAttributes` include it (or JS `onchange`); `touchedBy` = items whose `touchesColumns` include it.
6. Smells (computed, shown as badges; each with a one-line explanation):
   - Update steps with no filtering attributes (sync plugins, real-time workflows, flows).
   - More than N sync items on one event/stage (default 5).
   - Disabled/draft items that still exist (clutter).
   - Real-time workflow + sync plugin on the same message (ordering ambiguity).
   - Flows triggered on Update with no filtering attributes and no filter expression.
   - Cascade delete chains ≥ 2 levels (walk child cascades one level: parent → child → grandchild).
   - Business rules scoped to entity (server-side) plus JS on the same field.

---

## 7. UI specification

### 7.1 Layout (Fluent UI v9)
```
┌ Header ──────────────────────────────────────────────────────────────────────────────┐
│ ●Dev "Contoso DEV"   Table: [ contoso_project ▾ (search) ]  [Refresh]  [Export ▾]      │
│ Project (contoso_project) · Custom · User-owned · Audit on · Dup detection off         │
│ 12 plugin steps · 3 real-time wf · 4 flows · 2 BR · 5 forms (9 handlers, 3 PCF) · 2 keys│
│ Smells: ⚠ 2 sync Update steps without filtering attributes  ⚠ 7 sync items on Update  │
├ Tabs: [Pipeline] [Forms] [Columns] [Data rules] [Touched by] [Everything] [Raw]        │
├ Pipeline (default) ────────────────────────────────────────────────────────────────────┤
│ Event: (Create) (Update) (Delete) (Assign) (SetState) (Custom…)  Filter: [x] enabled only│
│  Create                                                                                │
│   ├ client         BR "Default region" · JS onload contoso_project.js/onLoad             │
│   ├ prevalidation  ─                                                                    │
│   ├ preoperation   #1 Contoso.Plugins.ProjectNumbering (sync) · autonumber contoso_code  │
│   ├ postoperation  #1 Contoso.Plugins.ProjectRollup (sync, img: Post)                    │
│   └ after commit   Flow "Notify PM on project created" (Org scope) · WF "Create tasks" (bg)│
│  Update (filtering: 14 items on 9 columns)  …                                           │
├ Detail pane (right): all `details`, filtering attributes as chips, images, config,      │
│   [Open in browser] [Copy as markdown] [Show raw]                                       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Table picker**: searchable dropdown over all tables (display + logical name), remembers last 10 tables per environment (`settings`), accepts prefill `{ entityName }` from `getLaunchContext()` and auto-runs.
- **Pipeline tab**: event pills with counts; each event renders stage rows; items are compact rows with kind icon, name, mode badge (sync/async/bg/realtime), rank, enabled state, filtering-attribute chips (collapsed after 5), smell badges.
- **Forms tab**: one card per form (type, state, default): libraries, handlers table (event, attribute/control, function, library, enabled, passContext, params), PCF/components table, business rules applied.
- **Columns tab**: grid of columns with type, required, secured, audited, source type, autonumber, and two chip columns: *Triggers* and *Touched by* (click a chip to select the item). Search + "only columns with logic" filter.
- **Data rules tab**: keys, duplicate rules (with conditions), cascades (as a small tree: this table → child tables with behaviour), field security profiles, audit effective status, required columns.
- **Touched by tab**: flows/actions that read or write this table without being triggered by it (`externalTouchers`), grouped by read/write.
- **Everything tab**: flat virtualized grid of all items with column filters; useful for export previews.
- **Raw tab**: source JSON per source (redacted), plus "Save raw sources as fixture" (writes anonymized JSON for tests — asks for a folder via `fileSystem.selectPath`).
- **Progressive rendering**: the header appears after table metadata; each tab fills as its sources resolve; a slim progress bar lists sources with ✓ / ✗ (error tooltip) / spinner.
- Errors never block: e.g. "Plugin steps: insufficient privileges — this map is missing server-side plugins" as a warning banner.

### 7.2 State
`connection`, `tables[]`, `selectedTable`, `run: { status, progress: Record<source, 'pending'|'running'|'done'|'error'> }`, `map?: LogicMap`, `filters: { event, enabledOnly, showSystemSteps }`, `selection`, `recent[]`.

### 7.3 Settings keys
`ui.recentTables.<connectionId>`, `ui.showSystemSteps`, `ui.enabledOnly`, `export.lastFormat`, `smells.maxSyncItems`.

---

## 8. Export (`export/`)

- **Markdown** (primary): title (table, environment, date), facts line, smells, then sections mirroring the tabs. Pipeline section as nested lists per event/stage; Forms as tables; Columns as a table limited to columns with logic (full list optional); Data rules; Touched by; Other dependencies; Source errors. Deterministic ordering so re-exports diff cleanly in git.
- **JSON**: the `LogicMap` (same object the headless path returns).
- **Mermaid**: `flowchart LR` per selected event: `client --> prevalidation --> preoperation --> mainoperation --> postoperation --> postcommit` with items as nodes inside `subgraph` per stage; include as a fenced block in the Markdown when the user ticks "include diagrams".
- **Copy as markdown** for a single item (detail pane).
Save via `toolboxAPI.fileSystem.saveFile('<table>-logic-map.md', content, [{ name: 'Markdown', extensions: ['md'] }])`.
Redaction: never include plugin secure config (we never fetch it), redact query strings in webhook URLs, never include full flow `clientdata`, redact `unsecureConfig` unless "include configuration" is ticked.

---

## 9. Data layer

Same `DataverseClient` design as the Environment Diff tool (paging via `@odata.nextLink` when `queryData` surfaces it — **VERIFY** — else FetchXML paging with the double-URL-encoded cookie; retry with backoff on 429/503; pool of 6; per-run cache; cooperative cancellation). Keep it in a shared internal package or copy the ~200 lines; do not add a network library.
Request budget for one table: metadata 4–6 calls, forms 1, processes 2–4 pages (+ flow `clientdata` batches), steps 1–3, images 1–3, custom APIs 1, dup rules 2, field permissions 1, apps 2, dependencies 1, componenttype option set 1, org settings 1, service endpoints 1 → typically < 40 requests, < 10 s.

---

## 10. Agent integration (MCP) — part of v1

### 10.1 `pptb.config.json`
```json
{
  "invocation": {
    "version": "1.0.0",
    "capabilities": ["table-logic-map"],
    "prefill": {
      "properties": {
        "entityName": { "type": "string", "description": "Table logical name, e.g. account" },
        "includeSystemSteps": { "type": "boolean" },
        "events": { "type": "array", "items": { "type": "string" }, "description": "Optional filter, e.g. [\"Create\",\"Update\"]" }
      }
    },
    "returnTopic": {
      "properties": {
        "logicMap": { "type": "object", "description": "LogicMap JSON (schemaVersion 1)" },
        "markdown": { "type": "string", "description": "Human-readable report" }
      }
    }
  },
  "agents": {
    "version": "1.0.0",
    "invokable": true,
    "modes": ["one-way", "two-way"],
    "defaultMode": "two-way",
    "timeoutMS": 60000,
    "headless": true,
    "executionModes": ["windowed", "headless"],
    "defaultExecutionMode": "headless",
    "headlessEntry": "dist/headless.js"
  }
}
```
### 10.2 Windowed run
On startup: `const ctx = await toolboxAPI.invocation.getLaunchContext()`; if `ctx?.entityName`, select it and run; if `ctx.__pptb?.expectsResponse`, call `toolboxAPI.invocation.returnData({ logicMap, markdown })` when the run completes (respect `ctx.__pptb.timeoutMs` by returning a partial map with `sourceErrors` if time runs out).

### 10.3 Headless run (`src/headless.ts` → `dist/headless.js`)
```ts
/// <reference types="@pptb/types" />
async function invokeHeadless(input, context) {
  const { updateProgress, logger, invocationMode } = context;
  const entityName = String(input?.entityName ?? '').trim();
  if (!entityName) return { error: 'entityName is required' };
  updateProgress(5, 'resolving table');
  const client = createHeadlessClient(context);   // VERIFY: how dataverseAPI is exposed in headless context (1.2.5 notes: runtime support for dataverseAPI)
  const map = await buildLogicMap(client, entityName, { includeSystemSteps: !!input.includeSystemSteps, events: input.events, progress: (p, msg) => updateProgress(5 + Math.round(p * 0.9), msg), logger });
  updateProgress(100, 'done');
  return invocationMode === 'one-way' ? undefined : { logicMap: map, markdown: toMarkdown(map) };
}
module.exports = { invokeHeadless };
```
Build a second Vite/esbuild target for `headless.ts` as CommonJS with no DOM dependencies (hence the `parseXml()` abstraction). Test with MCP Inspector against the running PPTB MCP server; confirm the tool only appears when `agents.invokable` is true.

### 10.4 Inter-tool
Declare capability `table-logic-map` so other tools can `launchTool('@yourorg/pptb-table-logic-map', { entityName })`. Consider launching **into** other tools from the detail pane when they exist (e.g. Plugin Registration with a step id) — backlog.

---

## 11. Testing

### 11.1 Unit (Vitest) — fixtures in `src/fixtures/`
- `parsers/formxml`: main form with 3 tabs, header controls, handlers on onload/onsave/onchange with parameters, two PCF controls, a web resource and an iframe; quick create; quick view. Assert libraries, handlers, pcf, components.
- `parsers/flowDefinition`: Dataverse Create trigger with filtering attributes; Update trigger with filter expression; action-performed trigger; nested Scope/Condition/Apply-to-each with `ListRecords`/`UpdateRecord` on another table; legacy connector flow. Assert triggers, actions on table, read/write classification, connection references.
- `parsers/workflowXaml`: real-time before/after, background, on-demand; trigger flags mapping (incl. `ownerid` → Assign, `statecode` → SetState).
- `parsers/businessRuleXaml`: rule with visibility + required + set value; scoped to a form; assert actions and columns (heuristic tolerance: assert superset).
- `classify`: pipeline ordering, event expansion, synonyms, column index, every smell.
- `export/markdown`: golden snapshot for a fixture map; deterministic ordering.
- `data/paging`: cookie decode/escape, nextLink stripping.

### 11.2 Manual QA matrix
1. `account` in a Sales-enabled org with "show system steps" off/on (first-party volume; performance).
2. Custom table with: sync + async plugins with images, a real-time workflow (before), a background workflow, two flows (Create, Update with filtering), a BR scoped to one form, JS handlers, a PCF, an autonumber, a formula column, an alternate key, a duplicate rule, cascade delete to a child.
3. User without privileges on `sdkmessageprocessingstep` → warning banner, rest of map intact.
4. Table with zero logic → clean empty state per tab.
5. Launch from MCP Inspector headless and windowed; compare JSON equality with UI export.
6. Theme switch; `connection:updated` resets state and reloads the table list.

---

## 12. Delivery plan

**M0 — Scaffold (½ day).** `yo pptb` React+TS+Vite; manifest and `pptb.config.json`; icon; `pptb-validate` green; loads in Debug loader; table picker lists tables.

**M1 — Data layer + metadata sources (1 day).** `DataverseClient`; tableMeta, columns, keys, relationships/cascades; header facts render; unit tests for paging.

**M2 — Server pipeline (1.5 days).** pluginSteps (+images, endpoints), processes (workflows/actions/BPF), customApis, duplicateRules; `classify` and the Pipeline tab; fixtures and tests for XAML parsing and classification.

**M3 — Flows and forms (1.5 days).** flowDefinition parser + flow items + externalTouchers; formxml parser → Forms tab (scripts, PCF, components) and BR attachment; Columns tab with triggers/touchedBy.

**M4 — Data rules, apps, dependencies, smells (1 day).** fieldSecurity, apps, dependency cross-check, smell badges; Data rules / Touched by / Everything / Raw tabs.

**M5 — Export + agent (1 day).** Markdown/JSON/Mermaid export; windowed launch context; headless entry + CJS build; MCP Inspector test.

**M6 — Hardening + publish (1 day).** QA matrix, performance on a first-party table, README (what is exact vs heuristic, privileges needed: System Customizer/Administrator read on the queried tables), `npm publish`, registry submission, Discord announcement, tag `v1.0.0`.

---

## 13. Publishing checklist
- [ ] `package.json` required fields; `features.minAPI` matches the highest "Requires vX" used
- [ ] `pptb.config.json` validates; `agents.invokable` true only once headless is tested
- [ ] no `cspExceptions`, no external calls, no telemetry
- [ ] single IIFE bundle; `dist/headless.js` present and discoverable
- [ ] icon `currentColor`, checked in light/dark
- [ ] `npx pptb-validate` passes
- [ ] README: screenshots, exact-vs-heuristic table, privileges, redaction policy, known limitations, VERIFY outcomes
- [ ] MIT `LICENSE`

---

## 14. Backlog
- Non-solution cloud flows via `powerplatformAPI` (`PowerAutomate.Flows.Read` scope; requires the connection to be enabled for Power Platform API).
- Canvas apps referencing the table (`canvasapps.connectionreferences` JSON — **VERIFY** contents) and custom pages.
- Column masking rules, SLAs (`slas?$filter=objecttypecode eq …`), routing rules, record creation rules, queues.
- Power Pages table permissions (`adx_entitypermissions`) when the site tables exist.
- JavaScript web resource scan: fetch referenced libraries' content and grep for `Xrm.WebApi` calls on this table → heuristic touchers.
- Plugin trace correlation: link to Dataverse Trace Analyzer (inter-tool launch with plugin type name).
- "Explain this table" narrative via BYO LLM key — keep out of v1.
- Multi-table overview (matrix of tables × logic counts) as a starting page.

---

## 15. Appendix

### 15.1 Code tables (`src/domain/codes.ts`)
- `systemform.type`: 2 Main, 5 Mobile-Express, 6 Quick View, 7 Quick Create, 8 Dialog, 11 Card, 12 Main-Interactive (**VERIFY**)
- `workflow.category`: 0 Workflow, 1 Dialog, 2 Business Rule, 3 Action, 4 BPF, 5 Cloud Flow, 6 Desktop Flow; `type`: 1 Definition; `mode`: 0 Background, 1 Real-time; stage values 20 Pre / 40 Post
- `sdkmessageprocessingstep.stage`: 10 PreValidation, 20 PreOperation, 30 MainOperation, 40 PostOperation; `mode`: 0 Sync, 1 Async; `statecode`: 0 Enabled, 1 Disabled; image `imagetype`: 0 Pre, 1 Post, 2 Both; `supporteddeployment`: 0 Server, 1 Offline, 2 Both
- Dataverse flow trigger `message`: 1 Create, 2 Delete, 3 Update, 4 Create/Update, 5 Create/Delete, 6 Update/Delete, 7 Create/Update/Delete; `scope`: 1 User, 2 BU, 3 Parent-Child BU, 4 Organization
- Attribute `SourceType`: 0 Simple, 1 Calculated, 2 Rollup, 3 Formula (**VERIFY** 3)
- `duplicaterule.statuscode`: 0 Unpublished, 1 Publishing, 2 Published (**VERIFY**)
- Cascade values: `NoCascade`, `Cascade`, `Active`, `UserOwned`, `RemoveLink`, `Restrict`

### 15.2 VERIFY list (resolve in M1–M3; record in `docs/verified.md`)
1. `queryData` nextLink pass-through; error shape for 429.
2. `$filter` on expanded navigation (`sdkmessagefilterid/primaryobjecttypecode`).
3. `workflow._formid_value` presence; storage of entity-scoped business rules; BR XAML element names.
4. BPF `clientdata` structure.
5. `controlDescriptions/customControl` location in `formxml`; class ids for web resource/iframe/subgrid/quick view/timeline.
6. Flow action `operationId` names and action-performed trigger parameter keys on the installed connector version.
7. `SourceType = 3` for formula columns; `FormulaDefinition` availability without `$select`.
8. `RetrieveDependenciesForDelete` parameter passing through `execute` vs raw `queryData`.
9. Headless context: how `dataverseAPI` is provided and whether `connectionName` is honoured; Node vs browser runtime for `dist/headless.js`.
10. Real-time workflow ordering relative to plugin ranks within the same stage.

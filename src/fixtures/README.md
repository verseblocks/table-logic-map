# Test fixtures

Anonymized inputs for the parser and classifier tests. Nothing here comes from a customer environment.

| File | What it is | Provenance |
|---|---|---|
| `formxml.main.xml` | Main form: 2 tabs, header controls, onload/onsave/onchange/tabstatechange/onrecordselect handlers, 3 PCF descriptors, web resource, IFrame (with a secret-looking query string to test redaction), subgrid, quick view form, notes, unknown control | Hand-authored against the form XML schema |
| `flow.clientdata.create.json` | Cloud flow `clientdata`: Dataverse Create/Update trigger with filtering attributes + filter expression, nested Scope/If/Foreach/Switch/Until actions with GetItem/UpdateRecord/ListRecords/DeleteRecord/PerformBoundAction/CreateRecord, one non-Dataverse action | Hand-authored against the Logic Apps workflow definition schema |
| `flow.clientdata.update-filter.json` | Cloud flow `clientdata`: Dataverse Update trigger (message 3) with a filter expression and no filtering attributes; Compose + UpdateRecord (with a fake hard-coded secret to test that parameters are never copied) | Hand-authored |
| `flow.clientdata.action-performed.json` | Cloud flow `clientdata`: "When an action is performed" trigger (`catalogId`/`categoryId`/`sdkMessageName`/`entityname`), GetItem, PerformUnboundAction (no table), ReturnResponse | Hand-authored; trigger `operationId` is illustrative (keys are matched by presence, see docs/verified.md #6) |
| `flow.clientdata.row-selected.json` | Cloud flow `clientdata`: "When a row is selected" trigger (`entityname` only), ListRecords, If with a Teams action | Hand-authored; trigger `operationId` is illustrative (matched by `/selected/i`) |
| `flow.clientdata.legacy.json` | Cloud flow `clientdata` on the legacy `shared_commondataservice` connector: trigger and GetItems without `apiId` (resolved through `connectionReferences`), PatchItem, plus a SharePoint `GetItem` that must be ignored | Hand-authored against the legacy connector shape (`dataset` + `table` parameters) |
| `workflow.realtime.xaml` | Classic workflow: condition on a Money column, UpdateEntity with SetEntityProperty/SetAttributeValue, AssignEntity, CreateEntity (task), SetState, SendEmail | Hand-authored in the shape produced by the classic designer (see Microsoft docs `createaworkflow.cs`) |
| `businessrule.form.xaml` | Business rule: condition on a choice column, SetVisibility, SetRequiredLevel, SetDefaultValue, LockUnlock, else-branch ShowErrorMessage and SetValue | Hand-authored; element names are heuristics (see docs/verified.md #3) |
| `bpf.leadtoopportunity.xaml` | Real business process flow (Lead → Opportunity, 3 entity steps, stages, steps, controls, stage relationship) | Microsoft Industry Accelerator for Automotive (MIT license), `CDS.solutions/AutomotiveSales/Extracts/Base/Workflows` |
| `pluginsteps.steps.json` | 9 `sdkmessageprocessingstep` rows (with `sdkmessageid`, `plugintypeid`, `sdkmessagefilterid` expansions): sync pre-op, disabled post-op with secure config, async, custom API message, webhook, Service Bus, hidden Microsoft step with managed-property `ishidden`, secondary-entity registration, unknown message | Hand-authored |
| `pluginsteps.images.json` | `sdkmessageprocessingstepimage` rows (Pre / Post / Both) for the steps above | Hand-authored |
| `pluginsteps.serviceendpoints.json` | `serviceendpoint` rows: a webhook with a secret-looking query string (redaction test) and a Service Bus queue | Hand-authored |
| `dependencies.retrievefordelete.json` | `RetrieveDependenciesForDelete` response in the `EntityCollection.Entities` plain-object shape, incl. duplicates, braced ids and an unknown component type (10021) | Hand-authored |
| `dependencies.retrievefordelete.attributes.json` | Same function in the `Attributes` key/value shape (`OptionSetValue` / `EntityReference` wrappers) | Hand-authored |
| `logicmap.sample.ts` | Hand-built `LogicMap` for `contoso_project` used by the export golden-snapshot tests (deterministic ids, a raw marker that must never be exported) | Hand-authored |

Add new fixtures with the same naming (`<source>.<scenario>.<ext>`) and describe them here.

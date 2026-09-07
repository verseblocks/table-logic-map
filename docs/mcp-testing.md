# Testing the agent integration with MCP Inspector

Table Logic Map is exposed to assistants through the Power Platform ToolBox (PPTB) MCP server.
This checklist exercises both execution modes. It needs PPTB ≥ 1.2.5 (headless runtime).

## 1. Load the tool

- `npm run build` (produces `dist/index.html` and `dist/headless.js`).
- PPTB → Settings → *Show Debug Menu* → Debug → *Load Local Tool* → select the project **root**.
  Locally loaded tools are included in MCP discovery.

## 2. Start the MCP server and Inspector

- PPTB → MCP Server → Start (note the port, default `7339`, and the auth token).
- `npx @modelcontextprotocol/inspector` → connect to `http://127.0.0.1:7339` with header `X-MCP-Auth-Token: <token>`.

## 3. Discovery

- `list-tools` must contain `table-logic-map` (friendly name derived from the display name).
- The description lists execution modes `windowed, headless` (default `headless`) and invocation modes `one-way, two-way` (default `two-way`).
- Set `agents.invokable` to `false` in `pptb.config.json`, reload the tool, and confirm the tool disappears.

## 4. Headless, two-way (default)

```json
{
  "entityName": "account",
  "__pptb": { "mode": "two-way", "executionMode": "headless", "connectionName": "Contoso DEV", "timeoutMs": 120000 }
}
```

Expected: a job is started; progress messages (`tableMeta: done`, `pluginSteps: running`, …) appear in PPTB's MCP invocation details; the result contains `logicMap` (`schemaVersion: 1`) and `markdown`.
Without `connectionName` the run fails with "No primary connection is available" – that is the platform contract, not a tool bug.

## 5. Headless, one-way

Same call with `"mode": "one-way"`. Expected: `status: accepted` immediately; the job log ends with `done`.

## 6. Windowed, two-way

```json
{ "entityName": "account", "__pptb": { "mode": "two-way", "executionMode": "windowed" } }
```

Expected: the tool window opens with `account` selected, builds the map, calls `returnData({ logicMap, markdown })` and closes. The response is validated by PPTB against `invocation.returnTopic`.

Every terminal outcome answers: a build failure, a cancellation and the caller's `timeoutMs` (answered ~2 s early with the partial map) return the same shape plus an `error` string describing what happened. `error` is declared in `returnTopic` but is absent on success, so an agent should read it when present and must not require it.

## 7. Parity check

Export JSON from the UI for the same table and compare with the headless `logicMap` (ignore `generatedAt` and `stats`). They must be equal: both paths call `buildLogicMap` and `filterMap` with the same options and apply the same redaction. Compare with the UI's view filters at their defaults (`showSystemSteps` off, `enabledOnly` off, no event filter). The `smells.maxSyncItems` threshold also changes the derived `smells`, so pass the UI's setting as the `maxSyncItems` input to make the two maps comparable; omitting it uses the same default of 5.

## 8. Error paths

- Missing `entityName` → `{ "error": "entityName is required (table logical name, e.g. \"account\")" }`.
- `entityName` that is not a logical name (`"Account Name"`, `"account')/Attributes"`) → `{ "error": "entityName must be a table logical name …" }`, returned before any Dataverse request.
- Unknown table (a well-formed name that does not exist) → invocation error `Unable to load table 'nope_table': HTTP 404` — the platform message is kept but always prefixed with the table that was being loaded.
- Unknown `events` value (`["Modify"]`, or a typo) → `{ "error": "Unknown event(s): Modify. Use one of Create, Update, … or \"Custom:<message>\" / \"Message:<message>\" …" }`. Well-known names are case-insensitive, so `["create"]` runs normally and must return the same map as `["Create"]` — never an empty one.
- Unsupported execution mode → deterministic PPTB error listing supported modes.

## 9. Redaction

Register a plugin step with an unsecure configuration value on the test table, then check the headless result: `logicMap` must contain `"unsecureConfig": "[configuration omitted]"` and never the real value, and the `markdown` must not contain it either. The **windowed** two-way return (§6) is built by the same policy (`buildAgentPayload` → `redactConfiguration`), so repeat the check there. The same holds for the UI's JSON, Markdown and HTML exports; the value is only visible in the detail pane inside the app.

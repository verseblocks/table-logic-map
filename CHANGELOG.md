# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- Table picker with search over display and logical names and per-environment recent tables.
- Logic map assembled from 15 independent sources: table metadata, org settings, columns (formula/rollup/calculated/autonumber/required), alternate keys, relationships and cascades, forms (JavaScript handlers, PCF controls, web resources, IFrames, subgrids, quick view forms), classic workflows, actions, business rules, business process flows, cloud flows (triggers and Dataverse actions), plugin steps (images, filtering attributes, service endpoints), custom APIs, duplicate detection rules, field security profiles, model-driven apps, dependency cross-check and views.
- Pipeline view by event and stage with mode badges, ranks, filtering-attribute chips and smell badges.
- Forms, Columns, Data rules, Touched by, Everything and Raw tabs with a detail pane (Open in browser, Copy as Markdown).
- Markdown, JSON and Mermaid exports with deterministic ordering and redaction of secrets.
- HTML export: one self-contained document (inline stylesheet, inline SVG pipeline diagrams, no scripts and no external resources) carrying the same sections as the Markdown export. It renders offline in any browser, opens in Microsoft Word and carries a print stylesheet for printing to PDF. Every value read from Dataverse is HTML-escaped, so a record name containing markup cannot produce executable output. The single *Include diagrams* toggle now covers both formats: Mermaid code blocks in Markdown, inline SVG in HTML.
- Agent integration: `pptb.config.json` invocation/agents contract, windowed launch context handling and a headless `dist/headless.js` entry for the PPTB MCP server.
- Progressive rendering, independent source failure handling, retry with backoff and paging in the data layer.

### Fixed

Review-and-fix pass over the whole tool before the first release:

- Correctness of the Dataverse queries: the model-driven **apps** source used a lookup property (`_appmoduleid_value`) that `appmodulecomponent` does not have, so it returned 400 on every run and the map never listed apps; the **processes** source selected `_formid_value`, which `workflow` does not expose either (`formid` is an `Edm.Guid`), so every run wasted a request on a rejected query and business rules lost their form scoping. Real-time workflow execution order (`workflow.rank`) is now read instead of assumed to be 1, plugin steps on classic Action messages no longer race with the `processes` source for their `Custom:`/`Message:` event name, and cloud-flow filtering attributes are attached to `Update` only.
- **Redaction**: plugin unsecure configuration is now removed from the JSON export and from the MCP/agent payload (Markdown already omitted it), so it never leaves the tool unless a caller explicitly asks for it. Record names are flattened before they are written to Markdown, so a name containing line breaks cannot forge headings or list items.
- **Deterministic exports**: items, `stats.sourcesDone` and `sourceErrors` are sorted instead of following source completion order, so re-exports of the same table diff cleanly.
- **Input validation** in the headless entry: `entityName` must be a table logical name before it is interpolated into an OData metadata path, event names are matched case-insensitively (`create` → `Create`) with `Custom:`/`Message:` prefixes preserved, and unknown events return an error instead of an empty map. Build failures are prefixed with the table that could not be loaded. `includeDiagrams` is now declared in `invocation.prefill`.
- **Development loop**: `npm run dev-watch` no longer deletes `dist/headless.js` on every rebuild, so headless MCP calls keep working while the UI is rebuilt on save (`npm run dev-watch:headless` rebuilds the headless bundle too).
- **Consistent errors between the two run modes**: a table that cannot be loaded now reports `Unable to load table '<name>': <platform message>` from `buildLogicMap` itself, so the in-app error state reads the same as the agent-facing one instead of showing a bare `HTTP 404`.
- **Agent/UI parity for smells**: the headless entry accepts `maxSyncItems`, so an assistant can reproduce exactly the `too-many-sync` badges a user sees rather than always falling back to the built-in threshold of 5.
- **Honest return contract**: `invocation.returnTopic` declares the `error` string that a windowed run adds when it fails, is cancelled or hits the caller's timeout. It is absent on success, so callers read it when present and never require it.

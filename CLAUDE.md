# Table Logic Map — project notes for coding agents

Power Platform ToolBox (PPTB) tool by VerseBlocks. Read `pptb-table-logic-map-guide.md` (design spec)
and `docs/verified.md` (platform facts confirmed against PPTB 1.2.5 source) before changing behaviour.
The PPTB tool-dev skill is installed at `.claude/skills/pptb-tool-dev/`.

## Commands

- `npm run typecheck` — `tsc --noEmit` (strict, noUnusedLocals/Parameters)
- `npm test` — Vitest (node environment, `src/**/*.test.ts`)
- `npm run build` — typecheck + UI bundle (`dist/index.html`, single IIFE) + headless bundle (`dist/headless.js`, CJS)
- `npm run validate:offline` — manifest/config validation without URL reachability checks, plus dist structure checks
- `npx pptb-validate` — full validation (needs the GitHub repo to exist)

## Architecture (src/)

- `domain/model.ts` — the domain model (`LogicItem`, `LogicMap`, events, stages). **Do not add UI types here.**
- `domain/buildLogicMap.ts` — UI-free orchestrator used by both the React UI and `headless.ts`.
- `domain/filterMap.ts` — view filters (system steps, enabled only, events) re-deriving the map.
- `data/client.ts` — `DataverseClient` (pool of 6, retry on 429/503, nextLink + FetchXML paging, per-run cache).
- `xml/xml.ts` — `parseXml()` → `XmlEl` tree (fast-xml-parser) shared by browser and Node. **Never use `DOMParser`.**
- `sources/*.ts` — one module per data source; each returns `SourceResult` and fails independently.
- `parsers/*.ts` — pure functions with fixture tests; heuristic parsers report `confidence: 'heuristic'`.
- `classify/index.ts` — pure assembly: pipeline, synonyms, column index, smells, dependency classification.
- `export/*.ts` — Markdown (primary), JSON, Mermaid. Deterministic ordering.
- `ui/*` — React 18 + Fluent UI v9 + Zustand (`ui/store.ts` is the only place that touches `window.toolboxAPI`).
- `headless.ts` — `invokeHeadless(input, context)` for the PPTB MCP server (Node runtime, no DOM).

## Rules

- Only call PPTB APIs that exist in `node_modules/@pptb/types` (`toolboxAPI`, `dataverseAPI`). Do not invent methods.
- All Dataverse access goes through `DataverseClient`; sources never touch `window`.
- Never fetch plugin secure configuration; never export full flow `clientdata`; redact query strings in webhook URLs.
- Every source query must be paged (`client.query` follows `@odata.nextLink`).
- Item ids are Dataverse GUIDs where available, else `${kind}:${stableKey}`; one item per event, `groupId` ties multi-event registrations.
- Keep exports deterministic (sorted) so re-exports diff cleanly.
- Tests: fixtures live in `src/fixtures/` (anonymized). Parsers must have fixture tests.

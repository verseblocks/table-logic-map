/**
 * buildLogicMap — UI-free orchestrator shared by the React UI and the headless MCP entry.
 *
 *  1. `tableMeta` resolves the table facts (fatal if it fails).
 *  2. Wave 1 sources (`columns`, `customApis`, `orgSettings`) run in parallel; they feed
 *     `knownColumns` / `customApiNames` to later sources.
 *  3. Every other source runs in parallel (bounded by the client's pool). Each failure becomes a
 *     `sourceErrors` entry, never a failed map.
 *  4. After each source completes the accumulated data is re-classified and emitted through
 *     `onPartial` for progressive rendering; the final map has `stats.partial = false`.
 */
import type { DataverseClient } from '../data/client';
import { DataverseRequestError, classifyError, errorMessage } from '../data/client';
import { classify, type ClassifyInput } from '../classify';
import { ALL_SOURCES, type BuildOptions, type LogicMap, type Logger, type SourceError, type SourceName, type SourceStatus, type TableFacts } from './model';
import { SOURCES } from '../sources';
import type { Source, SourceContext, SourceResult } from '../sources/types';

const noopLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export interface BuildResult extends LogicMap {}

function toSourceError(name: SourceName, err: unknown): SourceError {
    const kind = err instanceof DataverseRequestError ? err.kind : classifyError(err);
    return {
        source: name,
        message: errorMessage(err),
        kind: kind === 'permission' ? 'permission' : kind === 'aborted' ? 'aborted' : 'error',
    };
}

export async function buildLogicMap(client: DataverseClient, tableLogicalName: string, options: BuildOptions = {}): Promise<LogicMap> {
    const logger = options.logger ?? noopLogger;
    const now = options.now ?? (() => new Date());
    const startedAt = now();
    const environment = options.environment ?? { name: '', url: '' };
    const environmentUrl = environment.url.replace(/\/+$/, '');
    const signal = options.signal;

    const statuses = new Map<SourceName, SourceStatus>(ALL_SOURCES.map((s) => [s, 'pending' as SourceStatus]));
    const results = new Map<SourceName, SourceResult>();
    const sourceErrors: SourceError[] = [];
    const sourcesDone: SourceName[] = [];

    const percent = () => Math.round((sourcesDone.length / ALL_SOURCES.length) * 100);
    const report = (source: SourceName, status: SourceStatus, message?: string) => {
        statuses.set(source, status);
        options.progress?.({ source, status, message, percent: percent() });
    };

    const byName = new Map<SourceName, Source>(SOURCES.map((s) => [s.name, s]));
    const get = (name: SourceName): Source => {
        const s = byName.get(name);
        if (!s) throw new Error(`Source '${name}' is not registered`);
        return s;
    };

    // Shared, mutable context state that later sources read.
    const knownColumns = new Set<string>();
    const customApiNames = new Set<string>();
    let table: TableFacts | undefined;
    let org = {};

    const makeCtx = (): SourceContext => {
        if (!table) throw new Error('table facts are not resolved yet');
        return { client, table, org, options, knownColumns, customApiNames, environmentUrl, logger, signal };
    };

    const assemble = (partial: boolean): LogicMap => {
        if (!table) throw new Error('table facts are not resolved yet');
        // `sourcesDone` / `sourceErrors` are appended in completion order (the sources run in
        // parallel); `classify` sorts both into `ALL_SOURCES` order so the map is reproducible.
        const input: ClassifyInput = {
            table,
            org,
            environment,
            generatedAt: startedAt.toISOString(),
            results: [...results.entries()].map(([name, result]) => ({ name, result })),
            sourceErrors: [...sourceErrors],
            options,
            stats: {
                requests: client.stats.requests,
                durationMs: now().getTime() - startedAt.getTime(),
                sourcesDone: [...sourcesDone],
                partial,
            },
        };
        return classify(input);
    };

    const emitPartial = () => {
        if (!options.onPartial || !table) return;
        try {
            options.onPartial(assemble(true));
        } catch (err) {
            logger.warn(`onPartial failed: ${errorMessage(err)}`);
        }
    };

    const runSource = async (name: SourceName): Promise<void> => {
        if (signal?.aborted) {
            report(name, 'skipped', 'cancelled');
            sourcesDone.push(name);
            return;
        }
        report(name, 'running');
        try {
            const result = await get(name).run(makeCtx());
            results.set(name, result);
            if (result.customApiNames) for (const n of result.customApiNames) customApiNames.add(n);
            if (result.columns) for (const c of result.columns) knownColumns.add(c.logicalName);
            if (result.org) org = { ...org, ...result.org };
            if (result.tableFacts) table = result.tableFacts;
            sourcesDone.push(name);
            report(name, 'done', result.warnings?.join('; '));
        } catch (err) {
            const se = toSourceError(name, err);
            sourceErrors.push(se);
            sourcesDone.push(name);
            logger.error(`Source ${name} failed: ${se.message}`);
            report(name, 'error', se.message);
        }
        emitPartial();
    };

    // 1. Table metadata is required to do anything else.
    report('tableMeta', 'running');
    try {
        const ctxBootstrap: SourceContext = {
            client,
            table: { logicalName: tableLogicalName, entitySetName: '', metadataId: '', displayName: tableLogicalName } as TableFacts,
            org,
            options,
            knownColumns,
            customApiNames,
            environmentUrl,
            logger,
            signal,
        };
        const meta = await get('tableMeta').run(ctxBootstrap);
        if (!meta.tableFacts) throw new Error(`Table '${tableLogicalName}' was not found`);
        table = meta.tableFacts;
        results.set('tableMeta', meta);
        sourcesDone.push('tableMeta');
        report('tableMeta', 'done');
    } catch (err) {
        report('tableMeta', 'error', errorMessage(err));
        // Always name the table. The platform message for a table that does not exist is a bare
        // `HTTP 404`, which tells neither a user nor an assistant that the *name* was the problem,
        // so both the UI error state and the headless entry get the same prefixed message here
        // (the headless `tableError()` guard keeps it from being applied twice).
        const message = `Unable to load table '${tableLogicalName}': ${errorMessage(err)}`;
        throw err instanceof DataverseRequestError ? new DataverseRequestError(message, err.kind, err.path, { cause: err }) : new Error(message, { cause: err });
    }
    emitPartial();

    // 2. Wave 1: cheap sources that later sources depend on.
    const wave1: SourceName[] = ['columns', 'customApis', 'orgSettings'];
    await Promise.all(wave1.map(runSource));

    // 3. Everything else in parallel (the client pool bounds concurrency).
    const rest = ALL_SOURCES.filter((s) => s !== 'tableMeta' && !wave1.includes(s));
    const pending = new Set(rest);
    const running = new Map<SourceName, Promise<void>>();
    const isReady = (s: Source) => (s.after ?? []).every((dep) => sourcesDone.includes(dep));
    while (pending.size > 0) {
        let launched = 0;
        for (const name of [...pending]) {
            const source = get(name);
            if (isReady(source)) {
                pending.delete(name);
                running.set(name, runSource(name));
                launched++;
            }
        }
        if (launched === 0) {
            // Wait for any running source to finish, then re-evaluate readiness.
            await Promise.race([...running.values()]);
            for (const [name] of running) if (sourcesDone.includes(name)) running.delete(name);
            if (running.size === 0 && launched === 0 && pending.size > 0) {
                // Unsatisfiable dependency (should not happen) — run them anyway.
                for (const name of [...pending]) {
                    pending.delete(name);
                    running.set(name, runSource(name));
                }
            }
        }
    }
    await Promise.all([...running.values()]);

    return assemble(false);
}

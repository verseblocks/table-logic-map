import { stripRaw, type LogicMap } from '../domain/model';
import { redactConfiguration, type RedactOptions } from './redact';

export { CONFIG_OMITTED, redactConfiguration, type RedactOptions } from './redact';

/** Options for the JSON export; the same shape the Markdown export uses for its own redaction. */
export type JsonOptions = RedactOptions;

/**
 * Deterministic JSON export of the LogicMap (the same object the headless path returns), without
 * raw source data and without plugin unsecure configuration unless `includeConfiguration` is set.
 */
export function toJson(map: LogicMap, opts: JsonOptions = {}): string {
    return JSON.stringify(redactConfiguration(stripRaw(map), opts), null, 2);
}

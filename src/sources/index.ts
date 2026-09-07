/**
 * Source registry consumed by buildLogicMap. Order here does not matter; scheduling is driven by
 * each source's optional `after` list and the wave logic in buildLogicMap.
 */
import type { Source } from './types';
import { tableMetaSource } from './tableMeta';
import { orgSettingsSource } from './orgSettings';
import { columnsSource } from './columns';
import { keysSource } from './keys';
import { relationshipsSource } from './relationships';
import { formsSource } from './forms';
import { processesSource } from './processes';
import { flowsSource } from './flows';
import { pluginStepsSource } from './pluginSteps';
import { customApisSource } from './customApis';
import { duplicateRulesSource } from './duplicateRules';
import { fieldSecuritySource } from './fieldSecurity';
import { appsSource } from './apps';
import { dependenciesSource } from './dependencies';
import { viewsSource } from './views';

export const SOURCES: readonly Source[] = [
    tableMetaSource,
    orgSettingsSource,
    columnsSource,
    keysSource,
    relationshipsSource,
    formsSource,
    processesSource,
    flowsSource,
    pluginStepsSource,
    customApisSource,
    duplicateRulesSource,
    fieldSecuritySource,
    appsSource,
    dependenciesSource,
    viewsSource,
];

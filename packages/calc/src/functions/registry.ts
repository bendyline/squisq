/** The assembled function registry + the volatile set derived from it. */

import type { CalcFunctionDef } from '../evaluate.js';
import { dateFunctions } from './datetime.js';
import { infoFunctions } from './info.js';
import { logicalFunctions } from './logical.js';
import { lookupFunctions } from './lookup.js';
import { mathFunctions } from './math.js';
import { textFunctions } from './text.js';

export function buildFunctionRegistry(): Map<string, CalcFunctionDef> {
  const registry = new Map<string, CalcFunctionDef>();
  for (const family of [
    mathFunctions,
    logicalFunctions,
    lookupFunctions,
    textFunctions,
    infoFunctions,
    dateFunctions,
  ]) {
    for (const [name, def] of Object.entries(family)) {
      registry.set(name, def);
    }
  }
  return registry;
}

export function volatileFunctionNames(registry: ReadonlyMap<string, CalcFunctionDef>): string[] {
  return [...registry.entries()]
    .filter(([, def]) => def.volatile === true)
    .map(([name]) => name)
    .sort();
}

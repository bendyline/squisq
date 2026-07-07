/**
 * Format registry implementation.
 *
 * `createRegistry()` returns an empty, mutable registry (last-write-wins by id);
 * `defaultRegistry()` returns one preloaded with every built-in format.
 */

import type { FormatDefinition, FormatId, FormatRegistry } from './types.js';
import { defaultFormats } from './defaultFormats.js';

/** Normalize an extension to lowercase, without a leading dot. */
function normalizeExt(ext: string): string {
  return ext.replace(/^\.+/, '').toLowerCase();
}

/** Create an empty registry. Registering an existing id overwrites it. */
export function createRegistry(): FormatRegistry {
  const byId = new Map<FormatId, FormatDefinition>();

  return {
    register(def: FormatDefinition): void {
      byId.set(def.id, def);
    },
    get(id: FormatId): FormatDefinition | undefined {
      return byId.get(id);
    },
    byExtension(ext: string): FormatDefinition | undefined {
      const target = normalizeExt(ext);
      if (!target) return undefined;
      for (const def of byId.values()) {
        if (def.extensions.some((e) => normalizeExt(e) === target)) return def;
      }
      return undefined;
    },
    list(): FormatDefinition[] {
      return [...byId.values()];
    },
  };
}

/** Create a registry preloaded with all built-in formats. */
export function defaultRegistry(): FormatRegistry {
  const registry = createRegistry();
  for (const def of defaultFormats()) {
    registry.register(def);
  }
  return registry;
}

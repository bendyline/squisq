/**
 * Browser-local library of user-defined custom templates.
 *
 * Library templates live in `localStorage` under
 * `LIBRARY_STORAGE_KEY`. They're a cross-doc convenience — a personal
 * collection of designs the user reuses across documents — but they're
 * NOT used by the SSR pipeline. When a user applies a library template
 * to a block, `applyTemplate` (in CustomTemplateContext) copies the
 * definition into the doc's `customTemplates` so the doc remains
 * self-sufficient (the markdown file ships with everything it needs).
 *
 * Safe to import in SSR / Node — gracefully no-ops when
 * `localStorage` is unavailable.
 */

import type { CustomTemplateDefinition } from '@bendyline/squisq/schemas';

export const LIBRARY_STORAGE_KEY = 'squisq:custom-template-library';

interface LibraryPayload {
  /** Schema version for forward-compatibility. */
  version: 1;
  templates: CustomTemplateDefinition[];
}

function safeStorage(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage
      ? globalThis.localStorage
      : null;
  } catch {
    // Some browsers throw on localStorage access in private mode.
    return null;
  }
}

function readPayload(): LibraryPayload {
  const storage = safeStorage();
  if (!storage) return { version: 1, templates: [] };
  const raw = storage.getItem(LIBRARY_STORAGE_KEY);
  if (!raw) return { version: 1, templates: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<LibraryPayload>;
    if (parsed && Array.isArray(parsed.templates)) {
      return { version: 1, templates: parsed.templates };
    }
  } catch {
    // Corrupt payload — drop it.
  }
  return { version: 1, templates: [] };
}

function writePayload(payload: LibraryPayload): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — best-effort write.
  }
}

/** Return every template currently in the user's library, sorted by label. */
export function listLibraryTemplates(): CustomTemplateDefinition[] {
  const { templates } = readPayload();
  return templates.slice().sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Insert or replace a library template (matched by `name`). Returns
 * the persisted list so callers can update their state without
 * re-reading.
 */
export function saveLibraryTemplate(def: CustomTemplateDefinition): CustomTemplateDefinition[] {
  const payload = readPayload();
  const idx = payload.templates.findIndex((t) => t.name === def.name);
  if (idx >= 0) {
    payload.templates[idx] = def;
  } else {
    payload.templates.push(def);
  }
  writePayload(payload);
  return payload.templates.slice().sort((a, b) => a.label.localeCompare(b.label));
}

/** Remove a library template by name. Returns the updated list. */
export function deleteLibraryTemplate(name: string): CustomTemplateDefinition[] {
  const payload = readPayload();
  payload.templates = payload.templates.filter((t) => t.name !== name);
  writePayload(payload);
  return payload.templates.slice().sort((a, b) => a.label.localeCompare(b.label));
}

/** Wipe the entire library — useful for tests and "reset" affordances. */
export function clearLibrary(): void {
  writePayload({ version: 1, templates: [] });
}

/**
 * Browser-local library of user-defined custom themes.
 *
 * The theme analog of `customTemplates/library.ts`. Library themes live in
 * `localStorage` under `THEME_LIBRARY_STORAGE_KEY`. They're a cross-doc
 * convenience — a personal collection the user reuses across documents — but
 * they're NOT used by the SSR / export pipeline. When a user applies a library
 * theme to a doc, `applyTheme` (in CustomThemeContext) copies the definition
 * into the doc's `customThemes` so the doc remains self-sufficient (the
 * markdown file ships with everything it needs), exactly as applying a library
 * template copies it into `Doc.customTemplates`.
 *
 * Safe to import in SSR / Node — gracefully no-ops when `localStorage` is
 * unavailable.
 */

import { validateTheme, type Theme } from '@bendyline/squisq/schemas';

export const THEME_LIBRARY_STORAGE_KEY = 'squisq:custom-theme-library';

interface LibraryPayload {
  /** Schema version for forward-compatibility. */
  version: 1;
  themes: Theme[];
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
  if (!storage) return { version: 1, themes: [] };
  try {
    const raw = storage.getItem(THEME_LIBRARY_STORAGE_KEY);
    if (!raw) return { version: 1, themes: [] };
    const parsed = JSON.parse(raw) as Partial<LibraryPayload>;
    if (parsed && Array.isArray(parsed.themes)) {
      return {
        version: 1,
        themes: parsed.themes.filter((theme): theme is Theme => validateTheme(theme).valid),
      };
    }
  } catch {
    // Corrupt payload — drop it.
  }
  return { version: 1, themes: [] };
}

function writePayload(payload: LibraryPayload): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(THEME_LIBRARY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — best-effort write.
  }
}

/** Return every theme currently in the user's library, sorted by name. */
export function listLibraryThemes(): Theme[] {
  const { themes } = readPayload();
  return themes.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Insert or replace a library theme (matched by `id`). Returns the persisted
 * list so callers can update their state without re-reading.
 */
export function saveLibraryTheme(theme: Theme): Theme[] {
  const payload = readPayload();
  const idx = payload.themes.findIndex((t) => t.id === theme.id);
  if (idx >= 0) {
    payload.themes[idx] = theme;
  } else {
    payload.themes.push(theme);
  }
  writePayload(payload);
  return payload.themes.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/** Remove a library theme by id. Returns the updated list. */
export function deleteLibraryTheme(id: string): Theme[] {
  const payload = readPayload();
  payload.themes = payload.themes.filter((t) => t.id !== id);
  writePayload(payload);
  return payload.themes.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/** Wipe the entire theme library — useful for tests and "reset" affordances. */
export function clearThemeLibrary(): void {
  writePayload({ version: 1, themes: [] });
}

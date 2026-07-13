/**
 * CustomThemeContext — exposes the merged set of doc-level + library custom
 * themes to the rest of the editor (chiefly ThemePicker and CustomThemeDialog).
 *
 * The theme analog of CustomTemplateContext. The host wraps the editor in a
 * provider, supplying:
 *   - `docThemes`: the list currently sourced from the active doc's
 *     frontmatter (read from `Doc.customThemes`).
 *   - `onDocThemesChange`: a callback the host uses to persist a change back
 *     into the doc (e.g. by updating the markdown source).
 *
 * Library themes come from `localStorage` via `customThemeLibrary.ts` and are
 * managed entirely within the context — the host doesn't see them.
 *
 * `applyTheme(theme)` is the bridge between the two pools: when a user picks a
 * library theme, we copy its definition into the doc's `customThemes` (if it
 * isn't already there) so the doc remains self-sufficient for SSR / export.
 * Selecting it as the active theme (writing `squisq-theme: <id>`) is a
 * separate step the caller performs; this just ensures the doc-scoped resolve
 * has the definition — exactly as `applyTemplate` seeds `Doc.customTemplates`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Theme } from '@bendyline/squisq/schemas';
import {
  listLibraryThemes,
  saveLibraryTheme as saveLibraryThemeRaw,
  deleteLibraryTheme as deleteLibraryThemeRaw,
  THEME_LIBRARY_STORAGE_KEY,
} from './customThemeLibrary';

export interface CustomThemeContextValue {
  /** Themes inlined into the current doc's frontmatter. */
  docThemes: Theme[];
  /** Themes the user has saved to their browser-local library. */
  libraryThemes: Theme[];
  /**
   * Convenience: the union of doc + library, with library entries skipped
   * when a doc theme of the same id already exists. Used by the picker so a
   * single "Custom" section covers both sources without duplicates.
   */
  allThemes: Theme[];

  /**
   * Persist a theme into the current doc. Replaces any existing entry with
   * the same `id`. Triggers the host's `onDocThemesChange` so the doc's
   * frontmatter ends up updated.
   */
  upsertDocTheme: (theme: Theme) => void;
  /** Persist a theme into the user's library (replaces by id). */
  upsertLibraryTheme: (theme: Theme) => void;
  /** Remove a doc-level theme by id. */
  removeDocTheme: (id: string) => void;
  /** Remove a library theme by id. */
  removeLibraryTheme: (id: string) => void;
  /**
   * Apply a theme to the current doc. If the theme is already in the doc,
   * this is a no-op. If it's only in the library, it's copied into the doc
   * so SSR / export work. Returns the resolved definition so callers can
   * also write the `squisq-theme` selection.
   */
  applyTheme: (theme: Theme) => Theme;
}

const CustomThemeContext = createContext<CustomThemeContextValue | null>(null);

export interface CustomThemeProviderProps {
  /** The current doc's custom themes (from `Doc.customThemes`). */
  docThemes: Theme[];
  /**
   * Callback the host uses to persist a new doc-theme list back into the doc
   * (e.g. by writing the encoded payload into the markdown's
   * `squisq-custom-themes` frontmatter key).
   */
  onDocThemesChange: (next: Theme[]) => void;
  children: ReactNode;
}

export function CustomThemeProvider({
  docThemes,
  onDocThemesChange,
  children,
}: CustomThemeProviderProps) {
  const [libraryThemes, setLibraryThemes] = useState<Theme[]>(() => listLibraryThemes());

  // Re-read the library when this provider mounts so cross-tab edits (or
  // initial first-paint quirks) are picked up. We don't subscribe to
  // localStorage events in v1 — opening the picker re-renders and re-reads,
  // which is enough for the single-tab common case.
  useEffect(() => {
    setLibraryThemes(listLibraryThemes());
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_LIBRARY_STORAGE_KEY) setLibraryThemes(listLibraryThemes());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const upsertDocTheme = useCallback(
    (theme: Theme) => {
      const existingIdx = docThemes.findIndex((t) => t.id === theme.id);
      const next =
        existingIdx >= 0
          ? docThemes.map((t, i) => (i === existingIdx ? theme : t))
          : [...docThemes, theme];
      onDocThemesChange(next);
    },
    [docThemes, onDocThemesChange],
  );

  const removeDocTheme = useCallback(
    (id: string) => {
      const next = docThemes.filter((t) => t.id !== id);
      if (next.length !== docThemes.length) onDocThemesChange(next);
    },
    [docThemes, onDocThemesChange],
  );

  const upsertLibraryTheme = useCallback((theme: Theme) => {
    setLibraryThemes(saveLibraryThemeRaw(theme));
  }, []);

  const removeLibraryTheme = useCallback((id: string) => {
    setLibraryThemes(deleteLibraryThemeRaw(id));
  }, []);

  const applyTheme = useCallback(
    (theme: Theme) => {
      // If the doc already has this theme (matching id), leave both alone —
      // the existing entry might be a customized copy.
      const inDoc = docThemes.find((t) => t.id === theme.id);
      if (!inDoc) upsertDocTheme(theme);
      return inDoc ?? theme;
    },
    [docThemes, upsertDocTheme],
  );

  const allThemes = useMemo(() => {
    const seen = new Set(docThemes.map((t) => t.id));
    return [...docThemes, ...libraryThemes.filter((t) => !seen.has(t.id))];
  }, [docThemes, libraryThemes]);

  const value = useMemo<CustomThemeContextValue>(
    () => ({
      docThemes,
      libraryThemes,
      allThemes,
      upsertDocTheme,
      upsertLibraryTheme,
      removeDocTheme,
      removeLibraryTheme,
      applyTheme,
    }),
    [
      docThemes,
      libraryThemes,
      allThemes,
      upsertDocTheme,
      upsertLibraryTheme,
      removeDocTheme,
      removeLibraryTheme,
      applyTheme,
    ],
  );

  return <CustomThemeContext.Provider value={value}>{children}</CustomThemeContext.Provider>;
}

/**
 * Hook returning the current context. Returns null when no provider is
 * mounted — callers can degrade to "no custom themes" rather than throwing,
 * since the feature is optional.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook is co-located with its provider by design, mirroring CustomTemplateContext
export function useCustomThemes(): CustomThemeContextValue | null {
  return useContext(CustomThemeContext);
}

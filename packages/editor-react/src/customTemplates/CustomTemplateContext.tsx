/**
 * CustomTemplateContext — exposes the merged set of doc-level + library
 * custom templates to the rest of the editor (chiefly TemplatePicker
 * and TemplateDesigner).
 *
 * The host wraps the editor in a provider, supplying:
 *   - `docTemplates`: the list currently sourced from the active doc's
 *     frontmatter (read from `Doc.customTemplates`).
 *   - `onDocTemplatesChange`: a callback the host uses to persist a
 *     change back into the doc (e.g. by updating the markdown source).
 *
 * Library templates come from `localStorage` via `library.ts` and are
 * managed entirely within the context — the host doesn't see them.
 *
 * `applyTemplate(def)` is the bridge between the two pools: when a
 * user picks a library template for a block, we copy its definition
 * into the doc's customTemplates (if it isn't already there) so the
 * doc remains self-sufficient for SSR / export. The block's annotation
 * (`{[name]}`) is what actually selects the template at render time;
 * this just ensures the registry merge has the definition.
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
import type { CustomTemplateDefinition } from '@bendyline/squisq/schemas';
import {
  listLibraryTemplates,
  saveLibraryTemplate as saveLibraryTemplateRaw,
  deleteLibraryTemplate as deleteLibraryTemplateRaw,
} from './library';

export interface CustomTemplateContextValue {
  /** Templates inlined into the current doc's frontmatter. */
  docTemplates: CustomTemplateDefinition[];
  /** Templates the user has saved to their browser-local library. */
  libraryTemplates: CustomTemplateDefinition[];
  /**
   * Convenience: the union of doc + library, with library entries
   * skipped when a doc template of the same name already exists.
   * Used by the picker so a single "Custom" section covers both
   * sources without duplicates.
   */
  allTemplates: CustomTemplateDefinition[];

  /**
   * Persist a template into the current doc. Replaces any existing
   * entry with the same `name`. Triggers the host's
   * `onDocTemplatesChange` so the doc's frontmatter ends up updated.
   */
  upsertDocTemplate: (def: CustomTemplateDefinition) => void;
  /** Persist a template into the user's library (replaces by name). */
  upsertLibraryTemplate: (def: CustomTemplateDefinition) => void;
  /** Remove a doc-level template by name. */
  removeDocTemplate: (name: string) => void;
  /** Remove a library template by name. */
  removeLibraryTemplate: (name: string) => void;
  /**
   * Apply a template to the current doc. If the template is already in
   * the doc, this is a no-op. If it's only in the library, it's
   * copied into the doc so SSR / export work. Returns the resolved
   * definition so callers can also write the heading annotation.
   */
  applyTemplate: (def: CustomTemplateDefinition) => CustomTemplateDefinition;
}

const CustomTemplateContext = createContext<CustomTemplateContextValue | null>(null);

export interface CustomTemplateProviderProps {
  /** The current doc's custom templates (from `Doc.customTemplates`). */
  docTemplates: CustomTemplateDefinition[];
  /**
   * Callback the host uses to persist a new doc-template list back
   * into the doc (e.g. by writing the encoded payload into the
   * markdown's `squisq-custom-templates` frontmatter key).
   */
  onDocTemplatesChange: (next: CustomTemplateDefinition[]) => void;
  children: ReactNode;
}

export function CustomTemplateProvider({
  docTemplates,
  onDocTemplatesChange,
  children,
}: CustomTemplateProviderProps) {
  const [libraryTemplates, setLibraryTemplates] = useState<CustomTemplateDefinition[]>(
    () => listLibraryTemplates(),
  );

  // Re-read the library when this provider mounts so cross-tab edits
  // (or initial first-paint quirks) are picked up. We don't subscribe
  // to localStorage events in v1 — opening the picker re-renders and
  // re-reads, which is enough for the single-tab common case.
  useEffect(() => {
    setLibraryTemplates(listLibraryTemplates());
  }, []);

  const upsertDocTemplate = useCallback(
    (def: CustomTemplateDefinition) => {
      const existingIdx = docTemplates.findIndex((t) => t.name === def.name);
      const next =
        existingIdx >= 0
          ? docTemplates.map((t, i) => (i === existingIdx ? def : t))
          : [...docTemplates, def];
      onDocTemplatesChange(next);
    },
    [docTemplates, onDocTemplatesChange],
  );

  const removeDocTemplate = useCallback(
    (name: string) => {
      const next = docTemplates.filter((t) => t.name !== name);
      if (next.length !== docTemplates.length) onDocTemplatesChange(next);
    },
    [docTemplates, onDocTemplatesChange],
  );

  const upsertLibraryTemplate = useCallback((def: CustomTemplateDefinition) => {
    setLibraryTemplates(saveLibraryTemplateRaw(def));
  }, []);

  const removeLibraryTemplate = useCallback((name: string) => {
    setLibraryTemplates(deleteLibraryTemplateRaw(name));
  }, []);

  const applyTemplate = useCallback(
    (def: CustomTemplateDefinition) => {
      // If the doc already has this template (matching name), leave
      // both alone — the existing entry might be a customized copy.
      const inDoc = docTemplates.find((t) => t.name === def.name);
      if (!inDoc) upsertDocTemplate(def);
      return inDoc ?? def;
    },
    [docTemplates, upsertDocTemplate],
  );

  const allTemplates = useMemo(() => {
    const seen = new Set(docTemplates.map((t) => t.name));
    return [...docTemplates, ...libraryTemplates.filter((t) => !seen.has(t.name))];
  }, [docTemplates, libraryTemplates]);

  const value = useMemo<CustomTemplateContextValue>(
    () => ({
      docTemplates,
      libraryTemplates,
      allTemplates,
      upsertDocTemplate,
      upsertLibraryTemplate,
      removeDocTemplate,
      removeLibraryTemplate,
      applyTemplate,
    }),
    [
      docTemplates,
      libraryTemplates,
      allTemplates,
      upsertDocTemplate,
      upsertLibraryTemplate,
      removeDocTemplate,
      removeLibraryTemplate,
      applyTemplate,
    ],
  );

  return (
    <CustomTemplateContext.Provider value={value}>{children}</CustomTemplateContext.Provider>
  );
}

/**
 * Hook returning the current context. Returns null when no provider is
 * mounted — callers can degrade to "no custom templates" rather than
 * throwing, since the feature is optional.
 */
export function useCustomTemplates(): CustomTemplateContextValue | null {
  return useContext(CustomTemplateContext);
}

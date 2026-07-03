/**
 * useDocCustomThemes — read + persist the active doc's custom themes (the
 * list inlined into the doc's frontmatter under `squisq-custom-themes`).
 *
 * The theme analog of `useDocCustomTemplates`. Both the CustomThemeProvider
 * and any manager surface need the same two things: the current
 * `Doc.customThemes` array and a way to write a new list back into the
 * markdown source. Centralizing the frontmatter encoding here keeps call
 * sites from drifting.
 */

import { useCallback, useMemo } from 'react';
import type { Theme } from '@bendyline/squisq/schemas';
import {
  FRONTMATTER_CUSTOM_THEMES_KEY,
  writeCustomThemesToFrontmatter,
} from '@bendyline/squisq/doc';
import { setFrontmatterValues } from '@bendyline/squisq/markdown';
import { useEditorContext } from '../EditorContext';

export interface DocCustomThemes {
  /** Custom themes inlined in the active doc's frontmatter. */
  docThemes: Theme[];
  /**
   * Persist a new custom-themes list back into the markdown source's
   * frontmatter so the doc round-trips through save/load. The whole list is
   * encoded as a single compact JSON string per the flat YAML frontmatter
   * parser's constraint.
   */
  onDocThemesChange: (next: Theme[]) => void;
}

export function useDocCustomThemes(): DocCustomThemes {
  const { doc, markdownSource, setMarkdownSource } = useEditorContext();
  // Memoized so identity is stable across renders that don't touch
  // frontmatter — keeps the CustomThemeProvider value stable.
  const docThemes = useMemo<Theme[]>(() => doc?.customThemes ?? [], [doc?.customThemes]);
  const onDocThemesChange = useCallback(
    (next: Theme[]) => {
      const payload = writeCustomThemesToFrontmatter(next);
      const updated = setFrontmatterValues(markdownSource, {
        [FRONTMATTER_CUSTOM_THEMES_KEY]: payload ?? null,
      });
      if (updated !== markdownSource) setMarkdownSource(updated);
    },
    [markdownSource, setMarkdownSource],
  );
  return { docThemes, onDocThemesChange };
}

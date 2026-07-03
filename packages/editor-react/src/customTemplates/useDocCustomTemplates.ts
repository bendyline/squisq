/**
 * useDocCustomTemplates — read + persist the active doc's custom
 * templates (the list inlined into the doc's frontmatter under
 * `squisq-custom-templates`).
 *
 * Both the WYSIWYG editor and the standalone Custom Layout Manager need
 * the same two things: the current `Doc.customTemplates` array and a way
 * to write a new list back into the markdown source. Centralizing the
 * frontmatter encoding here keeps the two call sites from drifting.
 */

import { useCallback, useMemo } from 'react';
import type { CustomTemplateDefinition } from '@bendyline/squisq/schemas';
import {
  FRONTMATTER_CUSTOM_TEMPLATES_KEY,
  writeCustomTemplatesToFrontmatter,
} from '@bendyline/squisq/doc';
import { setFrontmatterValues } from '@bendyline/squisq/markdown';
import { useEditorContext } from '../EditorContext';

export interface DocCustomTemplates {
  /** Custom templates inlined in the active doc's frontmatter. */
  docTemplates: CustomTemplateDefinition[];
  /**
   * Persist a new custom-templates list back into the markdown source's
   * frontmatter so the doc round-trips through save/load. The whole list
   * is encoded as a single base64-JSON string per the flat YAML
   * frontmatter parser's constraint.
   */
  onDocTemplatesChange: (next: CustomTemplateDefinition[]) => void;
}

export function useDocCustomTemplates(): DocCustomTemplates {
  const { doc, markdownSource, setMarkdownSource } = useEditorContext();
  // Memoized so identity is stable across renders that don't touch
  // frontmatter — keeps the CustomTemplateProvider value stable.
  const docTemplates = useMemo<CustomTemplateDefinition[]>(
    () => doc?.customTemplates ?? [],
    [doc?.customTemplates],
  );
  const onDocTemplatesChange = useCallback(
    (next: CustomTemplateDefinition[]) => {
      const payload = writeCustomTemplatesToFrontmatter(next);
      const updated = setFrontmatterValues(markdownSource, {
        [FRONTMATTER_CUSTOM_TEMPLATES_KEY]: payload ?? null,
      });
      if (updated !== markdownSource) setMarkdownSource(updated);
    },
    [markdownSource, setMarkdownSource],
  );
  return { docTemplates, onDocTemplatesChange };
}

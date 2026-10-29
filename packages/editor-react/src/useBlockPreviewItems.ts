/**
 * The preview cards both block-preview surfaces draw: the inline gutter beside
 * a wide editor and the navigation sheet's list on a narrow one.
 */

import { useMemo } from 'react';
import type { Block, ViewportConfig } from '@bendyline/squisq/schemas';
import { flattenRenderableBlocks, DEFAULT_THEME } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import { usePreviewSettingsOptional } from './PreviewControls';
import { useEditorContext } from './EditorContext';
import { usePreviewProjection } from './usePreviewProjection';
import { resolveBlockVisual } from './resolveBlockVisual';

export interface BlockPreviewItem {
  id: string;
  template: string;
  headingText: string;
  /** The block as the preview renders it. */
  block: Block;
  /** The block with its source heading and positions, for positioning and navigation. */
  sourceBlock: Block;
}

export function useBlockPreviewItems(viewport: ViewportConfig): BlockPreviewItem[] {
  const { doc, workspaceContainer, fileName, mediaRevision } = useEditorContext();
  const projection = usePreviewProjection(doc, '', workspaceContainer, fileName, mediaRevision);
  const previewDoc = projection?.contentDoc ?? doc;
  // Follow the document's active theme so the mini cards reflect the
  // same palette as the main preview surface. PreviewSettingsProvider
  // resolves this from frontmatter (`squisq-theme` / legacy `theme`)
  // and theme overrides, so we never duplicate that logic here. Falls
  // back to DEFAULT_THEME when mounted outside the provider (defensive —
  // EditorShell always wraps with it).
  const previewSettings = usePreviewSettingsOptional();
  const activeTheme = previewSettings?.activeTheme ?? DEFAULT_THEME;

  // Keep the source block for positioning/navigation: the preview projection
  // intentionally strips source headings while choosing a renderable template.
  return useMemo<BlockPreviewItem[]>(() => {
    if (!previewDoc || !previewDoc.blocks.length) return [];
    const flat = flattenRenderableBlocks(previewDoc.blocks);
    const result: BlockPreviewItem[] = [];

    flat.forEach((block, index) => {
      const visual = resolveBlockVisual(previewDoc, block, activeTheme, viewport, {
        blockIndex: index,
        totalBlocks: flat.length,
      });
      if (!visual) return;
      result.push({
        id: block.id,
        template: visual.template ?? 'content',
        headingText: block.sourceHeading ? extractPlainText(block.sourceHeading) : '',
        block: visual,
        sourceBlock: block,
      });
    });

    return result;
  }, [previewDoc, viewport, activeTheme]);
}

/**
 * resolveBlockVisual — resolves a doc block into a renderable card (with
 * `layers`) via the shared preview pipeline and canonical materializer.
 *
 * Kept in its own module (rather than alongside `BlockThumbnail` in
 * `TimelineBlockPreview.tsx`) so that component file exports only components,
 * which keeps React Fast Refresh working.
 */

import type { Block, DocBlock, Doc, ViewportConfig, Theme } from '@bendyline/squisq/schemas';
import { materializeBlockLayers, type MaterializeBlockLayersOptions } from '@bendyline/squisq/doc';
import { buildPreviewDoc } from './buildPreviewDoc';

/**
 * Resolve a doc block into a renderable card (with `layers`) via the shared
 * preview pipeline, or null when it can't be rendered.
 */
export function resolveBlockVisual(
  doc: Doc,
  block: Block,
  theme: Theme,
  viewport: ViewportConfig,
): Block | null {
  try {
    const slide = buildPreviewDoc({ ...doc, blocks: [block] }).blocks[0] as DocBlock | undefined;
    if (!slide) return null;
    const ctx: MaterializeBlockLayersOptions = {
      blockIndex: 0,
      totalBlocks: 1,
      theme,
      viewport,
      customTemplates: doc.customTemplates,
    };
    const { layers } = materializeBlockLayers(slide, ctx);
    return { ...(slide as unknown as Block), layers };
  } catch {
    return null;
  }
}

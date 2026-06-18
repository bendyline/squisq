/**
 * TimelineBlockPreview
 *
 * Renders a tiny slideshow-style thumbnail of a single block, used to fill each
 * bar on the timeline. Reuses the same rendering path as the inline preview
 * gutter and the slideshow: `buildPreviewDoc` → `getLayers` → `BlockRenderer`.
 */

import { memo } from 'react';
import type {
  Block,
  DocBlock,
  Doc,
  ViewportConfig,
  MediaProvider,
  Theme,
} from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { getLayers, type RenderContext } from '@bendyline/squisq/doc';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
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
    const ctx: RenderContext = { blockIndex: 0, totalBlocks: 1, theme, viewport };
    const layers = getLayers(slide, ctx);
    return { ...(slide as unknown as Block), layers };
  } catch {
    return null;
  }
}

export interface BlockThumbnailProps {
  /** A block already resolved via {@link resolveBlockVisual}. */
  visual: Block;
  viewport?: ViewportConfig;
  basePath?: string;
  mediaProvider?: MediaProvider | null;
}

/**
 * Memoized so the SVG only re-renders when the resolved block changes — keeps
 * the timeline smooth while dragging (where bar geometry updates every frame).
 */
export const BlockThumbnail = memo(function BlockThumbnail({
  visual,
  viewport = VIEWPORT_PRESETS.landscape,
  basePath = '/',
  mediaProvider = null,
}: BlockThumbnailProps) {
  return (
    <MediaContext.Provider value={mediaProvider}>
      <BlockRenderer block={visual} blockTime={0} basePath={basePath} viewport={viewport} />
    </MediaContext.Provider>
  );
});

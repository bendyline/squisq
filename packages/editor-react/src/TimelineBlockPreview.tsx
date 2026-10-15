/**
 * TimelineBlockPreview
 *
 * Renders a tiny slideshow-style thumbnail of a single block, used to fill each
 * bar on the timeline. Reuses the same rendering path as the inline preview
 * gutter and the slideshow: `buildPreviewDoc` → `materializeBlockLayers` → `BlockRenderer`.
 */

import { memo } from 'react';
import type { Block, ViewportConfig, MediaProvider, BuildCursor } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';

export interface BlockThumbnailProps {
  buildPlayback?: 'all' | BuildCursor;
  /** A block already resolved via `resolveBlockVisual`. */
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
  buildPlayback = 'all',
  viewport = VIEWPORT_PRESETS.landscape,
  basePath = '/',
  mediaProvider = null,
}: BlockThumbnailProps) {
  return (
    <MediaContext.Provider value={mediaProvider}>
      <BlockRenderer
        buildPlayback={buildPlayback}
        block={visual}
        blockTime={0}
        basePath={basePath}
        viewport={viewport}
      />
    </MediaContext.Provider>
  );
});

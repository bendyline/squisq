/**
 * BlockRenderer Component
 *
 * Renders a single block as an SVG element with all its layers.
 * Each layer is rendered back-to-front (first layer is background).
 * Handles positioning, animations, and transitions.
 */

import type { Block, Layer } from '@bendyline/prodcore/schemas';
import { ImageLayer } from './layers/ImageLayer';
import { TextLayer } from './layers/TextLayer';
import { ShapeLayer } from './layers/ShapeLayer';
import { MapLayer } from './layers/MapLayer';
import { VideoLayer } from './layers/VideoLayer';
import { getTransitionClass } from './utils/animationUtils';

/** Default viewport dimensions (1080p landscape) - for backwards compatibility */
export const VIEWPORT = {
  width: 1920,
  height: 1080,
};

/** Viewport configuration type */
export interface ViewportDimensions {
  width: number;
  height: number;
}

interface BlockRendererProps {
  /** The block to render */
  block: Block;
  /** Current time relative to block start (seconds) */
  blockTime: number;
  /** Base path for resolving media URLs */
  basePath: string;
  /** Whether this block is entering (for transition) */
  isEntering?: boolean;
  /** Whether this block is exiting (for transition) */
  isExiting?: boolean;
  /** Viewport dimensions (defaults to 1920x1080 landscape) */
  viewport?: ViewportDimensions;
  /** Whether the doc is currently playing (controls video playback) */
  isPlaying?: boolean;
}

export function BlockRenderer({
  block,
  blockTime,
  basePath,
  isEntering = false,
  isExiting = false,
  viewport = VIEWPORT,
  isPlaying,
}: BlockRendererProps) {
  // Build transition class and inline style for dynamic duration
  let transitionClass = '';
  const transitionStyle: Record<string, string> = {};
  if (block.transition && isEntering) {
    transitionClass = getTransitionClass(block.transition.type, true);
    transitionStyle['--transition-duration'] = `${block.transition.duration}s`;
  } else if (block.transition && isExiting) {
    transitionClass = getTransitionClass(block.transition.type, false);
    transitionStyle['--transition-duration'] = `${block.transition.duration}s`;
  }

  // Unique clip path ID per block to avoid conflicts when multiple blocks render simultaneously
  const clipId = `vb-clip-${block.id}`;

  return (
    <svg
      className={`block-svg ${transitionClass}`}
      style={transitionStyle}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="hidden"
      data-block-id={block.id}
    >
      {/* Clip path matching the viewBox -- prevents Ken Burns animations from
          bleeding outside the block area (foreignObject + transform: scale
          can escape SVG overflow="hidden" in some browsers) */}
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={viewport.width} height={viewport.height} />
        </clipPath>
      </defs>

      {/* All layers clipped to viewBox bounds */}
      <g clipPath={`url(#${clipId})`}>
        {block.layers.map((layer) => (
          <LayerRenderer
            key={layer.id}
            layer={layer}
            basePath={basePath}
            viewport={viewport}
            blockTime={blockTime}
            isPlaying={isPlaying}
          />
        ))}
      </g>
    </svg>
  );
}

interface LayerRendererProps {
  layer: Layer;
  basePath: string;
  viewport: { width: number; height: number };
  blockTime: number;
  isPlaying?: boolean;
}

/**
 * Dispatch to the appropriate layer component based on type.
 */
function LayerRenderer({ layer, basePath, viewport, blockTime, isPlaying }: LayerRendererProps) {
  switch (layer.type) {
    case 'image':
      return (
        <ImageLayer
          layer={layer}
          basePath={basePath}
          viewport={viewport}
          blockTime={blockTime}
        />
      );
    case 'text':
      return (
        <TextLayer
          layer={layer}
          viewport={viewport}
          blockTime={blockTime}
        />
      );
    case 'shape':
      return (
        <ShapeLayer
          layer={layer}
          viewport={viewport}
          blockTime={blockTime}
        />
      );
    case 'map':
      return (
        <MapLayer
          layer={layer}
          basePath={basePath}
          viewport={viewport}
          blockTime={blockTime}
        />
      );
    case 'video':
      return (
        <VideoLayer
          layer={layer}
          basePath={basePath}
          viewport={viewport}
          blockTime={blockTime}
          isPlaying={isPlaying}
        />
      );
    default:
      console.warn(`Unknown layer type: ${(layer as Layer).type}`);
      return null;
  }
}

export default BlockRenderer;
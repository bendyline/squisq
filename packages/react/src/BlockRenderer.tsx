/**
 * BlockRenderer Component
 *
 * Renders a single block as an SVG element with all its layers.
 * Each layer is rendered back-to-front (first layer is background).
 * Handles positioning, animations, and transitions.
 */

import { useId } from 'react';
import type { Block, Layer, Theme, Transition } from '@bendyline/squisq/schemas';
import { resolveTransitionDuration } from '@bendyline/squisq/schemas';
import { ImageLayer } from './layers/ImageLayer';
import { TextLayer } from './layers/TextLayer';
import { ShapeLayer } from './layers/ShapeLayer';
import { PathLayer } from './layers/PathLayer';
import { MapLayer } from './layers/MapLayer';
import { VideoLayer } from './layers/VideoLayer';
import { TableLayer } from './layers/TableLayer';
import { TreeLayer } from './layers/TreeLayer';
import { MermaidLayer } from './layers/MermaidLayer';
import { getTransitionClass } from './utils/animationUtils';

/** Default viewport dimensions (1080p landscape). */
const DEFAULT_VIEWPORT = {
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
  /** Transition to apply. Defaults to block.transition. */
  transition?: Transition;
  /** Viewport dimensions (defaults to 1920x1080 landscape) */
  viewport?: ViewportDimensions;
  /** Whether the doc is currently playing (controls video playback) */
  isPlaying?: boolean;
  /**
   * Whether to render block transitions and layer animations (default: true).
   * Disabling this only removes authored/render-style motion; timed video
   * layers continue to advance normally.
   */
  animationsEnabled?: boolean;
  /** Resolved theme inherited by rich-media renderers such as Mermaid. */
  theme?: Theme;
}

export function BlockRenderer({
  block,
  blockTime,
  basePath,
  isEntering = false,
  isExiting = false,
  transition,
  viewport = DEFAULT_VIEWPORT,
  isPlaying,
  animationsEnabled = true,
  theme,
}: BlockRendererProps) {
  // Build transition class and inline style for dynamic duration
  let transitionClass = '';
  const transitionStyle: Record<string, string> = {};
  const activeTransition = animationsEnabled ? (transition ?? block.transition) : undefined;
  if (activeTransition && isEntering) {
    transitionClass = getTransitionClass(activeTransition.type, true, activeTransition.direction);
    transitionStyle['--transition-duration'] = `${resolveTransitionDuration(activeTransition)}s`;
  } else if (activeTransition && isExiting) {
    transitionClass = getTransitionClass(activeTransition.type, false, activeTransition.direction);
    transitionStyle['--transition-duration'] = `${resolveTransitionDuration(activeTransition)}s`;
  }

  // React's instance id keeps SVG fragment references local even when the
  // same block is rendered in a thumbnail, preview, and player at once.
  const instanceId = useId().replace(/:/g, '');
  const clipId = `vb-clip-${instanceId}-${block.id}`;

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
        {(block.layers ?? []).map((layer) => (
          <LayerRenderer
            key={layer.id}
            layer={layer}
            basePath={basePath}
            viewport={viewport}
            blockTime={blockTime}
            isPlaying={isPlaying}
            animationsEnabled={animationsEnabled}
            theme={theme}
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
  animationsEnabled: boolean;
  theme?: Theme;
}

/**
 * Dispatch to the appropriate layer component based on type.
 */
function LayerRenderer({
  layer,
  basePath,
  viewport,
  blockTime,
  isPlaying,
  animationsEnabled,
  theme,
}: LayerRendererProps) {
  // Render policy must not mutate caller-owned Docs. A shallow copy is enough:
  // every layer renderer reads animation only from the base layer field.
  const renderedLayer: Layer =
    animationsEnabled || !layer.animation ? layer : { ...layer, animation: undefined };

  switch (renderedLayer.type) {
    case 'image':
      return (
        <ImageLayer
          layer={renderedLayer}
          basePath={basePath}
          viewport={viewport}
          blockTime={blockTime}
          animationsEnabled={animationsEnabled}
        />
      );
    case 'text':
      return <TextLayer layer={renderedLayer} viewport={viewport} blockTime={blockTime} />;
    case 'shape':
      return <ShapeLayer layer={renderedLayer} viewport={viewport} blockTime={blockTime} />;
    case 'path':
      return <PathLayer layer={renderedLayer} viewport={viewport} blockTime={blockTime} />;
    case 'map':
      return (
        <MapLayer
          layer={renderedLayer}
          basePath={basePath}
          viewport={viewport}
          blockTime={blockTime}
        />
      );
    case 'video':
      return (
        <VideoLayer
          layer={renderedLayer}
          basePath={basePath}
          viewport={viewport}
          blockTime={blockTime}
          isPlaying={isPlaying}
        />
      );
    case 'table':
      return <TableLayer layer={renderedLayer} viewport={viewport} blockTime={blockTime} />;
    case 'tree':
      return <TreeLayer layer={renderedLayer} viewport={viewport} blockTime={blockTime} />;
    case 'mermaid':
      return (
        <MermaidLayer
          layer={renderedLayer}
          viewport={viewport}
          blockTime={blockTime}
          theme={theme}
        />
      );
    default:
      console.warn(`Unknown layer type: ${(renderedLayer as Layer).type}`);
      return null;
  }
}

export default BlockRenderer;

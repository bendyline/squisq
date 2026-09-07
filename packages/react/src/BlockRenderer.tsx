/**
 * BlockRenderer Component
 *
 * Renders a single block as an SVG element with all its layers.
 * Each layer is rendered back-to-front (first layer is background).
 * Handles positioning, animations, and transitions.
 */

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Block, Layer, Theme, Transition } from '@bendyline/squisq/schemas';
import { resolveTransitionDuration } from '@bendyline/squisq/schemas';
import { ImageLayer } from './layers/ImageLayer';
import { TextLayer } from './layers/TextLayer';
import { ShapeLayer } from './layers/ShapeLayer';
import { PathLayer } from './layers/PathLayer';
import { MapLayer } from './layers/MapLayer';
import { VideoLayer } from './layers/VideoLayer';
import { TableLayer } from './layers/TableLayer';
import type { TableLayerContentRenderer } from './layers/TableLayer';
import { TreeLayer } from './layers/TreeLayer';
import { MermaidLayer } from './layers/MermaidLayer';
import { getTransitionClass } from './utils/animationUtils';
import { largestFittingTextScale } from './utils/textFit';

/** Default viewport dimensions (1080p landscape). */
const DEFAULT_VIEWPORT = {
  width: 1920,
  height: 1080,
};

const FIT_TOLERANCE_PX = 1;

type TextFitTarget = HTMLElement | SVGGElement;

function applyTextScale(targets: readonly TextFitTarget[], scale: number): void {
  for (const target of targets) {
    if (target.dataset.squisqTextFit === 'html') {
      const baseFontSize = Number(target.dataset.squisqBaseFontSize);
      if (Number.isFinite(baseFontSize)) target.style.fontSize = `${baseFontSize * scale}px`;
    } else {
      target.style.transform = `scale(${scale})`;
    }
  }
}

function cssPixels(value: string): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function htmlTargetFits(target: HTMLElement): boolean {
  const content = target.querySelector<HTMLElement>('[data-squisq-text-content="true"]');
  if (!content || content.scrollWidth <= 0 || content.scrollHeight <= 0) return false;

  const view = target.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(target);
  const horizontalInset = computed
    ? cssPixels(computed.paddingLeft) +
      cssPixels(computed.paddingRight) +
      cssPixels(computed.borderLeftWidth) +
      cssPixels(computed.borderRightWidth)
    : 0;
  const verticalInset = computed
    ? cssPixels(computed.paddingTop) +
      cssPixels(computed.paddingBottom) +
      cssPixels(computed.borderTopWidth) +
      cssPixels(computed.borderBottomWidth)
    : 0;
  const availableWidth = Math.max(0, target.clientWidth - horizontalInset);
  const availableHeight = Math.max(0, target.clientHeight - verticalInset);
  if (
    content.scrollWidth > availableWidth + FIT_TOLERANCE_PX ||
    content.scrollHeight > availableHeight + FIT_TOLERANCE_PX
  ) {
    return false;
  }

  // A bounded table scrollbar means some authored cells are no longer all
  // visible together, so it also limits the shared slide scale.
  for (const scrollRegion of content.querySelectorAll<HTMLElement>('[data-squisq-table-scroll]')) {
    if (
      (scrollRegion.clientWidth > 0 &&
        scrollRegion.scrollWidth > scrollRegion.clientWidth + FIT_TOLERANCE_PX) ||
      (scrollRegion.clientHeight > 0 &&
        scrollRegion.scrollHeight > scrollRegion.clientHeight + FIT_TOLERANCE_PX)
    ) {
      return false;
    }
  }
  return true;
}

function svgTargetFits(target: SVGGElement, scale: number): boolean {
  const content = target.querySelector<SVGGraphicsElement>('[data-squisq-text-content="true"]');
  if (!content || typeof content.getBBox !== 'function') return false;
  try {
    const box = content.getBBox();
    const availableWidth = Number(target.dataset.squisqFitWidth);
    const availableHeight = Number(target.dataset.squisqFitHeight);
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.width * scale <= availableWidth + FIT_TOLERANCE_PX &&
      box.height * scale <= availableHeight + FIT_TOLERANCE_PX
    );
  } catch {
    return false;
  }
}

function renderedTextRects(targets: readonly TextFitTarget[]): DOMRect[] {
  return targets
    .map((target) =>
      target.querySelector<Element>('[data-squisq-text-content="true"]')?.getBoundingClientRect(),
    )
    .filter((rect): rect is DOMRect => !!rect && rect.width > 0 && rect.height > 0);
}

function overlapPairs(rects: readonly DOMRect[]): Set<string> {
  const pairs = new Set<string>();
  for (let left = 0; left < rects.length; left += 1) {
    for (let right = left + 1; right < rects.length; right += 1) {
      const a = rects[left]!;
      const b = rects[right]!;
      if (
        a.left < b.right - FIT_TOLERANCE_PX &&
        a.right > b.left + FIT_TOLERANCE_PX &&
        a.top < b.bottom - FIT_TOLERANCE_PX &&
        a.bottom > b.top + FIT_TOLERANCE_PX
      ) {
        pairs.add(`${left}:${right}`);
      }
    }
  }
  return pairs;
}

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
  /** Silence audio carried by video layers. */
  muted?: boolean;
  /**
   * Whether to render block transitions and layer animations (default: true).
   * Disabling this only removes authored/render-style motion; timed video
   * layers continue to advance normally.
   */
  animationsEnabled?: boolean;
  /** Resolved theme inherited by rich-media renderers such as Mermaid. */
  theme?: Theme;
  /** Optional host renderer for interactive table content. */
  tableContentRenderer?: TableLayerContentRenderer;
  /** Grow all slide text by one shared factor without overflow or new overlap. */
  growTextToFit?: boolean;
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
  muted = false,
  animationsEnabled = true,
  theme,
  tableContentRenderer,
  growTextToFit = false,
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [textScale, setTextScale] = useState(1);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    let cancelled = false;
    if (!svg) return;

    const measure = (): void => {
      if (cancelled) return;
      const targets = Array.from(svg.querySelectorAll<TextFitTarget>('[data-squisq-text-fit]'));
      if (!growTextToFit || targets.length === 0) {
        applyTextScale(targets, 1);
        setTextScale(1);
        return;
      }

      // Existing overlaps are part of the authored layout. A larger candidate
      // is rejected only when it introduces an additional collision.
      applyTextScale(targets, 1);
      const baselineOverlaps = overlapPairs(renderedTextRects(targets));
      const fits = (scale: number): boolean => {
        applyTextScale(targets, scale);
        if (
          targets.some((target) =>
            target.dataset.squisqTextFit === 'html'
              ? !htmlTargetFits(target as HTMLElement)
              : !svgTargetFits(target as SVGGElement, scale),
          )
        ) {
          return false;
        }

        const candidateOverlaps = overlapPairs(renderedTextRects(targets));
        for (const pair of candidateOverlaps) {
          if (!baselineOverlaps.has(pair)) return false;
        }
        return true;
      };

      const nextScale = largestFittingTextScale(fits);
      applyTextScale(targets, nextScale);
      setTextScale((current) => (current === nextScale ? current : nextScale));
    };

    measure();
    // Re-evaluate once webfonts have their final glyph metrics; otherwise a
    // fallback face can approve a scale that the designed face cannot hold.
    const fonts = svg.ownerDocument?.fonts;
    if (fonts && fonts.status !== 'loaded') void fonts.ready.then(measure);

    return () => {
      cancelled = true;
    };
  }, [block.layers, growTextToFit, viewport.height, viewport.width]);

  return (
    <svg
      ref={svgRef}
      className={`block-svg ${transitionClass}`}
      style={transitionStyle}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="hidden"
      data-block-id={block.id}
      data-squisq-text-scale={growTextToFit ? textScale : undefined}
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
            block={block}
            layer={layer}
            basePath={basePath}
            viewport={viewport}
            blockTime={blockTime}
            isPlaying={isPlaying}
            muted={muted}
            animationsEnabled={animationsEnabled}
            theme={theme}
            tableContentRenderer={tableContentRenderer}
            textScale={textScale}
          />
        ))}
      </g>
    </svg>
  );
}

interface LayerRendererProps {
  block: Block;
  layer: Layer;
  basePath: string;
  viewport: { width: number; height: number };
  blockTime: number;
  isPlaying?: boolean;
  muted: boolean;
  animationsEnabled: boolean;
  theme?: Theme;
  tableContentRenderer?: TableLayerContentRenderer;
  textScale: number;
}

/**
 * Dispatch to the appropriate layer component based on type.
 */
function LayerRenderer({
  block,
  layer,
  basePath,
  viewport,
  blockTime,
  isPlaying,
  muted,
  animationsEnabled,
  theme,
  tableContentRenderer,
  textScale,
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
      return (
        <TextLayer
          layer={renderedLayer}
          viewport={viewport}
          blockTime={blockTime}
          textScale={textScale}
        />
      );
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
          muted={muted}
        />
      );
    case 'table':
      return (
        <TableLayer
          block={block}
          layer={renderedLayer}
          viewport={viewport}
          blockTime={blockTime}
          contentRenderer={tableContentRenderer}
        />
      );
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

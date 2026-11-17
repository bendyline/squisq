/**
 * foreignObjectPlacement
 *
 * Where WebKit actually paints a composited element inside a slide's
 * `<foreignObject>`. It ignores the slide SVG's viewBox transform for such an
 * element (see foreignObjectPaint.ts): the foreignObject's x/y/width/height,
 * which are slide units, are read as CSS pixels from the top-left of the
 * `<svg>` element's box — no scale, and no letterbox offset. A `<video>` is
 * always composited, so a slide's video drew at full canvas size from the
 * frame's corner, over everything else.
 *
 * `useForeignObjectScreenPlacement` measures the slide's scale and letterbox
 * offset so a layer can give its foreignObject the on-screen box instead.
 * WebKit hit-tests that element where it paints it, so native controls stay
 * under the finger. Every other engine gets null and keeps the slide-unit box.
 *
 * Measurement uses the SVG element's own layout box and viewBox rather than
 * `getScreenCTM()`: WebKit does apply CSS transforms on the slide's HTML
 * ancestors (a player's fit scale, a swipe transition) to the element, and
 * the CTM would count them twice.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';
import { paintsForeignObjectLayersUnscaled } from './foreignObjectPaint';

/** Slide units → CSS px within the `<svg>` element's box: `css = offset + unit * scale`. */
export interface ForeignObjectScreenPlacement {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** The meet-fit placement of `svg`'s viewBox in its box, or null when it cannot be read. */
export function measureSlidePlacement(svg: SVGSVGElement): ForeignObjectScreenPlacement | null {
  const viewBox = svg.viewBox?.baseVal;
  const width = svg.clientWidth;
  const height = svg.clientHeight;
  if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0 || width <= 0 || height <= 0) {
    return null;
  }
  const align = svg.preserveAspectRatio?.baseVal;
  // Slides draw `xMidYMid meet` (BlockRenderer); anything else is left alone.
  if (
    align &&
    (align.align !== align.SVG_PRESERVEASPECTRATIO_XMIDYMID ||
      align.meetOrSlice !== align.SVG_MEETORSLICE_MEET)
  ) {
    return null;
  }
  const scale = Math.min(width / viewBox.width, height / viewBox.height);
  return {
    scale,
    offsetX: (width - viewBox.width * scale) / 2 - viewBox.x * scale,
    offsetY: (height - viewBox.height * scale) / 2 - viewBox.y * scale,
  };
}

/**
 * The on-screen placement for a composited element inside `ref`'s
 * foreignObject, on engines that paint it unscaled; null elsewhere, when
 * `enabled` is false, or until the slide has a size.
 */
export function useForeignObjectScreenPlacement(
  ref: RefObject<SVGForeignObjectElement | null>,
  enabled: boolean,
): ForeignObjectScreenPlacement | null {
  const [placement, setPlacement] = useState<ForeignObjectScreenPlacement | null>(null);
  const active = enabled && paintsForeignObjectLayersUnscaled();

  useLayoutEffect(() => {
    const svg = ref.current?.ownerSVGElement;
    if (!active || !svg) {
      setPlacement(null);
      return;
    }
    const measure = (): void => {
      const next = measureSlidePlacement(svg);
      setPlacement((current) =>
        current &&
        next &&
        current.scale === next.scale &&
        current.offsetX === next.offsetX &&
        current.offsetY === next.offsetY
          ? current
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [active, ref]);

  return placement;
}

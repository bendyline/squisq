/**
 * Pan and zoom as plain math: a transform `{ tx, ty, scale }` maps drawing
 * units to screen pixels (`screen = drawing * scale + t`). Pure, so the
 * viewer and its tests share one definition of fitting and zooming.
 */

export interface ViewTransform {
  tx: number;
  ty: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_VIEW_SCALE = 0.02;
export const MAX_VIEW_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
}

/** Zoom by `factor`, keeping the drawing point under screen point (`fx`, `fy`) still. */
export function zoomAt(t: ViewTransform, factor: number, fx: number, fy: number): ViewTransform {
  const scale = clampScale(t.scale * factor);
  const k = scale / t.scale;
  return { tx: fx - (fx - t.tx) * k, ty: fy - (fy - t.ty) * k, scale };
}

/** The transform that centers `box` in `size`, as large as fits within `maxScale`. */
export function fitTransform(
  box: { x: number; y: number; width: number; height: number },
  size: Size,
  padding = 24,
  maxScale = 1.5,
): ViewTransform {
  const availW = Math.max(1, size.width - padding * 2);
  const availH = Math.max(1, size.height - padding * 2);
  const scale =
    box.width <= 0 || box.height <= 0
      ? clampScale(maxScale)
      : clampScale(Math.min(maxScale, availW / box.width, availH / box.height));
  return {
    tx: (size.width - box.width * scale) / 2 - box.x * scale,
    ty: (size.height - box.height * scale) / 2 - box.y * scale,
    scale,
  };
}

/** The part of the drawing the screen shows. */
export function visibleRect(
  t: ViewTransform,
  size: Size,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: -t.tx / t.scale,
    y0: -t.ty / t.scale,
    x1: (size.width - t.tx) / t.scale,
    y1: (size.height - t.ty) / t.scale,
  };
}

/** Pan the least distance that brings `box` fully into view (with `margin`), keeping the scale. */
export function revealTransform(
  t: ViewTransform,
  box: { x: number; y: number; width: number; height: number },
  size: Size,
  margin = 24,
): ViewTransform {
  const left = box.x * t.scale + t.tx;
  const top = box.y * t.scale + t.ty;
  const right = left + box.width * t.scale;
  const bottom = top + box.height * t.scale;
  const shift = (lo: number, hi: number, extent: number): number => {
    if (hi - lo > extent - margin * 2) return extent / 2 - (lo + hi) / 2;
    if (lo < margin) return margin - lo;
    if (hi > extent - margin) return extent - margin - hi;
    return 0;
  };
  return {
    tx: t.tx + shift(left, right, size.width),
    ty: t.ty + shift(top, bottom, size.height),
    scale: t.scale,
  };
}

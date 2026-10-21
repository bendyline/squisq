/**
 * Canvas → slide geometry for layer export: layers are authored on the
 * player's 1920×1080 canvas, and PresentationML places shapes in EMU.
 */

import type { Position } from '@bendyline/squisq/schemas';
import type { EmuRect } from './pictureLayers.js';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './styles.js';

/** A rectangle on the 1920×1080 canvas, in canvas px. */
export interface LayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One canvas px in EMU (the 1920px canvas spans the slide width). */
export const EMU_PER_CANVAS_PX = SLIDE_WIDTH / 1920;

export function resolvePositionValue(
  value: number | string | undefined,
  dimension: number,
): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.endsWith('%')) {
      const percent = Number.parseFloat(trimmed);
      if (Number.isFinite(percent)) return (percent / 100) * dimension;
    }
    const numeric = Number.parseFloat(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

export function resolveLayerRect(
  position: Position,
  defaultWidth: number,
  defaultHeight: number,
): LayerRect {
  const width = Math.max(
    1,
    position.width != null ? resolvePositionValue(position.width, 1920) : defaultWidth,
  );
  const height = Math.max(
    1,
    position.height != null ? resolvePositionValue(position.height, 1080) : defaultHeight,
  );
  let x = resolvePositionValue(position.x, 1920);
  let y = resolvePositionValue(position.y, 1080);
  const anchor = position.anchor ?? 'top-left';
  if (anchor === 'center') {
    x -= width / 2;
    y -= height / 2;
  } else {
    if (anchor.endsWith('right')) x -= width;
    if (anchor.startsWith('bottom')) y -= height;
  }
  // BlockRenderer clips the complete layer stack to the 1920x1080 viewBox.
  // Native PowerPoint shapes are not implicitly clipped, so trim their boxes
  // to that same canvas instead of letting long text create off-slide content.
  const clippedX = Math.min(1919, Math.max(0, x));
  const clippedY = Math.min(1079, Math.max(0, y));
  const clippedWidth = Math.max(1, Math.min(width - (clippedX - x), 1920 - clippedX));
  const clippedHeight = Math.max(1, Math.min(height - (clippedY - y), 1080 - clippedY));
  return { x: clippedX, y: clippedY, width: clippedWidth, height: clippedHeight };
}

export function toEmuRect(rect: LayerRect): EmuRect {
  return {
    x: Math.round((rect.x / 1920) * SLIDE_WIDTH),
    y: Math.round((rect.y / 1080) * SLIDE_HEIGHT),
    width: Math.max(1, Math.round((rect.width / 1920) * SLIDE_WIDTH)),
    height: Math.max(1, Math.round((rect.height / 1080) * SLIDE_HEIGHT)),
  };
}

/**
 * Where the inline text editor sits on screen, and the scale its text renders
 * at.
 *
 * The editor normally covers the edited layer's on-screen box exactly, with
 * text at the layer's size times the canvas zoom. Zoomed out on a phone that
 * text drops to a few pixels, too small to read or edit, and iOS zooms the
 * page into anything under 16px that takes focus. A minimum font size
 * magnifies the editor instead: it becomes a larger copy of the layer's box,
 * centered on it and kept inside the canvas. The drawing itself stays at its
 * zoom.
 */

/** The smallest on-screen text the editor uses on a touch screen. */
export const TOUCH_MIN_EDIT_FONT_PX = 16;

export interface SceneTextFrameInput {
  /** Screen position of the layer box's top-left corner. */
  origin: { x: number; y: number };
  /** The layer box in viewport units. */
  size: { width: number; height: number };
  /** Canvas zoom (screen pixels per viewport unit). */
  zoom: number;
  /** The text's size in viewport units. */
  fontSize: number;
  /** Smallest on-screen font size in pixels; 0 for none. */
  minFontPx: number;
  /** The canvas's on-screen size, which a magnified editor stays inside. */
  container: { width: number; height: number } | null;
}

export interface SceneTextFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Screen pixels per viewport unit for the editor's text and padding. */
  scale: number;
}

export function sceneTextFrame({
  origin,
  size,
  zoom,
  fontSize,
  minFontPx,
  container,
}: SceneTextFrameInput): SceneTextFrame {
  const scale = fontSize > 0 && minFontPx > 0 ? Math.max(zoom, minFontPx / fontSize) : zoom;
  if (scale === zoom) {
    return {
      left: origin.x,
      top: origin.y,
      width: size.width * zoom,
      height: size.height * zoom,
      scale,
    };
  }

  // Magnified: grow about the layer's center, then pull back inside the canvas.
  let width = size.width * scale;
  let height = size.height * scale;
  let left = origin.x + (size.width * zoom - width) / 2;
  let top = origin.y + (size.height * zoom - height) / 2;
  if (container && container.width > 0 && container.height > 0) {
    width = Math.min(width, container.width);
    height = Math.min(height, container.height);
    left = Math.min(Math.max(left, 0), container.width - width);
    top = Math.min(Math.max(top, 0), container.height - height);
  }
  return { left, top, width, height, scale };
}

/** The floor for the current device: touch screens get one, mice don't. */
export function editFontFloorPx(): number {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 0;
  return window.matchMedia('(pointer: coarse)').matches ? TOUCH_MIN_EDIT_FONT_PX : 0;
}

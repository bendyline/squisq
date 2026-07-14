/**
 * useScenePanZoom — transient viewport pan/zoom state for the Scene.
 *
 * State is a simple affine transform `{ tx, ty, scale }` that maps
 * viewport units → screen pixels. The Scene's root `<svg>` applies the
 * transform via a single `<g transform="translate(tx ty) scale(scale)">`
 * so every layer renders at its natural viewport coordinates and the
 * group transform handles all pan/zoom.
 *
 * The hook only owns state and a small command surface — DOM event
 * binding is done by the Scene component so tests can drive the hook
 * with synthetic transforms without a DOM.
 */

import { useCallback, useRef, useState } from 'react';
import { calculateFitScale } from '../fitScale';

export interface SceneTransform {
  /** Translation in screen pixels. */
  tx: number;
  ty: number;
  /** Uniform scale factor. 1 = viewport units render 1:1 with screen pixels. */
  scale: number;
}

export const IDENTITY_TRANSFORM: SceneTransform = Object.freeze({ tx: 0, ty: 0, scale: 1 });

/** Clamp scale to a sensible range so a single accidental wheel doesn't escape. */
const MIN_SCALE = 0.02;
const MAX_SCALE = 8;

export interface UseScenePanZoomResult {
  transform: SceneTransform;
  /** Replace the transform wholesale. */
  setTransform: (t: SceneTransform) => void;
  /** Pan by a screen-pixel delta. */
  panBy: (dx: number, dy: number) => void;
  /**
   * Zoom toward a point in screen-pixel coordinates (relative to the
   * scene's container origin). Scale multiplies by `factor`; positive
   * factor > 1 zooms in, < 1 zooms out. The viewport point under
   * `(focusX, focusY)` stays put after the zoom.
   */
  zoomAt: (factor: number, focusX: number, focusY: number) => void;
  /** Reset to identity. */
  reset: () => void;
  /**
   * Fit a viewport-unit bounding box into a container of `containerSize`
   * screen pixels, with optional padding (also in screen pixels) and an
   * optional maximum scale. When the box is empty, no-ops.
   */
  fitBox: (
    box: { x: number; y: number; width: number; height: number },
    containerSize: { width: number; height: number },
    padding?: number,
    maxScale?: number,
  ) => void;
  /** Convert a screen-pixel point (container-relative) → viewport units. */
  screenToViewport: (sx: number, sy: number) => { x: number; y: number };
  /** Convert a viewport-unit point → screen pixels (container-relative). */
  viewportToScreen: (vx: number, vy: number) => { x: number; y: number };
}

export function useScenePanZoom(
  initial: SceneTransform = IDENTITY_TRANSFORM,
): UseScenePanZoomResult {
  const [transform, setTransformState] = useState<SceneTransform>(initial);
  // Keep a ref so commands batching multiple updates in the same tick see
  // the latest state without waiting for a render cycle.
  const ref = useRef(transform);
  ref.current = transform;

  const setTransform = useCallback((t: SceneTransform) => {
    ref.current = t;
    setTransformState(t);
  }, []);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const t = ref.current;
      setTransform({ tx: t.tx + dx, ty: t.ty + dy, scale: t.scale });
    },
    [setTransform],
  );

  const zoomAt = useCallback(
    (factor: number, focusX: number, focusY: number) => {
      const t = ref.current;
      const nextScale = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE);
      const effectiveFactor = nextScale / t.scale;
      // Keep the viewport point under (focusX, focusY) stationary:
      //   focus_v = (focus_s - tx) / scale
      //   tx' = focus_s - focus_v * scale'
      //       = focus_s - (focus_s - tx) * (scale' / scale)
      const tx = focusX - (focusX - t.tx) * effectiveFactor;
      const ty = focusY - (focusY - t.ty) * effectiveFactor;
      setTransform({ tx, ty, scale: nextScale });
    },
    [setTransform],
  );

  const reset = useCallback(() => setTransform(IDENTITY_TRANSFORM), [setTransform]);

  const fitBox = useCallback(
    (
      box: { x: number; y: number; width: number; height: number },
      containerSize: { width: number; height: number },
      padding = 24,
      maxScale = MAX_SCALE,
    ) => {
      if (box.width <= 0 || box.height <= 0) return;
      if (containerSize.width <= 0 || containerSize.height <= 0) return;
      const availW = Math.max(1, containerSize.width - padding * 2);
      const availH = Math.max(1, containerSize.height - padding * 2);
      const scale = calculateFitScale(
        { width: box.width, height: box.height },
        { width: availW, height: availH },
        Math.min(MAX_SCALE, Math.max(Number.EPSILON, maxScale)),
      );
      // Center the box in the container.
      const scaledW = box.width * scale;
      const scaledH = box.height * scale;
      const tx = (containerSize.width - scaledW) / 2 - box.x * scale;
      const ty = (containerSize.height - scaledH) / 2 - box.y * scale;
      setTransform({ tx, ty, scale });
    },
    [setTransform],
  );

  const screenToViewport = useCallback((sx: number, sy: number) => {
    const t = ref.current;
    return { x: (sx - t.tx) / t.scale, y: (sy - t.ty) / t.scale };
  }, []);

  const viewportToScreen = useCallback((vx: number, vy: number) => {
    const t = ref.current;
    return { x: vx * t.scale + t.tx, y: vy * t.scale + t.ty };
  }, []);

  return {
    transform,
    setTransform,
    panBy,
    zoomAt,
    reset,
    fitBox,
    screenToViewport,
    viewportToScreen,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

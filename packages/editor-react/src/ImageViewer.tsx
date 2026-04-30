/**
 * ImageViewer
 *
 * Read-only image viewer used when EditorShell runs in `image` file mode
 * (PNG/JPEG/etc.). Renders a centered image that fits its container with
 * a small overlay toolbar for fit / 100% / zoom in / zoom out, and a
 * status row showing intrinsic dimensions and current zoom.
 *
 * Lifecycle of the `src` URL is the caller's responsibility — when fed a
 * blob URL, the host should `URL.revokeObjectURL` on unmount or src change.
 *
 * Future image-editing actions (rotate, flip, crop) will slot in alongside
 * the existing zoom controls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';

export interface ImageViewerProps {
  /** Image source — typically a blob: URL the host owns and revokes. */
  src: string;
  /** Alt text for accessibility. Defaults to empty string (decorative). */
  alt?: string;
  /** Additional class name on the outer container. */
  className?: string;
  /** Color theme for the chrome around the image. */
  theme?: 'light' | 'dark';
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 16;
const ZOOM_STEP = 1.25;

type FitState = { mode: 'fit' } | { mode: 'manual'; zoom: number };

export function ImageViewer({ src, alt = '', className, theme = 'light' }: ImageViewerProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [fitZoom, setFitZoom] = useState<number>(1);
  const [state, setState] = useState<FitState>({ mode: 'fit' });
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNaturalSize(null);
    setState({ mode: 'fit' });
    setPan({ x: 0, y: 0 });
    setError(null);
  }, [src]);

  const recomputeFitZoom = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !naturalSize) return;
    const { clientWidth, clientHeight } = stage;
    if (clientWidth === 0 || clientHeight === 0) return;
    const fit = Math.min(clientWidth / naturalSize.w, clientHeight / naturalSize.h, 1);
    setFitZoom(fit > 0 ? fit : 1);
  }, [naturalSize]);

  useEffect(() => {
    recomputeFitZoom();
    if (typeof ResizeObserver === 'undefined') return;
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => recomputeFitZoom());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [recomputeFitZoom]);

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  const handleError = useCallback(() => {
    setError('Failed to load image');
  }, []);

  const effectiveZoom = state.mode === 'fit' ? fitZoom : state.zoom;

  const setZoom = useCallback((next: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    setState({ mode: 'manual', zoom: clamped });
  }, []);

  const onFit = useCallback(() => {
    setState({ mode: 'fit' });
    setPan({ x: 0, y: 0 });
  }, []);
  const onActual = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [setZoom]);
  const onZoomIn = useCallback(() => setZoom(effectiveZoom * ZOOM_STEP), [effectiveZoom, setZoom]);
  const onZoomOut = useCallback(() => setZoom(effectiveZoom / ZOOM_STEP), [effectiveZoom, setZoom]);

  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (effectiveZoom <= fitZoom) return;
      dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      e.preventDefault();
    },
    [effectiveZoom, fitZoom, pan.x, pan.y],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPan({
        x: drag.panX + (e.clientX - drag.startX),
        y: drag.panY + (e.clientY - drag.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const isPannable = effectiveZoom > fitZoom + 1e-6;

  const imgStyle: CSSProperties = naturalSize
    ? {
        width: `${naturalSize.w * effectiveZoom}px`,
        height: `${naturalSize.h * effectiveZoom}px`,
        transform: `translate(${pan.x}px, ${pan.y}px)`,
      }
    : { maxWidth: '100%', maxHeight: '100%' };

  const containerCls = ['squisq-image-viewer', `squisq-image-viewer--${theme}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerCls} data-testid="image-viewer">
      <div
        ref={stageRef}
        className="squisq-image-viewer-stage"
        onMouseDown={onMouseDown}
        style={{ cursor: isPannable ? (dragRef.current ? 'grabbing' : 'grab') : 'default' }}
      >
        {/* future: rotate, flip, crop overlays go here */}
        {error ? (
          <div className="squisq-image-viewer-error">{error}</div>
        ) : (
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            className="squisq-image-viewer-img"
            style={imgStyle}
            onLoad={handleLoad}
            onError={handleError}
            draggable={false}
          />
        )}
        <div className="squisq-image-viewer-toolbar">
          <button
            type="button"
            className="squisq-image-viewer-btn"
            onClick={onZoomOut}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="squisq-image-viewer-btn"
            onClick={onFit}
            aria-pressed={state.mode === 'fit'}
            title="Fit to viewport"
          >
            Fit
          </button>
          <button
            type="button"
            className="squisq-image-viewer-btn"
            onClick={onActual}
            title="Actual size (100%)"
          >
            100%
          </button>
          <button
            type="button"
            className="squisq-image-viewer-btn"
            onClick={onZoomIn}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div className="squisq-image-viewer-status">
        {naturalSize ? (
          <>
            <span>
              {naturalSize.w} × {naturalSize.h}
            </span>
            <span>{Math.round(effectiveZoom * 100)}%</span>
          </>
        ) : (
          <span>Loading…</span>
        )}
      </div>
    </div>
  );
}

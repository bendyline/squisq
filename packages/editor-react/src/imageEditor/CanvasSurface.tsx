/**
 * CanvasSurface — the SVG editing surface for `<ImageEditor>`.
 *
 * Renders the doc's canvas (with background and per-layer rendering) in
 * an `<svg>` whose `viewBox` matches the canvas dimensions. Pointer
 * events are normalized to canvas coordinates and dispatched as either
 * selection / drag / resize gestures (select tool) or as a crop-rect
 * gesture (crop tool).
 *
 * Layer rendering uses small purpose-built renderers in `./layers/` for
 * image / text / shape, which don't need media-context lookup, animation,
 * or blockTime-driven reflow. `path` layers (the full drawing-shape
 * vocabulary) reuse the shared `@bendyline/squisq-react` `PathLayer` so the
 * image editor draws named shapes with exactly the same code as drawings —
 * the canvas is the viewport and `blockTime` is 0 (no animation).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PathLayer } from '@bendyline/squisq-react';
import type { ImageEditDoc, ImageEditLayer } from '@bendyline/squisq/schemas';
import type { CanvasRect, ImageEditorAction, ImageEditorTool } from './state.js';
import { EditorImageLayer } from './layers/EditorImageLayer.js';
import { EditorTextLayer } from './layers/EditorTextLayer.js';
import { EditorShapeLayer } from './layers/EditorShapeLayer.js';
import { SelectionHandles, type Handle } from './layers/SelectionHandles.js';

export interface CanvasSurfaceProps {
  doc: ImageEditDoc;
  selectedLayerId: string | null;
  tool: ImageEditorTool;
  resolveAssetUrl: (path: string) => Promise<string>;
  dispatch: (action: ImageEditorAction) => void;
  /** When the text tool drops a new layer at a given canvas point. */
  onCreateTextAt?: (x: number, y: number) => void;
  /** When the shape tool drops a new layer at a given canvas point (click placement). */
  onCreateShapeAt?: (x: number, y: number) => void;
  /**
   * When the shape tool finishes a drag gesture (drag-to-draw placement).
   * Only called when `shapeDragDraw` is true and the drag exceeds the minimum distance.
   */
  onCreateShapeFromPoints?: (x1: number, y1: number, x2: number, y2: number) => void;
  /**
   * When true the shape tool uses drag-to-draw instead of click-to-place.
   * Set by the host when the active shape kind is line-based (line, arrow, etc.).
   */
  shapeDragDraw?: boolean;
  /** Background fill behind the canvas (the editor "paper"). */
  workspaceBackground?: string;
  /** Current zoom level (1 = 100% = 1:1 pixels). */
  zoom?: number;
  /** Called when a zoom-rect drag or other gesture wants to change zoom. */
  onSetZoom?: (zoom: number) => void;
  /** Ref forwarded to the outer scrollable surface div so the host can read its size and scroll position. */
  surfaceRef?: React.RefObject<HTMLDivElement>;
  /**
   * When set, immediately enters inline text editing for this layer ID.
   * Used by the host to trigger editing after creating a new text layer.
   */
  requestEditLayerId?: string | null;
}

interface DragState {
  layerId: string;
  startCanvasX: number;
  startCanvasY: number;
  startBox: CanvasRect;
  handle: Handle | 'move';
}

interface CropDragState {
  startCanvasX: number;
  startCanvasY: number;
  currentX: number;
  currentY: number;
}

interface ShapeLineDragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function CanvasSurface({
  doc,
  selectedLayerId,
  tool,
  resolveAssetUrl,
  dispatch,
  onCreateTextAt,
  onCreateShapeAt,
  onCreateShapeFromPoints,
  shapeDragDraw,
  workspaceBackground,
  zoom = 1,
  onSetZoom,
  surfaceRef,
  requestEditLayerId,
}: CanvasSurfaceProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [, forceRender] = useState(0);
  const [cropDrag, setCropDrag] = useState<CropDragState | null>(null);
  const [shapeLineDrag, setShapeLineDrag] = useState<ShapeLineDragState | null>(null);
  const internalWrapRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const [zoomDrag, setZoomDrag] = useState<CropDragState | null>(null); // reuse CropDragState shape
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  /** Convert client-space coordinates to canvas coordinates. */
  const toCanvas = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * doc.canvas.width;
      const y = ((clientY - rect.top) / rect.height) * doc.canvas.height;
      return { x, y };
    },
    [doc.canvas.width, doc.canvas.height],
  );

  // After zoom changes, apply any pending scroll (set by zoom-rect commit).
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    if (pending && internalWrapRef.current) {
      pendingScrollRef.current = null;
      internalWrapRef.current.scrollLeft = pending.left;
      internalWrapRef.current.scrollTop = pending.top;
    }
  }, [zoom]);

  // Helper: assign both internal and external ref
  const setWrapRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      internalWrapRef.current = el;
      if (surfaceRef) {
        (surfaceRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }
    },
    [surfaceRef],
  );

  // Enter editing when the host requests it (e.g. after creating a new text layer).
  useEffect(() => {
    if (requestEditLayerId) setEditingLayerId(requestEditLayerId);
  }, [requestEditLayerId]);

  // Exit editing when a different layer is selected externally.
  useEffect(() => {
    if (editingLayerId && selectedLayerId !== editingLayerId) setEditingLayerId(null);
  }, [selectedLayerId, editingLayerId]);

  // Auto-focus the inline textarea whenever we enter editing mode.
  useLayoutEffect(() => {
    if (editingLayerId && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.select();
    }
  }, [editingLayerId]);

  // ── Pointer handlers ───────────────────────────────────────────────────
  const onPointerDownLayer = useCallback(
    (e: React.PointerEvent<SVGGElement>, layer: ImageEditLayer) => {
      if (tool !== 'select') return;
      if (layer.locked) return;
      e.stopPropagation();
      const pt = toCanvas(e.clientX, e.clientY);
      dispatch({ type: 'select', layerId: layer.id });
      const box = layerBox(layer, doc);
      dragRef.current = {
        layerId: layer.id,
        startCanvasX: pt.x,
        startCanvasY: pt.y,
        startBox: box,
        handle: 'move',
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [tool, dispatch, toCanvas, doc],
  );

  const onPointerDownHandle = useCallback(
    (e: React.PointerEvent<SVGRectElement>, handle: Handle) => {
      if (!selectedLayerId) return;
      const layer = doc.layers.find((l) => l.id === selectedLayerId);
      if (!layer || layer.locked) return;
      e.stopPropagation();
      const pt = toCanvas(e.clientX, e.clientY);
      const box = layerBox(layer, doc);
      dragRef.current = {
        layerId: layer.id,
        startCanvasX: pt.x,
        startCanvasY: pt.y,
        startBox: box,
        handle,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [selectedLayerId, doc, toCanvas],
  );

  const onPointerDownEmpty = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const pt = toCanvas(e.clientX, e.clientY);
      if (tool === 'select') {
        dispatch({ type: 'select', layerId: null });
        setEditingLayerId(null);
        return;
      }
      if (tool === 'zoom-rect') {
        e.preventDefault();
        setZoomDrag({ startCanvasX: pt.x, startCanvasY: pt.y, currentX: pt.x, currentY: pt.y });
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return;
      }
      if (tool === 'crop') {
        e.preventDefault();
        setCropDrag({ startCanvasX: pt.x, startCanvasY: pt.y, currentX: pt.x, currentY: pt.y });
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return;
      }
      if (tool === 'text') {
        onCreateTextAt?.(pt.x, pt.y);
        return;
      }
      if (tool === 'shape') {
        if (shapeDragDraw) {
          e.preventDefault();
          setShapeLineDrag({ startX: pt.x, startY: pt.y, currentX: pt.x, currentY: pt.y });
          (e.target as Element).setPointerCapture?.(e.pointerId);
        } else {
          onCreateShapeAt?.(pt.x, pt.y);
        }
      }
    },
    [tool, dispatch, toCanvas, onCreateTextAt, onCreateShapeAt, shapeDragDraw],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (drag) {
        const pt = toCanvas(e.clientX, e.clientY);
        const dx = pt.x - drag.startCanvasX;
        const dy = pt.y - drag.startCanvasY;
        const next = applyHandle(drag.startBox, drag.handle, dx, dy);
        dispatch({
          type: 'update-layer',
          layerId: drag.layerId,
          patch: {
            position: {
              x: Math.round(next.x),
              y: Math.round(next.y),
              width: Math.round(next.width),
              height: Math.round(next.height),
            },
          },
        });
        return;
      }
      if (shapeLineDrag) {
        const pt = toCanvas(e.clientX, e.clientY);
        setShapeLineDrag((prev) => (prev ? { ...prev, currentX: pt.x, currentY: pt.y } : prev));
        return;
      }
      if (zoomDrag) {
        const pt = toCanvas(e.clientX, e.clientY);
        setZoomDrag((prev) => (prev ? { ...prev, currentX: pt.x, currentY: pt.y } : prev));
        return;
      }
      if (cropDrag) {
        const pt = toCanvas(e.clientX, e.clientY);
        setCropDrag((prev) => (prev ? { ...prev, currentX: pt.x, currentY: pt.y } : prev));
      }
    }
    function onUp() {
      if (dragRef.current) {
        dragRef.current = null;
        forceRender((n) => n + 1);
      }
      if (shapeLineDrag) {
        const dist = Math.hypot(
          shapeLineDrag.currentX - shapeLineDrag.startX,
          shapeLineDrag.currentY - shapeLineDrag.startY,
        );
        if (dist >= 4 && onCreateShapeFromPoints) {
          onCreateShapeFromPoints(
            shapeLineDrag.startX,
            shapeLineDrag.startY,
            shapeLineDrag.currentX,
            shapeLineDrag.currentY,
          );
        } else {
          // Too short to be a drag — fall back to fixed-size placement.
          onCreateShapeAt?.(shapeLineDrag.startX, shapeLineDrag.startY);
        }
        setShapeLineDrag(null);
      }
      if (zoomDrag) {
        const rectW = Math.abs(zoomDrag.currentX - zoomDrag.startCanvasX);
        const rectH = Math.abs(zoomDrag.currentY - zoomDrag.startCanvasY);
        if (rectW >= 10 && rectH >= 10 && onSetZoom && internalWrapRef.current) {
          const wrap = internalWrapRef.current;
          const viewportW = wrap.clientWidth - 32;
          const viewportH = wrap.clientHeight - 32;
          const newZoom = Math.max(
            0.0625,
            Math.min(16, Math.min(viewportW / rectW, viewportH / rectH)),
          );
          const cx = Math.min(zoomDrag.startCanvasX, zoomDrag.currentX) + rectW / 2;
          const cy = Math.min(zoomDrag.startCanvasY, zoomDrag.currentY) + rectH / 2;
          pendingScrollRef.current = {
            left: cx * newZoom - wrap.clientWidth / 2 + 16,
            top: cy * newZoom - wrap.clientHeight / 2 + 16,
          };
          onSetZoom(newZoom);
          dispatch({ type: 'set-tool', tool: 'select' });
        }
        setZoomDrag(null);
      }
      if (cropDrag) {
        const rect = normalizeCropRect(cropDrag);
        if (rect.width >= 8 && rect.height >= 8) {
          dispatch({ type: 'crop', rect });
          dispatch({ type: 'set-tool', tool: 'select' });
        }
        setCropDrag(null);
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [
    toCanvas,
    dispatch,
    cropDrag,
    shapeLineDrag,
    zoomDrag,
    onSetZoom,
    onCreateShapeFromPoints,
    onCreateShapeAt,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────
  const selectedLayer = selectedLayerId
    ? (doc.layers.find((l) => l.id === selectedLayerId) ?? null)
    : null;
  const selectedBox = selectedLayer ? layerBox(selectedLayer, doc) : null;
  const selectionBox =
    selectedLayer && selectedLayer.type === 'text'
      ? measureTextLayerBox(selectedLayer, selectedBox!)
      : selectedBox;

  // Expand the selection box outward so the dashed outline clears the layer's own stroke.
  // Padding = half-stroke (so the outline sits just past the stroke edge) + a proportional
  // visual buffer that stays consistent in screen-space across different canvas sizes.
  const paddedSelectionBox = (() => {
    if (!selectionBox || !selectedLayer) return null;
    const sw =
      selectedLayer.type === 'shape' || selectedLayer.type === 'path'
        ? (((selectedLayer.content as Record<string, unknown>)['strokeWidth'] as
            | number
            | undefined) ?? 0)
        : 0;
    const strokeHalf = sw / 2;
    const proportional = Math.max(doc.canvas.width, doc.canvas.height) * 0.007;
    const p = Math.ceil(strokeHalf + proportional);
    return {
      x: selectionBox.x - p,
      y: selectionBox.y - p,
      width: selectionBox.width + p * 2,
      height: selectionBox.height + p * 2,
    };
  })();

  return (
    <div
      ref={setWrapRefCallback}
      className="squisq-image-editor-surface"
      style={{ background: workspaceBackground ?? '#1f1f24' }}
    >
      <div className="squisq-image-editor-canvas-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${doc.canvas.width} ${doc.canvas.height}`}
          width={Math.round(doc.canvas.width * zoom)}
          height={Math.round(doc.canvas.height * zoom)}
          className={`squisq-image-editor-canvas squisq-image-editor-canvas--tool-${tool}`}
          onPointerDown={onPointerDownEmpty}
        >
          {/* Canvas background */}
          <rect
            x={0}
            y={0}
            width={doc.canvas.width}
            height={doc.canvas.height}
            fill={
              doc.canvas.background && doc.canvas.background !== 'transparent'
                ? doc.canvas.background
                : 'url(#squisq-image-editor-checker)'
            }
          />
          <defs>
            <pattern
              id="squisq-image-editor-checker"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <rect width="16" height="16" fill="#f0f0f0" />
              <rect width="8" height="8" fill="#d0d0d0" />
              <rect x="8" y="8" width="8" height="8" fill="#d0d0d0" />
            </pattern>
          </defs>

          {/* Layers, back-to-front */}
          {doc.layers.map((layer) => {
            if (layer.visible === false) return null;
            const onPointerDown = (e: React.PointerEvent<SVGGElement>) =>
              onPointerDownLayer(e, layer);
            const onDoubleClick =
              layer.type === 'text'
                ? (e: React.MouseEvent<SVGGElement>) => {
                    e.stopPropagation();
                    dispatch({ type: 'select', layerId: layer.id });
                    setEditingLayerId(layer.id);
                  }
                : undefined;
            const opacity = layer.opacity ?? 1;
            const isEditing = editingLayerId === layer.id;
            return (
              <g
                key={layer.id}
                data-layer-id={layer.id}
                opacity={opacity}
                visibility={isEditing ? 'hidden' : undefined}
                pointerEvents={isEditing ? 'none' : undefined}
                style={{ cursor: tool === 'select' && !layer.locked ? 'move' : undefined }}
                onPointerDown={isEditing ? undefined : onPointerDown}
                onDoubleClick={onDoubleClick}
              >
                {layer.type === 'image' && (
                  <EditorImageLayer
                    layer={layer}
                    canvas={doc.canvas}
                    resolveAssetUrl={resolveAssetUrl}
                  />
                )}
                {layer.type === 'text' && <EditorTextLayer layer={layer} canvas={doc.canvas} />}
                {layer.type === 'shape' && <EditorShapeLayer layer={layer} canvas={doc.canvas} />}
                {layer.type === 'path' && (
                  <PathLayer layer={layer} viewport={doc.canvas} blockTime={0} />
                )}
              </g>
            );
          })}

          {/* Selection handles */}
          {selectedLayer &&
            paddedSelectionBox &&
            tool === 'select' &&
            !selectedLayer.locked &&
            editingLayerId !== selectedLayer.id && (
              <SelectionHandles
                box={paddedSelectionBox}
                onHandlePointerDown={onPointerDownHandle}
              />
            )}

          {/* Inline text editor — foreignObject overlays the hidden text layer */}
          {editingLayerId &&
            (() => {
              const editLayer = doc.layers.find((l) => l.id === editingLayerId);
              if (!editLayer || editLayer.type !== 'text') return null;
              const pos = layerBox(editLayer, doc);
              const textLayer = editLayer as ImageEditLayer & { type: 'text' };
              const s = textLayer.content;
              const editBox = measureTextLayerBox(textLayer, pos);
              return (
                <foreignObject
                  key={`inline-edit-${editingLayerId}`}
                  x={editBox.x}
                  y={editBox.y}
                  width={editBox.width}
                  height={editBox.height}
                  style={{ overflow: 'visible' }}
                >
                  <textarea
                    ref={editTextareaRef}
                    value={s.text}
                    onChange={(e) => {
                      dispatch({
                        type: 'update-layer',
                        layerId: editingLayerId,
                        patch: {
                          content: { ...s, text: e.target.value },
                        } as Partial<ImageEditLayer>,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingLayerId(null);
                      }
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    wrap="off"
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      padding: 0,
                      margin: 0,
                      border: 'none',
                      outline: '2px dashed rgba(59,130,246,0.8)',
                      outlineOffset: '2px',
                      resize: 'none',
                      background: 'transparent',
                      fontFamily: s.style.fontFamily ?? 'sans-serif',
                      // The foreignObject participates in the SVG viewBox transform, so its
                      // contents use canvas units and inherit zoom from the SVG exactly once.
                      fontSize: `${s.style.fontSize}px`,
                      fontWeight: s.style.fontWeight ?? 'normal',
                      color: s.style.color,
                      textAlign: (s.style.textAlign ?? 'left') as 'left' | 'center' | 'right',
                      lineHeight: s.style.lineHeight ?? 1.4,
                      caretColor: s.style.color,
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                    }}
                  />
                </foreignObject>
              );
            })()}

          {/* Shape drag-to-draw preview */}
          {shapeLineDrag && (
            <line
              x1={shapeLineDrag.startX}
              y1={shapeLineDrag.startY}
              x2={shapeLineDrag.currentX}
              y2={shapeLineDrag.currentY}
              stroke="#39f"
              strokeWidth={2}
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          )}

          {/* Zoom-rect drag preview */}
          {zoomDrag &&
            (() => {
              const r = normalizeCropRect(zoomDrag);
              return (
                <g pointerEvents="none">
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.width}
                    height={r.height}
                    fill="rgba(255,200,0,0.08)"
                    stroke="#f90"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })()}

          {/* Crop rectangle preview */}
          {cropDrag &&
            (() => {
              const r = normalizeCropRect(cropDrag);
              return (
                <g pointerEvents="none">
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.width}
                    height={r.height}
                    fill="rgba(255,255,255,0.05)"
                    stroke="#39f"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                </g>
              );
            })()}
        </svg>
      </div>
    </div>
  );
}

// ============================================
// Helpers
// ============================================

/** Resolve a layer's pixel box, ignoring anchor/percentage strings (the editor authors numeric coords). */
function layerBox(layer: ImageEditLayer, doc: ImageEditDoc): CanvasRect {
  const p = layer.position;
  const x = typeof p.x === 'number' ? p.x : 0;
  const y = typeof p.y === 'number' ? p.y : 0;
  const width = typeof p.width === 'number' ? p.width : doc.canvas.width;
  const height = typeof p.height === 'number' ? p.height : doc.canvas.height;
  return { x, y, width, height };
}

const MIN_DIM = 4;

function applyHandle(box: CanvasRect, handle: Handle | 'move', dx: number, dy: number): CanvasRect {
  if (handle === 'move') return { ...box, x: box.x + dx, y: box.y + dy };
  let { x, y, width, height } = box;
  // Each handle adjusts a subset of (x, y, width, height).
  if (handle.includes('w')) {
    const newWidth = Math.max(MIN_DIM, width - dx);
    x = x + (width - newWidth);
    width = newWidth;
  } else if (handle.includes('e')) {
    width = Math.max(MIN_DIM, width + dx);
  }
  if (handle.includes('n')) {
    const newHeight = Math.max(MIN_DIM, height - dy);
    y = y + (height - newHeight);
    height = newHeight;
  } else if (handle.includes('s')) {
    height = Math.max(MIN_DIM, height + dy);
  }
  return { x, y, width, height };
}

function normalizeCropRect(d: CropDragState): CanvasRect {
  const x = Math.min(d.startCanvasX, d.currentX);
  const y = Math.min(d.startCanvasY, d.currentY);
  const width = Math.abs(d.currentX - d.startCanvasX);
  const height = Math.abs(d.currentY - d.startCanvasY);
  return { x, y, width, height };
}

/**
 * Measure the visual bounding box of a text layer using a 2D canvas.
 * Falls back to the layer's authored width/height if measurement isn't
 * available (SSR, headless test envs without canvas). The returned box
 * tightly wraps the rendered glyphs so the selection rectangle hugs the
 * actual text rather than an arbitrary author-supplied frame.
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (typeof document === 'undefined') {
    measureCtx = null;
    return null;
  }
  try {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
  } catch {
    measureCtx = null;
  }
  return measureCtx ?? null;
}

function measureTextLayerBox(
  layer: ImageEditLayer & { type: 'text' },
  fallback: CanvasRect,
): CanvasRect {
  const ctx = getMeasureCtx();
  if (!ctx) return fallback;
  const { text, style } = layer.content;
  const fontSize = style.fontSize;
  const fontWeight = style.fontWeight ?? 'normal';
  const fontFamily = style.fontFamily ?? 'sans-serif';
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const lines = (text ?? '').split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line || ' ').width;
    if (w > maxWidth) maxWidth = w;
  }
  const lineHeight = style.lineHeight ?? 1.4;
  const lineHeightPx = fontSize * lineHeight;
  // Use full line boxes so the SVG selection and textarea editor share
  // identical bounds without clipping the caret or the final line.
  const totalHeight = Math.max(1, lines.length) * lineHeightPx;
  // Mirror the textAnchor logic in EditorTextLayer.
  const anchor =
    style.textAlign === 'center' ? 'middle' : style.textAlign === 'right' ? 'end' : 'start';
  const x =
    anchor === 'middle'
      ? fallback.x - maxWidth / 2
      : anchor === 'end'
        ? fallback.x - maxWidth
        : fallback.x;
  return {
    x,
    y: fallback.y,
    width: Math.max(MIN_DIM, Math.ceil(maxWidth)),
    height: Math.max(MIN_DIM, Math.ceil(totalHeight)),
  };
}

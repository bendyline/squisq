/**
 * CanvasSurface — the SVG editing surface for `<ImageEditor>`.
 *
 * Renders the doc's canvas (with background and per-layer rendering) in
 * an `<svg>` whose `viewBox` matches the canvas dimensions. Pointer
 * events are normalized to canvas coordinates and dispatched as either
 * selection / drag / resize gestures (select tool) or as a crop-rect
 * gesture (crop tool).
 *
 * Layer rendering uses small purpose-built renderers in `./layers/`,
 * not the heavier `@bendyline/squisq-react` layer components — the
 * editor doesn't need media-context lookup, animation, or
 * blockTime-driven reflow.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** When the shape tool drops a new layer at a given canvas point. */
  onCreateShapeAt?: (x: number, y: number) => void;
  /** Background fill behind the canvas (the editor "paper"). */
  workspaceBackground?: string;
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

export function CanvasSurface({
  doc,
  selectedLayerId,
  tool,
  resolveAssetUrl,
  dispatch,
  onCreateTextAt,
  onCreateShapeAt,
  workspaceBackground,
}: CanvasSurfaceProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [, forceRender] = useState(0);
  const [cropDrag, setCropDrag] = useState<CropDragState | null>(null);

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
        onCreateShapeAt?.(pt.x, pt.y);
      }
    },
    [tool, dispatch, toCanvas, onCreateTextAt, onCreateShapeAt],
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
  }, [toCanvas, dispatch, cropDrag]);

  // ── Render ─────────────────────────────────────────────────────────────
  const selectedLayer = selectedLayerId
    ? (doc.layers.find((l) => l.id === selectedLayerId) ?? null)
    : null;
  const selectedBox = selectedLayer ? layerBox(selectedLayer, doc) : null;
  const selectionBox =
    selectedLayer && selectedLayer.type === 'text'
      ? measureTextLayerBox(selectedLayer, selectedBox!)
      : selectedBox;

  return (
    <div
      className="squisq-image-editor-surface"
      style={{ background: workspaceBackground ?? '#1f1f24' }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${doc.canvas.width} ${doc.canvas.height}`}
        preserveAspectRatio="xMidYMid meet"
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
          const opacity = layer.opacity ?? 1;
          return (
            <g
              key={layer.id}
              data-layer-id={layer.id}
              opacity={opacity}
              style={{ cursor: tool === 'select' && !layer.locked ? 'move' : undefined }}
              onPointerDown={onPointerDown}
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
            </g>
          );
        })}

        {/* Selection handles */}
        {selectedLayer && selectionBox && tool === 'select' && !selectedLayer.locked && (
          <SelectionHandles box={selectionBox} onHandlePointerDown={onPointerDownHandle} />
        )}

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
  // First line spans fontSize tall; subsequent lines add lineHeightPx each.
  const totalHeight = fontSize + Math.max(0, lines.length - 1) * lineHeightPx;
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

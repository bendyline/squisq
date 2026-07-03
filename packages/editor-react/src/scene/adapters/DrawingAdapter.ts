/**
 * DrawingAdapter — edit a `{[drawing]}` block as semantic markdown.
 *
 * Read direction:  child `{[shape …]}` headings → `computeDrawingLayout` →
 *                  Scene layers + connector edges.
 * Write direction: SceneCommand → `drawingCommands` (insert/update/delete
 *                  shape & connector headings).
 *
 * This is the drawing counterpart to `DiagramAdapter` — same seam
 * (`LayoutAdapterResult`), richer shape vocabulary, resizable shapes, and
 * connector create / select / delete / re-target. Unlike the old behaviour,
 * nothing is persisted as a base64 `layers=` blob; every shape is a heading.
 */

import { useCallback, useEffect, useMemo, useRef, useState, createElement } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { Layer, Block } from '@bendyline/squisq/schemas';
import { computeDrawingLayout } from '@bendyline/squisq/doc';
import type { SceneCommand, SceneEdge } from '../commands/SceneCommand';
import type { SceneTool, SceneToolContext } from '../tools/SceneTool';
import { SelectTool } from '../tools/SelectTool';
import { createPathTool } from '../tools/PathTool';
import { createTextTool } from '../tools/TextTool';
import { createDrawingConnectTool } from '../tools/DrawingConnectTool';
import { createDrawShapeTool } from '../tools/createDrawShapeTool';
import {
  shapesToSceneLayers,
  shapeBoxes,
  drawingLayerFollows,
  shapeIdFromLayerId,
  isPrimaryShapeLayer,
  type ShapeBox,
} from '../layers/shapeLayers';
import { DiagramEdges } from '../layers/DiagramEdges';
import { edgeEndpoints } from '../layers/edgeGeometry';
import {
  addShape,
  moveShape,
  resizeShape,
  setShapeParam,
  setConnectorStyle,
  removeShape,
  renameShape,
  addConnector,
  removeConnector,
  retargetConnector,
  listDrawingChildren,
} from '../commands/drawingCommands';
import type { LayoutAdapterResult } from './LayoutAdapter';
import type { SceneEdge as SceneEdgeType } from '../commands/SceneCommand';

export interface DrawingAdapterOptions {
  /** Default stroke color for new shapes/paths. */
  stroke?: string;
  /** Default fill color for new shapes. */
  fill?: string;
}

/** Connector styling fields the properties panel can set. */
export interface ConnectorStyleInput {
  startStyle?: string;
  endStyle?: string;
  lineStyle?: string;
  routing?: string;
}

/**
 * The drawing adapter's result extends the base scene-adapter contract with
 * handles the host (SceneBlockWidget) uses to drive the shape palette and
 * properties panel.
 */
export interface DrawingAdapterResult extends LayoutAdapterResult {
  /** Set the kind the draw tool will place next (the ShapePalette → canvas). */
  setPendingKind: (kind: string | null) => void;
  /** The currently-selected connector id, if any. */
  selectedEdgeId: string | null;
  /** The currently-selected connector, if any. */
  selectedEdge: SceneEdgeType | null;
  /** Update a connector's end/line/routing styles. */
  setConnectorStyle: (id: string, style: ConnectorStyleInput) => void;
  /** Update a shape's style param (fill/stroke/etc.); empty value clears it. */
  setShapeParam: (id: string, key: string, value: string) => void;
}

/** Hit radius (viewport units) for grabbing a selected connector's endpoint. */
const ENDPOINT_HIT_RADIUS = 18;

export function useDrawingAdapter(
  editor: Editor,
  headingPos: number,
  options: DrawingAdapterOptions = {},
): DrawingAdapterResult {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const onUpdate = () => setVersion((v) => v + 1);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  // ── Read: child headings → shapes + connectors ────────────────
  const node = editor.state.doc.nodeAt(headingPos);
  const children = node ? listDrawingChildren(editor, headingPos) : [];
  const blocks: Block[] = children.map((c) => ({
    id: c.id,
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    ...(c.kind ? { template: c.kind } : {}),
    ...(Object.keys(c.params).length > 0 ? { templateOverrides: c.params } : {}),
    ...(c.text ? { title: c.text } : {}),
  }));
  const layout = computeDrawingLayout(blocks);
  const layers: Layer[] = shapesToSceneLayers(layout.shapes);
  const boxes: ShapeBox[] = shapeBoxes(layout.shapes);
  const edges: SceneEdge[] = layout.connectors.map((c) => ({
    id: c.id,
    source: c.from,
    target: c.to,
    ...(c.label ? { label: c.label } : {}),
    startMarker: c.startMarker,
    endMarker: c.endMarker,
    ...(c.dasharray ? { dasharray: c.dasharray } : {}),
    routing: c.routing,
  }));

  // ── Connector selection state ─────────────────────────────────
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // The shape kind the draw tool will place next (set by the ShapePalette).
  // Defaults to rectangle so the toolbar "Shape" tool works before any pick.
  const pendingKindRef = useRef<string | null>('rectangle');
  const setPendingKind = useCallback((kind: string | null) => {
    pendingKindRef.current = kind;
  }, []);

  // Mirror the live read in a ref so the memoized connect tool + keyboard
  // handler always see current edges/boxes/selection without re-binding.
  const dataRef = useRef({ edges, boxes, selectedEdgeId, headingPos });
  dataRef.current = { edges, boxes, selectedEdgeId, headingPos };

  // Drop a stale selection when its edge disappears (e.g. a shape removed).
  useEffect(() => {
    if (selectedEdgeId && !edges.some((e) => e.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [edges, selectedEdgeId]);

  // Delete/Backspace removes the selected connector (when focus isn't in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isEditableTarget(e.target)) return;
      const { edges: liveEdges, selectedEdgeId: sel, headingPos: pos } = dataRef.current;
      if (!sel) return;
      const edge = liveEdges.find((ed) => ed.id === sel);
      if (!edge) return;
      e.preventDefault();
      removeConnector(editor, pos, edge.source, edge.target);
      setSelectedEdgeId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  // ── Connect tool: create new edges + re-target a selected edge ──
  const endpointAt = useCallback((point: { x: number; y: number }) => {
    const { edges: liveEdges, boxes: liveBoxes, selectedEdgeId: sel } = dataRef.current;
    if (!sel) return null;
    const edge = liveEdges.find((ed) => ed.id === sel);
    if (!edge) return null;
    const ep = edgeEndpoints(liveBoxes, edge.source, edge.target);
    if (!ep) return null;
    if (within(ep.start, point))
      return { connectorId: edge.id, end: 'from' as const, fixedShapeId: edge.target };
    if (within(ep.end, point))
      return { connectorId: edge.id, end: 'to' as const, fixedShapeId: edge.source };
    return null;
  }, []);

  const onRetarget = useCallback(
    (connectorId: string, end: 'from' | 'to', newTargetId: string) => {
      retargetConnector(editor, dataRef.current.headingPos, connectorId, end, newTargetId);
    },
    [editor],
  );

  const onDrawShape = useCallback(
    (kind: string, b: { x: number; y: number; width: number; height: number }) => {
      const pos = dataRef.current.headingPos;
      const id = nextShapeId(editor, pos, kind);
      addShape(editor, pos, id, kind, {
        x: String(Math.round(b.x)),
        y: String(Math.round(b.y)),
        width: String(Math.round(b.width)),
        height: String(Math.round(b.height)),
      });
    },
    [editor],
  );

  // Tools: Select, the kind-driven draw tool (the ShapePalette switches its
  // kind; defaults to rectangle), freehand Pen, Text, and Connect. Specific
  // rect/circle/line buttons are folded into the palette + draw tool.
  const tools: SceneTool[] = useMemo(
    () => [
      SelectTool,
      createDrawShapeTool({ getKind: () => pendingKindRef.current, onDraw: onDrawShape }),
      createPathTool({ stroke: options.stroke }),
      createTextTool({ color: options.stroke }),
      createDrawingConnectTool({ endpointAt, onRetarget }),
    ],
    [options.stroke, endpointAt, onRetarget, onDrawShape],
  );

  const renderExtras = useCallback((_ctx: SceneToolContext): ReactNode => {
    const { edges: liveEdges, boxes: liveBoxes, selectedEdgeId: sel } = dataRef.current;
    return createElement(DiagramEdges, {
      nodes: liveBoxes,
      edges: liveEdges,
      variant: 'straight',
      selectedId: sel,
      onEdgeClick: (edge: SceneEdge) => setSelectedEdgeId(edge.id),
    });
  }, []);

  // ── Write: SceneCommand → drawing heading commands ─────────────
  const dispatch = (cmd: SceneCommand) => {
    switch (cmd.kind) {
      case 'moveLayer': {
        if (!isPrimaryShapeLayer(cmd.id)) return; // label moves duplicate the shape move
        const id = shapeIdFromLayerId(cmd.id);
        if (id) moveShape(editor, headingPos, id, cmd.x, cmd.y);
        return;
      }
      case 'resizeLayer': {
        if (!isPrimaryShapeLayer(cmd.id)) return;
        const id = shapeIdFromLayerId(cmd.id);
        if (id) resizeShape(editor, headingPos, id, cmd.width, cmd.height);
        return;
      }
      case 'addLayer': {
        const shape = layerToShape(cmd.layer);
        const id = nextShapeId(editor, headingPos, shape.kind);
        addShape(editor, headingPos, id, shape.kind, shape.params, shape.label);
        return;
      }
      case 'removeLayer': {
        const id = shapeIdFromLayerId(cmd.id);
        if (id) removeShape(editor, headingPos, id);
        return;
      }
      case 'renameLayer': {
        const id = shapeIdFromLayerId(cmd.id);
        if (id) renameShape(editor, headingPos, id, cmd.label);
        return;
      }
      case 'setLayerText': {
        // Drawing labels persist as heading text (markdown inline marks);
        // the rich `html` is not stored separately.
        const id = shapeIdFromLayerId(cmd.id);
        if (id) renameShape(editor, headingPos, id, cmd.text);
        return;
      }
      case 'setLayerAttr': {
        const id = shapeIdFromLayerId(cmd.id);
        if (!id) return;
        const mapped = paramForLayerPath(cmd.path);
        if (mapped === '__text__') {
          renameShape(editor, headingPos, id, String(cmd.value ?? ''));
        } else if (mapped) {
          setShapeParam(editor, headingPos, id, mapped, String(cmd.value ?? ''));
        }
        return;
      }
      case 'addEdge':
        addConnector(editor, headingPos, nextEdgeId(editor, headingPos), cmd.source, cmd.target);
        return;
      case 'removeEdge':
        removeConnector(editor, headingPos, cmd.source, cmd.target);
        return;
    }
    const _exhaustive: never = cmd;
    void _exhaustive;
  };

  return {
    layers,
    edges,
    tools,
    dispatch,
    layerFollows: drawingLayerFollows,
    renderExtras,
    setPendingKind,
    selectedEdgeId,
    selectedEdge: edges.find((e) => e.id === selectedEdgeId) ?? null,
    setConnectorStyle: (id, style) => {
      setConnectorStyle(editor, headingPos, id, style);
    },
    setShapeParam: (id, key, value) => {
      setShapeParam(editor, headingPos, id, key, value);
    },
  };
}

// ============================================
// Layer ↔ shape mapping
// ============================================

interface ShapeWrite {
  kind: string;
  params: Record<string, string>;
  label: string;
}

/** Map a tool-produced Layer to a `{[shape …]}` heading's kind + params + label. */
function layerToShape(layer: Layer): ShapeWrite {
  const params = posParams(layer.position);
  if (layer.type === 'shape') {
    const c = layer.content;
    const kind = c.shape === 'rect' ? 'rectangle' : c.shape; // circle / line keep their name
    if (c.fill) params.fill = c.fill;
    if (c.stroke) params.stroke = c.stroke;
    if (c.strokeWidth != null) params.strokeWidth = String(c.strokeWidth);
    if (c.borderRadius != null) params.borderRadius = String(c.borderRadius);
    return { kind, params, label: '' };
  }
  if (layer.type === 'path') {
    const c = layer.content;
    params.d = c.d;
    if (c.stroke) params.stroke = c.stroke;
    if (c.strokeWidth != null) params.strokeWidth = String(c.strokeWidth);
    if (c.fill) params.fill = c.fill;
    return { kind: 'path', params, label: '' };
  }
  if (layer.type === 'text') {
    return { kind: 'text', params, label: layer.content.text };
  }
  // Unknown layer types degrade to a rectangle outline.
  return { kind: 'rectangle', params, label: '' };
}

/** Pull numeric x/y/width/height out of a Layer position into string params. */
function posParams(pos: Layer['position']): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof pos.x === 'number') out.x = String(Math.round(pos.x));
  if (typeof pos.y === 'number') out.y = String(Math.round(pos.y));
  if (typeof pos.width === 'number') out.width = String(Math.round(pos.width));
  if (typeof pos.height === 'number') out.height = String(Math.round(pos.height));
  return out;
}

/** Map a `setLayerAttr` dotted path to a shape param name (or '__text__' for the label). */
function paramForLayerPath(path: string): string | null {
  switch (path) {
    case 'content.fill':
      return 'fill';
    case 'content.stroke':
    case 'content.style.color':
      return 'stroke';
    case 'content.strokeWidth':
      return 'strokeWidth';
    case 'content.borderRadius':
      return 'borderRadius';
    case 'content.dasharray':
      return 'dasharray';
    case 'content.d':
      return 'd';
    case 'content.text':
      return '__text__';
    default:
      return null;
  }
}

const KIND_PREFIX: Record<string, string> = {
  rectangle: 'rect',
  rect: 'rect',
  circle: 'circle',
  line: 'line',
  arrow: 'arrow',
  path: 'path',
  text: 'text',
};

/** A fresh, unique heading id for a new shape, e.g. `rect-1`, `star-2`. */
function nextShapeId(editor: Editor, parentPos: number, kind: string): string {
  const used = new Set(listDrawingChildren(editor, parentPos).map((c) => c.id));
  const prefix = KIND_PREFIX[kind] ?? (kind.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'shape');
  let i = 1;
  let id = `${prefix}-${i}`;
  while (used.has(id)) id = `${prefix}-${++i}`;
  return id;
}

/** A fresh, unique heading id for a new connector, e.g. `edge-1`. */
function nextEdgeId(editor: Editor, parentPos: number): string {
  const used = new Set(listDrawingChildren(editor, parentPos).map((c) => c.id));
  let i = 1;
  let id = `edge-${i}`;
  while (used.has(id)) id = `edge-${++i}`;
  return id;
}

function within(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= ENDPOINT_HIT_RADIUS;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

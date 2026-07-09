/**
 * edgeGeometry — pure geometry for scene connector edges (shared by the
 * `DiagramEdges` renderer and the drawing adapter's endpoint hit-testing).
 *
 * Endpoints are clipped to the source/target bounding boxes so an arrowhead
 * sits on a card's edge rather than inside it — matching `diagramBlock.ts` /
 * `drawingBlock.ts` so the editor and the SSR preview agree.
 */

import { NODE_WIDTH, NODE_HEIGHT } from './nodeCard';
import {
  nearestSnapPoint as nearestCoreSnapPoint,
  snapEndpoints as coreSnapEndpoints,
  type ConnectorSnapPoint,
} from '@bendyline/squisq/doc';

/** Minimal box an edge needs from a node/shape (id + bounds). */
export interface EdgeNodeBox {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** Center + half-extents of a node/shape box. */
export interface NodeBox {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function boxesOf(nodes: readonly EdgeNodeBox[]): Map<string, NodeBox> {
  const map = new Map<string, NodeBox>();
  for (const n of nodes) {
    const w = n.width ?? NODE_WIDTH;
    const h = n.height ?? NODE_HEIGHT;
    map.set(n.id, { cx: n.x + w / 2, cy: n.y + h / 2, rx: w / 2, ry: h / 2 });
  }
  return map;
}

/** Intersection of the center-to-center line with `from`'s bounding box. */
export function edgePoint(from: NodeBox, to: NodeBox): { x: number; y: number } {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (dx === 0 && dy === 0) return { x: from.cx, y: from.cy };
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const sx = adx > 0 ? from.rx / adx : Infinity;
  const sy = ady > 0 ? from.ry / ady : Infinity;
  const s = Math.min(sx, sy);
  return { x: from.cx + dx * s, y: from.cy + dy * s };
}

function boxFor(nodes: readonly EdgeNodeBox[], id: string): NodeBox | null {
  return boxesOf(nodes).get(id) ?? null;
}

/** Nearest stable connector port on the named node/shape to `point`. */
export function snapPointToward(
  nodes: readonly EdgeNodeBox[],
  id: string,
  point: { x: number; y: number },
): ConnectorSnapPoint | null {
  const box = boxFor(nodes, id);
  return box ? nearestCoreSnapPoint(box, point) : null;
}

/**
 * Snapped start/end points of the edge `source`→`target`, or null when an
 * endpoint shape is missing. Used by the renderer and by tool hit-testing
 * endpoint handles against the same geometry the renderer draws.
 */
export function edgeEndpoints(
  nodes: readonly EdgeNodeBox[],
  source: string,
  target: string,
): { start: ConnectorSnapPoint; end: ConnectorSnapPoint } | null {
  const boxes = boxesOf(nodes);
  const a = boxes.get(source);
  const b = boxes.get(target);
  if (!a || !b) return null;
  return coreSnapEndpoints(a, b);
}

export function straightPath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

export function curvedPath(start: { x: number; y: number }, end: { x: number; y: number }): string {
  const dx = Math.abs(end.x - start.x);
  const cp = Math.max(40, dx / 2);
  return `M ${start.x} ${start.y} C ${start.x + cp} ${start.y}, ${end.x - cp} ${end.y}, ${end.x} ${end.y}`;
}

/**
 * DiagramEdges — render the edge layer for a diagram scene.
 *
 * Edges are derived from the underlying `connectsTo` attributes and
 * are not stored as Layer objects in the schema (the SSR template
 * synthesizes them at render time too). Drawn behind the node cards
 * so the cards visually clip the edge endpoints.
 *
 * Path geometry matches `diagramBlock.ts` (cubic-bezier with
 * horizontal-ish control points + a clipped endpoint on the node's
 * bounding rect), so editor and preview show the same curves.
 */

import type { SceneEdge } from '../commands/SceneCommand';
import { NODE_WIDTH, NODE_HEIGHT, type DiagramNodeDescriptor } from './nodeCard';

interface DiagramEdgesProps {
  nodes: readonly DiagramNodeDescriptor[];
  edges: readonly SceneEdge[];
  /** Optional callback for click-to-select / delete on an edge. */
  onEdgeClick?: (edge: SceneEdge) => void;
}

interface NodeBox {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function DiagramEdges({ nodes, edges, onEdgeClick }: DiagramEdgesProps) {
  const boxById = new Map<string, NodeBox>();
  for (const n of nodes) {
    const w = n.width ?? NODE_WIDTH;
    const h = n.height ?? NODE_HEIGHT;
    boxById.set(n.id, {
      cx: n.x + w / 2,
      cy: n.y + h / 2,
      rx: w / 2,
      ry: h / 2,
    });
  }

  return (
    <g className="squisq-scene-edges">
      <defs>
        <marker
          id="squisq-scene-edge-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="squisq-scene-edge-arrow" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const a = boxById.get(edge.source);
        const b = boxById.get(edge.target);
        if (!a || !b) return null;
        const d = edgePath(a, b);
        return (
          <g key={edge.id} onClick={onEdgeClick ? () => onEdgeClick(edge) : undefined}>
            <path
              d={d}
              className="squisq-scene-edge-path"
              markerEnd="url(#squisq-scene-edge-arrow)"
            />
            {edge.label ? (
              <text
                x={(a.cx + b.cx) / 2}
                y={(a.cy + b.cy) / 2}
                className="squisq-scene-edge-label"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function edgePath(a: NodeBox, b: NodeBox): string {
  const start = edgePoint(a, b);
  const end = edgePoint(b, a);
  const dx = Math.abs(end.x - start.x);
  const cp = Math.max(40, dx / 2);
  return `M ${start.x} ${start.y} C ${start.x + cp} ${start.y}, ${end.x - cp} ${end.y}, ${end.x} ${end.y}`;
}

function edgePoint(from: NodeBox, to: NodeBox): { x: number; y: number } {
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

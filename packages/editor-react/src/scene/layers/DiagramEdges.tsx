/**
 * DiagramEdges — render the edge layer for a diagram or drawing scene.
 *
 * Edges are derived from `connectsTo` / `from`–`to` attributes and are not
 * stored as Layer objects (the SSR templates synthesize them at render time
 * too). Drawn behind the shape cards so the cards clip the edge endpoints.
 *
 * Routing (`variant` default, per-edge `routing` override), end markers
 * (`startMarker`/`endMarker`), and dash come from the shared core geometry
 * (`connectorPath` / `markerPath`) so the editor and the SSR `PathLayer`
 * renderer draw identical connectors. When `selectedId` is set, that edge is
 * highlighted and given endpoint-handle markers (the active tool drives the
 * drag).
 */

import type { MarkerStyle } from '@bendyline/squisq/schemas';
import { connectorPath, markerPath } from '@bendyline/squisq/doc';
import type { SceneEdge } from '../commands/SceneCommand';
import { boxesOf, edgePoint } from './edgeGeometry';
import type { EdgeNodeBox } from './edgeGeometry';

interface DiagramEdgesProps {
  nodes: readonly EdgeNodeBox[];
  edges: readonly SceneEdge[];
  /** Default routing when an edge sets none. Default 'curved' (diagrams). */
  variant?: 'curved' | 'straight';
  /** Id of the currently-selected edge (drawn highlighted, with handles). */
  selectedId?: string | null;
  /** Click handler for select-to-edit / delete on an edge. */
  onEdgeClick?: (edge: SceneEdge) => void;
}

/** Marker styles that carry a glyph (everything except 'none'). */
const MARKER_STYLES: MarkerStyle[] = ['arrow', 'open', 'diamond', 'circle', 'square'];

function markerId(style: MarkerStyle, dir: 'start' | 'end'): string {
  return `squisq-edge-${style}-${dir}`;
}

export function DiagramEdges({
  nodes,
  edges,
  variant = 'curved',
  selectedId,
  onEdgeClick,
}: DiagramEdgesProps) {
  const boxById = boxesOf(nodes);
  const defaultRouting = variant === 'straight' ? 'straight' : 'curved';

  return (
    <g className="squisq-scene-edges">
      <defs>
        {(['start', 'end'] as const).flatMap((dir) =>
          MARKER_STYLES.map((style) => {
            const mp = markerPath(style, dir);
            if (!mp) return null;
            return (
              <marker
                key={markerId(style, dir)}
                id={markerId(style, dir)}
                viewBox="0 0 10 10"
                refX={dir === 'end' ? 9 : 1}
                refY={5}
                markerWidth={8}
                markerHeight={8}
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path
                  d={mp.d}
                  className={
                    mp.filled ? 'squisq-scene-edge-arrow' : 'squisq-scene-edge-marker-open'
                  }
                />
              </marker>
            );
          }),
        )}
      </defs>
      {edges.map((edge) => {
        const a = boxById.get(edge.source);
        const b = boxById.get(edge.target);
        if (!a || !b) return null;
        const start = edgePoint(a, b);
        const end = edgePoint(b, a);
        const d = connectorPath(edge.routing ?? defaultRouting, start, end);
        const startMarker = edge.startMarker ?? 'none';
        const endMarker = edge.endMarker ?? 'arrow';
        const selected = selectedId === edge.id;
        return (
          <g
            key={edge.id}
            className={selected ? 'squisq-scene-edge selected' : 'squisq-scene-edge'}
            onClick={onEdgeClick ? () => onEdgeClick(edge) : undefined}
          >
            <path
              d={d}
              className="squisq-scene-edge-path"
              strokeDasharray={edge.dasharray}
              markerStart={
                startMarker !== 'none' ? `url(#${markerId(startMarker, 'start')})` : undefined
              }
              markerEnd={endMarker !== 'none' ? `url(#${markerId(endMarker, 'end')})` : undefined}
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
            {selected ? (
              <>
                <circle cx={start.x} cy={start.y} r={6} className="squisq-scene-edge-handle" />
                <circle cx={end.x} cy={end.y} r={6} className="squisq-scene-edge-handle" />
              </>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

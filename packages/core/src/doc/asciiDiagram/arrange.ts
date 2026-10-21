/**
 * Auto-arrange for ASCII diagrams: every box gets a new grid position from
 * squisq-graph's layered layout, so connections flow one way and cross as
 * little as possible. Labels, containment and the edge set are untouched;
 * only `col`/`row` (and box sizes grown to what the renderer would draw
 * anyway) change.
 *
 * Box sizes match `renderAsciiDiagram`'s own rules (`leafBoxSize`,
 * `containerBoxMargins`), and the renderer derives container rects from
 * their children, so the arranged diagram renders without the collision
 * pass having to move anything.
 *
 * The renderer joins two boxes side to side only when their rows overlap,
 * so top-to-bottom is the flow it always draws faithfully. Every
 * arrangement is rendered and re-parsed before it is returned; one that
 * would lose an edge or a label falls back to the other direction, and
 * failing both, the diagram comes back unchanged.
 */

import { layoutGraph, type LayoutGraph } from '@bendyline/squisq-graph';
import { parseAsciiDiagram } from './parse.js';
import {
  computeSideDegrees,
  containerBoxMargins,
  leafBoxSize,
  renderAsciiDiagram,
} from './render.js';
import type { AsciiDiagram, AsciiDiagramNode } from './types.js';

export interface ArrangeAsciiDiagramOptions {
  /** Which way connections flow: top to bottom (default) or left to right. */
  direction?: 'down' | 'right';
}

/** Grid cells are about twice as tall as they are wide. */
const CELL_ASPECT = 2;
const TARGET_ASPECT = 1.6;

export function arrangeAsciiDiagram(
  diagram: AsciiDiagram,
  options: ArrangeAsciiDiagramOptions = {},
): AsciiDiagram {
  if (diagram.nodes.length === 0) return diagram;
  const first = options.direction ?? 'down';
  const meaning = diagramMeaning(diagram);
  const asRendered = diagramMeaning(parseAsciiDiagram(renderAsciiDiagram(diagram)));
  for (const direction of [first, first === 'down' ? 'right' : 'down'] as const) {
    const arranged = arrangeOnce(diagram, direction);
    const back = diagramMeaning(parseAsciiDiagram(renderAsciiDiagram(arranged)));
    // The renderer may drop what it cannot draw (an over-long edge label);
    // an arrangement may lose exactly that, never more.
    if (back === meaning || back === asRendered) return arranged;
  }
  return diagram;
}

/** What a diagram says, independent of where its boxes sit. */
function diagramMeaning(d: AsciiDiagram): string {
  const labelOf = new Map(d.nodes.map((n) => [n.id, n.label]));
  const nodes = d.nodes
    .map((n) => JSON.stringify([n.label, n.containerId ? labelOf.get(n.containerId) : null]))
    .sort();
  const edges = d.edges
    .map((e) => {
      const ends = [labelOf.get(e.source) ?? '', labelOf.get(e.target) ?? ''];
      if (!e.directed) ends.sort();
      return JSON.stringify([...ends, e.label ?? null, e.directed]);
    })
    .sort();
  return JSON.stringify([nodes, edges]);
}

function arrangeOnce(diagram: AsciiDiagram, direction: 'down' | 'right'): AsciiDiagram {
  const ids = new Set(diagram.nodes.map((n) => n.id));
  const parentOf = (n: AsciiDiagramNode): string | undefined =>
    n.containerId && n.containerId !== n.id && ids.has(n.containerId) ? n.containerId : undefined;
  const containers = new Set(diagram.nodes.map(parentOf).filter((p): p is string => !!p));
  const longestLabel = diagram.edges.reduce((m, e) => Math.max(m, (e.label ?? '').length), 0);
  const titleRows = diagram.nodes
    .filter((n) => containers.has(n.id))
    .reduce((m, n) => Math.max(m, containerBoxMargins(n.label).top), 2);

  const right = direction === 'right';
  const settings = {
    direction,
    integerCoordinates: true,
    nodeSpacing: right ? 2 : 4,
    layerSpacing: right ? Math.max(8, longestLabel + 6) : 3,
    edgeSpacing: 2,
    componentSpacing: right ? 4 : 2,
    containerPadding: { top: titleRows, right: 2, bottom: 2, left: 2 },
    aspectRatio: TARGET_ASPECT * CELL_ASPECT,
  } as const;

  // Sides depend on where boxes land, and box sizes on how many edges each
  // side carries: guess from the flow direction, lay out, then grow any box
  // the renderer would grow and lay out once more.
  const degrees = new Map(
    diagram.nodes.map((n) => [n.id, { top: 0, bottom: 0, left: 0, right: 0 }]),
  );
  for (const e of diagram.edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue;
    degrees.get(e.source)![right ? 'right' : 'bottom']++;
    degrees.get(e.target)![right ? 'left' : 'top']++;
  }

  let arranged = diagram.nodes;
  for (let pass = 0; pass < 3; pass++) {
    const graph: LayoutGraph = {
      nodes: diagram.nodes.map((n) => {
        const parent = parentOf(n);
        if (containers.has(n.id)) {
          return { id: n.id, width: containerBoxMargins(n.label).minWidth, height: 3, parent };
        }
        const size = leafBoxSize(n, degrees.get(n.id)!);
        return { id: n.id, width: size.wCols, height: size.hRows, parent };
      }),
      edges: diagram.edges.map((e, i) => ({ id: String(i), source: e.source, target: e.target })),
    };
    const result = layoutGraph(graph, settings);
    arranged = diagram.nodes.map((n, i) => {
      const placed = result.nodes[i]!;
      // Containers keep a minimal size: the renderer derives their rect from
      // their children and never shrinks below the authored width.
      return containers.has(n.id)
        ? { ...n, col: placed.x, row: placed.y, wCols: graph.nodes[i]!.width, hRows: 3 }
        : { ...n, col: placed.x, row: placed.y, wCols: placed.width, hRows: placed.height };
    });

    let grew = false;
    const actual = computeSideDegrees(arranged, diagram.edges);
    for (const n of arranged) {
      if (containers.has(n.id)) continue;
      const need = leafBoxSize(n, actual.get(n.id)!);
      if (need.wCols > n.wCols || need.hRows > n.hRows) {
        const d = degrees.get(n.id)!;
        const a = actual.get(n.id)!;
        degrees.set(n.id, {
          top: Math.max(d.top, a.top),
          bottom: Math.max(d.bottom, a.bottom),
          left: Math.max(d.left, a.left),
          right: Math.max(d.right, a.right),
        });
        grew = true;
      }
    }
    if (!grew) break;
  }

  return {
    ...diagram,
    nodes: [...arranged].sort((a, b) => a.row - b.row || a.col - b.col),
  };
}

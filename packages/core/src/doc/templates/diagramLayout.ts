/**
 * Diagram layout — shared between the read-only SVG render path
 * (`diagramBlock` template) and the interactive editor (React Flow in
 * `@bendyline/squisq-editor-react`). Same children + same options always
 * produce the same node positions and edge list, so previews and the
 * editor stay visually consistent.
 *
 * Layout rules:
 * 1. Children with both `x` and `y` set keep their authored coordinates.
 * 2. Children missing either coordinate are auto-placed below the bounding
 *    box of the explicitly-positioned children: by a layered layout
 *    (squisq-graph) when connections run between them, so the flow reads
 *    one way and crosses little, otherwise in a square-ish grid in
 *    declaration order.
 * 3. Edges come from each child's `connectsTo`. Targets that don't match
 *    any sibling id are dropped (and counted in `warnings`).
 */

import { layoutGraph } from '@bendyline/squisq-graph';
import type { Block, BlockConnection } from '../../schemas/Doc.js';

export interface DiagramNodePosition {
  /** Block id (matches `Block.id`). */
  id: string;
  /** Display label (block title or fallback to id). */
  label: string;
  /** Pixel x coordinate (canvas-relative). */
  x: number;
  /** Pixel y coordinate (canvas-relative). */
  y: number;
  /** True when the position came from `x=`/`y=` attributes; false when auto-laid out. */
  pinned: boolean;
  /** Optional `.class` tokens carried over from the heading. */
  classes?: string[];
}

export interface DiagramEdge {
  /** Synthetic stable edge id. */
  id: string;
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** Connection type from `connectsTo=target:type` (used as edge label). */
  type?: string;
}

export interface DiagramLayout {
  nodes: DiagramNodePosition[];
  edges: DiagramEdge[];
  warnings: string[];
}

export interface DiagramLayoutOptions {
  /** Horizontal grid pitch between auto-laid-out nodes. Default: 260 (node width 180 + 80 air). */
  gapX?: number;
  /** Vertical grid pitch between auto-laid-out nodes. Default: 140. */
  gapY?: number;
  /** Padding around the explicit-positions bounding box before the grid starts. Default: 80. */
  gridPad?: number;
  /** Origin x for the grid when no explicit nodes anchor it. Default: 80. */
  gridOriginX?: number;
  /** Origin y for the grid when no explicit nodes anchor it. Default: 80. */
  gridOriginY?: number;
  /** Node size the layered layout spaces for. Default: 180 × 64, the diagram card. */
  nodeWidth?: number;
  nodeHeight?: number;
  /** Which way connected auto-placed nodes flow. Default: `right`. */
  direction?: 'right' | 'down';
}

const DEFAULT_OPTS: Required<DiagramLayoutOptions> = {
  gapX: 260,
  gapY: 140,
  gridPad: 80,
  gridOriginX: 80,
  gridOriginY: 80,
  nodeWidth: 180,
  nodeHeight: 64,
  direction: 'right',
};

/**
 * Compute node positions and edges for a diagram from a parent block's
 * children. Pure function — same inputs always produce the same output.
 */
export function computeDiagramLayout(
  children: readonly Block[],
  options: DiagramLayoutOptions = {},
): DiagramLayout {
  const opts = { ...DEFAULT_OPTS, ...options };
  const warnings: string[] = [];

  // First pass: extract explicit positions, record which children still need a grid slot.
  type Entry = { child: Block; pinned: boolean; x: number; y: number };
  const entries: Entry[] = [];
  const unpositionedIdx: number[] = [];

  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    const hasX = typeof c.x === 'number';
    const hasY = typeof c.y === 'number';
    if (hasX && hasY) {
      entries.push({ child: c, pinned: true, x: c.x as number, y: c.y as number });
    } else {
      entries.push({ child: c, pinned: false, x: 0, y: 0 });
      unpositionedIdx.push(i);
    }
  }

  // Second pass: auto-place unpositioned children below the pinned ones.
  if (unpositionedIdx.length > 0) {
    // Find the bottom-right of the pinned bounding box so the placement sits below it.
    let baseX = opts.gridOriginX;
    let baseY = opts.gridOriginY;
    const pinned = entries.filter((e) => e.pinned);
    if (pinned.length > 0) {
      const minX = Math.min(...pinned.map((e) => e.x));
      const maxY = Math.max(...pinned.map((e) => e.y));
      baseX = minX;
      baseY = maxY + opts.gridPad + opts.gapY;
    }
    const placed = layeredPlacement(children, unpositionedIdx, opts);
    const cols = Math.max(1, Math.ceil(Math.sqrt(unpositionedIdx.length)));
    unpositionedIdx.forEach((entryIdx, k) => {
      const at = placed?.get(entryIdx) ?? {
        x: (k % cols) * opts.gapX,
        y: Math.floor(k / cols) * opts.gapY,
      };
      entries[entryIdx].x = baseX + at.x;
      entries[entryIdx].y = baseY + at.y;
    });
  }

  // Third pass: emit nodes + the id-set used to validate edge targets.
  const nodes: DiagramNodePosition[] = entries.map((e) => ({
    id: e.child.id,
    label: e.child.title ?? e.child.id,
    x: e.x,
    y: e.y,
    pinned: e.pinned,
    ...(e.child.classes && e.child.classes.length > 0 ? { classes: e.child.classes } : {}),
  }));
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Fourth pass: emit edges from each child's connectsTo, dropping ghosts.
  const edges: DiagramEdge[] = [];
  const seenEdgeIds = new Set<string>();
  for (const child of children) {
    if (!child.connectsTo) continue;
    for (const conn of child.connectsTo) {
      if (!nodeIds.has(conn.target)) {
        warnings.push(`Edge from "${child.id}" to "${conn.target}" dropped: no such sibling node`);
        continue;
      }
      const edgeId = makeEdgeId(child.id, conn);
      if (seenEdgeIds.has(edgeId)) continue;
      seenEdgeIds.add(edgeId);
      edges.push({
        id: edgeId,
        source: child.id,
        target: conn.target,
        ...(conn.type ? { type: conn.type } : {}),
      });
    }
  }

  return { nodes, edges, warnings };
}

/**
 * Positions for the unpositioned children, relative to the placement origin,
 * when connections run between them; null when none do, so a diagram of
 * unconnected cards keeps its familiar grid. Spacing follows the grid pitch:
 * the gaps between cards are what `gapX`/`gapY` leave around a card.
 */
function layeredPlacement(
  children: readonly Block[],
  unpositionedIdx: readonly number[],
  opts: Required<DiagramLayoutOptions>,
): Map<number, { x: number; y: number }> | null {
  const free = new Set(unpositionedIdx.map((i) => children[i].id));
  const edges: { id: string; source: string; target: string }[] = [];
  for (const i of unpositionedIdx) {
    for (const conn of children[i].connectsTo ?? []) {
      if (free.has(conn.target) && conn.target !== children[i].id) {
        edges.push({ id: String(edges.length), source: children[i].id, target: conn.target });
      }
    }
  }
  if (edges.length === 0) return null;
  const across = opts.direction === 'right';
  const result = layoutGraph(
    {
      nodes: unpositionedIdx.map((i) => ({
        id: children[i].id,
        width: opts.nodeWidth,
        height: opts.nodeHeight,
      })),
      edges,
    },
    {
      direction: opts.direction,
      layerSpacing: Math.max(0, across ? opts.gapX - opts.nodeWidth : opts.gapY - opts.nodeHeight),
      nodeSpacing: Math.max(0, across ? opts.gapY - opts.nodeHeight : opts.gapX - opts.nodeWidth),
      componentSpacing: Math.max(0, opts.gapX - opts.nodeWidth),
      // The template draws its own connectors between card sides; only the
      // positions are used, so no room is reserved for routing tracks.
      edgeSpacing: 1,
    },
  );
  const out = new Map<number, { x: number; y: number }>();
  unpositionedIdx.forEach((entryIdx, k) => {
    const n = result.nodes[k];
    out.set(entryIdx, { x: Math.round(n.x), y: Math.round(n.y) });
  });
  return out;
}

function makeEdgeId(source: string, conn: BlockConnection): string {
  return conn.type ? `${source}->${conn.target}:${conn.type}` : `${source}->${conn.target}`;
}

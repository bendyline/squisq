/**
 * Diagram layout — shared between the read-only SVG render path
 * (`diagramBlock` template) and the interactive editor (React Flow in
 * `@bendyline/squisq-editor-react`). Same children + same options always
 * produce the same node positions and edge list, so previews and the
 * editor stay visually consistent.
 *
 * Layout rules:
 * 1. Children with both `x` and `y` set keep their authored coordinates.
 * 2. Children missing either coordinate are auto-placed in a square-ish
 *    grid in declaration order, offset below the bounding box of the
 *    explicitly-positioned children.
 * 3. Edges come from each child's `connectsTo`. Targets that don't match
 *    any sibling id are dropped (and counted in `warnings`).
 */

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
}

const DEFAULT_OPTS: Required<DiagramLayoutOptions> = {
  gapX: 260,
  gapY: 140,
  gridPad: 80,
  gridOriginX: 80,
  gridOriginY: 80,
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

  // Second pass: lay out unpositioned children in a square-ish grid.
  if (unpositionedIdx.length > 0) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(unpositionedIdx.length)));
    // Find the bottom-right of the pinned bounding box so the grid sits below it.
    let baseX = opts.gridOriginX;
    let baseY = opts.gridOriginY;
    const pinned = entries.filter((e) => e.pinned);
    if (pinned.length > 0) {
      const minX = Math.min(...pinned.map((e) => e.x));
      const maxY = Math.max(...pinned.map((e) => e.y));
      baseX = minX;
      baseY = maxY + opts.gridPad + opts.gapY;
    }
    unpositionedIdx.forEach((entryIdx, k) => {
      const col = k % cols;
      const row = Math.floor(k / cols);
      entries[entryIdx].x = baseX + col * opts.gapX;
      entries[entryIdx].y = baseY + row * opts.gapY;
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

function makeEdgeId(source: string, conn: BlockConnection): string {
  return conn.type ? `${source}->${conn.target}:${conn.type}` : `${source}->${conn.target}`;
}

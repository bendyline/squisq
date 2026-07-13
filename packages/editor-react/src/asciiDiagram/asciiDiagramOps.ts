/**
 * Pure data operations over the ASCII diagram model — the write-direction
 * half of the fence-is-source-of-truth loop:
 *
 *   fence text → parseAsciiDiagram → op → renderAsciiDiagram → fence text
 *
 * Every op returns a new AsciiDiagram (inputs are never mutated) and
 * maintains the invariants the renderer/parser fixpoint relies on:
 * container moves translate whole subtrees, removals promote children and
 * drop incident edges, sizes never fall below what a label needs.
 */

import type { AsciiDiagram, AsciiDiagramEdge, AsciiDiagramNode } from '@bendyline/squisq/doc';

/**
 * Make arbitrary (rename-dialog) input safe as a box label: box-drawing /
 * arrow glyphs would corrupt the art, and the Scene's inline editor is
 * single-line, so newlines collapse to spaces.
 */
export function sanitizeAsciiLabel(label: string): string {
  return label
    .replace(/[─-╿▲▼◀-◄▶-►←-↓`]/gu, ' ') // backticks would terminate the fence
    .replace(/\s+/g, ' ')
    .trim();
}

function descendantsOf(diagram: AsciiDiagram, nodeId: string): Set<string> {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of diagram.nodes) {
      if (out.has(n.id)) continue;
      if (n.containerId === nodeId || (n.containerId && out.has(n.containerId))) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Move a node to (col, row); a container drags its whole subtree along. */
export function moveNodeOp(
  diagram: AsciiDiagram,
  nodeId: string,
  col: number,
  row: number,
): AsciiDiagram {
  const node = diagram.nodes.find((n) => n.id === nodeId);
  if (!node) return diagram;
  const dCol = Math.max(0, col) - node.col;
  const dRow = Math.max(0, row) - node.row;
  if (dCol === 0 && dRow === 0) return diagram;
  const moving = descendantsOf(diagram, nodeId);
  moving.add(nodeId);
  return {
    ...diagram,
    nodes: diagram.nodes.map((n) =>
      moving.has(n.id)
        ? { ...n, col: Math.max(0, n.col + dCol), row: Math.max(0, n.row + dRow) }
        : n,
    ),
  };
}

/** Resize a node (grid cells). Clamped so the label always fits. */
export function resizeNodeOp(
  diagram: AsciiDiagram,
  nodeId: string,
  wCols: number,
  hRows: number,
): AsciiDiagram {
  const node = diagram.nodes.find((n) => n.id === nodeId);
  if (!node) return diagram;
  const labelLines = node.label.length > 0 ? node.label.split('\n') : [];
  const minW = Math.max(3, labelLines.reduce((w, l) => Math.max(w, l.length), 0) + 4);
  const minH = Math.max(3, labelLines.length + 2);
  return {
    ...diagram,
    nodes: diagram.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            wCols: Math.max(minW, Math.round(wCols)),
            hRows: Math.max(minH, Math.round(hRows)),
          }
        : n,
    ),
  };
}

/** Add a directed edge; duplicates (same source/target/label) are no-ops. */
export function addEdgeOp(
  diagram: AsciiDiagram,
  source: string,
  target: string,
  label?: string,
): AsciiDiagram {
  const ids = new Set(diagram.nodes.map((n) => n.id));
  if (!ids.has(source) || !ids.has(target) || source === target) return diagram;
  const exists = diagram.edges.some(
    (e) => e.source === source && e.target === target && (e.label ?? '') === (label ?? ''),
  );
  if (exists) return diagram;
  const edge: AsciiDiagramEdge = {
    source,
    target,
    ...(label ? { label } : {}),
    directed: true,
  };
  return { ...diagram, edges: [...diagram.edges, edge] };
}

/**
 * Remove an edge. A label-qualified call removes the exact match; without
 * a label the first (source, target) match goes — mirroring the legacy
 * `removeConnection` semantics.
 */
export function removeEdgeOp(
  diagram: AsciiDiagram,
  source: string,
  target: string,
  label?: string,
): AsciiDiagram {
  let removed = false;
  const edges = diagram.edges.filter((e) => {
    if (removed) return true;
    const match =
      e.source === source &&
      e.target === target &&
      (label !== undefined ? (e.label ?? '') === label : true);
    if (match) {
      removed = true;
      return false;
    }
    return true;
  });
  return removed ? { ...diagram, edges } : diagram;
}

/**
 * Rename a node. The label drives the node's parse-derived id, so edges
 * and containment references are rewritten to the id the next parse will
 * produce. (Selection in the canvas drops after a rename — documented.)
 */
export function renameNodeOp(diagram: AsciiDiagram, nodeId: string, label: string): AsciiDiagram {
  const node = diagram.nodes.find((n) => n.id === nodeId);
  if (!node) return diagram;
  const clean = sanitizeAsciiLabel(label);
  if (clean.length === 0 || clean === node.label) return diagram;
  return {
    ...diagram,
    nodes: diagram.nodes.map((n) => (n.id === nodeId ? { ...n, label: clean } : n)),
  };
}

/** Add a node at (col, row). Inherits a container when placed inside one. */
export function addNodeOp(
  diagram: AsciiDiagram,
  opts: { col: number; row: number; label?: string },
): { diagram: AsciiDiagram; label: string } {
  // First free "Node N" label.
  let label = opts.label;
  if (!label) {
    let i = 1;
    const labels = new Set(diagram.nodes.map((n) => n.label.split('\n')[0]));
    while (labels.has(`Node ${i}`)) i++;
    label = `Node ${i}`;
  }
  const clean = sanitizeAsciiLabel(label) || 'Node';
  const col = Math.max(0, Math.round(opts.col));
  const row = Math.max(0, Math.round(opts.row));
  const wCols = clean.length + 4;
  const hRows = 3;
  // Container inheritance: the new box's center falls inside a container.
  const centerCol = col + wCols / 2;
  const centerRow = row + hRows / 2;
  const containers = diagram.nodes
    .filter((n) => diagram.nodes.some((m) => m.containerId === n.id))
    .filter(
      (n) =>
        centerCol > n.col &&
        centerCol < n.col + n.wCols &&
        centerRow > n.row &&
        centerRow < n.row + n.hRows,
    )
    .sort((a, b) => a.wCols * a.hRows - b.wCols * b.hRows);
  const node: AsciiDiagramNode = {
    id: `__new-${diagram.nodes.length}`, // provisional; the re-parse derives the real slug id
    label: clean,
    col,
    row,
    wCols,
    hRows,
    ...(containers[0] ? { containerId: containers[0].id } : {}),
  };
  return { diagram: { ...diagram, nodes: [...diagram.nodes, node] }, label: clean };
}

/**
 * Remove a node: incident edges (both directions) drop, direct children
 * are promoted to the removed node's own container (or top level).
 */
export function removeNodeOp(diagram: AsciiDiagram, nodeId: string): AsciiDiagram {
  const node = diagram.nodes.find((n) => n.id === nodeId);
  if (!node) return diagram;
  const nodes = diagram.nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => {
      if (n.containerId !== nodeId) return n;
      const promoted = { ...n };
      if (node.containerId) promoted.containerId = node.containerId;
      else delete promoted.containerId;
      return promoted;
    });
  const edges = diagram.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return { ...diagram, nodes, edges };
}

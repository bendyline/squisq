/**
 * The input graph as a containment tree with validated edges, in the layout
 * frame: layers always run along x, so a top-to-bottom drawing swaps every
 * width and height on the way in and back on the way out.
 */

import type { LayoutGraph } from '../types.js';

export interface HNode {
  index: number;
  id: string;
  /** Extent along the layer axis. */
  width: number;
  /** Extent across the layers. */
  height: number;
  /** Index of the holding container; the root for top-level nodes, -1 for the root itself. */
  parent: number;
  children: number[];
  depth: number;
}

export interface HEdge {
  /** Position in the input's edge list. */
  input: number;
  id: string;
  source: number;
  target: number;
  weight: number;
}

export interface Hierarchy {
  /** Input nodes in input order, then the virtual root. */
  nodes: HNode[];
  root: number;
  edges: HEdge[];
  dropped: number;
}

function size(value: number, integer: boolean): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return integer ? Math.ceil(value) : value;
}

export function buildHierarchy(
  graph: LayoutGraph,
  transpose: boolean,
  integer: boolean,
): Hierarchy {
  const n = graph.nodes.length;
  const root = n;
  const byId = new Map<string, number>();
  graph.nodes.forEach((node, i) => {
    if (!byId.has(node.id)) byId.set(node.id, i);
  });

  const parent = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const p = graph.nodes[i]!.parent;
    const pi = p === undefined ? undefined : byId.get(p);
    parent[i] = pi === undefined || pi === i ? root : pi;
  }
  parent[root] = -1;

  // Depths, cutting any parent cycle: the node where a walk meets itself
  // moves to the top level.
  const depth = new Int32Array(n + 1).fill(-1);
  depth[root] = 0;
  for (let i = 0; i < n; i++) {
    while (depth[i] === -1) {
      const path: number[] = [];
      const onPath = new Set<number>();
      let v = i;
      while (depth[v] === -1 && !onPath.has(v)) {
        onPath.add(v);
        path.push(v);
        v = parent[v]!;
      }
      if (depth[v] === -1) {
        parent[v] = root;
        continue;
      }
      for (let k = path.length - 1; k >= 0; k--) {
        const node = path[k]!;
        depth[node] = depth[parent[node]!]! + 1;
      }
    }
  }

  const nodes: HNode[] = graph.nodes.map((node, i) => {
    const w = size(node.width, integer);
    const h = size(node.height, integer);
    return {
      index: i,
      id: node.id,
      width: transpose ? h : w,
      height: transpose ? w : h,
      parent: parent[i]!,
      children: [],
      depth: depth[i]!,
    };
  });
  nodes.push({ index: root, id: '', width: 0, height: 0, parent: -1, children: [], depth: 0 });
  for (let i = 0; i < n; i++) nodes[parent[i]!]!.children.push(i);

  const edges: HEdge[] = [];
  let dropped = 0;
  graph.edges.forEach((edge, input) => {
    const s = byId.get(edge.source);
    const t = byId.get(edge.target);
    if (
      s === undefined ||
      t === undefined ||
      s === t ||
      isAncestor(nodes, s, t) ||
      isAncestor(nodes, t, s)
    ) {
      dropped++;
      return;
    }
    const w = edge.weight;
    edges.push({
      input,
      id: edge.id,
      source: s,
      target: t,
      weight: w !== undefined && Number.isFinite(w) && w > 0 ? w : 1,
    });
  });

  return { nodes, root, edges, dropped };
}

function isAncestor(nodes: readonly HNode[], ancestor: number, node: number): boolean {
  let v = nodes[node]!.parent;
  while (v !== -1) {
    if (v === ancestor) return true;
    v = nodes[v]!.parent;
  }
  return false;
}

/** The ancestor of `node` (or `node` itself) at `depth`. */
export function ancestorAt(nodes: readonly HNode[], node: number, depth: number): number {
  let v = node;
  while (nodes[v]!.depth > depth) v = nodes[v]!.parent;
  return v;
}

/** The deepest container holding both nodes. */
export function commonContainer(nodes: readonly HNode[], a: number, b: number): number {
  let x = nodes[a]!.parent;
  let y = nodes[b]!.parent;
  while (nodes[x]!.depth > nodes[y]!.depth) x = nodes[x]!.parent;
  while (nodes[y]!.depth > nodes[x]!.depth) y = nodes[y]!.parent;
  while (x !== y) {
    x = nodes[x]!.parent;
    y = nodes[y]!.parent;
  }
  return x;
}

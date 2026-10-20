/**
 * The interior of one container (or of the whole drawing): its children and
 * border ports split into connected blocks, each block laid out, then the
 * blocks packed. The block that touches the border ports spans the
 * container; the rest are shelved beneath it toward a target aspect ratio.
 */

import type { Padding, Point } from '../types.js';
import { type BlockEdge, type BlockNode, type BlockSettings, layoutBlock } from './block.js';
import { KIND_NODE, KIND_PORT } from './placement.js';

export interface LevelChild {
  width: number;
  height: number;
  model: number;
}

export interface LevelPort {
  side: 'in' | 'out';
}

export type LevelRef = { child: number; offset: number } | { port: number };

export interface LevelEdge {
  key: string;
  /** Drawn direction: `from` ends up left of `to`. */
  from: LevelRef;
  to: LevelRef;
  weight: number;
}

export interface LevelSettings extends Omit<BlockSettings, 'padIn' | 'padOut'> {
  padding: Padding;
  minWidth: number;
  minHeight: number;
  componentSpacing: number;
  /** Target width over height for the packed blocks. */
  aspect: number;
}

export interface LevelLayout {
  width: number;
  height: number;
  childX: Float64Array;
  childY: Float64Array;
  /** Height of each port on its border. */
  portY: Float64Array;
  /** Route per level-edge key, in this container's frame. */
  routes: Map<string, Point[]>;
  crossings: number;
  dummies: number;
}

interface Block {
  members: number[];
  hasPorts: boolean;
  model: number;
}

export function layoutLevel(
  children: readonly LevelChild[],
  ports: readonly LevelPort[],
  edges: readonly LevelEdge[],
  settings: LevelSettings,
): LevelLayout {
  const c = children.length;
  const total = c + ports.length;
  const idOf = (ref: LevelRef): number => ('child' in ref ? ref.child : c + ref.port);

  // Union-find over children and ports; every port with an edge joins one block.
  const parent = Int32Array.from({ length: total }, (_, i) => i);
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]!]!;
      v = parent[v]!;
    }
    return v;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const degree = new Int32Array(total);
  for (const edge of edges) {
    const a = idOf(edge.from);
    const b = idOf(edge.to);
    degree[a]!++;
    degree[b]!++;
    union(a, b);
  }
  let anchor = -1;
  for (let p = c; p < total; p++) {
    if (degree[p] === 0) continue;
    if (anchor < 0) anchor = p;
    else union(anchor, p);
  }

  const blocksByRoot = new Map<number, Block>();
  for (let v = 0; v < total; v++) {
    if (v >= c && degree[v] === 0) continue;
    const r = find(v);
    let block = blocksByRoot.get(r);
    if (!block) {
      block = { members: [], hasPorts: false, model: v < c ? children[v]!.model : Infinity };
      blocksByRoot.set(r, block);
    }
    block.members.push(v);
    if (v >= c) block.hasPorts = true;
    else block.model = Math.min(block.model, children[v]!.model);
  }
  const blocks = [...blocksByRoot.values()];
  const portBlock = blocks.find((b) => b.hasPorts);
  const rest = blocks
    .filter((b) => !b.hasPorts)
    .sort((a, b) => b.members.length - a.members.length || a.model - b.model);

  const edgesByBlock = new Map<Block, LevelEdge[]>();
  for (const edge of edges) {
    const block = blocksByRoot.get(find(idOf(edge.from)))!;
    const list = edgesByBlock.get(block);
    if (list) list.push(edge);
    else edgesByBlock.set(block, [edge]);
  }

  const { padding: pad } = settings;
  const blockSettings: BlockSettings = { ...settings, padIn: pad.left, padOut: pad.right };
  const laid = (block: Block) => {
    const local = new Map<number, number>();
    const nodes: BlockNode[] = block.members.map((v, k) => {
      local.set(v, k);
      if (v < c) {
        const child = children[v]!;
        return { kind: KIND_NODE, width: child.width, height: child.height, model: child.model };
      }
      return { kind: KIND_PORT, width: 0, height: 0, side: ports[v - c]!.side, model: v };
    });
    const blockEdges: BlockEdge[] = (edgesByBlock.get(block) ?? []).map((edge) => ({
      from: local.get(idOf(edge.from))!,
      to: local.get(idOf(edge.to))!,
      weight: edge.weight,
      fromOffset: 'child' in edge.from ? edge.from.offset : 0,
      toOffset: 'child' in edge.to ? edge.to.offset : 0,
      key: edge.key,
    }));
    return layoutBlock(nodes, blockEdges, blockSettings);
  };

  const portLaid = portBlock ? laid(portBlock) : null;
  const restLaid = rest.map(laid);
  const gap = settings.componentSpacing;

  // Shelf-pack the blocks without ports beneath the port block.
  const portX = portLaid?.hasIn ? 0 : pad.left;
  let top = pad.top;
  if (portLaid) top += portLaid.height + (restLaid.length > 0 ? gap : 0);
  let area = 0;
  let widest = 0;
  for (const b of restLaid) {
    area += (b.width + gap) * (b.height + gap);
    widest = Math.max(widest, b.width);
  }
  const rowLimit = Math.max(
    widest,
    Math.sqrt(area * settings.aspect),
    portLaid
      ? portLaid.width - (portLaid.hasIn ? pad.left : 0) - (portLaid.hasOut ? pad.right : 0)
      : 0,
  );
  const restAt: Point[] = [];
  let x = pad.left;
  let y = top;
  let rowHeight = 0;
  let right = portLaid && !portLaid.hasOut ? portX + portLaid.width : pad.left;
  let bottom = portLaid ? pad.top + portLaid.height : pad.top;
  for (const b of restLaid) {
    if (x > pad.left && x - pad.left + b.width > rowLimit + 1e-9) {
      x = pad.left;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    restAt.push({ x, y });
    right = Math.max(right, x + b.width);
    bottom = Math.max(bottom, y + b.height);
    x += b.width + gap;
    rowHeight = Math.max(rowHeight, b.height);
  }

  let width = Math.max(settings.minWidth, right + pad.right);
  if (portLaid?.hasOut) width = Math.max(width, portX + portLaid.width);
  let height = Math.max(settings.minHeight, bottom + pad.bottom);

  const childX = new Float64Array(c);
  const childY = new Float64Array(c);
  const portY = new Float64Array(ports.length);
  const routes = new Map<string, Point[]>();
  let crossings = 0;
  let dummies = 0;
  const settle = (
    block: Block,
    placed: ReturnType<typeof laid>,
    bx: number,
    by: number,
    outX?: number,
  ) => {
    const geometry = placed.finish(outX);
    block.members.forEach((v, k) => {
      if (v < c) {
        childX[v] = bx + geometry.x[k]!;
        childY[v] = by + geometry.y[k]!;
      } else {
        portY[v - c] = by + geometry.y[k]!;
      }
    });
    for (const [key, points] of geometry.routes) {
      routes.set(
        key,
        points.map((p) => ({ x: p.x + bx, y: p.y + by })),
      );
    }
    crossings += placed.crossings;
    dummies += placed.dummies;
  };
  if (portBlock && portLaid) settle(portBlock, portLaid, portX, pad.top, width - portX);
  rest.forEach((block, k) => settle(block, restLaid[k]!, restAt[k]!.x, restAt[k]!.y));

  // Ports with no edge inside: stacked on their border, after any routed ones.
  for (const side of ['in', 'out'] as const) {
    const free: number[] = [];
    let after = -Infinity;
    ports.forEach((port, p) => {
      if (port.side !== side) return;
      if (degree[c + p] === 0) free.push(p);
      else after = Math.max(after, portY[p]!);
    });
    if (free.length === 0) continue;
    const es = settings.edgeSpacing;
    let start = Number.isFinite(after)
      ? after + es
      : pad.top + (bottom - pad.top) / 2 - ((free.length - 1) * es) / 2;
    start = Math.max(pad.top, settings.integer ? Math.floor(start) : start);
    free.forEach((p, k) => {
      portY[p] = start + k * es;
    });
    height = Math.max(height, start + (free.length - 1) * es + pad.bottom);
  }

  return { width, height, childX, childY, portY, routes, crossings, dummies };
}

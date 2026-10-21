/**
 * `layoutGraph`: a compound layered ("Sugiyama") layout with orthogonal edge
 * routing, pure TypeScript and deterministic — the same input always gives
 * the same output, and ties are broken by input order.
 *
 * Every container is laid out on its own, innermost first, so a container's
 * contents always stay inside it. An edge that leaves a container does so
 * through a port on its border: out on the side the flow runs toward, in on
 * the side it comes from. Edges from one container toward the same outside
 * neighbor share a port, so they leave as one trunk rather than a fringe.
 *
 * The work happens in a left-to-right frame; a top-to-bottom drawing is the
 * same layout transposed.
 */

import {
  buildHierarchy,
  ancestorAt,
  commonContainer,
  type Hierarchy,
} from './internal/hierarchy.js';
import { feedbackRanks, type WeightedArc } from './internal/cycles.js';
import { type LevelEdge, type LevelLayout, type LevelRef, layoutLevel } from './internal/level.js';
import { simplify } from './internal/block.js';
import type {
  LaidOutEdge,
  LaidOutNode,
  LayoutGraph,
  LayoutOptions,
  LayoutResult,
  Padding,
  Point,
} from './types.js';

export const DEFAULT_LAYOUT_OPTIONS: Required<Omit<LayoutOptions, 'containerPadding'>> & {
  containerPadding: Padding;
} = {
  direction: 'right',
  nodeSpacing: 20,
  layerSpacing: 48,
  edgeSpacing: 8,
  componentSpacing: 40,
  containerPadding: { top: 28, right: 12, bottom: 12, left: 12 },
  aspectRatio: 1.6,
  orderingSweeps: 24,
  placementSweeps: 12,
  portSharing: 'neighbor',
  integerCoordinates: false,
};

type ResolvedOptions = typeof DEFAULT_LAYOUT_OPTIONS;

function nonNegative(value: number | undefined, fallback: number, integer: boolean): number {
  const v = value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
  return integer ? Math.ceil(v) : v;
}

export function resolveLayoutOptions(options: LayoutOptions = {}): ResolvedOptions {
  const d = DEFAULT_LAYOUT_OPTIONS;
  const integer = options.integerCoordinates === true;
  const pad = options.containerPadding ?? {};
  const count = (v: number | undefined, fallback: number): number =>
    v !== undefined && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  return {
    direction: options.direction === 'down' ? 'down' : 'right',
    nodeSpacing: nonNegative(options.nodeSpacing, d.nodeSpacing, integer),
    layerSpacing: nonNegative(options.layerSpacing, d.layerSpacing, integer),
    edgeSpacing: Math.max(
      integer ? 1 : 0.5,
      nonNegative(options.edgeSpacing, d.edgeSpacing, integer),
    ),
    componentSpacing: nonNegative(options.componentSpacing, d.componentSpacing, integer),
    containerPadding: {
      top: nonNegative(pad.top, d.containerPadding.top, integer),
      right: nonNegative(pad.right, d.containerPadding.right, integer),
      bottom: nonNegative(pad.bottom, d.containerPadding.bottom, integer),
      left: nonNegative(pad.left, d.containerPadding.left, integer),
    },
    aspectRatio:
      options.aspectRatio !== undefined &&
      Number.isFinite(options.aspectRatio) &&
      options.aspectRatio > 0
        ? options.aspectRatio
        : d.aspectRatio,
    orderingSweeps: count(options.orderingSweeps, d.orderingSweeps),
    placementSweeps: count(options.placementSweeps, d.placementSweeps),
    portSharing: options.portSharing === 'container' ? 'container' : 'neighbor',
    integerCoordinates: integer,
  };
}

/** One original edge's path through the levels, in drawn order. */
interface EdgePlan {
  reversed: boolean;
  steps: { container: number; key: string }[];
}

type HRef = { node: number; port?: string } | { own: string };

interface LevelEdgeSpec {
  from: HRef;
  to: HRef;
  weight: number;
}

interface ContainerPorts {
  keys: string[];
  sides: ('in' | 'out')[];
  index: Map<string, number>;
}

export function layoutGraph(graph: LayoutGraph, options?: LayoutOptions): LayoutResult {
  const opts = resolveLayoutOptions(options);
  const transpose = opts.direction === 'down';
  const integer = opts.integerCoordinates;
  const h = buildHierarchy(graph, transpose, integer);
  const { nodes, root } = h;

  const reversedPair = orientLevels(h);

  const ports = new Map<number, ContainerPorts>();
  const levelEdges = new Map<number, Map<string, LevelEdgeSpec>>();
  const addPort = (container: number, key: string, side: 'in' | 'out'): void => {
    let entry = ports.get(container);
    if (!entry) {
      entry = { keys: [], sides: [], index: new Map() };
      ports.set(container, entry);
    }
    if (entry.index.has(key)) return;
    entry.index.set(key, entry.keys.length);
    entry.keys.push(key);
    entry.sides.push(side);
  };
  const addLevelEdge = (container: number, from: HRef, to: HRef, weight: number): string => {
    const key = `${refKey(from)}>${refKey(to)}`;
    let map = levelEdges.get(container);
    if (!map) {
      map = new Map();
      levelEdges.set(container, map);
    }
    const spec = map.get(key);
    if (spec) spec.weight += weight;
    else map.set(key, { from, to, weight });
    return key;
  };
  const isContainer = (v: number): boolean => nodes[v]!.children.length > 0;
  const chainUp = (from: number, to: number): number[] => {
    const chain = [from];
    while (chain[chain.length - 1] !== to) chain.push(nodes[chain[chain.length - 1]!]!.parent);
    return chain;
  };

  const plans: EdgePlan[] = h.edges.map((edge) => {
    const lca = commonContainer(nodes, edge.source, edge.target);
    const depth = nodes[lca]!.depth + 1;
    const a = ancestorAt(nodes, edge.source, depth);
    const b = ancestorAt(nodes, edge.target, depth);
    const reversed = reversedPair.get(`${a}>${b}`) === true;
    const [ds, dt, da, db] = reversed
      ? [edge.target, edge.source, b, a]
      : [edge.source, edge.target, a, b];
    const tag = reversed ? 'r' : '';
    const perNeighbor = opts.portSharing === 'neighbor';
    const outKey = perNeighbor ? `o${db}${tag}` : `o${tag}`;
    const inKey = perNeighbor ? `i${da}${tag}` : `i${tag}`;
    const steps: EdgePlan['steps'] = [];

    const up = chainUp(ds, da);
    for (const v of up) if (isContainer(v)) addPort(v, outKey, 'out');
    for (let k = 1; k < up.length; k++) {
      const from: HRef = { node: up[k - 1]!, port: isContainer(up[k - 1]!) ? outKey : undefined };
      steps.push({
        container: up[k]!,
        key: addLevelEdge(up[k]!, from, { own: outKey }, edge.weight),
      });
    }
    steps.push({
      container: lca,
      key: addLevelEdge(
        lca,
        { node: da, port: isContainer(da) ? outKey : undefined },
        { node: db, port: isContainer(db) ? inKey : undefined },
        edge.weight,
      ),
    });
    const downChain = chainUp(dt, db);
    for (const v of downChain) if (isContainer(v)) addPort(v, inKey, 'in');
    for (let k = downChain.length - 1; k >= 1; k--) {
      const to: HRef = {
        node: downChain[k - 1]!,
        port: isContainer(downChain[k - 1]!) ? inKey : undefined,
      };
      steps.push({
        container: downChain[k]!,
        key: addLevelEdge(downChain[k]!, { own: inKey }, to, edge.weight),
      });
    }
    return { reversed, steps };
  });

  // Innermost containers first.
  const layouts = new Map<number, LevelLayout>();
  const order: number[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const v = stack.pop()!;
    order.push(v);
    for (const child of nodes[v]!.children) if (isContainer(child)) stack.push(child);
  }
  const pad = transposePadding(opts.containerPadding, transpose);
  const zero: Padding = { top: 0, right: 0, bottom: 0, left: 0 };
  const half = (size: number): number => (integer ? Math.floor(size / 2) : size / 2);
  const sizeOf = (v: number): { width: number; height: number } => {
    const inner = layouts.get(v);
    return inner ? { width: inner.width, height: inner.height } : nodes[v]!;
  };

  for (let k = order.length - 1; k >= 0; k--) {
    const container = order[k]!;
    const kids = nodes[container]!.children;
    const local = new Map<number, number>();
    kids.forEach((v, i) => local.set(v, i));
    const own = ports.get(container);
    const toRef = (ref: HRef): LevelRef => {
      if ('own' in ref) return { port: own!.index.get(ref.own)! };
      const child = local.get(ref.node)!;
      if (ref.port !== undefined) {
        const inner = layouts.get(ref.node)!;
        return { child, offset: inner.portY[ports.get(ref.node)!.index.get(ref.port)!]! };
      }
      return { child, offset: half(sizeOf(ref.node).height) };
    };
    const edges: LevelEdge[] = [];
    for (const [key, spec] of levelEdges.get(container) ?? []) {
      edges.push({ key, from: toRef(spec.from), to: toRef(spec.to), weight: spec.weight });
    }
    const isRoot = container === root;
    layouts.set(
      container,
      layoutLevel(
        kids.map((v) => ({ ...sizeOf(v), model: v })),
        (own?.sides ?? []).map((side) => ({ side })),
        edges,
        {
          nodeSpacing: opts.nodeSpacing,
          layerSpacing: opts.layerSpacing,
          edgeSpacing: opts.edgeSpacing,
          orderingSweeps: opts.orderingSweeps,
          placementSweeps: opts.placementSweeps,
          integer,
          padding: isRoot ? zero : pad,
          minWidth: isRoot ? 0 : nodes[container]!.width,
          minHeight: isRoot ? 0 : nodes[container]!.height,
          componentSpacing: isRoot
            ? opts.componentSpacing
            : Math.max(opts.nodeSpacing, opts.componentSpacing / 2),
          aspect: transpose ? 1 / opts.aspectRatio : opts.aspectRatio,
        },
      ),
    );
  }

  // Absolute positions, outermost first.
  const absX = new Float64Array(nodes.length);
  const absY = new Float64Array(nodes.length);
  for (const container of order) {
    const inner = layouts.get(container)!;
    nodes[container]!.children.forEach((v, i) => {
      absX[v] = absX[container]! + inner.childX[i]!;
      absY[v] = absY[container]! + inner.childY[i]!;
    });
  }

  const out = (x: number, y: number): Point =>
    transpose
      ? { x: round(y, integer), y: round(x, integer) }
      : { x: round(x, integer), y: round(y, integer) };

  // Both corners are rounded and the size taken between them, so rounding
  // never makes siblings overlap or a child poke out of its container.
  const laidNodes: LaidOutNode[] = graph.nodes.map((_, v) => {
    const { width, height } = sizeOf(v);
    const corner = out(absX[v]!, absY[v]!);
    const far = out(absX[v]! + width, absY[v]! + height);
    return {
      id: nodes[v]!.id,
      x: corner.x,
      y: corner.y,
      width: round(far.x - corner.x, integer),
      height: round(far.y - corner.y, integer),
      container: isContainer(v),
    };
  });

  let reversedEdges = 0;
  const laidEdges: LaidOutEdge[] = h.edges.map((edge, e) => {
    const plan = plans[e]!;
    if (plan.reversed) reversedEdges++;
    const points: Point[] = [];
    for (const step of plan.steps) {
      const piece = layouts.get(step.container)!.routes.get(step.key) ?? [];
      for (const p of piece)
        points.push({ x: p.x + absX[step.container]!, y: p.y + absY[step.container]! });
    }
    let route = simplify(points).map((p) => out(p.x, p.y));
    route = simplify(route);
    if (plan.reversed) route.reverse();
    return {
      id: edge.id,
      source: graph.edges[edge.input]!.source,
      target: graph.edges[edge.input]!.target,
      points: route,
      reversed: plan.reversed,
    };
  });

  const rootLayout = layouts.get(root)!;
  let crossings = 0;
  let dummyNodes = 0;
  for (const layout of layouts.values()) {
    crossings += layout.crossings;
    dummyNodes += layout.dummies;
  }
  // Rounding each coordinate on its own can push an edge past the rounded total.
  let width = round(transpose ? rootLayout.height : rootLayout.width, integer);
  let height = round(transpose ? rootLayout.width : rootLayout.height, integer);
  for (const n of laidNodes) {
    width = Math.max(width, n.x + n.width);
    height = Math.max(height, n.y + n.height);
  }
  for (const e of laidEdges) {
    for (const p of e.points) {
      width = Math.max(width, p.x);
      height = Math.max(height, p.y);
    }
  }
  return {
    nodes: laidNodes,
    edges: laidEdges,
    width: round(width, integer),
    height: round(height, integer),
    stats: { crossings, reversedEdges, dummyNodes, droppedEdges: h.dropped },
  };
}

/**
 * Break cycles per container, over the edges lifted to that container's
 * children. Returns the lifted pairs `"a>b"` that are drawn against the flow.
 */
function orientLevels(h: Hierarchy): Map<string, boolean> {
  const { nodes } = h;
  const perLevel = new Map<number, Map<string, WeightedArc>>();
  for (const edge of h.edges) {
    const lca = commonContainer(nodes, edge.source, edge.target);
    const depth = nodes[lca]!.depth + 1;
    const a = ancestorAt(nodes, edge.source, depth);
    const b = ancestorAt(nodes, edge.target, depth);
    let arcs = perLevel.get(lca);
    if (!arcs) {
      arcs = new Map();
      perLevel.set(lca, arcs);
    }
    const key = `${a}>${b}`;
    const arc = arcs.get(key);
    if (arc) arc.weight += edge.weight;
    else arcs.set(key, { from: a, to: b, weight: edge.weight });
  }
  const reversed = new Map<string, boolean>();
  for (const [container, arcs] of perLevel) {
    const kids = nodes[container]!.children;
    const local = new Map<number, number>();
    kids.forEach((v, i) => local.set(v, i));
    const list = [...arcs.entries()];
    const ranks = feedbackRanks(
      kids.length,
      list.map(([, arc]) => ({
        from: local.get(arc.from)!,
        to: local.get(arc.to)!,
        weight: arc.weight,
      })),
    );
    for (const [key, arc] of list) {
      reversed.set(key, ranks[local.get(arc.from)!]! > ranks[local.get(arc.to)!]!);
    }
  }
  return reversed;
}

function refKey(ref: HRef): string {
  if ('own' in ref) return `p${ref.own}`;
  return ref.port === undefined ? `n${ref.node}` : `n${ref.node}${ref.port}`;
}

/** Output-frame padding expressed in the left-to-right frame. */
function transposePadding(p: Padding, transpose: boolean): Padding {
  return transpose ? { top: p.left, right: p.bottom, bottom: p.right, left: p.top } : p;
}

function round(value: number, integer: boolean): number {
  if (integer) return Math.round(value);
  const r = Math.round(value * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * One connected block of one container, laid out in its own frame: layers,
 * bend points for long edges, ordering, placement, channel tracks, then
 * orthogonal routes. A block may carry its container's border ports: the
 * in-ports form the first layer and the out-ports the last.
 */

import type { Point } from '../types.js';
import { assignTracks, type ChannelRun } from './channels.js';
import { orderLayers } from './ordering.js';
import { KIND_DUMMY, KIND_NODE, KIND_PORT, placeLayers } from './placement.js';

export interface BlockNode {
  kind: typeof KIND_NODE | typeof KIND_PORT;
  width: number;
  height: number;
  /** Ports only: the border they sit on. */
  side?: 'in' | 'out';
  /** Tie-break order. */
  model: number;
}

export interface BlockEdge {
  /** Drawn direction: `from` lands in an earlier layer than `to`. */
  from: number;
  to: number;
  weight: number;
  /** Attach heights below each end's top edge. */
  fromOffset: number;
  toOffset: number;
  key: string;
}

export interface BlockSettings {
  nodeSpacing: number;
  layerSpacing: number;
  edgeSpacing: number;
  /** Space kept inside the in-port border before the channel. */
  padIn: number;
  /** Space kept inside the out-port border after the channel. */
  padOut: number;
  orderingSweeps: number;
  placementSweeps: number;
  integer: boolean;
}

export interface BlockGeometry {
  /** Left and top edge of every input node. */
  x: Float64Array;
  y: Float64Array;
  /** Route per edge key, from the `from` end to the `to` end. */
  routes: Map<string, Point[]>;
}

export interface PlacedBlock {
  width: number;
  height: number;
  hasIn: boolean;
  hasOut: boolean;
  crossings: number;
  dummies: number;
  /** Final geometry; `outX` moves the out-port column right to a wider container's border. */
  finish(outX?: number): BlockGeometry;
}

export function layoutBlock(
  inputNodes: readonly BlockNode[],
  edges: readonly BlockEdge[],
  settings: BlockSettings,
): PlacedBlock {
  const n0 = inputNodes.length;
  const hasIn = inputNodes.some((v) => v.side === 'in');
  const hasOut = inputNodes.some((v) => v.side === 'out');
  const layerOf = assignLayers(inputNodes, edges);

  // Nodes, bend points included.
  const kinds: number[] = inputNodes.map((v) => v.kind);
  const widths: number[] = inputNodes.map((v) => (v.kind === KIND_NODE ? v.width : 0));
  const heights: number[] = inputNodes.map((v) => (v.kind === KIND_NODE ? v.height : 0));
  const models: number[] = inputNodes.map((v) => v.model);
  const layers: number[] = Array.from(layerOf);

  const segFrom: number[] = [];
  const segTo: number[] = [];
  const segOffFrom: number[] = [];
  const segOffTo: number[] = [];
  const segWeight: number[] = [];
  const chains: number[][] = [];
  const segmentAt = new Map<string, number>();
  const addSegment = (
    from: number,
    to: number,
    offFrom: number,
    offTo: number,
    w: number,
  ): number => {
    const key = `${from}:${offFrom}>${to}:${offTo}`;
    const known = segmentAt.get(key);
    if (known !== undefined) {
      segWeight[known]! += w;
      return known;
    }
    segFrom.push(from);
    segTo.push(to);
    segOffFrom.push(offFrom);
    segOffTo.push(offTo);
    segWeight.push(w);
    segmentAt.set(key, segFrom.length - 1);
    return segFrom.length - 1;
  };

  // Long edges toward one attach point share their bend points, layer by
  // layer, so a fan-in is drawn as one trunk with branches instead of a comb
  // of parallel lines; failing that, long edges out of one attach point do.
  const attach = (v: number, off: number): string => `${v}:${off}`;
  const longInto = new Map<string, number>();
  const longOutOf = new Map<string, number>();
  for (const edge of edges) {
    if (layers[edge.to]! - layers[edge.from]! < 2) continue;
    const into = attach(edge.to, edge.toOffset);
    const outOf = attach(edge.from, edge.fromOffset);
    longInto.set(into, (longInto.get(into) ?? 0) + 1);
    longOutOf.set(outOf, (longOutOf.get(outOf) ?? 0) + 1);
  }
  const sharedDummies = new Map<string, Map<number, number>>();
  const dummyFor = (group: string | null, layer: number, model: number): number => {
    let byLayer = group === null ? undefined : sharedDummies.get(group);
    if (group !== null && !byLayer) {
      byLayer = new Map();
      sharedDummies.set(group, byLayer);
    }
    const known = byLayer?.get(layer);
    if (known !== undefined) {
      models[known] = Math.min(models[known]!, model);
      return known;
    }
    const d = kinds.length;
    kinds.push(KIND_DUMMY);
    widths.push(0);
    heights.push(0);
    models.push(model);
    layers.push(layer);
    byLayer?.set(layer, d);
    return d;
  };
  for (const edge of edges) {
    const chain: number[] = [];
    const first = layers[edge.from]!;
    const span = layers[edge.to]! - first;
    const into = attach(edge.to, edge.toOffset);
    const outOf = attach(edge.from, edge.fromOffset);
    const group =
      span < 2
        ? null
        : longInto.get(into)! > 1
          ? `t${into}`
          : longOutOf.get(outOf)! > 1
            ? `s${outOf}`
            : null;
    let prev = edge.from;
    let prevOff = edge.fromOffset;
    for (let k = 1; k < span; k++) {
      const d = dummyFor(group, first + k, models[edge.from]! + 0.5);
      chain.push(addSegment(prev, d, prevOff, 0, edge.weight));
      prev = d;
      prevOff = 0;
    }
    chain.push(addSegment(prev, edge.to, prevOff, edge.toOffset, edge.weight));
    chains.push(chain);
  }
  const nodeCount = kinds.length;
  const dummies = nodeCount - n0;

  const layerCount = layers.reduce((m, l) => Math.max(m, l + 1), 0);
  const byLayer: number[][] = Array.from({ length: layerCount }, () => []);
  for (let v = 0; v < nodeCount; v++) byLayer[layers[v]!]!.push(v);
  for (const layer of byLayer) layer.sort((a, b) => models[a]! - models[b]! || a - b);

  const up: number[][] = Array.from({ length: nodeCount }, () => []);
  const down: number[][] = Array.from({ length: nodeCount }, () => []);
  segFrom.forEach((from, s) => {
    down[from]!.push(s);
    up[segTo[s]!]!.push(s);
  });
  const frac = (v: number, off: number): number =>
    heights[v]! > 0 ? Math.min(0.999, Math.max(0, off / heights[v]!)) : 0.5;
  const segs = {
    segFrom: Int32Array.from(segFrom),
    segTo: Int32Array.from(segTo),
    segOffFrom: Float64Array.from(segOffFrom),
    segOffTo: Float64Array.from(segOffTo),
    segWeight: Float64Array.from(segWeight),
  };

  const crossings = orderLayers({
    layers: byLayer,
    nodeCount,
    segFrom: segs.segFrom,
    segTo: segs.segTo,
    segFracFrom: Float64Array.from(segFrom, (v, s) => frac(v, segOffFrom[s]!)),
    segFracTo: Float64Array.from(segTo, (v, s) => frac(v, segOffTo[s]!)),
    segWeight: segs.segWeight,
    up,
    down,
    sweeps: settings.orderingSweeps,
  });

  const heightArr = Float64Array.from(heights);
  const y = placeLayers({
    layers: byLayer,
    heights: heightArr,
    kinds: Uint8Array.from(kinds),
    ...segs,
    up,
    down,
    nodeSpacing: settings.nodeSpacing,
    edgeSpacing: settings.edgeSpacing,
    sweeps: settings.placementSweeps,
    integer: settings.integer,
  });

  // Channel tracks between each pair of adjacent layers.
  const es = settings.edgeSpacing;
  const channelTracks: Int32Array[] = [];
  const channelCounts: number[] = [];
  for (let i = 0; i + 1 < layerCount; i++) {
    const runs: ChannelRun[] = [];
    const ids: number[] = [];
    for (const v of byLayer[i]!) {
      for (const s of down[v]!) {
        const to = segTo[s]!;
        runs.push({
          from: y[v]! + segOffFrom[s]!,
          to: y[to]! + segOffTo[s]!,
          sourceKey: `${v}:${segOffFrom[s]}`,
          targetKey: `${to}:${segOffTo[s]}`,
        });
        ids.push(s);
      }
    }
    const assigned = assignTracks(runs, es);
    const perSeg = new Int32Array(segFrom.length).fill(-1);
    ids.forEach((s, k) => {
      perSeg[s] = assigned.track[k]!;
    });
    channelTracks.push(perSeg);
    channelCounts.push(assigned.count);
  }

  // Columns and the gaps between them.
  const colWidth = byLayer.map((layer) => layer.reduce((m, v) => Math.max(m, widths[v]!), 0));
  const colX: number[] = [];
  const trackX: ((t: number) => number)[] = [];
  let cursor = 0;
  for (let i = 0; i < layerCount; i++) {
    colX.push(cursor);
    cursor += colWidth[i]!;
    if (i + 1 === layerCount) break;
    const tracks = channelCounts[i]!;
    const start = cursor;
    let gap: number;
    if (hasIn && i === 0) {
      gap = settings.padIn + (tracks + 1) * es;
      trackX.push((t) => start + settings.padIn + (t + 1) * es);
    } else if (hasOut && i + 2 === layerCount) {
      gap = (tracks + 1) * es + settings.padOut;
      trackX.push((t) => start + (t + 1) * es);
    } else {
      gap = Math.max(settings.layerSpacing, (tracks + 1) * es);
      const lead = (gap - (tracks - 1) * es) / 2;
      const first = start + (settings.integer ? Math.floor(lead) : lead);
      trackX.push((t) => first + t * es);
    }
    cursor += gap;
  }
  const width = layerCount > 0 ? colX[layerCount - 1]! + colWidth[layerCount - 1]! : 0;
  let height = 0;
  for (let v = 0; v < nodeCount; v++) height = Math.max(height, y[v]! + heights[v]!);

  const finish = (outX?: number): BlockGeometry => {
    const cols = colX.slice();
    if (hasOut && outX !== undefined && outX > cols[layerCount - 1]!) cols[layerCount - 1] = outX;
    const x = new Float64Array(n0);
    const left = (v: number): number => {
      const i = layers[v]!;
      if (kinds[v] !== KIND_NODE) return cols[i]!;
      const lead = (colWidth[i]! - widths[v]!) / 2;
      return cols[i]! + (settings.integer ? Math.floor(lead) : lead);
    };
    for (let v = 0; v < n0; v++) x[v] = left(v);

    const routes = new Map<string, Point[]>();
    edges.forEach((edge, e) => {
      const points: Point[] = [];
      const start = edge.from;
      points.push({ x: left(start) + widths[start]!, y: y[start]! + edge.fromOffset });
      for (const s of chains[e]!) {
        const u = segFrom[s]!;
        const v = segTo[s]!;
        const ya = y[u]! + segOffFrom[s]!;
        const yb = y[v]! + segOffTo[s]!;
        const t = channelTracks[layers[u]!]![s]!;
        if (t >= 0) {
          const tx = trackX[layers[u]!]!(t);
          points.push({ x: tx, y: ya }, { x: tx, y: yb });
        }
        if (kinds[v] === KIND_DUMMY) {
          const i = layers[v]!;
          points.push({ x: cols[i]!, y: yb }, { x: cols[i]! + colWidth[i]!, y: yb });
        } else {
          points.push({ x: left(v), y: yb });
        }
      }
      routes.set(edge.key, simplify(points));
    });
    return { x, y: y.slice(0, n0), routes };
  };

  return { width, height, hasIn, hasOut, crossings, dummies, finish };
}

/**
 * Layers for the block's nodes: longest path from the sources, then each
 * node whose outgoing weight beats its incoming weight moves as close to its
 * successors as they allow. In-ports take the first layer, out-ports the last.
 */
function assignLayers(nodes: readonly BlockNode[], edges: readonly BlockEdge[]): Int32Array {
  const n = nodes.length;
  const isPort = (v: number): boolean => nodes[v]!.kind === KIND_PORT;
  const outs: number[][] = Array.from({ length: n }, () => []);
  const ins: number[][] = Array.from({ length: n }, () => []);
  const inDeg = new Int32Array(n);
  edges.forEach((edge, e) => {
    outs[edge.from]!.push(e);
    ins[edge.to]!.push(e);
    if (!isPort(edge.from) && !isPort(edge.to)) inDeg[edge.to]!++;
  });

  const layer = new Int32Array(n);
  const topo: number[] = [];
  for (let v = 0; v < n; v++) if (!isPort(v) && inDeg[v] === 0) topo.push(v);
  for (let k = 0; k < topo.length; k++) {
    const v = topo[k]!;
    for (const e of outs[v]!) {
      const w = edges[e]!.to;
      if (isPort(w)) continue;
      layer[w] = Math.max(layer[w]!, layer[v]! + 1);
      if (--inDeg[w]! === 0) topo.push(w);
    }
  }
  let last = 0;
  for (const v of topo) last = Math.max(last, layer[v]!);
  const shift = nodes.some((v) => v.side === 'in') ? 1 : 0;
  for (const v of topo) layer[v]! += shift;
  for (let v = 0; v < n; v++) {
    if (nodes[v]!.side === 'in') layer[v] = 0;
    else if (nodes[v]!.side === 'out') layer[v] = last + shift + 1;
  }

  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let k = topo.length - 1; k >= 0; k--) {
      const v = topo[k]!;
      if (outs[v]!.length === 0) continue;
      let outW = 0;
      let inW = 0;
      let nearest = Infinity;
      for (const e of outs[v]!) {
        outW += edges[e]!.weight;
        nearest = Math.min(nearest, layer[edges[e]!.to]!);
      }
      for (const e of ins[v]!) inW += edges[e]!.weight;
      if (outW > inW && nearest - 1 > layer[v]!) {
        layer[v] = nearest - 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return layer;
}

/** Drop repeated points and the middle of straight runs. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = last!;
      const sameX = Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - p.x) < 1e-6;
      const sameY = Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - p.y) < 1e-6;
      if (sameX || sameY) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

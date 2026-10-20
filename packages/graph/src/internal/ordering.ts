/**
 * Crossing reduction inside one block: layer-by-layer weighted barycenter
 * sweeps, keeping the best ordering seen, then adjacent transposition.
 *
 * Positions are a node's rank in its layer plus the fraction of its height at
 * which the edge attaches, so the separate ports of a container count as
 * separate points.
 */

export interface OrderInput {
  /** Node ids per layer; reordered in place. */
  layers: number[][];
  nodeCount: number;
  segFrom: Int32Array;
  segTo: Int32Array;
  segFracFrom: Float64Array;
  segFracTo: Float64Array;
  segWeight: Float64Array;
  /** Per node, the segments arriving from the previous layer. */
  up: number[][];
  /** Per node, the segments leaving for the next layer. */
  down: number[][];
  sweeps: number;
}

const TRANSPOSE_MAX_LAYER = 300;
const STALL_LIMIT = 4;

/** Order the layers in place; returns the remaining crossing count. */
export function orderLayers(input: OrderInput): number {
  const { layers } = input;
  const pos = new Int32Array(input.nodeCount);
  const syncPositions = (i: number): void => {
    layers[i]!.forEach((v, k) => {
      pos[v] = k;
    });
  };
  for (let i = 0; i < layers.length; i++) syncPositions(i);
  if (layers.length < 2) return 0;

  const total = (): number => {
    let c = 0;
    for (let i = 0; i + 1 < layers.length; i++) c += crossingsBetween(input, pos, layers[i]!);
    return c;
  };

  let best = layers.map((layer) => layer.slice());
  let bestCrossings = total();
  let stall = 0;
  for (let sweep = 0; sweep < input.sweeps && bestCrossings > 0; sweep++) {
    if (sweep % 2 === 0) {
      for (let i = 1; i < layers.length; i++) {
        reorder(input, pos, i, 'up');
        syncPositions(i);
      }
    } else {
      for (let i = layers.length - 2; i >= 0; i--) {
        reorder(input, pos, i, 'down');
        syncPositions(i);
      }
    }
    const c = total();
    if (c < bestCrossings) {
      bestCrossings = c;
      best = layers.map((layer) => layer.slice());
      stall = 0;
    } else if (++stall >= STALL_LIMIT) {
      break;
    }
  }
  for (let i = 0; i < layers.length; i++) {
    layers[i] = best[i]!;
    syncPositions(i);
  }
  if (bestCrossings > 0) transpose(input, pos);
  return total();
}

function reorder(input: OrderInput, pos: Int32Array, i: number, side: 'up' | 'down'): void {
  const layer = input.layers[i]!;
  const ref = input.layers[side === 'up' ? i - 1 : i + 1]!;
  const size = layer.length;
  const refSize = Math.max(1, ref.length);
  const keys = new Map<number, number>();
  for (const v of layer) {
    const segs = side === 'up' ? input.up[v]! : input.down[v]!;
    let sum = 0;
    let weight = 0;
    for (const s of segs) {
      const u = side === 'up' ? input.segFrom[s]! : input.segTo[s]!;
      const frac = side === 'up' ? input.segFracFrom[s]! : input.segFracTo[s]!;
      const w = input.segWeight[s]!;
      sum += w * ((pos[u]! + frac) / refSize);
      weight += w;
    }
    keys.set(v, weight > 0 ? sum / weight : (pos[v]! + 0.5) / size);
  }
  layer.sort((a, b) => keys.get(a)! - keys.get(b)! || pos[a]! - pos[b]!);
}

/** Crossings between `layer` and the next one. */
function crossingsBetween(input: OrderInput, pos: Int32Array, layer: readonly number[]): number {
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (const v of layer) {
    for (const s of input.down[v]!) {
      tops.push(pos[v]! + input.segFracFrom[s]!);
      bottoms.push(pos[input.segTo[s]!]! + input.segFracTo[s]!);
    }
  }
  if (tops.length < 2) return 0;
  const idx = tops.map((_, k) => k);
  idx.sort((a, b) => tops[a]! - tops[b]! || bottoms[a]! - bottoms[b]!);
  return countInversions(idx.map((k) => bottoms[k]!));
}

/** Pairs i < j with values[i] > values[j], by merge sort. */
export function countInversions(values: number[]): number {
  const buffer = new Array<number>(values.length);
  const sort = (lo: number, hi: number): number => {
    if (hi - lo < 2) return 0;
    const mid = (lo + hi) >> 1;
    let count = sort(lo, mid) + sort(mid, hi);
    let i = lo;
    let j = mid;
    let k = lo;
    while (i < mid && j < hi) {
      if (values[j]! < values[i]!) {
        count += mid - i;
        buffer[k++] = values[j++]!;
      } else {
        buffer[k++] = values[i++]!;
      }
    }
    while (i < mid) buffer[k++] = values[i++]!;
    while (j < hi) buffer[k++] = values[j++]!;
    for (let m = lo; m < hi; m++) values[m] = buffer[m]!;
    return count;
  };
  return sort(0, values.length);
}

/** Swap neighbors while a swap removes crossings with the adjacent layers. */
function transpose(input: OrderInput, pos: Int32Array): void {
  const { layers } = input;
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      if (layer.length < 2 || layer.length > TRANSPOSE_MAX_LAYER) continue;
      for (let k = 0; k + 1 < layer.length; k++) {
        const u = layer[k]!;
        const v = layer[k + 1]!;
        const keep = pairCrossings(input, pos, u, v);
        const swap = pairCrossings(input, pos, v, u);
        if (swap < keep) {
          layer[k] = v;
          layer[k + 1] = u;
          pos[v] = k;
          pos[u] = k + 1;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
}

/** Crossings among the edges of `left` and `right` when `left` comes first. */
function pairCrossings(input: OrderInput, pos: Int32Array, left: number, right: number): number {
  let c = 0;
  for (const side of [input.up, input.down]) {
    const ls = side[left]!;
    const rs = side[right]!;
    if (ls.length === 0 || rs.length === 0) continue;
    const far = side === input.up ? input.segFrom : input.segTo;
    const frac = side === input.up ? input.segFracFrom : input.segFracTo;
    for (const a of ls) {
      const pa = pos[far[a]!]! + frac[a]!;
      for (const b of rs) if (pa > pos[far[b]!]! + frac[b]!) c++;
    }
  }
  return c;
}

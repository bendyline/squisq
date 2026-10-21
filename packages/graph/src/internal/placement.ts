/**
 * Placement across the layers. Each pass takes one layer at a time and asks
 * where each node would like to sit — the weighted median of the attach
 * points of its neighbors in the reference layer — then solves for the
 * closest positions that keep the layer's order and spacing. That solve is a
 * weighted isotonic regression (pool adjacent violators): optimal for the
 * layer, linear in its size. Edges between bend points weigh most, so long
 * edges straighten first.
 */

export const KIND_NODE = 0;
export const KIND_PORT = 1;
export const KIND_DUMMY = 2;

export interface PlacementInput {
  layers: readonly number[][];
  heights: Float64Array;
  kinds: Uint8Array;
  segFrom: Int32Array;
  segTo: Int32Array;
  segOffFrom: Float64Array;
  segOffTo: Float64Array;
  segWeight: Float64Array;
  up: readonly number[][];
  down: readonly number[][];
  nodeSpacing: number;
  edgeSpacing: number;
  sweeps: number;
  integer: boolean;
}

/** Straightness priority by what an edge joins (after Gansner et al.). */
function omega(a: number, b: number): number {
  const dummies = (a === KIND_DUMMY ? 1 : 0) + (b === KIND_DUMMY ? 1 : 0);
  return dummies === 2 ? 8 : dummies === 1 ? 2 : 1;
}

/** Top edge of every node, normalized so the highest sits at 0. */
export function placeLayers(input: PlacementInput): Float64Array {
  const { layers, heights, kinds } = input;
  const y = new Float64Array(heights.length);
  const gap = (a: number, b: number): number => {
    const sa = kinds[a] === KIND_NODE ? input.nodeSpacing : input.edgeSpacing;
    const sb = kinds[b] === KIND_NODE ? input.nodeSpacing : input.edgeSpacing;
    const g = (sa + sb) / 2;
    return input.integer ? Math.ceil(g) : g;
  };

  for (const layer of layers) {
    let cursor = 0;
    layer.forEach((v, k) => {
      if (k > 0) cursor += gap(layer[k - 1]!, v);
      y[v] = cursor;
      cursor += heights[v]!;
    });
  }

  const place = (i: number, useUp: boolean, useDown: boolean): void => {
    const layer = layers[i]!;
    if (layer.length === 0) return;
    const targets = new Float64Array(layer.length);
    const weights = new Float64Array(layer.length);
    let offset = 0;
    layer.forEach((v, k) => {
      if (k > 0) offset += heights[layer[k - 1]!]! + gap(layer[k - 1]!, v);
      const ts: number[] = [];
      const ws: number[] = [];
      if (useUp) {
        for (const s of input.up[v]!) {
          const u = input.segFrom[s]!;
          ts.push(y[u]! + input.segOffFrom[s]! - input.segOffTo[s]!);
          ws.push(input.segWeight[s]! * omega(kinds[u]!, kinds[v]!));
        }
      }
      if (useDown) {
        for (const s of input.down[v]!) {
          const u = input.segTo[s]!;
          ts.push(y[u]! + input.segOffTo[s]! - input.segOffFrom[s]!);
          ws.push(input.segWeight[s]! * omega(kinds[u]!, kinds[v]!));
        }
      }
      if (ts.length === 0) {
        targets[k] = y[v]! - offset;
        weights[k] = 1e-3;
      } else {
        targets[k] = weightedMedian(ts, ws) - offset;
        weights[k] = ws.reduce((a, b) => a + b, 0);
      }
    });
    const z = isotonic(targets, weights);
    offset = 0;
    layer.forEach((v, k) => {
      if (k > 0) offset += heights[layer[k - 1]!]! + gap(layer[k - 1]!, v);
      y[v] = (input.integer ? Math.round(z[k]!) : z[k]!) + offset;
    });
  };

  for (let sweep = 0; sweep < input.sweeps; sweep++) {
    if (sweep % 2 === 0) for (let i = 1; i < layers.length; i++) place(i, true, false);
    else for (let i = layers.length - 2; i >= 0; i--) place(i, false, true);
  }
  // Balance: each layer between both neighbors, top-down then bottom-up.
  for (let i = 0; i < layers.length; i++) place(i, true, true);
  for (let i = layers.length - 1; i >= 0; i--) place(i, true, true);

  let min = Infinity;
  for (const layer of layers) for (const v of layer) min = Math.min(min, y[v]!);
  if (Number.isFinite(min) && min !== 0) for (let v = 0; v < y.length; v++) y[v]! -= min;
  return y;
}

/** The weighted median; an exact split averages the two middle values. */
export function weightedMedian(values: readonly number[], weights: readonly number[]): number {
  if (values.length === 1) return values[0]!;
  const idx = values.map((_, k) => k).sort((a, b) => values[a]! - values[b]!);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let k = 0; k < idx.length; k++) {
    acc += weights[idx[k]!]!;
    if (Math.abs(acc - total / 2) < 1e-9 && k + 1 < idx.length) {
      return (values[idx[k]!]! + values[idx[k + 1]!]!) / 2;
    }
    if (acc > total / 2) return values[idx[k]!]!;
  }
  return values[idx[idx.length - 1]!]!;
}

/** Closest non-decreasing sequence to `values` in weighted least squares. */
export function isotonic(values: Float64Array, weights: Float64Array): Float64Array {
  const n = values.length;
  const means = new Float64Array(n);
  const sums = new Float64Array(n);
  const counts = new Int32Array(n);
  let blocks = 0;
  for (let i = 0; i < n; i++) {
    means[blocks] = values[i]!;
    sums[blocks] = weights[i]!;
    counts[blocks] = 1;
    blocks++;
    while (blocks > 1 && means[blocks - 2]! > means[blocks - 1]!) {
      const w = sums[blocks - 2]! + sums[blocks - 1]!;
      means[blocks - 2] =
        (means[blocks - 2]! * sums[blocks - 2]! + means[blocks - 1]! * sums[blocks - 1]!) / w;
      sums[blocks - 2] = w;
      counts[blocks - 2]! += counts[blocks - 1]!;
      blocks--;
    }
  }
  const out = new Float64Array(n);
  let i = 0;
  for (let b = 0; b < blocks; b++) for (let c = 0; c < counts[b]!; c++) out[i++] = means[b]!;
  return out;
}

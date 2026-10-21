/**
 * Cycle breaking: a weighted greedy feedback-arc-set order (Eades, Lin and
 * Smyth). Edges that run backward in the returned order are the ones drawn
 * against the flow. Sinks and sources are peeled first, so an acyclic graph
 * never loses an edge; otherwise the node with the largest out-minus-in
 * weight goes next, ties to the earliest in model order.
 */

export interface WeightedArc {
  from: number;
  to: number;
  weight: number;
}

/** A rank per node; an arc with `rank[from] > rank[to]` closes a cycle. */
export function feedbackRanks(n: number, arcs: readonly WeightedArc[]): Int32Array {
  const outs: number[][] = Array.from({ length: n }, () => []);
  const ins: number[][] = Array.from({ length: n }, () => []);
  const outW = new Float64Array(n);
  const inW = new Float64Array(n);
  const outDeg = new Int32Array(n);
  const inDeg = new Int32Array(n);
  arcs.forEach((arc, i) => {
    if (arc.from === arc.to) return;
    outs[arc.from]!.push(i);
    ins[arc.to]!.push(i);
    outW[arc.from]! += arc.weight;
    inW[arc.to]! += arc.weight;
    outDeg[arc.from]!++;
    inDeg[arc.to]!++;
  });

  const removed = new Uint8Array(n);
  const front: number[] = [];
  const back: number[] = [];
  let remaining = n;

  const remove = (v: number, queue: number[]): void => {
    removed[v] = 1;
    remaining--;
    for (const a of outs[v]!) {
      const t = arcs[a]!.to;
      if (removed[t]) continue;
      inW[t]! -= arcs[a]!.weight;
      if (--inDeg[t]! === 0) queue.push(t);
    }
    for (const a of ins[v]!) {
      const s = arcs[a]!.from;
      if (removed[s]) continue;
      outW[s]! -= arcs[a]!.weight;
      if (--outDeg[s]! === 0) queue.push(s);
    }
  };

  // One queue of candidates; whether a node is a source or a sink is
  // re-checked when it is taken, since removals change both.
  let queue: number[] = [];
  for (let v = 0; v < n; v++) if (inDeg[v] === 0 || outDeg[v] === 0) queue.push(v);

  while (remaining > 0) {
    while (queue.length > 0) {
      const next: number[] = [];
      for (const v of queue) {
        if (removed[v]) continue;
        if (outDeg[v] === 0) {
          back.push(v);
          remove(v, next);
        } else if (inDeg[v] === 0) {
          front.push(v);
          remove(v, next);
        }
      }
      queue = next;
    }
    if (remaining === 0) break;
    let best = -1;
    let bestScore = -Infinity;
    for (let v = 0; v < n; v++) {
      if (removed[v]) continue;
      const score = outW[v]! - inW[v]!;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    front.push(best);
    remove(best, queue);
  }

  const rank = new Int32Array(n);
  let r = 0;
  for (const v of front) rank[v] = r++;
  for (let i = back.length - 1; i >= 0; i--) rank[back[i]!] = r++;
  return rank;
}

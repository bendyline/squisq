/**
 * Track assignment in the channel between two layers. Every edge that
 * changes height between the layers needs a vertical run somewhere in the
 * channel; this decides how many parallel tracks the channel needs and which
 * track each run takes.
 *
 * Runs that converge on one attach point share a track, as do runs that fan
 * out of one point toward targets nobody else uses, so a fan reads as a tree
 * instead of a comb. Two groups whose spans overlap must take different
 * tracks; their left-to-right order is the one that crosses fewer horizontal
 * stubs, settled for the whole channel through the same feedback-arc order
 * the layering uses.
 */

import { feedbackRanks, type WeightedArc } from './cycles.js';

export interface ChannelRun {
  /** Height where the run leaves the left layer. */
  from: number;
  /** Height where it reaches the right layer. */
  to: number;
  /** Identity of the attach point on the left. */
  sourceKey: string;
  /** Identity of the attach point on the right. */
  targetKey: string;
}

export interface TrackAssignment {
  /** Track per run, left to right from 0; -1 for a level run that needs none. */
  track: Int32Array;
  count: number;
}

interface Group {
  lefts: number[];
  rights: number[];
  lo: number;
  hi: number;
  first: number;
}

const LEVEL = 1e-6;

export function assignTracks(runs: readonly ChannelRun[], minGap: number): TrackAssignment {
  const track = new Int32Array(runs.length).fill(-1);
  const bent: number[] = [];
  runs.forEach((run, i) => {
    if (Math.abs(run.from - run.to) > LEVEL) bent.push(i);
  });
  if (bent.length === 0) return { track, count: 0 };

  const byTarget = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const i of bent) {
    byTarget.set(runs[i]!.targetKey, (byTarget.get(runs[i]!.targetKey) ?? 0) + 1);
    bySource.set(runs[i]!.sourceKey, (bySource.get(runs[i]!.sourceKey) ?? 0) + 1);
  }
  const groupOf = new Map<string, number>();
  const groups: Group[] = [];
  const members: number[][] = [];
  for (const i of bent) {
    const run = runs[i]!;
    // Join whichever side gathers more runs: two sources fanning out to the
    // same twenty targets make two trees, not twenty pairs.
    const intoCount = byTarget.get(run.targetKey)!;
    const outOfCount = bySource.get(run.sourceKey)!;
    const key =
      intoCount < 2 && outOfCount < 2
        ? `r${i}`
        : intoCount >= outOfCount
          ? `t${run.targetKey}`
          : `s${run.sourceKey}`;
    let g = groupOf.get(key);
    if (g === undefined) {
      g = groups.length;
      groupOf.set(key, g);
      groups.push({ lefts: [], rights: [], lo: Infinity, hi: -Infinity, first: i });
      members.push([]);
    }
    const group = groups[g]!;
    group.lefts.push(run.from);
    group.rights.push(run.to);
    group.lo = Math.min(group.lo, run.from, run.to);
    group.hi = Math.max(group.hi, run.from, run.to);
    members[g]!.push(i);
  }
  for (const g of groups) {
    g.lefts = sortedUnique(g.lefts);
    g.rights = sortedUnique(g.rights);
  }

  // Order every overlapping pair; the cheaper side wins, ties go top first.
  const order = groups.map((_, k) => k).sort((a, b) => groups[a]!.lo - groups[b]!.lo || a - b);
  const arcs: WeightedArc[] = [];
  for (let x = 0; x < order.length; x++) {
    const a = order[x]!;
    const ga = groups[a]!;
    for (let y = x + 1; y < order.length; y++) {
      const b = order[y]!;
      const gb = groups[b]!;
      if (gb.lo >= ga.hi + minGap) break;
      const aFirst = inside(gb.lefts, ga) + inside(ga.rights, gb);
      const bFirst = inside(ga.lefts, gb) + inside(gb.rights, ga);
      if (aFirst < bFirst) arcs.push({ from: a, to: b, weight: bFirst - aFirst });
      else if (bFirst < aFirst) arcs.push({ from: b, to: a, weight: aFirst - bFirst });
      else arcs.push(tieArc(a, b, ga, gb));
    }
  }

  const rank = feedbackRanks(groups.length, arcs);
  const level = new Int32Array(groups.length);
  const byRank = groups.map((_, k) => k).sort((a, b) => rank[a]! - rank[b]!);
  const succ: number[][] = groups.map(() => []);
  for (const arc of arcs) {
    if (rank[arc.from]! < rank[arc.to]!) succ[arc.from]!.push(arc.to);
    else succ[arc.to]!.push(arc.from);
  }
  let count = 0;
  for (const g of byRank) {
    for (const s of succ[g]!) level[s] = Math.max(level[s]!, level[g]! + 1);
    count = Math.max(count, level[g]! + 1);
  }
  groups.forEach((_, g) => {
    for (const i of members[g]!) track[i] = level[g]!;
  });
  return { track, count };
}

/** Equal crossings either way: the group centered higher goes left. */
function tieArc(a: number, b: number, ga: Group, gb: Group): WeightedArc {
  const center = (g: Group): number => (g.lo + g.hi) / 2;
  const first = center(ga) < center(gb) || (center(ga) === center(gb) && ga.first < gb.first);
  return first ? { from: a, to: b, weight: 0.5 } : { from: b, to: a, weight: 0.5 };
}

function inside(points: readonly number[], g: Group): number {
  let c = 0;
  for (const p of points) if (p > g.lo + LEVEL && p < g.hi - LEVEL) c++;
  return c;
}

function sortedUnique(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of values)
    if (out.length === 0 || Math.abs(out[out.length - 1]! - v) > LEVEL) out.push(v);
  return out;
}

import type { CalcRangeAddress } from './types.js';

interface Interval<T> {
  entry: T;
  maxEnd: number;
  left?: Interval<T>;
  right?: Interval<T>;
}

/** Per-sheet interval index using the more selective coordinate axis. */
export class DependencyIndex<T extends { range: CalcRangeAddress }> {
  private readonly sheets = new Map<string, { root: Interval<T>; columnAxis: boolean }>();

  constructor(entries: readonly T[]) {
    const sheets = new Map<string, T[]>();
    for (const entry of entries) {
      const name = entry.range.sheet.toLowerCase();
      let group = sheets.get(name);
      if (!group) {
        group = [];
        sheets.set(name, group);
      }
      group.push(entry);
    }
    for (const [name, group] of sheets) {
      const columnAxis =
        new Set(group.map((e) => e.range.startCol)).size >
        new Set(group.map((e) => e.range.startRow)).size;
      const startAt = (entry: T) => (columnAxis ? entry.range.startCol : entry.range.startRow);
      const endAt = (entry: T) => (columnAxis ? entry.range.endCol : entry.range.endRow);
      group.sort((a, b) => startAt(a) - startAt(b));
      const build = (start: number, end: number): Interval<T> | undefined => {
        if (start >= end) return undefined;
        const mid = (start + end) >>> 1;
        const entry = group[mid]!;
        const left = build(start, mid);
        const right = build(mid + 1, end);
        return {
          entry,
          left,
          right,
          maxEnd: Math.max(endAt(entry), left?.maxEnd ?? -1, right?.maxEnd ?? -1),
        };
      };
      this.sheets.set(name, { root: build(0, group.length)!, columnAxis });
    }
  }

  *at(sheet: string, row: number, col: number, charge?: () => void): Iterable<T> {
    const tree = this.sheets.get(sheet.toLowerCase());
    const at = tree?.columnAxis ? col : row;
    const stack = tree ? [tree.root] : [];
    while (stack.length) {
      charge?.();
      const node = stack.pop()!;
      if (node.maxEnd < at) continue;
      if (node.left) stack.push(node.left);
      const range = node.entry.range;
      if ((tree?.columnAxis ? range.startCol : range.startRow) > at) continue;
      if (
        range.startRow <= row &&
        range.endRow >= row &&
        range.startCol <= col &&
        range.endCol >= col
      )
        yield node.entry;
      if (node.right) stack.push(node.right);
    }
  }
}

/** Iterative Tarjan traversal; yields precedents before their dependent components. */
export function* dependencyComponents<T>(
  roots: readonly T[],
  idOf: (node: T) => string,
  predecessors: (node: T) => T[],
  charge: () => void,
): Generator<{ members: T[]; cyclic: boolean }> {
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const active = new Set<string>();
  const members: T[] = [];
  const frames: { node: T; id: string; neighbors: T[]; next: number }[] = [];
  const enter = (node: T) => {
    charge();
    const id = idOf(node);
    indices.set(id, indices.size);
    low.set(id, indices.get(id)!);
    active.add(id);
    members.push(node);
    frames.push({ node, id, neighbors: predecessors(node), next: 0 });
  };
  for (const root of roots) {
    if (indices.has(idOf(root))) continue;
    enter(root);
    while (frames.length) {
      const frame = frames[frames.length - 1]!;
      if (frame.next < frame.neighbors.length) {
        charge();
        const neighbor = frame.neighbors[frame.next++]!;
        const id = idOf(neighbor);
        if (!indices.has(id)) enter(neighbor);
        else if (active.has(id)) low.set(frame.id, Math.min(low.get(frame.id)!, indices.get(id)!));
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
      if (low.get(frame.id) !== indices.get(frame.id)) continue;
      const component: T[] = [];
      let node: T;
      do {
        node = members.pop()!;
        active.delete(idOf(node));
        component.push(node);
      } while (idOf(node) !== frame.id);
      yield {
        members: component,
        cyclic: component.length > 1 || frame.neighbors.some((n) => idOf(n) === frame.id),
      };
    }
  }
}

import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../layout.js';
import type { LayoutGraph, LayoutOptions, LayoutResult, Point } from '../types.js';

const EPS = 1e-6;

function box(w = 80, h = 30) {
  return { width: w, height: h };
}

/** Every invariant a layout must keep, whatever the graph. */
function expectValid(graph: LayoutGraph, result: LayoutResult): void {
  expect(result.nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id));
  const byId = new Map(result.nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string | undefined>();
  for (const n of graph.nodes) {
    parentOf.set(
      n.id,
      n.parent !== undefined && byId.has(n.parent) && n.parent !== n.id ? n.parent : undefined,
    );
  }
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    let p = parentOf.get(id);
    while (p !== undefined && !out.has(p)) {
      out.add(p);
      p = parentOf.get(p);
    }
    return out;
  };

  for (const n of result.nodes) {
    expect(n.x).toBeGreaterThanOrEqual(-EPS);
    expect(n.y).toBeGreaterThanOrEqual(-EPS);
    expect(n.x + n.width).toBeLessThanOrEqual(result.width + EPS);
    expect(n.y + n.height).toBeLessThanOrEqual(result.height + EPS);
    const p = parentOf.get(n.id);
    if (p !== undefined && !ancestors(p).has(n.id)) {
      const c = byId.get(p)!;
      expect(c.container).toBe(true);
      expect(n.x, `${n.id} inside ${p}`).toBeGreaterThanOrEqual(c.x - EPS);
      expect(n.y, `${n.id} inside ${p}`).toBeGreaterThanOrEqual(c.y - EPS);
      expect(n.x + n.width, `${n.id} inside ${p}`).toBeLessThanOrEqual(c.x + c.width + EPS);
      expect(n.y + n.height, `${n.id} inside ${p}`).toBeLessThanOrEqual(c.y + c.height + EPS);
    }
  }

  // Siblings never overlap.
  const groups = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const key = parentOf.get(n.id) ?? '';
    groups.set(key, [...(groups.get(key) ?? []), n.id]);
  }
  const overlaps: string[] = [];
  for (const ids of groups.values()) {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = byId.get(unique[i]!)!;
        const b = byId.get(unique[j]!)!;
        const overlap =
          a.x < b.x + b.width - EPS &&
          b.x < a.x + a.width - EPS &&
          a.y < b.y + b.height - EPS &&
          b.y < a.y + a.height - EPS;
        if (overlap) overlaps.push(`${a.id} overlaps ${b.id}`);
      }
    }
  }
  expect(overlaps).toEqual([]);

  const cuts: string[] = [];
  for (const e of result.edges) {
    expect(e.points.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]!;
      const b = e.points[i]!;
      const orthogonal = Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS;
      expect(orthogonal, `${e.id} segment ${i} is diagonal`).toBe(true);
    }
    const s = byId.get(e.source)!;
    const t = byId.get(e.target)!;
    expect(onBoundary(e.points[0]!, s), `${e.id} starts on ${s.id}`).toBe(true);
    expect(onBoundary(e.points[e.points.length - 1]!, t), `${e.id} ends on ${t.id}`).toBe(true);

    // A route never cuts through a box it has no business inside.
    const allowed = new Set([e.source, e.target, ...ancestors(e.source), ...ancestors(e.target)]);
    for (const n of result.nodes) {
      if (allowed.has(n.id)) continue;
      for (let i = 1; i < e.points.length; i++) {
        if (crossesInterior(e.points[i - 1]!, e.points[i]!, n))
          cuts.push(`${e.id} cuts through ${n.id}`);
      }
    }
  }
  expect(cuts).toEqual([]);
}

function onBoundary(p: Point, n: { x: number; y: number; width: number; height: number }): boolean {
  const within = (v: number, lo: number, hi: number) => v >= lo - 0.01 && v <= hi + 0.01;
  const onX = Math.abs(p.x - n.x) < 0.01 || Math.abs(p.x - (n.x + n.width)) < 0.01;
  const onY = Math.abs(p.y - n.y) < 0.01 || Math.abs(p.y - (n.y + n.height)) < 0.01;
  return (onX && within(p.y, n.y, n.y + n.height)) || (onY && within(p.x, n.x, n.x + n.width));
}

function crossesInterior(
  a: Point,
  b: Point,
  n: { x: number; y: number; width: number; height: number },
): boolean {
  const m = 0.01;
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 < n.x + n.width - m && x1 > n.x + m && y0 < n.y + n.height - m && y1 > n.y + m;
}

/** A seeded generator, so random graphs are the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGraph(
  seed: number,
  nodeCount: number,
  edgeCount: number,
  folders: number,
): LayoutGraph {
  const r = rng(seed);
  const nodes: LayoutGraph['nodes'][number][] = [];
  for (let f = 0; f < folders; f++) {
    const parent = f > 2 && r() < 0.4 ? `f${Math.floor(r() * f)}` : undefined;
    nodes.push({ id: `f${f}`, width: 60, height: 24, parent });
  }
  for (let i = 0; i < nodeCount; i++) {
    const parent = folders > 0 && r() < 0.85 ? `f${Math.floor(r() * folders)}` : undefined;
    nodes.push({
      id: `n${i}`,
      width: 40 + Math.floor(r() * 80),
      height: 20 + Math.floor(r() * 20),
      parent,
    });
  }
  const edges: LayoutGraph['edges'][number][] = [];
  for (let e = 0; e < edgeCount; e++) {
    const a = Math.floor(r() * nodeCount);
    const b = Math.floor(r() * nodeCount);
    edges.push({ id: `e${e}`, source: `n${a}`, target: `n${b}`, weight: 1 + Math.floor(r() * 3) });
  }
  // Folders with no files would be plain nodes; that is fine, they still lay out.
  return { nodes, edges };
}

describe('layoutGraph — flat graphs', () => {
  it('lays a chain out left to right on one line', () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: 'a', ...box() },
        { id: 'b', ...box() },
        { id: 'c', ...box() },
      ],
      edges: [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'bc', source: 'b', target: 'c' },
      ],
    };
    const result = layoutGraph(graph);
    expectValid(graph, result);
    const [a, b, c] = result.nodes;
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);
    expect(a!.y).toBe(b!.y);
    expect(b!.y).toBe(c!.y);
    for (const e of result.edges) expect(e.points).toHaveLength(2);
    expect(result.stats).toMatchObject({ crossings: 0, reversedEdges: 0, droppedEdges: 0 });
  });

  it('flows top to bottom when asked', () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: 'a', ...box() },
        { id: 'b', ...box() },
      ],
      edges: [{ id: 'ab', source: 'a', target: 'b' }],
    };
    const result = layoutGraph(graph, { direction: 'down' });
    expectValid(graph, result);
    const [a, b] = result.nodes;
    expect(a!.y + a!.height).toBeLessThan(b!.y);
    expect(a!.x).toBe(b!.x);
    expect(a!.width).toBe(80);
    expect(result.edges[0]!.points).toEqual([
      { x: a!.x + 40, y: a!.y + 30 },
      { x: b!.x + 40, y: b!.y },
    ]);
  });

  it('draws one edge of a cycle against the flow', () => {
    const graph: LayoutGraph = {
      nodes: ['a', 'b', 'c'].map((id) => ({ id, ...box() })),
      edges: [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'bc', source: 'b', target: 'c' },
        { id: 'ca', source: 'c', target: 'a' },
      ],
    };
    const result = layoutGraph(graph);
    expectValid(graph, result);
    expect(result.stats.reversedEdges).toBe(1);
    const back = result.edges.find((e) => e.reversed)!;
    expect(back.id).toBe('ca');
    // Its route still runs source to target: from c's left side to a's right side.
    const a = result.nodes[0]!;
    const c = result.nodes[2]!;
    expect(back.points[0]!.x).toBe(c.x);
    expect(back.points[back.points.length - 1]!.x).toBe(a.x + a.width);
  });

  it('untangles crossings the input order would cause', () => {
    const graph: LayoutGraph = {
      nodes: ['a', 'b', 'd', 'c'].map((id) => ({ id, ...box() })),
      edges: [
        { id: 'ac', source: 'a', target: 'c' },
        { id: 'bd', source: 'b', target: 'd' },
      ],
    };
    const result = layoutGraph(graph);
    expectValid(graph, result);
    expect(result.stats.crossings).toBe(0);
  });

  it('drops edges it cannot draw and says so', () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: 'box', ...box(200, 100) },
        { id: 'inner', ...box(), parent: 'box' },
        { id: 'x', ...box() },
      ],
      edges: [
        { id: 'self', source: 'x', target: 'x' },
        { id: 'ghost', source: 'x', target: 'nobody' },
        { id: 'own', source: 'box', target: 'inner' },
        { id: 'ok', source: 'inner', target: 'x' },
      ],
    };
    const result = layoutGraph(graph);
    expectValid(graph, result);
    expect(result.stats.droppedEdges).toBe(3);
    expect(result.edges.map((e) => e.id)).toEqual(['ok']);
  });

  it('packs unconnected nodes toward the aspect ratio instead of one column', () => {
    const graph: LayoutGraph = {
      nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, ...box() })),
      edges: [],
    };
    const result = layoutGraph(graph, { aspectRatio: 1.6 });
    expectValid(graph, result);
    const ratio = result.width / result.height;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(3.2);
  });

  it('long edges into one node share their bend points as one trunk', () => {
    const graph: LayoutGraph = {
      nodes: ['r', 's1', 's2', 's0', 'm1', 'm2', 't'].map((id) => ({ id, ...box() })),
      edges: [
        { id: 'r-s1', source: 'r', target: 's1' },
        { id: 'r-s2', source: 'r', target: 's2' },
        { id: 's0-m1', source: 's0', target: 'm1' },
        { id: 'm1-m2', source: 'm1', target: 'm2' },
        { id: 'm2-t', source: 'm2', target: 't' },
        { id: 's1-t', source: 's1', target: 't' },
        { id: 's2-t', source: 's2', target: 't' },
      ],
    };
    const result = layoutGraph(graph);
    expectValid(graph, result);
    expect(result.stats.dummyNodes).toBe(1);
    const tail = (id: string) => result.edges.find((e) => e.id === id)!.points.slice(-2);
    expect(tail('s1-t')).toEqual(tail('s2-t'));
  });

  it('gives the same answer every time', () => {
    const graph = randomGraph(7, 40, 70, 0);
    expect(layoutGraph(graph)).toEqual(layoutGraph(graph));
  });

  it('survives an empty graph', () => {
    expect(layoutGraph({ nodes: [], edges: [] })).toMatchObject({
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
    });
  });
});

describe('layoutGraph — containers', () => {
  const nested: LayoutGraph = {
    nodes: [
      { id: 'A', ...box(60, 24) },
      { id: 'a1', ...box(), parent: 'A' },
      { id: 'a2', ...box(), parent: 'A' },
      { id: 'B', ...box(60, 24) },
      { id: 'b1', ...box(), parent: 'B' },
      { id: 'b2', ...box(), parent: 'B' },
    ],
    edges: [
      { id: 'a1a2', source: 'a1', target: 'a2' },
      { id: 'a1b1', source: 'a1', target: 'b1' },
      { id: 'a2b1', source: 'a2', target: 'b1' },
      { id: 'a2b2', source: 'a2', target: 'b2' },
    ],
  };

  it('keeps children inside their containers and routes around everything else', () => {
    for (const direction of ['right', 'down'] as const) {
      const result = layoutGraph(nested, { direction });
      expectValid(nested, result);
      expect(result.nodes.find((n) => n.id === 'A')!.container).toBe(true);
      expect(result.nodes.find((n) => n.id === 'a1')!.container).toBe(false);
    }
  });

  it('sends edges toward one neighbor through one shared border port', () => {
    const result = layoutGraph(nested);
    const A = result.nodes.find((n) => n.id === 'A')!;
    const border = A.x + A.width;
    // Where each route crosses A's right border.
    const exitOf = (id: string): number | undefined => {
      const points = result.edges.find((e) => e.id === id)!.points;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        if (Math.min(a.x, b.x) <= border && Math.max(a.x, b.x) >= border && a.y === b.y) return a.y;
      }
      return undefined;
    };
    const exits = ['a1b1', 'a2b1', 'a2b2'].map(exitOf);
    expect(exits[0]).toBeDefined();
    expect(exits[1]).toBe(exits[0]);
    expect(exits[2]).toBe(exits[0]);
  });

  it('with one port per side, every edge leaves a container at the same point', () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: 'A', ...box(60, 24) },
        { id: 'a1', ...box(), parent: 'A' },
        { id: 'a2', ...box(), parent: 'A' },
        { id: 'x', ...box() },
        { id: 'y', ...box() },
      ],
      edges: [
        { id: 'a1x', source: 'a1', target: 'x' },
        { id: 'a1y', source: 'a1', target: 'y' },
        { id: 'a2y', source: 'a2', target: 'y' },
      ],
    };
    const result = layoutGraph(graph, { portSharing: 'container' });
    expectValid(graph, result);
    const A = result.nodes.find((n) => n.id === 'A')!;
    const border = A.x + A.width;
    const crossings = result.edges.map((e) => {
      for (let i = 1; i < e.points.length; i++) {
        const [a, b] = [e.points[i - 1]!, e.points[i]!];
        if (Math.min(a.x, b.x) <= border && Math.max(a.x, b.x) >= border && a.y === b.y) return a.y;
      }
      return undefined;
    });
    expect(crossings[0]).toBeDefined();
    expect(new Set(crossings).size).toBe(1);
  });

  it('grows a container to its contents but never below its own size', () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: 'big', ...box(500, 300) },
        { id: 'x', ...box(), parent: 'big' },
      ],
      edges: [],
    };
    const result = layoutGraph(graph);
    expectValid(graph, result);
    expect(result.nodes[0]).toMatchObject({ width: 500, height: 300, container: true });
  });

  it('routes an edge from a container itself out of its border', () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: 'A', ...box(60, 24) },
        { id: 'a1', ...box(), parent: 'A' },
        { id: 'x', ...box() },
      ],
      edges: [{ id: 'Ax', source: 'A', target: 'x' }],
    };
    const result = layoutGraph(graph);
    expectValid(graph, result);
  });

  it('cuts a parent cycle instead of looping forever', () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: 'p', ...box(), parent: 'q' },
        { id: 'q', ...box(), parent: 'p' },
        { id: 'r', ...box(), parent: 'q' },
      ],
      edges: [{ id: 'rp', source: 'r', target: 'p' }],
    };
    const result = layoutGraph(graph);
    expect(result.nodes).toHaveLength(3);
  });

  it('handles deep nesting with edges across every level', () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: 'L1', ...box(40, 20) },
        { id: 'L2', ...box(40, 20), parent: 'L1' },
        { id: 'L3', ...box(40, 20), parent: 'L2' },
        { id: 'deep', ...box(), parent: 'L3' },
        { id: 'mid', ...box(), parent: 'L2' },
        { id: 'R1', ...box(40, 20) },
        { id: 'R2', ...box(40, 20), parent: 'R1' },
        { id: 'far', ...box(), parent: 'R2' },
        { id: 'top', ...box() },
      ],
      edges: [
        { id: 'deep-far', source: 'deep', target: 'far' },
        { id: 'far-deep', source: 'far', target: 'deep' },
        { id: 'mid-deep', source: 'mid', target: 'deep' },
        { id: 'top-deep', source: 'top', target: 'deep' },
        { id: 'far-top', source: 'far', target: 'top' },
      ],
    };
    for (const direction of ['right', 'down'] as const) {
      const result = layoutGraph(graph, { direction });
      expectValid(graph, result);
    }
  });
});

describe('layoutGraph — random graphs', () => {
  const cases: [number, number, number, number][] = [
    [1, 20, 30, 0],
    [2, 40, 80, 6],
    [3, 60, 120, 10],
    [4, 80, 100, 14],
    [5, 30, 90, 3],
  ];
  for (const [seed, n, e, f] of cases) {
    for (const direction of ['right', 'down'] as const) {
      it(`seed ${seed}: ${n} nodes, ${e} edges, ${f} folders, ${direction}`, () => {
        const graph = randomGraph(seed, n, e, f);
        expectValid(graph, layoutGraph(graph, { direction }));
      });
    }
  }

  it('keeps every coordinate whole in integer mode', () => {
    const graph = randomGraph(11, 40, 60, 6);
    const cells: LayoutGraph = {
      nodes: graph.nodes.map((node) => ({ ...node, width: Math.ceil(node.width / 10), height: 3 })),
      edges: graph.edges,
    };
    const options: LayoutOptions = {
      integerCoordinates: true,
      nodeSpacing: 2,
      layerSpacing: 6,
      edgeSpacing: 1,
      componentSpacing: 4,
      containerPadding: { top: 2, right: 1, bottom: 1, left: 1 },
    };
    const result = layoutGraph(cells, options);
    expectValid(cells, result);
    for (const n of result.nodes)
      for (const v of [n.x, n.y, n.width, n.height]) expect(Number.isInteger(v)).toBe(true);
    for (const e of result.edges)
      for (const p of e.points) expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  });

  it('lays out a 600-file graph promptly', () => {
    const graph = randomGraph(42, 600, 1200, 40);
    const started = Date.now();
    const result = layoutGraph(graph);
    const elapsed = Date.now() - started;
    expectValid(graph, result);
    expect(elapsed).toBeLessThan(10_000);
  });
});

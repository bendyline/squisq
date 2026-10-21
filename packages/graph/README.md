# @bendyline/squisq-graph

Graph layout for squisq: a compound layered ("Sugiyama") layout with
orthogonal edge routing. Give it boxes, optional containers, and edges; it
returns positions for every box and an axis-aligned route for every edge.

- **Edges flow one way.** Cycles are broken by drawing the fewest edges
  against the flow, and nodes are ordered to cross as little as possible.
- **Containers stay whole.** Nodes may nest inside container nodes to any
  depth. Each container is laid out on its own, so its contents never leak
  out, and edges leave it through ports on its border. Edges toward the same
  neighbor share one port (or, with `portSharing: 'container'`, every edge
  shares one port per side).
- **Fans read as trees.** Long edges into one node share their bend points,
  and runs that converge in a channel share a track, so a hub draws as a
  trunk with branches rather than a comb of parallel lines.
- **Deterministic.** The same input always gives the same output; ties are
  broken by input order. `graphSignature` fingerprints a graph and its
  options for caching.
- **Any unit.** Size nodes in pixels, or in character cells with
  `integerCoordinates: true`.
- **Off the main thread.** `createWorkerLayoutEngine` runs layouts in a Web
  Worker and falls back to the calling thread where none can start.

Zero runtime dependencies; runs in the browser and Node.

```ts
import { layoutGraph, polylinePath } from '@bendyline/squisq-graph';

const result = layoutGraph(
  {
    nodes: [
      { id: 'src', width: 60, height: 24 },
      { id: 'a.ts', width: 80, height: 28, parent: 'src' },
      { id: 'b.ts', width: 80, height: 28, parent: 'src' },
      { id: 'main.ts', width: 90, height: 28 },
    ],
    edges: [
      { id: 'm-a', source: 'main.ts', target: 'a.ts' },
      { id: 'a-b', source: 'a.ts', target: 'b.ts' },
    ],
  },
  { direction: 'right' },
);

for (const edge of result.edges) {
  const d = polylinePath(edge.points, { radius: 6 });
  // <path d={d} marker-end="url(#arrow)" />
}
```

In squisq itself it places auto-laid-out nodes of the `diagram` template
and backs the ASCII diagram editor's **Arrange** action
(`arrangeAsciiDiagram`).

Part of the [squisq](https://github.com/bendyline/squisq) monorepo. MIT
licensed.

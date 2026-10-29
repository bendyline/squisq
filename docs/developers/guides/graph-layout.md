---
title: Graph layout
description: Lay out boxes and arrows with @bendyline/squisq-graph, run large layouts in a Web Worker, and draw the result in React with DiagramViewer.
---

# Graph layout

`@bendyline/squisq-graph` takes boxes, optional containers, and edges, and returns a position for
every box and an axis-aligned route for every edge. It is a compound layered ("Sugiyama") layout:
edges flow one way, crossings are kept low, nested containers stay whole, and long edges into one
node share bend points so fans read as trees.

It is pure TypeScript with zero runtime dependencies, runs in the browser and in Node, and is
deterministic: the same input always produces the same output. Squisq itself uses it to auto-place
nodes in the `diagram` template and for the ASCII diagram editor's **Arrange** action.

Drawing is up to you. Use the route helpers to emit SVG, or hand the result to `DiagramViewer` from
`@bendyline/squisq-react/graph` for a pan-and-zoom viewer with selection and keyboard navigation.

```bash
npm install @bendyline/squisq-graph
# for the React viewer:
npm install @bendyline/squisq-react react react-dom
```

## Lay out a graph

```ts
import { layoutGraph, type LayoutGraph } from '@bendyline/squisq-graph';

const graph: LayoutGraph = {
  nodes: [
    { id: 'api', width: 90, height: 28 },
    { id: 'services', width: 80, height: 24 }, // a container: other nodes name it as parent
    { id: 'auth', width: 70, height: 28, parent: 'services' },
    { id: 'billing', width: 80, height: 28, parent: 'services' },
    { id: 'db', width: 60, height: 28 },
  ],
  edges: [
    { id: 'api-auth', source: 'api', target: 'auth' },
    { id: 'api-billing', source: 'api', target: 'billing' },
    { id: 'auth-db', source: 'auth', target: 'db' },
    { id: 'billing-db', source: 'billing', target: 'db', weight: 2 },
    { id: 'db-api', source: 'db', target: 'api' }, // closes a cycle
    { id: 'loop', source: 'db', target: 'db' }, // a self-loop: dropped
  ],
};

const result = layoutGraph(graph, { direction: 'down' });
```

`result` holds every node in input order with absolute top-left coordinates, the routes, the drawing
size, and statistics:

```text
width 208, height 252
stats { crossings: 0, reversedEdges: 1, dummyNodes: 1, droppedEdges: 1 }

api       x 9.25  y 0    90 × 28
services  x 14    y 76   194 × 100   container
auth      x 26    y 120  70 × 28
billing   x 116   y 120  80 × 28
db        x 57.75 y 224  60 × 28

db-api  reversed  [(87.75,224) (87.75,200) (0,200) (0,52) (54.25,52) (54.25,28)]
```

The `services` container grew from its 80 × 24 minimum to hold its contents. The edge from `db` back
to `api` closes a cycle, so it is drawn against the flow and marked `reversed`; its points still run
from its source to its target. The self-loop was dropped and counted.

### The input

A `LayoutGraph` is `{ nodes, edges }`. Sizes are in whatever unit you draw in: pixels for SVG or
canvas, character cells for ASCII art.

| Node field      | Meaning                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `id`            | Unique within the graph.                                                                   |
| `width, height` | The box size. For a container, its minimum size (room for its label); the layout grows it. |
| `parent`        | Id of the container that holds this node. Any node another node names is a container.      |

| Edge field       | Meaning                                                   |
| ---------------- | --------------------------------------------------------- |
| `id`             | Your edge id, echoed in the result.                       |
| `source, target` | Node ids.                                                 |
| `weight`         | Heavier edges are kept shorter and straighter. Default 1. |

Containers nest to any depth. Each one is laid out on its own, innermost first, so its contents
never leak out, and edges cross its border through ports. A `parent` that names no node leaves the
node at the top level.

Input order matters. Every tie is broken by the order of `nodes` and `edges`, which is what makes the
layout stable. If your data comes from an unordered source, sort it before laying it out.

### The result

| `LayoutResult` field | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `nodes`              | Every input node, in input order: `{ id, x, y, width, height, container }`.   |
| `edges`              | Every kept edge, in input order: `{ id, source, target, points, reversed }`.  |
| `width, height`      | The drawing size. Everything lies within `[0, width] × [0, height]`.          |
| `stats`              | `crossings`, `reversedEdges`, `dummyNodes` (bend points), and `droppedEdges`. |

Coordinates are absolute, not relative to the container, with y growing downward. Each edge's
`points` run from the source's boundary to the target's in axis-aligned segments (consecutive points
share an x or a y), with at least two points.

An edge is dropped, and counted in `stats.droppedEdges`, when an endpoint is unknown, when it is a
self-loop, or when it links a container to its own contents.

## Options

Pass `LayoutOptions` as the second argument. Every option is optional; `DEFAULT_LAYOUT_OPTIONS`
holds the defaults and `resolveLayoutOptions(options)` fills them in.

| Option               | Default                     | What it controls                                                                                               |
| -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `direction`          | `'right'`                   | Which way edges flow: sources on the left (`'right'`) or on top (`'down'`).                                    |
| `nodeSpacing`        | `20`                        | Gap between neighboring nodes in one layer.                                                                    |
| `layerSpacing`       | `48`                        | Minimum gap between layers; widened when a gap needs more routing tracks.                                      |
| `edgeSpacing`        | `8`                         | Gap between parallel edge segments.                                                                            |
| `componentSpacing`   | `40`                        | Gap between unconnected parts of the graph.                                                                    |
| `containerPadding`   | top 28, sides and bottom 12 | Space inside a container around its contents; the top holds the label. Partial values merge with the defaults. |
| `aspectRatio`        | `1.6`                       | Width-to-height target when packing unconnected parts side by side.                                            |
| `orderingSweeps`     | `24`                        | Ordering passes. More find fewer crossings on dense graphs.                                                    |
| `placementSweeps`    | `12`                        | Placement passes. More straighten long edges further.                                                          |
| `portSharing`        | `'neighbor'`                | How edges crossing a container border share ports (see below).                                                 |
| `integerCoordinates` | `false`                     | Round every coordinate to a whole number, for character grids.                                                 |

Invalid numbers (negative, `NaN`) fall back to the default rather than throwing.

### Container ports

An edge that leaves a container does so through a port on its border: out on the side the flow runs
toward, in on the side it comes from.

- `portSharing: 'neighbor'` gives one port per outside neighbor, so each trunk leaving a container
  names where it goes.
- `portSharing: 'container'` gives one port per side, so every node inside shows a single line toward
  the way out.

### Character grids

With `integerCoordinates: true`, size nodes in character cells and set spacings in cells too. This is
how Squisq re-arranges ASCII box diagrams: `arrangeAsciiDiagram` (from `@bendyline/squisq/doc`) lays
the boxes out with this package, re-renders the art, and checks that nothing was lost.

```ts
import { arrangeAsciiDiagram, parseAsciiDiagram, renderAsciiDiagram } from '@bendyline/squisq/doc';

const art = `
┌─────────┐   ┌─────────┐   ┌────────┐
│ Sensors │──▶│ Gateway │──▶│ Storage│
└─────────┘   └─────────┘   └────────┘
`;

console.log(renderAsciiDiagram(arrangeAsciiDiagram(parseAsciiDiagram(art))));
// The three boxes, now stacked top to bottom with arrows between them.
```

See [Diagrams](../../guide/diagrams.md#box-diagrams) for the authored diagram format.

## Draw the routes yourself

Three helpers turn routes into drawing instructions:

| Helper                                          | Returns                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `polylinePath(points, { radius?, precision? })` | An SVG path `d`. `radius` rounds corners (each cut to at most half its shorter leg). |
| `pointAlongPolyline(points, fraction)`          | `{ x, y, angle }` a fraction (0–1) of the way along, for labels and arrowheads.      |
| `polylineLength(points)`                        | The route's length.                                                                  |

A minimal SVG renderer:

```ts
import { pointAlongPolyline, polylinePath, type LayoutResult } from '@bendyline/squisq-graph';

function toSvg(result: LayoutResult, labels: Record<string, string>): string {
  const parts: string[] = [];
  for (const node of result.nodes) {
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="4"` +
        ` fill="${node.container ? '#f1f5f9' : '#fff'}" stroke="#94a3b8"/>`,
      `<text x="${node.x + 8}" y="${node.y + 18}" font-size="12">${labels[node.id] ?? node.id}</text>`,
    );
  }
  for (const edge of result.edges) {
    const dash = edge.reversed ? ' stroke-dasharray="4 3"' : '';
    parts.push(
      `<path d="${polylinePath(edge.points, { radius: 6 })}" fill="none" stroke="#64748b"${dash}` +
        ` marker-end="url(#arrow)"/>`,
    );
    const mid = pointAlongPolyline(edge.points, 0.5);
    parts.push(`<circle cx="${mid.x}" cy="${mid.y}" r="2" fill="#64748b"/>`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${result.width} ${result.height}">` +
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6"` +
    ` markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#64748b"/></marker></defs>` +
    parts.join('') +
    `</svg>`
  );
}
```

Escape labels before putting them in markup if they come from users.

## Cache layouts with graphSignature

`graphSignature(graph, options?)` returns a short, stable string fingerprint of everything that
decides a layout: the graph in order and the resolved options. Equal signatures mean an identical
layout, so you can key a cache on it.

```ts
import {
  graphSignature,
  layoutGraph,
  type LayoutGraph,
  type LayoutOptions,
  type LayoutResult,
} from '@bendyline/squisq-graph';

const cache = new Map<string, LayoutResult>();

function cachedLayout(graph: LayoutGraph, options?: LayoutOptions) {
  const key = graphSignature(graph, options);
  let result = cache.get(key);
  if (!result) {
    result = layoutGraph(graph, options);
    cache.set(key, result);
  }
  return result;
}
```

Options are resolved before hashing, so passing a default explicitly (`{ nodeSpacing: 20 }`) gives the
same signature as leaving it out. Reordering nodes or edges changes the signature, because it can
change the layout. `LAYOUT_ALGORITHM_VERSION` is part of the hash; it changes when the algorithm's
output changes, which invalidates persisted caches.

## Run layouts off the main thread

A large graph can take long enough to stall the UI. A layout engine runs the same `layoutGraph`
behind a promise:

```ts
import { createWorkerLayoutEngine } from '@bendyline/squisq-graph';

const engine = createWorkerLayoutEngine();
const controller = new AbortController();

const result = await engine.layout(graph, { direction: 'down' }, { signal: controller.signal });
console.log(engine.mode); // 'worker', or 'inline' after falling back

engine.dispose(); // when you are done with it
```

How the worker engine behaves:

- It spawns its worker lazily on the first request and runs requests one at a time, in order.
- Aborting the running request, or a request passing its deadline (`requestTimeoutMs`, default 20
  seconds), ends the worker; the next request starts a fresh one. An aborted request rejects with an
  `AbortError`.
- Where no worker can start (Node, server rendering, a missing worker asset), requests run on the
  calling thread and `mode` reports `'inline'`.
- `dispose()` rejects anything pending, and later calls reject.

`createInlineLayoutEngine()` gives the same interface on the calling thread. For tests, pass
`transport: createLocalLayoutTransport` to drive the real worker protocol in-process.

### Bundling the worker

By default the engine starts the worker with
`new Worker(new URL('./worker/index.js', import.meta.url), { type: 'module' })`, a pattern Vite and
webpack 5 recognize and emit as an asset. The worker script is the package's self-contained
`@bendyline/squisq-graph/worker` subpath.

If your bundler pre-bundles dependencies, that URL breaks. In Vite, either add
`@bendyline/squisq-graph` to `optimizeDeps.exclude`, or build the worker yourself and pass a
`workerFactory`:

```ts
import { createWorkerLayoutEngine } from '@bendyline/squisq-graph';
import LayoutWorker from '@bendyline/squisq-graph/worker?worker';

export const engine = createWorkerLayoutEngine({
  workerFactory: () => new LayoutWorker(),
  requestTimeoutMs: 10_000,
});
```

## Draw it in React with DiagramViewer

`@bendyline/squisq-react/graph` holds a viewer for laid-out graphs, a caching layout hook, and the
text metrics to size nodes with. It is a separate subpath: the root entry and the standalone players
never load it.

```tsx
import { useMemo, useRef, useState } from 'react';
import type { LayoutGraph } from '@bendyline/squisq-graph';
import {
  DiagramViewer,
  graphNodeSize,
  useGraphLayout,
  type DiagramViewerHandle,
  type GraphViewNode,
} from '@bendyline/squisq-react/graph';

interface Service {
  id: string;
  name: string;
  team?: string;
  group?: string; // id of a container service
  dependsOn: string[];
}

export function ServiceMap({ services }: { services: Service[] }) {
  const views = useMemo<GraphViewNode[]>(
    () => services.map((s) => ({ id: s.id, label: s.name, detail: s.team })),
    [services],
  );
  const graph = useMemo<LayoutGraph>(
    () => ({
      nodes: services.map((s, i) => ({ id: s.id, parent: s.group, ...graphNodeSize(views[i]!) })),
      edges: services.flatMap((s) =>
        s.dependsOn.map((target) => ({ id: `${s.id}->${target}`, source: s.id, target })),
      ),
    }),
    [services, views],
  );
  const { layout, slow, error } = useGraphLayout(graph, { direction: 'down' });
  const [selected, setSelected] = useState<string[]>([]);
  const viewer = useRef<DiagramViewerHandle>(null);

  if (error) return <p role="alert">{error.message}</p>;
  if (!layout) return <p>Laying out…</p>;
  return (
    <div style={{ height: 480 }}>
      {slow && <p>Updating layout…</p>}
      <DiagramViewer
        ref={viewer}
        layout={layout}
        nodes={views}
        selectedIds={selected}
        onSelectionChange={setSelected}
        onNodeActivate={(id) => viewer.current?.reveal(id)}
        ariaLabel="Service dependencies"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
```

Give the viewer a size. It fills its own box (the SVG is 100% × 100%), measures it with a
`ResizeObserver`, and fits the drawing until the reader pans or zooms.

### Size nodes with graphNodeSize

Layouts often run before anything is drawn, sometimes in a worker, so the viewer measures text with
a character-width table instead of the DOM. `graphNodeSize({ label, detail?, badge?, expandable? },
{ minWidth?, maxWidth? })` returns the `{ width, height }` a node needs for what the viewer draws,
clamped to 64–280 by default. Feed it to the layout; the viewer truncates with the same table, so a
label always stays inside its box. `estimateTextWidth` and `truncateToWidth` expose the table, and
`GRAPH_NODE_METRICS` holds the type sizes and insets.

### useGraphLayout

`useGraphLayout(graph, options?, { engine?, slowAfterMs? })` returns
`{ layout, pending, slow, error, signature }`:

- Layouts are cached by `graphSignature` (the most recent dozen, shared by every hook instance), so
  returning to a graph is instant. `clearGraphLayoutCache()` empties the cache.
- A new graph keeps the previous `layout` on screen while the next one computes; a superseded layout
  is aborted.
- `slow` turns on only after `slowAfterMs` (default 150 ms), so quick layouts never flash a spinner.
- Layouts run on the calling thread unless you pass `engine: createWorkerLayoutEngine()`.

Only the signature decides whether the hook lays out again, so a new `graph` object with the same
content costs a hash, not a layout.

### Viewer props

| Prop                                        | Purpose                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout`                                    | The `LayoutResult` to draw. Required.                                                                                                                               |
| `ariaLabel`                                 | Name of the diagram for assistive technology. Required.                                                                                                             |
| `nodes`                                     | Per-node presentation: `label`, `detail` (second line), `badge`, `tone`, `fill`, `expandable`, `expanded`, `title`, `className`. A node without one shows its id.   |
| `edges`                                     | Per-edge presentation: `weight` (line width), `dashed`, `bidirectional`, `tone`, `title`, `className`.                                                              |
| `selectedIds`, `onSelectionChange`          | Controlled selection. Click selects; Shift, ⌘, or Ctrl toggles a node in or out; clicking the background clears. Omit `selectedIds` to let the viewer keep its own. |
| `onNodeActivate`                            | Double-click or Enter on a node that is not a container.                                                                                                            |
| `onContainerToggle(id, expanded)`           | A node's toggle was clicked, or Space pressed on an `expandable` node.                                                                                              |
| `onEdgeClick`, `onHoverChange`              | Edge clicks and the hovered node id (or `null`).                                                                                                                    |
| `highlightIds`                              | Keep these nodes (and edges between them) bright and dim the rest, such as search hits.                                                                             |
| `hoverNeighbors`                            | Hovering dims all but the node, its neighbors and its edges. Default `true`.                                                                                        |
| `wheel`                                     | `'zoom'` (default), or `'scroll-unless-modifier'` for a viewer inside a scrolling page.                                                                             |
| `controls`                                  | Show the zoom and fit buttons. Default `true`.                                                                                                                      |
| `cornerRadius`, `fitPadding`, `maxFitScale` | Edge bend radius (6), fit padding (24), and the largest scale a fit may reach (1.5).                                                                                |
| `describeNode`                              | What to announce when a node is selected; defaults to its label.                                                                                                    |
| `initialSize`                               | Size to assume before the element is measured (tests, server rendering).                                                                                            |

Tones are `neutral`, `accent`, `positive`, `notice`, `warning`, `danger`, and `muted`
(`GRAPH_TONE_NAMES`).

The ref handle (`DiagramViewerHandle`) offers `fit()`, `focus(ids)`, `reveal(id)`, `zoomBy(factor)`,
and `keepInPlace(id)`. The viewer already holds a toggled node at its screen position through the
next layout; call `keepInPlace` before changing the graph some other way.

### Keyboard

The viewer is one focusable element. Arrow keys move the selection, `]` and `[` follow outgoing and
incoming edges, Enter activates, Space toggles, Escape clears the selection, `f` or `0` fits, and `+`
and `-` zoom.

### Theming and large graphs

Every color is a CSS custom property with a light fallback, set on any ancestor:
`--squisq-graph-bg`, `--squisq-graph-node-bg`, `--squisq-graph-node-border`,
`--squisq-graph-text`, `--squisq-graph-muted`, `--squisq-graph-edge`,
`--squisq-graph-container-bg`, `--squisq-graph-container-border`, `--squisq-graph-badge-bg`,
`--squisq-graph-focus`, and `--squisq-graph-tone-<tone>`. The viewer renders its own stylesheet, so
there is no CSS file to import.

Panning, zooming, hovering and selecting never re-render the drawing. Above `GRAPH_VIEW_CULL_AT`
(600) nodes, only what is near the screen is drawn, and labels, details and badges drop out as the
drawing shrinks.

## Pitfalls

- **Unstable input order.** Ties follow input order, so feeding nodes in a different order gives a
  different (equally valid) layout and a different signature. Sort input from unordered sources.
- **Unmeasured text.** The layout only knows the sizes you give it. Size nodes with `graphNodeSize`
  when drawing with `DiagramViewer`, or measure with your own renderer's font otherwise.
- **Container-relative math.** Every `x` and `y` is absolute; don't add the parent's position again.
- **Pre-bundled workers.** A worker engine that silently reports `mode: 'inline'` in the browser
  usually means the bundler rewrote the worker URL; see [Bundling the worker](#bundling-the-worker).

## Related

- API reference: [`@bendyline/squisq-graph`](../../API.md#bendylinesquisq-graph) and
  [the graph viewer](../../API.md#graph-viewer-squisq-reactgraph)
- [Diagrams](../../guide/diagrams.md) — box diagrams, trees, and timelines in documents
- [Rendering documents in React](rendering.md)

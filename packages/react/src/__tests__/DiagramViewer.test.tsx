import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { layoutGraph, type GraphLayoutEngine, type LayoutGraph } from '@bendyline/squisq-graph';
import { DiagramViewer } from '../graph/DiagramViewer';
import { graphViewRenderCounts } from '../graph/constants';
import type { DiagramViewerHandle, GraphViewNode } from '../graph/types';
import { clearGraphLayoutCache, useGraphLayout } from '../graph/useGraphLayout';
import { estimateTextWidth, graphNodeSize, truncateToWidth } from '../graph/textMetrics';
import * as graphEntry from '../entries/graph';

// jsdom has no PointerEvent; without one, fired pointer events lose their
// buttons, coordinates and modifier keys.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStandIn extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventStandIn as unknown as typeof PointerEvent;
}

const SIZE = { width: 800, height: 600 };

const graph: LayoutGraph = {
  nodes: [
    { id: 'src', width: 60, height: 24 },
    { id: 'a', width: 90, height: 28, parent: 'src' },
    { id: 'b', width: 90, height: 28, parent: 'src' },
    { id: 'main', width: 90, height: 28 },
    { id: 'lib', width: 90, height: 28 },
  ],
  edges: [
    { id: 'main-a', source: 'main', target: 'a' },
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'b-lib', source: 'b', target: 'lib' },
  ],
};
const layout = layoutGraph(graph);
const views: GraphViewNode[] = [
  { id: 'src', label: 'src', expandable: true, expanded: true },
  { id: 'a', label: 'a.ts', badge: '2', tone: 'warning' },
  { id: 'b', label: 'b.ts', detail: 'src' },
  { id: 'main', label: 'main.ts' },
  { id: 'lib', label: 'a-really-long-library-file-name.ts' },
];

function setup(extra: Partial<Parameters<typeof DiagramViewer>[0]> = {}) {
  const onSelectionChange = vi.fn();
  const handle = createRef<DiagramViewerHandle>();
  const utils = render(
    <DiagramViewer
      ref={handle}
      layout={layout}
      nodes={views}
      ariaLabel="Dependencies"
      initialSize={SIZE}
      onSelectionChange={onSelectionChange}
      {...extra}
    />,
  );
  const root = utils.container.querySelector('.squisq-graph-view') as HTMLElement;
  const node = (i: number) =>
    utils.container.querySelector(`.gv-node[data-i="${i}"]`) as SVGGElement;
  const dynamicStyle = () => utils.container.querySelectorAll('style')[1]!.textContent ?? '';
  return { ...utils, root, node, onSelectionChange, handle, dynamicStyle };
}

function click(el: Element, init: PointerEventInit = {}) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 10, clientY: 10, ...init });
  fireEvent.pointerUp(el, { button: 0, pointerId: 1, clientX: 10, clientY: 10, ...init });
}

describe('DiagramViewer', () => {
  it('draws every node, container and edge, with labels cut to their boxes', () => {
    const { container } = setup();
    expect(container.querySelectorAll('.gv-node')).toHaveLength(4);
    expect(container.querySelectorAll('.gv-container')).toHaveLength(1);
    expect(container.querySelectorAll('.gv-edge')).toHaveLength(3);
    const line = container.querySelector('.gv-edge .gv-line')!;
    expect(line.getAttribute('marker-end')).toMatch(/^url\(#gv.*-arrow-neutral\)$/);
    expect(
      container.querySelector('.gv-node[data-tone="warning"] .gv-badge text')?.textContent,
    ).toBe('2');
    const lib = layout.nodes.findIndex((n) => n.id === 'lib');
    const label = container.querySelector(`.gv-node[data-i="${lib}"] .gv-label`)!.textContent!;
    expect(label.endsWith('…')).toBe(true);
    expect(container.querySelector(`.gv-node[data-i="${lib}"] title`)?.textContent).toBe(
      'a-really-long-library-file-name.ts',
    );
    expect(container.querySelector('.gv-container .gv-toggle')).not.toBeNull();
  });

  it('selects on click, adds with shift, and clears on the background', () => {
    const { node, onSelectionChange, container } = setup();
    const a = layout.nodes.findIndex((n) => n.id === 'a');
    const b = layout.nodes.findIndex((n) => n.id === 'b');
    click(node(a));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    click(node(b), { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a', 'b']);
    click(container.querySelector('svg')!);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('a drag pans instead of selecting', () => {
    const { node, onSelectionChange, root } = setup();
    const svg = root.querySelector('svg')!;
    const before = svg.querySelector('.gv-world')!.getAttribute('transform');
    fireEvent.pointerDown(node(1), { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 60, clientY: 40 });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(svg.querySelector('.gv-world')!.getAttribute('transform')).not.toBe(before);
  });

  it('shows selection and hover without re-rendering the drawing', () => {
    const { rerender, dynamicStyle, node, root } = setup({ selectedIds: [] });
    const counts = { ...graphViewRenderCounts };
    rerender(
      <DiagramViewer
        layout={layout}
        nodes={views}
        ariaLabel="Dependencies"
        initialSize={SIZE}
        selectedIds={['a']}
      />,
    );
    const a = layout.nodes.findIndex((n) => n.id === 'a');
    expect(dynamicStyle()).toContain(`[data-i="${a}"]`);

    fireEvent.pointerOver(node(a));
    expect(root.hasAttribute('data-dim')).toBe(true);
    const main = layout.nodes.findIndex((n) => n.id === 'main');
    const b = layout.nodes.findIndex((n) => n.id === 'b');
    const lib = layout.nodes.findIndex((n) => n.id === 'lib');
    expect(dynamicStyle()).toContain(`[data-i="${main}"]`);
    expect(dynamicStyle()).toContain(`[data-i="${b}"]`);
    expect(dynamicStyle()).not.toContain(`[data-i="${lib}"]`);
    fireEvent.pointerLeave(root.querySelector('svg')!);
    expect(root.hasAttribute('data-dim')).toBe(false);

    expect(graphViewRenderCounts).toEqual(counts);
  });

  it('highlights a set of nodes and dims the rest', () => {
    const { root, dynamicStyle } = setup({ highlightIds: ['main'] });
    expect(root.hasAttribute('data-dim')).toBe(true);
    expect(dynamicStyle()).toContain(
      `[data-i="${layout.nodes.findIndex((n) => n.id === 'main')}"]`,
    );
  });

  it('opens a node on double-click and Enter, and toggles containers', () => {
    const onNodeActivate = vi.fn();
    const onContainerToggle = vi.fn();
    const { node, root, container } = setup({
      onNodeActivate,
      onContainerToggle,
      selectedIds: ['b'],
    });
    fireEvent.doubleClick(node(layout.nodes.findIndex((n) => n.id === 'a')));
    expect(onNodeActivate).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(root, { key: 'Enter' });
    expect(onNodeActivate).toHaveBeenLastCalledWith('b');
    click(container.querySelector('.gv-container .gv-toggle rect')!);
    expect(onContainerToggle).toHaveBeenLastCalledWith('src', false);
  });

  it('moves selection with the arrow keys and follows edges with ] and [', () => {
    const { root, onSelectionChange, rerender } = setup({ selectedIds: ['main'] });
    fireEvent.keyDown(root, { key: ']' });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a']);
    rerender(
      <DiagramViewer
        layout={layout}
        nodes={views}
        ariaLabel="Dependencies"
        initialSize={SIZE}
        selectedIds={['a']}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.keyDown(root, { key: '[' });
    expect(onSelectionChange).toHaveBeenLastCalledWith(['main']);
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    const picked = onSelectionChange.mock.lastCall![0][0] as string;
    const at = (id: string) => layout.nodes.find((n) => n.id === id)!;
    expect(at(picked).x).toBeGreaterThan(at('a').x);
    expect(root.querySelector('.gv-live')!.textContent).toBe(
      views.find((v) => v.id === picked)!.label,
    );
    fireEvent.keyDown(root, { key: 'Escape' });
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it('reports edge clicks when asked to', () => {
    const onEdgeClick = vi.fn();
    const { container } = setup({ onEdgeClick });
    click(container.querySelector('.gv-edge .gv-hit')!);
    expect(onEdgeClick).toHaveBeenCalledWith(layout.edges[0]!.id);
  });

  it('zooms with the wheel and the buttons, and Fit puts the drawing back', () => {
    const { root, getByLabelText } = setup();
    const level = () => getByLabelText('Zoom level').textContent;
    const fitted = level();
    fireEvent.wheel(root, { deltaY: -200, clientX: 100, clientY: 100 });
    expect(level()).not.toBe(fitted);
    fireEvent.click(getByLabelText('Fit diagram'));
    expect(level()).toBe(fitted);
    fireEvent.click(getByLabelText('Zoom in'));
    expect(level()).not.toBe(fitted);
  });

  it('leaves the page alone in scroll mode unless a modifier is held', () => {
    const { root, getByLabelText } = setup({ wheel: 'scroll-unless-modifier' });
    const fitted = getByLabelText('Zoom level').textContent;
    fireEvent.wheel(root, { deltaY: -200 });
    expect(getByLabelText('Zoom level').textContent).toBe(fitted);
    fireEvent.wheel(root, { deltaY: -200, ctrlKey: true });
    expect(getByLabelText('Zoom level').textContent).not.toBe(fitted);
  });

  it('holds a toggled container where it was through the next layout', () => {
    const onContainerToggle = vi.fn();
    const { container, rerender } = setup({ onContainerToggle });
    const screenOf = (id: string, l: typeof layout) => {
      const world = container.querySelector('.gv-world')!.getAttribute('transform')!;
      const [tx, ty, scale] = world.match(/-?[\d.]+(?:e-?\d+)?/g)!.map(Number) as [
        number,
        number,
        number,
      ];
      const n = l.nodes.find((node) => node.id === id)!;
      return { x: n.x * scale + tx, y: n.y * scale + ty };
    };
    const before = screenOf('src', layout);
    click(container.querySelector('.gv-container .gv-toggle rect')!);
    expect(onContainerToggle).toHaveBeenCalledWith('src', false);

    // The host collapses src: a new graph, a new layout, src now a plain box.
    const collapsed = layoutGraph({
      nodes: [
        { id: 'src', width: 60, height: 28 },
        { id: 'main', width: 90, height: 28 },
        { id: 'lib', width: 90, height: 28 },
      ],
      edges: [
        { id: 'main-src', source: 'main', target: 'src' },
        { id: 'src-lib', source: 'src', target: 'lib' },
      ],
    });
    rerender(
      <DiagramViewer
        layout={collapsed}
        nodes={views}
        ariaLabel="Dependencies"
        initialSize={SIZE}
        onContainerToggle={onContainerToggle}
      />,
    );
    const after = screenOf('src', collapsed);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('a reveal of a node already in view does not stop the view following the layout', () => {
    const { handle, rerender, getByLabelText } = setup();
    act(() => handle.current!.reveal('a'));
    const bigger = layoutGraph({
      ...graph,
      nodes: [
        ...graph.nodes,
        ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, width: 90, height: 28 })),
      ],
    });
    rerender(
      <DiagramViewer layout={bigger} nodes={views} ariaLabel="Dependencies" initialSize={SIZE} />,
    );
    // Still fitted: thirty more boxes make the whole drawing smaller on screen.
    const level = Number(getByLabelText('Zoom level').textContent!.replace('%', ''));
    expect(level).toBeLessThan(150);
  });

  it('draws only what is near the screen on a large graph', () => {
    const big: LayoutGraph = {
      nodes: Array.from({ length: 900 }, (_, i) => ({ id: `n${i}`, width: 80, height: 28 })),
      edges: Array.from({ length: 899 }, (_, i) => ({
        id: `e${i}`,
        source: `n${i}`,
        target: `n${i + 1}`,
      })),
    };
    const bigLayout = layoutGraph(big, { direction: 'down' });
    const handle = createRef<DiagramViewerHandle>();
    const { container } = render(
      <DiagramViewer ref={handle} layout={bigLayout} ariaLabel="Big" initialSize={SIZE} />,
    );
    act(() => handle.current!.focus(['n450']));
    const drawn = container.querySelectorAll('.gv-node').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(200);
    expect(container.querySelectorAll('.gv-edge').length).toBeLessThan(200);
  });
});

describe('useGraphLayout', () => {
  beforeEach(() => clearGraphLayoutCache());

  it('lays out, caches by signature, and answers a repeat at once', async () => {
    const { result } = renderHook(() => useGraphLayout(graph));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.layout).not.toBeNull());
    expect(result.current.layout).toEqual(layout);
    expect(result.current.pending).toBe(false);

    const copy = JSON.parse(JSON.stringify(graph)) as LayoutGraph;
    const again = renderHook(() => useGraphLayout(copy));
    expect(again.result.current.pending).toBe(false);
    expect(again.result.current.layout).toBe(result.current.layout);
  });

  it('keeps the last layout while a new one computes, flags a slow one, and aborts superseded work', async () => {
    const resolvers: ((value: ReturnType<typeof layoutGraph>) => void)[] = [];
    const signals: AbortSignal[] = [];
    const engine: GraphLayoutEngine = {
      mode: 'worker',
      layout: (g, o, request) => {
        signals.push(request!.signal!);
        return new Promise((resolve) => resolvers.push(resolve));
      },
      dispose: () => {},
    };
    const second: LayoutGraph = { ...graph, edges: graph.edges.slice(1) };
    const { result, rerender } = renderHook(
      ({ g }) => useGraphLayout(g, undefined, { engine, slowAfterMs: 10 }),
      {
        initialProps: { g: graph },
      },
    );
    act(() => resolvers[0]!(layout));
    await waitFor(() => expect(result.current.layout).toBe(layout));

    rerender({ g: second });
    expect(result.current.pending).toBe(true);
    expect(result.current.layout).toBe(layout);
    await waitFor(() => expect(result.current.slow).toBe(true));

    rerender({ g: { ...second, edges: [] } });
    expect(signals[1]!.aborted).toBe(true);
  });
});

describe('graph text metrics', () => {
  it('sizes a node for its label, detail, badge and toggle', () => {
    const plain = graphNodeSize({ label: 'index.ts' });
    expect(plain.height).toBe(28);
    expect(graphNodeSize({ label: 'index.ts', detail: 'src' }).height).toBe(40);
    expect(
      graphNodeSize({ label: 'index.ts', badge: '12', expandable: true }).width,
    ).toBeGreaterThan(plain.width);
    expect(graphNodeSize({ label: 'x'.repeat(200) }).width).toBe(280);
    expect(graphNodeSize({ label: 'a' }).width).toBe(64);
  });

  it('cuts text to a width with an ellipsis', () => {
    expect(truncateToWidth('short', 200)).toBe('short');
    const cut = truncateToWidth('a fairly long label for a box', 60);
    expect(cut.endsWith('…')).toBe(true);
    expect(estimateTextWidth(cut)).toBeLessThanOrEqual(60);
  });

  it('exports the viewer surface from the /graph entry', () => {
    expect(typeof graphEntry.DiagramViewer).toBe('object');
    expect(typeof graphEntry.useGraphLayout).toBe('function');
    expect(typeof graphEntry.graphNodeSize).toBe('function');
  });
});

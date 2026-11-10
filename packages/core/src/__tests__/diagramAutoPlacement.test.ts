import { describe, expect, it } from 'vitest';
import type { Block, Layer } from '../schemas/Doc.js';
import { expandDocBlocks } from '../doc/templates/index.js';
import { VIEWPORT_PRESETS, type ViewportConfig } from '../schemas/Viewport.js';

/** A data-driven diagram: a host or an AI author states nodes and edges. */
const diagram = (nodes: unknown[], edges: unknown[]): Block =>
  ({
    id: 'causes',
    template: 'diagram',
    title: 'What warms the planet',
    nodes,
    edges,
    startTime: 0,
    duration: 8,
    audioSegment: 0,
  }) as unknown as Block;

const layersOf = (block: Block, viewport: ViewportConfig = VIEWPORT_PRESETS.landscape): Layer[] =>
  expandDocBlocks([block], { viewport })[0]!.layers!;

/** Where a node's card was drawn: its centre, in canvas pixels. */
function centre(layers: Layer[], id: string): { x: number; y: number } {
  const card = layers.find((layer) => layer.id === `node-card-${id}`);
  if (!card) throw new Error(`no card for ${id}`);
  const { x, y, width, height } = card.position;
  return { x: Number(x) + Number(width) / 2, y: Number(y) + Number(height) / 2 };
}

const edges = [
  { source: 'fuel', target: 'co2', label: 'releases' },
  { source: 'forests', target: 'co2', label: 'release' },
  { source: 'co2', target: 'heat', label: 'traps' },
];
const unplaced = [
  { id: 'fuel', label: 'Fossil fuels' },
  { id: 'forests', label: 'Cleared forests' },
  { id: 'co2', label: 'Carbon dioxide' },
  { id: 'heat', label: 'Trapped heat' },
];

describe('diagram nodes without positions', () => {
  it('are placed from the edges: causes before effects, left to right', () => {
    const layers = layersOf(diagram(unplaced, edges));
    const at = (id: string) => centre(layers, id);
    // Every node is drawn, none on top of another.
    const spots = unplaced.map((node) => at(node.id));
    expect(new Set(spots.map((spot) => `${Math.round(spot.x)},${Math.round(spot.y)}`)).size).toBe(
      4,
    );
    // The flow follows the edges across the slide.
    expect(at('fuel').x).toBeLessThan(at('co2').x);
    expect(at('forests').x).toBeLessThan(at('co2').x);
    expect(at('co2').x).toBeLessThan(at('heat').x);
    // The two causes share a column, one above the other.
    expect(Math.abs(at('fuel').x - at('forests').x)).toBeLessThan(1);
    expect(at('fuel').y).not.toBeCloseTo(at('forests').y, 0);
    // Every edge and its label is drawn.
    for (const edge of edges)
      expect(JSON.stringify(layers), edge.label).toContain(`"${edge.label}"`);
  });

  it('flow down a portrait frame', () => {
    const layers = layersOf(diagram(unplaced, edges), VIEWPORT_PRESETS.portrait);
    expect(centre(layers, 'fuel').y).toBeLessThan(centre(layers, 'co2').y);
    expect(centre(layers, 'co2').y).toBeLessThan(centre(layers, 'heat').y);
  });

  it('leave an author’s own positions alone', () => {
    // Placed by hand right to left, against the edges: the author's layout stands.
    const placed = unplaced.map((node, index) => ({ ...node, x: (3 - index) * 280, y: 0 }));
    const layers = layersOf(diagram(placed, edges));
    expect(centre(layers, 'heat').x).toBeLessThan(centre(layers, 'fuel').x);
  });
});

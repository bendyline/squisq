import { describe, it, expect } from 'vitest';
import { computeDiagramLayout } from '../doc/templates/diagramLayout.js';
import type { Block } from '../schemas/Doc.js';

function makeBlock(overrides: Partial<Block> & { id: string }): Block {
  return {
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    ...overrides,
  } as Block;
}

describe('computeDiagramLayout', () => {
  it('keeps explicit x/y positions intact', () => {
    const layout = computeDiagramLayout([
      makeBlock({ id: 'a', x: 100, y: 200 }),
      makeBlock({ id: 'b', x: 400, y: 300 }),
    ]);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes[0]).toMatchObject({ id: 'a', x: 100, y: 200, pinned: true });
    expect(layout.nodes[1]).toMatchObject({ id: 'b', x: 400, y: 300, pinned: true });
  });

  it('auto-positions children missing x or y in a grid below pinned nodes', () => {
    const layout = computeDiagramLayout([
      makeBlock({ id: 'pinned', x: 200, y: 100 }),
      makeBlock({ id: 'a' }),
      makeBlock({ id: 'b' }),
      makeBlock({ id: 'c' }),
      makeBlock({ id: 'd' }),
    ]);
    expect(layout.nodes.find((n) => n.id === 'pinned')?.pinned).toBe(true);
    const auto = layout.nodes.filter((n) => n.id !== 'pinned');
    for (const node of auto) {
      expect(node.pinned).toBe(false);
      // Should sit below the pinned node's y.
      expect(node.y).toBeGreaterThan(100);
    }
  });

  it('places fully-unpositioned children starting at the default origin', () => {
    const layout = computeDiagramLayout([
      makeBlock({ id: 'a', title: 'A' }),
      makeBlock({ id: 'b', title: 'B' }),
    ]);
    expect(layout.nodes[0].pinned).toBe(false);
    expect(layout.nodes[1].pinned).toBe(false);
    expect(layout.nodes[0].x).toBeGreaterThanOrEqual(0);
    expect(layout.nodes[0].y).toBeGreaterThanOrEqual(0);
  });

  it('extracts edges from connectsTo, including connection types', () => {
    const layout = computeDiagramLayout([
      makeBlock({
        id: 'a',
        x: 0,
        y: 0,
        connectsTo: [{ target: 'b', type: 'flow' }, { target: 'c' }],
      }),
      makeBlock({ id: 'b', x: 100, y: 0 }),
      makeBlock({ id: 'c', x: 200, y: 0 }),
    ]);
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges[0]).toMatchObject({ source: 'a', target: 'b', type: 'flow' });
    expect(layout.edges[1]).toMatchObject({ source: 'a', target: 'c' });
    expect(layout.edges[1].type).toBeUndefined();
  });

  it('drops edges with unknown targets and reports a warning', () => {
    const layout = computeDiagramLayout([
      makeBlock({
        id: 'a',
        x: 0,
        y: 0,
        connectsTo: [{ target: 'ghost' }, { target: 'b' }],
      }),
      makeBlock({ id: 'b', x: 100, y: 0 }),
    ]);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].target).toBe('b');
    expect(layout.warnings.length).toBe(1);
    expect(layout.warnings[0]).toContain('ghost');
  });

  it('dedupes edges with identical source/target/type', () => {
    const layout = computeDiagramLayout([
      makeBlock({
        id: 'a',
        x: 0,
        y: 0,
        connectsTo: [
          { target: 'b', type: 'flow' },
          { target: 'b', type: 'flow' },
        ],
      }),
      makeBlock({ id: 'b', x: 100, y: 0 }),
    ]);
    expect(layout.edges).toHaveLength(1);
  });

  it('distinguishes edges with different types', () => {
    const layout = computeDiagramLayout([
      makeBlock({
        id: 'a',
        x: 0,
        y: 0,
        connectsTo: [
          { target: 'b', type: 'flow' },
          { target: 'b', type: 'requires' },
        ],
      }),
      makeBlock({ id: 'b', x: 100, y: 0 }),
    ]);
    expect(layout.edges).toHaveLength(2);
  });

  it('returns an empty layout for no children', () => {
    const layout = computeDiagramLayout([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.warnings).toEqual([]);
  });

  it('falls back to the block id for the node label when title is missing', () => {
    const layout = computeDiagramLayout([makeBlock({ id: 'lonely', x: 0, y: 0 })]);
    expect(layout.nodes[0].label).toBe('lonely');
  });

  it('uses block.title for the node label when present', () => {
    const layout = computeDiagramLayout([makeBlock({ id: 'a', x: 0, y: 0, title: 'Alpha' })]);
    expect(layout.nodes[0].label).toBe('Alpha');
  });

  it('lays connected auto-placed nodes out along the flow', () => {
    const children = [
      makeBlock({ id: 'save', connectsTo: [] }),
      makeBlock({ id: 'check', connectsTo: [{ target: 'save' }] }),
      makeBlock({ id: 'load', connectsTo: [{ target: 'parse' }] }),
      makeBlock({ id: 'parse', connectsTo: [{ target: 'check' }] }),
    ];
    const layout = computeDiagramLayout(children);
    const at = (id: string) => layout.nodes.find((n) => n.id === id)!;
    expect(at('load').x).toBeLessThan(at('parse').x);
    expect(at('parse').x).toBeLessThan(at('check').x);
    expect(at('check').x).toBeLessThan(at('save').x);
    // A straight chain sits on one line, a grid pitch apart.
    expect(new Set(layout.nodes.map((n) => n.y)).size).toBe(1);
    expect(at('parse').x - at('load').x).toBe(260);
    expect(layout.nodes.every((n) => !n.pinned && n.x >= 80 && n.y >= 80)).toBe(true);
    expect(computeDiagramLayout(children)).toEqual(layout);

    const down = computeDiagramLayout(children, { direction: 'down' });
    const below = (id: string) => down.nodes.find((n) => n.id === id)!;
    expect(below('load').y).toBeLessThan(below('parse').y);
    expect(below('parse').y - below('load').y).toBe(140);
  });

  it('keeps the grid for auto-placed nodes with no connections between them', () => {
    const layout = computeDiagramLayout([
      makeBlock({ id: 'a' }),
      makeBlock({ id: 'b' }),
      makeBlock({ id: 'c' }),
      makeBlock({ id: 'd', connectsTo: [{ target: 'pinned' }] }),
      makeBlock({ id: 'pinned', x: 0, y: 0 }),
    ]);
    const auto = layout.nodes.filter((n) => !n.pinned);
    expect(auto.map((n) => [n.x, n.y])).toEqual([
      [0, 220],
      [260, 220],
      [0, 360],
      [260, 360],
    ]);
  });
});

/**
 * DiagramAdapter — pure read-side transform. Verifies that given a
 * (nodes, edges) shape from the existing data hook, the adapter
 * produces card+label Layer pairs and matching SceneEdges.
 */

import { describe, it, expect } from 'vitest';
import { buildDiagramScene } from '../adapters/DiagramAdapter';
import { NODE_WIDTH, NODE_HEIGHT } from '../layers/nodeCard';

describe('buildDiagramScene', () => {
  it('emits a card + label pair per node and preserves edges', () => {
    const out = buildDiagramScene(
      [
        { id: 'a', position: { x: 100, y: 100 }, data: { label: 'Bar' } },
        { id: 'b', position: { x: 400, y: 100 }, data: { label: 'Baz' } },
      ],
      [{ id: 'a->b', source: 'a', target: 'b', label: 'uses' }],
    );

    // Two cards + two labels, in that order.
    expect(out.layers.map((l) => l.id)).toEqual([
      'node-card-a',
      'node-card-b',
      'node-label-a',
      'node-label-b',
    ]);

    const card = out.layers[0];
    expect(card.type).toBe('shape');
    expect(card.position.x).toBe(100);
    expect(card.position.width).toBe(NODE_WIDTH);
    expect(card.position.height).toBe(NODE_HEIGHT);

    const label = out.layers[2];
    expect(label.type).toBe('text');
    // Label is centered over its card.
    expect(label.position.x).toBe(100 + NODE_WIDTH / 2);
    expect(label.position.y).toBe(100 + NODE_HEIGHT / 2);
    if (label.type === 'text') expect(label.content.text).toBe('Bar');

    expect(out.edges).toEqual([{ id: 'a->b', source: 'a', target: 'b', label: 'uses' }]);
    expect(out.nodes).toEqual([
      { id: 'a', label: 'Bar', x: 100, y: 100 },
      { id: 'b', label: 'Baz', x: 400, y: 100 },
    ]);
  });

  it('omits edge label when none provided', () => {
    const out = buildDiagramScene(
      [{ id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } }],
      [{ id: 'a->b', source: 'a', target: 'b' }],
    );
    expect(out.edges[0]).toEqual({ id: 'a->b', source: 'a', target: 'b' });
  });

  it('passes container kind through and styles the label top-anchored', () => {
    const out = buildDiagramScene(
      [
        {
          id: 'group',
          position: { x: 0, y: 0 },
          data: { label: 'Cluster\nextra' },
          width: 600,
          height: 400,
          kind: 'container',
        },
        { id: 'a', position: { x: 40, y: 60 }, data: { label: 'A' } },
      ],
      [],
    );
    expect(out.nodes[0].kind).toBe('container');
    const label = out.layers.find((l) => l.id === 'node-label-group');
    expect(label?.position.y).toBeLessThan(0 + 400 / 2); // top-anchored, not centered
    if (label?.type === 'text') expect(label.content.text).toBe('Cluster'); // first line only
  });

  it('fits and vertically centers dense multi-line labels inside ASCII-sized cards', () => {
    const out = buildDiagramScene(
      [
        {
          id: 'kernel',
          position: { x: 100, y: 200 },
          data: {
            label: '@bendyline/molen-kernel\nheadless sim — no DOM, no thread\nWorker + Node',
          },
          width: 252,
          height: 112,
        },
      ],
      [],
    );
    const label = out.layers.find((layer) => layer.id === 'node-label-kernel');
    expect(label?.type).toBe('text');
    if (label?.type !== 'text') return;

    expect(label.content.style.fontSize).toBeLessThan(38);
    expect(label.content.style.lineHeight).toBe(1.25);
    expect(label.position.width).toBe(228);
    expect(label.position.y).toBeLessThan(200 + 112 / 2);
  });

  it('maps directed:false to endMarker none, leaves default edges alone', () => {
    const out = buildDiagramScene(
      [
        { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } },
        { id: 'b', position: { x: 300, y: 0 }, data: { label: 'B' } },
      ],
      [
        { id: 'a->b', source: 'a', target: 'b', directed: false },
        { id: 'b->a', source: 'b', target: 'a' },
      ],
    );
    expect(out.edges[0]).toEqual({ id: 'a->b', source: 'a', target: 'b', endMarker: 'none' });
    expect(out.edges[1]).toEqual({ id: 'b->a', source: 'b', target: 'a' });
  });

  it('preserves authored anchors and routing for ASCII-derived edges', () => {
    const out = buildDiagramScene(
      [
        { id: 'source', position: { x: 0, y: 0 }, data: { label: 'Source' } },
        { id: 'target', position: { x: 0, y: 200 }, data: { label: 'Target' } },
      ],
      [
        {
          id: 'source->target',
          source: 'source',
          target: 'target',
          sourceAnchor: { side: 'bottom', offset: 0.25 },
          targetAnchor: { side: 'top', offset: 0.5 },
          routing: 'orthogonal',
        },
      ],
    );

    expect(out.edges[0]).toMatchObject({
      sourceAnchor: { side: 'bottom', offset: 0.25 },
      targetAnchor: { side: 'top', offset: 0.5 },
      routing: 'orthogonal',
    });
  });
});

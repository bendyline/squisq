/**
 * useMemoryLayerAdapter — in-memory variant of LayoutAdapter for the
 * template designer. We test the pure reducer (`applyCommand`)
 * directly so dispatch semantics are pinned down independent of
 * React's rendering.
 */

import { describe, it, expect } from 'vitest';
import { applyCommand } from '../useMemoryLayerAdapter';
import type { Layer, ShapeLayer, TextLayer } from '@bendyline/squisq/schemas';

function rect(id: string, x: number, y: number, w = 100, h = 100): ShapeLayer {
  return {
    id,
    type: 'shape',
    position: { x, y, width: w, height: h },
    content: { shape: 'rect' },
  };
}

describe('applyCommand', () => {
  it('moveLayer updates x/y on the matching layer only', () => {
    const before: Layer[] = [rect('a', 10, 20), rect('b', 30, 40)];
    const after = applyCommand(before, { kind: 'moveLayer', id: 'a', x: 100, y: 200 });
    expect(after[0].position.x).toBe(100);
    expect(after[0].position.y).toBe(200);
    expect(after[1].position.x).toBe(30);
  });

  it('resizeLayer updates width/height on the matching layer only', () => {
    const before: Layer[] = [rect('a', 0, 0, 100, 50)];
    const after = applyCommand(before, { kind: 'resizeLayer', id: 'a', width: 200, height: 80 });
    expect(after[0].position.width).toBe(200);
    expect(after[0].position.height).toBe(80);
  });

  it('addLayer appends', () => {
    const before: Layer[] = [rect('a', 0, 0)];
    const newLayer = rect('b', 100, 100);
    const after = applyCommand(before, { kind: 'addLayer', layer: newLayer });
    expect(after.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('removeLayer filters by id', () => {
    const before: Layer[] = [rect('a', 0, 0), rect('b', 10, 10), rect('c', 20, 20)];
    const after = applyCommand(before, { kind: 'removeLayer', id: 'b' });
    expect(after.map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('renameLayer rewrites TextLayer.content.text', () => {
    const layer: TextLayer = {
      id: 't',
      type: 'text',
      position: { x: 0, y: 0, width: 100 },
      content: { text: 'old', style: { fontSize: 24, color: '#000' } },
    };
    const after = applyCommand([layer], { kind: 'renameLayer', id: 't', label: 'new' });
    expect((after[0] as TextLayer).content.text).toBe('new');
  });

  it('renameLayer is a no-op for non-text layers', () => {
    const before: Layer[] = [rect('a', 0, 0)];
    const after = applyCommand(before, { kind: 'renameLayer', id: 'a', label: 'hi' });
    expect(after[0]).toEqual(before[0]);
  });

  it('setLayerAttr writes a deep field', () => {
    const layer: TextLayer = {
      id: 't',
      type: 'text',
      position: { x: 0, y: 0, width: 100 },
      content: { text: 'hi', style: { fontSize: 24, color: '#000' } },
    };
    const after = applyCommand([layer], {
      kind: 'setLayerAttr',
      id: 't',
      path: 'content.style.fontSize',
      value: 48,
    });
    expect((after[0] as TextLayer).content.style.fontSize).toBe(48);
  });

  it('ignores edge commands (no edge model)', () => {
    const before: Layer[] = [rect('a', 0, 0)];
    const after = applyCommand(before, { kind: 'addEdge', source: 'a', target: 'b' });
    expect(after).toEqual(before);
  });

  it('does not mutate the input array', () => {
    const before: Layer[] = [rect('a', 10, 20)];
    const snapshot = JSON.stringify(before);
    applyCommand(before, { kind: 'moveLayer', id: 'a', x: 99, y: 99 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

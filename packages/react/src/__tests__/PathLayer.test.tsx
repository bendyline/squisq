import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PathLayer } from '../layers/PathLayer';
import type { PathLayer as PathLayerType } from '@bendyline/squisq/schemas';

const viewport = { width: 1000, height: 1000 };

function renderPath(layer: PathLayerType) {
  const { container } = render(
    <svg>
      <PathLayer layer={layer} viewport={viewport} blockTime={0} />
    </svg>,
  );
  return container.querySelector('path')!;
}

describe('PathLayer', () => {
  it('uses the stored absolute `d` for plain paths (no shapeKind)', () => {
    const path = renderPath({
      id: 'p1',
      type: 'path',
      position: { x: 0, y: 0, width: 100, height: 100 },
      content: { d: 'M 10 10 L 90 90' },
    });
    expect(path.getAttribute('d')).toBe('M 10 10 L 90 90');
  });

  it('derives `d` from the position box for a named shape', () => {
    // A diamond's first vertex is the top-center of its box.
    const path = renderPath({
      id: 'p2',
      type: 'path',
      position: { x: 100, y: 200, width: 400, height: 200 },
      content: { d: 'STALE', shapeKind: 'diamond' },
    });
    const d = path.getAttribute('d')!;
    expect(d).not.toBe('STALE');
    // Top vertex at (x + w/2, y) = (300, 200).
    expect(d.startsWith('M 300 200')).toBe(true);
  });

  it('moving the position moves a named shape (regenerates `d`)', () => {
    const at = (x: number) =>
      renderPath({
        id: 'p3',
        type: 'path',
        position: { x, y: 0, width: 200, height: 200 },
        content: { d: 'M 0 0', shapeKind: 'diamond' },
      }).getAttribute('d')!;
    expect(at(0)).not.toBe(at(300));
  });

  it('resolves `%` positions against the viewport', () => {
    const path = renderPath({
      id: 'p4',
      type: 'path',
      position: { x: '0%', y: '0%', width: '50%', height: '50%' },
      content: { d: '', shapeKind: 'diamond' },
    });
    // 50% of a 1000px viewport → 500px box; diamond top vertex at (250, 0).
    expect(path.getAttribute('d')!.startsWith('M 250 0')).toBe(true);
  });

  it('falls back to the stored `d` when shapeKind is unknown', () => {
    const path = renderPath({
      id: 'p5',
      type: 'path',
      position: { x: 0, y: 0, width: 100, height: 100 },
      content: { d: 'M 1 2 L 3 4', shapeKind: 'not-a-real-shape' },
    });
    expect(path.getAttribute('d')).toBe('M 1 2 L 3 4');
  });
});

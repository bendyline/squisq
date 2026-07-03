import { describe, it, expect } from 'vitest';
import { SHAPE_DEFS, buildShapeLayer } from '../shapeDefs';

describe('buildShapeLayer', () => {
  const point = { x: 100, y: 200 };

  it('builds a native ShapeLayer for rect / circle / line', () => {
    for (const kind of ['rect', 'circle', 'line'] as const) {
      const def = SHAPE_DEFS.find((s) => s.kind === kind && !s.rounded)!;
      const layer = buildShapeLayer(def, point);
      expect(layer.type).toBe('shape');
      if (layer.type === 'shape') {
        expect(layer.content.shape).toBe(kind);
      }
      expect(layer.position.x).toBe(100);
      expect(layer.position.y).toBe(200);
    }
  });

  it('rounds the rounded-rectangle variant', () => {
    const def = SHAPE_DEFS.find((s) => s.id === 'shape-rect-rounded')!;
    const layer = buildShapeLayer(def, point);
    expect(layer.type).toBe('shape');
    if (layer.type === 'shape') {
      expect(layer.content.borderRadius).toBeGreaterThan(0);
    }
  });

  it('builds a computed PathLayer with non-empty geometry for non-native shapes', () => {
    const def = SHAPE_DEFS.find((s) => s.kind === 'diamond')!;
    const layer = buildShapeLayer(def, point);
    expect(layer.type).toBe('path');
    if (layer.type === 'path') {
      expect(layer.content.d.length).toBeGreaterThan(0);
      // Diamond path should reference the drop origin region.
      expect(layer.content.d).toMatch(/^M /);
      // The kind is recorded so the renderer can re-derive geometry on
      // move/resize and adapt to the viewport.
      expect(layer.content.shapeKind).toBe('diamond');
    }
  });

  it('assigns unique ids across calls', () => {
    const def = SHAPE_DEFS[0];
    const a = buildShapeLayer(def, point);
    const b = buildShapeLayer(def, point);
    expect(a.id).not.toBe(b.id);
  });
});

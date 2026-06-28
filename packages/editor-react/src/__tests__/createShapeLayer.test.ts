import { describe, it, expect } from 'vitest';
import { createShapeLayer } from '../imageEditor/createShapeLayer';

describe('createShapeLayer', () => {
  it('maps native primitives to ShapeLayer, centered on the drop point', () => {
    const rect = createShapeLayer('rectangle', 100, 100);
    expect(rect.type).toBe('shape');
    if (rect.type === 'shape') expect(rect.content.shape).toBe('rect');
    // 120×80 box centered at (100,100) → top-left (40, 60).
    expect(rect.position).toMatchObject({ x: 40, y: 60, width: 120, height: 80 });

    expect(createShapeLayer('circle', 0, 0).type).toBe('shape');
    const line = createShapeLayer('line', 0, 0);
    if (line.type === 'shape') expect(line.content.shape).toBe('line');
  });

  it('maps named shapes to a PathLayer carrying shapeKind + derived d', () => {
    const diamond = createShapeLayer('diamond', 100, 100);
    expect(diamond.type).toBe('path');
    if (diamond.type === 'path') {
      expect(diamond.content.shapeKind).toBe('diamond');
      expect(diamond.content.d.length).toBeGreaterThan(0);
      expect(diamond.content.fill).toBeTruthy();
    }
  });

  it('maps the line arrow to a PathLayer with an end marker (no shapeKind)', () => {
    const arrow = createShapeLayer('arrow', 50, 50);
    expect(arrow.type).toBe('path');
    if (arrow.type === 'path') {
      expect(arrow.content.endMarker).toBe('arrow');
      expect(arrow.content.shapeKind).toBeUndefined();
      expect(arrow.content.fill).toBe('none');
    }
  });

  it('maps the text shape to a TextLayer', () => {
    const text = createShapeLayer('text', 10, 10);
    expect(text.type).toBe('text');
  });

  it('prettifies multi-word kinds for the layer name', () => {
    expect(createShapeLayer('arrow-right', 0, 0).name).toBe('Arrow Right');
    expect(createShapeLayer('right-triangle', 0, 0).name).toBe('Right Triangle');
  });
});

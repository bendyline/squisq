/**
 * shapeLayers — pure read transform. Given the shapes `computeDrawingLayout`
 * derives from a drawing's children, verifies the Scene Layer(s), boxes, and
 * id helpers the DrawingAdapter relies on.
 */

import { describe, it, expect } from 'vitest';
import { computeDrawingLayout } from '@bendyline/squisq/doc';
import type { Block } from '@bendyline/squisq/schemas';
import {
  shapesToSceneLayers,
  shapeBoxes,
  drawingLayerFollows,
  shapeIdFromLayerId,
  isPrimaryShapeLayer,
  primaryLayerId,
} from '../layers/shapeLayers';

function shapeBlock(
  id: string,
  template: string,
  overrides: Record<string, string>,
  title?: string,
): Block {
  return {
    id,
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    template,
    templateOverrides: overrides,
    ...(title ? { title } : {}),
  } as Block;
}

describe('shapeLayers read transform', () => {
  it('emits a shape + follower label per rect, with dshape-/dlabel- ids', () => {
    const layout = computeDrawingLayout([
      shapeBlock('ceo', 'rectangle', { x: '20', y: '20', width: '120', height: '80' }, 'CEO'),
    ]);
    const layers = shapesToSceneLayers(layout.shapes);
    expect(layers.map((l) => l.id)).toEqual(['dshape-ceo', 'dlabel-ceo']);
    const [shape, label] = layers;
    expect(shape.type).toBe('shape');
    expect(shape.position).toMatchObject({ x: 20, y: 20, width: 120, height: 80 });
    expect(label.type).toBe('text');
    if (label.type === 'text') expect(label.content.text).toBe('CEO');
  });

  it('maps each shape kind to the right Layer type', () => {
    const layout = computeDrawingLayout([
      shapeBlock('r', 'rectangle', { x: '0', y: '0', width: '10', height: '10' }),
      shapeBlock('c', 'circle', { x: '0', y: '0', width: '10', height: '10' }),
      shapeBlock('l', 'line', { x: '0', y: '0', width: '10', height: '10' }),
      shapeBlock('p', 'path', { x: '0', y: '0', d: 'M 0 0 L 5 5' }),
      shapeBlock('t', 'text', { x: '0', y: '0', text: 'hi' }),
    ]);
    const byId = new Map(shapesToSceneLayers(layout.shapes).map((l) => [l.id, l]));
    expect(byId.get('dshape-r')?.type).toBe('shape');
    expect(byId.get('dshape-c')?.type).toBe('shape');
    expect(byId.get('dshape-l')?.type).toBe('shape'); // plain line → bbox shape
    expect(byId.get('dshape-p')?.type).toBe('path');
    expect(byId.get('dshape-t')?.type).toBe('text');
  });

  it('does not emit a label layer for a text shape', () => {
    const layout = computeDrawingLayout([shapeBlock('t', 'text', { x: '0', y: '0', text: 'Note' })]);
    expect(shapesToSceneLayers(layout.shapes).map((l) => l.id)).toEqual(['dshape-t']);
  });

  it('exposes {id,x,y,width,height} boxes for the connector renderer', () => {
    const layout = computeDrawingLayout([
      shapeBlock('a', 'rect', { x: '5', y: '6', width: '7', height: '8' }),
    ]);
    expect(shapeBoxes(layout.shapes)).toEqual([{ id: 'a', x: 5, y: 6, width: 7, height: 8 }]);
  });

  it('links a label to its shape and recovers shape ids from layer ids', () => {
    expect(drawingLayerFollows('dlabel-ceo')).toBe('dshape-ceo');
    expect(drawingLayerFollows('dshape-ceo')).toBeNull();
    expect(shapeIdFromLayerId('dshape-ceo')).toBe('ceo');
    expect(shapeIdFromLayerId('dlabel-ceo')).toBe('ceo');
    expect(shapeIdFromLayerId('whatever')).toBeNull();
    expect(isPrimaryShapeLayer('dshape-ceo')).toBe(true);
    expect(isPrimaryShapeLayer('dlabel-ceo')).toBe(false);
    expect(primaryLayerId('ceo')).toBe('dshape-ceo');
  });

  it('connectors (line/arrow with from/to) are edges, not shapes', () => {
    const layout = computeDrawingLayout([
      shapeBlock('a', 'rect', { x: '0', y: '0', width: '50', height: '50' }),
      shapeBlock('b', 'rect', { x: '0', y: '200', width: '50', height: '50' }),
      shapeBlock('e', 'arrow', { from: 'a', to: 'b' }, 'reports to'),
    ]);
    expect(shapesToSceneLayers(layout.shapes).map((l) => l.id)).toEqual(['dshape-a', 'dshape-b']);
    expect(layout.connectors).toHaveLength(1);
    expect(layout.connectors[0]).toMatchObject({ id: 'e', from: 'a', to: 'b', label: 'reports to' });
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeDrawingLayout,
  normalizeShapeKind,
  isShapeName,
} from '../doc/templates/drawingLayout.js';
import type { Block } from '../schemas/Doc.js';

/** Build a drawing child: `template` is the shape, geometry rides in overrides. */
function shape(
  id: string,
  template: string,
  overrides: Record<string, string> = {},
  extra: Partial<Block> = {},
): Block {
  return {
    id,
    startTime: 0,
    duration: 0,
    audioSegment: 0,
    template,
    templateOverrides: overrides,
    ...extra,
  } as Block;
}

describe('normalizeShapeKind', () => {
  it('maps aliases to canonical kinds', () => {
    expect(normalizeShapeKind('rectangle')).toBe('rect');
    expect(normalizeShapeKind('rect')).toBe('rect');
    expect(normalizeShapeKind('ellipse')).toBe('circle');
    expect(normalizeShapeKind('CIRCLE')).toBe('circle');
    expect(normalizeShapeKind('line')).toBe('line');
    expect(normalizeShapeKind('arrow')).toBe('arrow');
    expect(normalizeShapeKind('path')).toBe('path');
    expect(normalizeShapeKind('text')).toBe('text');
  });

  it('returns null for non-shapes', () => {
    expect(normalizeShapeKind('sectionHeader')).toBeNull();
    expect(normalizeShapeKind(undefined)).toBeNull();
    expect(isShapeName('rectangle')).toBe(true);
    expect(isShapeName('banana')).toBe(false);
  });
});

describe('computeDrawingLayout', () => {
  it('positions a rectangle from its geometry params', () => {
    const layout = computeDrawingLayout([
      shape('ceo', 'rectangle', { x: '21', y: '25', width: '100', height: '80' }, { title: 'CEO' }),
    ]);
    expect(layout.shapes).toHaveLength(1);
    expect(layout.shapes[0]).toMatchObject({
      id: 'ceo',
      kind: 'rect',
      x: 21,
      y: 25,
      width: 100,
      height: 80,
      pinned: true,
      label: 'CEO',
    });
  });

  it('tolerates trailing commas in geometry (matches the sketch syntax)', () => {
    const layout = computeDrawingLayout([
      shape('a', 'rect', { x: '21,', y: '25,', width: '100,', height: '80' }),
    ]);
    expect(layout.shapes[0]).toMatchObject({ x: 21, y: 25, width: 100, height: 80 });
  });

  it('applies default size when width/height are omitted', () => {
    const layout = computeDrawingLayout([shape('a', 'circle', { x: '0', y: '0' })]);
    expect(layout.shapes[0].kind).toBe('circle');
    expect(layout.shapes[0].width).toBeGreaterThan(0);
    expect(layout.shapes[0].height).toBeGreaterThan(0);
  });

  it('auto-positions shapes missing a coordinate below pinned ones', () => {
    const layout = computeDrawingLayout([
      shape('pinned', 'rect', { x: '200', y: '100', width: '100', height: '60' }),
      shape('floating', 'rect'),
    ]);
    const pinned = layout.shapes.find((s) => s.id === 'pinned')!;
    const floating = layout.shapes.find((s) => s.id === 'floating')!;
    expect(pinned.pinned).toBe(true);
    expect(floating.pinned).toBe(false);
    expect(floating.y).toBeGreaterThan(pinned.y);
  });

  it('turns a line with from/to into a resolved connector', () => {
    const layout = computeDrawingLayout([
      shape('ceo', 'rectangle', { x: '0', y: '0', width: '100', height: '60' }),
      shape('dev', 'rectangle', { x: '0', y: '200', width: '100', height: '60' }),
      shape('l1', 'line', { from: 'ceo', to: 'dev' }, { title: 'reports to' }),
    ]);
    expect(layout.shapes).toHaveLength(2); // line is a connector, not a shape
    expect(layout.connectors).toHaveLength(1);
    expect(layout.connectors[0]).toMatchObject({
      id: 'l1',
      kind: 'line',
      from: 'ceo',
      to: 'dev',
      label: 'reports to',
    });
  });

  it('emits an arrow connector with an arrowhead for arrow shapes', () => {
    const layout = computeDrawingLayout([
      shape('a', 'rect', { x: '0', y: '0', width: '50', height: '50' }),
      shape('b', 'rect', { x: '200', y: '0', width: '50', height: '50' }),
      shape('arr', 'arrow', { from: 'a', to: 'b' }),
    ]);
    expect(layout.connectors[0].kind).toBe('arrow');
  });

  it('drops a connector whose endpoint matches no shape, with a warning', () => {
    const layout = computeDrawingLayout([
      shape('a', 'rect', { x: '0', y: '0', width: '50', height: '50' }),
      shape('l', 'line', { from: 'a', to: 'ghost' }),
    ]);
    expect(layout.connectors).toHaveLength(0);
    expect(layout.warnings.some((w) => w.includes('ghost'))).toBe(true);
  });

  it('also derives arrow connectors from a shape connectsTo', () => {
    const layout = computeDrawingLayout([
      shape(
        'a',
        'rect',
        { x: '0', y: '0', width: '50', height: '50' },
        {
          connectsTo: [{ target: 'b' }],
        },
      ),
      shape('b', 'rect', { x: '200', y: '0', width: '50', height: '50' }),
    ]);
    expect(layout.connectors).toHaveLength(1);
    expect(layout.connectors[0]).toMatchObject({ from: 'a', to: 'b', kind: 'arrow' });
  });

  it('skips non-shape children and warns', () => {
    const layout = computeDrawingLayout([
      shape('a', 'rect', { x: '0', y: '0', width: '50', height: '50' }),
      shape('note', 'sectionHeader'),
    ]);
    expect(layout.shapes).toHaveLength(1);
    expect(layout.warnings.some((w) => w.includes('note'))).toBe(true);
  });

  it('reads text content for text shapes (text= param, else title)', () => {
    const fromParam = computeDrawingLayout([shape('t', 'text', { x: '0', y: '0', text: 'Hello' })]);
    expect(fromParam.shapes[0].text).toBe('Hello');
    const fromTitle = computeDrawingLayout([
      shape('t', 'text', { x: '0', y: '0' }, { title: 'Heading text' }),
    ]);
    expect(fromTitle.shapes[0].text).toBe('Heading text');
  });

  it('carries the raw d for path shapes', () => {
    const layout = computeDrawingLayout([
      shape('p', 'path', { x: '0', y: '0', d: 'M 0 0 L 10 10' }),
    ]);
    expect(layout.shapes[0].d).toBe('M 0 0 L 10 10');
  });

  it('returns an empty layout for no children', () => {
    const layout = computeDrawingLayout([]);
    expect(layout).toEqual({ shapes: [], connectors: [], warnings: [] });
  });
});

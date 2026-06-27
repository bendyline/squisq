import { describe, it, expect } from 'vitest';
import { computeLayoutLayers } from '../doc/templates/layoutLayout.js';
import { parseMarkdown } from '../markdown/parse.js';
import type { ShapeLayer, TextLayer, ImageLayer, PathLayer } from '../schemas/Doc.js';

const VP = { width: 1920, height: 1080 };

function child(id: string, template: string, params: Record<string, string> = {}, bodyMd = '') {
  return {
    id,
    template,
    templateOverrides: params,
    ...(bodyMd ? { contents: parseMarkdown(bodyMd).children } : {}),
  };
}

describe('computeLayoutLayers', () => {
  it('maps a text child to an absolutely-positioned TextLayer (body text + style)', () => {
    const { layers } = computeLayoutLayers(
      [
        child(
          'text-1',
          'text',
          {
            x: '100',
            y: '200',
            width: '600',
            height: '120',
            fontSize: '48',
            align: 'center',
            valign: 'middle',
            color: '#1e293b',
          },
          'Hello **world**',
        ),
      ],
      VP,
    );
    expect(layers).toHaveLength(1);
    const t = layers[0] as TextLayer;
    expect(t.type).toBe('text');
    expect(t.id).toBe('text-1');
    expect(t.position).toMatchObject({ x: 100, y: 200, width: 600, height: 120 });
    expect(t.content.text).toBe('Hello world'); // plain projection of the body
    expect(t.content.style.fontSize).toBe(48);
    expect(t.content.style.textAlign).toBe('center');
    expect(t.content.style.verticalAlign).toBe('middle');
    expect(t.content.style.color).toBe('#1e293b');
  });

  it('maps rectangle/circle children to ShapeLayers', () => {
    const { layers } = computeLayoutLayers(
      [
        child('box-1', 'rectangle', {
          x: '10',
          y: '10',
          width: '200',
          height: '100',
          fill: '#e0e7ff',
          stroke: '#6366f1',
          strokeWidth: '2',
          borderRadius: '8',
        }),
        child('c-1', 'circle', { x: '300', y: '10', width: '120', height: '120' }),
      ],
      VP,
    );
    const shapes = layers.filter((l): l is ShapeLayer => l.type === 'shape');
    expect(shapes.map((s) => s.content.shape)).toEqual(['rect', 'circle']);
    expect(shapes[0].content.fill).toBe('#e0e7ff');
    expect(shapes[0].content.borderRadius).toBe(8);
    expect(shapes[0].position).toMatchObject({ x: 10, y: 10, width: 200, height: 100 });
  });

  it('maps an image child to an ImageLayer and skips one missing src', () => {
    const { layers, warnings } = computeLayoutLayers(
      [
        child('img-1', 'image', {
          x: '0',
          y: '0',
          width: '320',
          height: '240',
          src: 'pic.png',
          alt: 'A pic',
          fit: 'cover',
        }),
        child('img-2', 'image', { x: '0', y: '0' }),
      ],
      VP,
    );
    const imgs = layers.filter((l): l is ImageLayer => l.type === 'image');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].content.src).toBe('pic.png');
    expect(imgs[0].content.alt).toBe('A pic');
    expect(imgs[0].content.fit).toBe('cover');
    expect(warnings.some((w) => w.includes('img-2'))).toBe(true);
  });

  it('maps a named polygon to a PathLayer via shapePath', () => {
    const { layers } = computeLayoutLayers(
      [child('star-1', 'star', { x: '0', y: '0', width: '100', height: '100' })],
      VP,
    );
    const p = layers[0] as PathLayer;
    expect(p.type).toBe('path');
    expect(p.content.d.startsWith('M')).toBe(true);
  });

  it('uses absolute positions (no fit-scaling) regardless of viewport', () => {
    const children = [
      child('text-1', 'text', { x: '100', y: '100', width: '200', height: '50' }, 'x'),
    ];
    const small = computeLayoutLayers(children, { width: 200, height: 200 }).layers[0];
    const large = computeLayoutLayers(children, { width: 4000, height: 4000 }).layers[0];
    expect(small.position.x).toBe(100);
    expect(large.position.x).toBe(100);
  });

  it('preserves child document order as z-order', () => {
    const { layers } = computeLayoutLayers(
      [child('a', 'rectangle', { x: '0', y: '0' }), child('b', 'text', {}, 'top')],
      VP,
    );
    expect(layers.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('warns and skips a child whose annotation is not a layer kind', () => {
    const { layers, warnings } = computeLayoutLayers(
      [child('weird', 'banana', { x: '0', y: '0' })],
      VP,
    );
    expect(layers).toHaveLength(0);
    expect(warnings.some((w) => w.includes('weird'))).toBe(true);
  });
});

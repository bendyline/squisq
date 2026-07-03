/**
 * normalizePositions — pixel → %-string conversion against the
 * designer canvas.
 */

import { describe, it, expect } from 'vitest';
import { normalizePositions } from '../normalizePositions';
import type { Layer, ShapeLayer, TextLayer } from '@bendyline/squisq/schemas';

const CANVAS = { width: 1920, height: 1080 };

function shape(id: string, x: number, y: number, w: number, h: number): ShapeLayer {
  return {
    id,
    type: 'shape',
    position: { x, y, width: w, height: h },
    content: { shape: 'rect' },
  };
}

describe('normalizePositions', () => {
  it('converts pixel positions to %-strings against the canvas', () => {
    const layers: Layer[] = [shape('a', 192, 108, 960, 540)];
    const out = normalizePositions(layers, CANVAS);
    expect(out[0].position.x).toBe('10%');
    expect(out[0].position.y).toBe('10%');
    expect(out[0].position.width).toBe('50%');
    expect(out[0].position.height).toBe('50%');
  });

  it('width converts against width, height against height (not both against width)', () => {
    // 1080 height; a 1080px tall layer should be 100% of height, not 56.25%.
    const layers: Layer[] = [shape('a', 0, 0, 1920, 1080)];
    const out = normalizePositions(layers, CANVAS);
    expect(out[0].position.width).toBe('100%');
    expect(out[0].position.height).toBe('100%');
  });

  it('passes %-string values through unchanged', () => {
    const layers: Layer[] = [
      {
        id: 'a',
        type: 'shape',
        position: { x: '10%', y: '20%', width: '30%', height: '40%' },
        content: { shape: 'rect' },
      },
    ];
    const out = normalizePositions(layers, CANVAS);
    expect(out[0].position).toEqual({ x: '10%', y: '20%', width: '30%', height: '40%' });
  });

  it('preserves anchor field', () => {
    const layers: Layer[] = [
      {
        id: 'a',
        type: 'shape',
        position: { x: 100, y: 100, width: 200, height: 100, anchor: 'center' },
        content: { shape: 'rect' },
      },
    ];
    const out = normalizePositions(layers, CANVAS);
    expect(out[0].position.anchor).toBe('center');
  });

  it('handles mixed pixel + percent in the same layer', () => {
    const layers: Layer[] = [
      {
        id: 'a',
        type: 'shape',
        // x pixel, y percent
        position: { x: 192, y: '20%', width: 960, height: 540 },
        content: { shape: 'rect' },
      },
    ];
    const out = normalizePositions(layers, CANVAS);
    expect(out[0].position.x).toBe('10%');
    expect(out[0].position.y).toBe('20%');
    expect(out[0].position.width).toBe('50%');
    expect(out[0].position.height).toBe('50%');
  });

  it('formats fractional percentages with up to 2 decimal places', () => {
    // 100 / 1920 ≈ 5.208333…% → rounded to 5.21%.
    const layers: Layer[] = [shape('a', 100, 100, 100, 100)];
    const out = normalizePositions(layers, CANVAS);
    expect(out[0].position.x).toBe('5.21%');
  });

  it('does not mutate the input layers', () => {
    const layers: Layer[] = [shape('a', 100, 200, 300, 400)];
    const before = JSON.stringify(layers);
    normalizePositions(layers, CANVAS);
    expect(JSON.stringify(layers)).toBe(before);
  });

  it('preserves non-position layer content (TextLayer)', () => {
    const layers: Layer[] = [
      {
        id: 't',
        type: 'text',
        position: { x: 192, y: 108, width: 480 },
        content: { text: '{title}', style: { fontSize: 36, color: '#000' } },
      } as TextLayer,
    ];
    const out = normalizePositions(layers, CANVAS);
    expect((out[0] as TextLayer).content.text).toBe('{title}');
    expect((out[0] as TextLayer).content.style.fontSize).toBe(36);
  });
});

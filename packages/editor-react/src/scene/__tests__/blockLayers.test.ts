/**
 * blockLayers — base64-JSON encode/decode round-trip for Layer arrays.
 */

import { describe, it, expect } from 'vitest';
import { encodeLayers, decodeLayers } from '../adapters/blockLayers';
import type { Layer, ShapeLayer, TextLayer } from '@bendyline/squisq/schemas';

describe('encodeLayers / decodeLayers', () => {
  it('round-trips a single ShapeLayer', () => {
    const layer: ShapeLayer = {
      id: 'rect-1',
      type: 'shape',
      position: { x: 100, y: 200, width: 50, height: 30 },
      content: { shape: 'rect', fill: '#abc', stroke: '#000', strokeWidth: 2 },
    };
    expect(decodeLayers(encodeLayers([layer]))).toEqual([layer]);
  });

  it('round-trips a mixed-type array preserving order', () => {
    const layers: Layer[] = [
      {
        id: 'a',
        type: 'shape',
        position: { x: 0, y: 0, width: 10, height: 10 },
        content: { shape: 'circle', fill: 'red' },
      },
      {
        id: 'b',
        type: 'text',
        position: { x: 20, y: 20, width: 80, height: 24 },
        content: { text: 'Hi there', style: { fontSize: 18, color: '#111' } },
      } as TextLayer,
    ];
    expect(decodeLayers(encodeLayers(layers))).toEqual(layers);
  });

  it('returns [] for invalid base64 / JSON', () => {
    expect(decodeLayers('not-valid-base64!!')).toEqual([]);
    expect(decodeLayers(Buffer.from('not json', 'utf-8').toString('base64'))).toEqual([]);
  });

  it('returns [] when the decoded value is not an array', () => {
    const encoded = Buffer.from(JSON.stringify({ not: 'an array' }), 'utf-8').toString('base64');
    expect(decodeLayers(encoded)).toEqual([]);
  });

  it('encodes deterministically (same input → same output)', () => {
    const layer: ShapeLayer = {
      id: 'x',
      type: 'shape',
      position: { x: 0, y: 0, width: 5, height: 5 },
      content: { shape: 'rect' },
    };
    expect(encodeLayers([layer])).toBe(encodeLayers([layer]));
  });
});

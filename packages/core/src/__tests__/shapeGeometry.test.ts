import { describe, it, expect } from 'vitest';
import {
  shapePath,
  markerPath,
  connectorPath,
  clipEndpoints,
  lineStyleDasharray,
  PATH_SHAPE_KINDS,
} from '../doc/utils/shapeGeometry.js';

describe('shapePath', () => {
  it('returns a non-empty path beginning with M for every path-shape kind', () => {
    for (const kind of PATH_SHAPE_KINDS) {
      const d = shapePath(kind, 0, 0, 100, 80);
      expect(d, kind).toBeTruthy();
      expect(d?.startsWith('M'), kind).toBe(true);
    }
  });

  it('returns null for natively-rendered primitives', () => {
    for (const kind of ['rect', 'circle', 'line', 'text', 'path', 'arrow']) {
      expect(shapePath(kind, 0, 0, 10, 10), kind).toBeNull();
    }
  });

  it('triangle is a closed 3-point polygon inscribed in the box', () => {
    expect(shapePath('triangle', 0, 0, 100, 100)).toBe('M 50 0 L 100 100 L 0 100 Z');
  });

  it('diamond hits the four edge midpoints', () => {
    expect(shapePath('diamond', 0, 0, 100, 100)).toBe('M 50 0 L 100 50 L 50 100 L 0 50 Z');
  });

  it('honors the bounding-box offset', () => {
    expect(shapePath('triangle', 10, 20, 100, 100)).toBe('M 60 20 L 110 120 L 10 120 Z');
  });
});

describe('markerPath', () => {
  it('arrow end is a filled triangle; none is null', () => {
    expect(markerPath('arrow', 'end')).toEqual({ d: 'M 0 0 L 10 5 L 0 10 z', filled: true });
    expect(markerPath('none', 'end')).toBeNull();
  });

  it('open is unfilled; diamond/circle/square are filled', () => {
    expect(markerPath('open', 'end')?.filled).toBe(false);
    expect(markerPath('diamond', 'end')?.filled).toBe(true);
    expect(markerPath('circle', 'end')?.filled).toBe(true);
    expect(markerPath('square', 'end')?.filled).toBe(true);
  });

  it('start mirrors the arrow horizontally', () => {
    expect(markerPath('arrow', 'start')).toEqual({ d: 'M 10 0 L 0 5 L 10 10 z', filled: true });
  });
});

describe('connectorPath', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 50 };

  it('straight is a single line segment', () => {
    expect(connectorPath('straight', a, b)).toBe('M 0 0 L 100 50');
  });

  it('orthogonal has a mid elbow', () => {
    expect(connectorPath('orthogonal', a, b)).toBe('M 0 0 L 50 0 L 50 50 L 100 50');
  });

  it('curved is a cubic bezier', () => {
    expect(connectorPath('curved', a, b).startsWith('M 0 0 C')).toBe(true);
  });
});

describe('clipEndpoints', () => {
  it('clips both endpoints to the box edges', () => {
    const r = clipEndpoints({ cx: 0, cy: 0, rx: 10, ry: 10 }, { cx: 100, cy: 0, rx: 10, ry: 10 });
    expect(r.start).toEqual({ x: 10, y: 0 });
    expect(r.end).toEqual({ x: 90, y: 0 });
  });
});

describe('lineStyleDasharray', () => {
  it('maps line styles to dash patterns', () => {
    expect(lineStyleDasharray('dashed')).toBe('8 6');
    expect(lineStyleDasharray('dotted')).toBe('2 6');
    expect(lineStyleDasharray('solid')).toBeUndefined();
    expect(lineStyleDasharray(undefined)).toBeUndefined();
  });
});

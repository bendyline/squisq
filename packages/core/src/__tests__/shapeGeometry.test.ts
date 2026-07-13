import { describe, it, expect } from 'vitest';
import {
  shapePath,
  markerPath,
  connectorPath,
  clipEndpoints,
  nearestSnapPoint,
  lineStyleDasharray,
  PATH_SHAPE_KINDS,
  snapEndpoints,
  snapPoints,
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

  it('orthogonal routing approaches top/bottom ports vertically', () => {
    expect(
      connectorPath('orthogonal', { port: 'bottom', x: 80, y: 60 }, { port: 'top', x: 20, y: 140 }),
    ).toBe('M 80 60 L 80 100 L 20 100 L 20 140');
  });

  it('curved is a cubic bezier', () => {
    expect(connectorPath('curved', a, b).startsWith('M 0 0 C')).toBe(true);
  });

  it('curved routing follows the endpoint port directions', () => {
    expect(
      connectorPath('curved', { port: 'bottom', x: 80, y: 60 }, { port: 'top', x: 20, y: 140 }),
    ).toBe('M 80 60 C 80 110, 20 90, 20 140');
  });
});

describe('clipEndpoints', () => {
  it('clips both endpoints to the box edges', () => {
    const r = clipEndpoints({ cx: 0, cy: 0, rx: 10, ry: 10 }, { cx: 100, cy: 0, rx: 10, ry: 10 });
    expect(r.start).toEqual({ x: 10, y: 0 });
    expect(r.end).toEqual({ x: 90, y: 0 });
  });
});

describe('snapEndpoints', () => {
  const a = { cx: 50, cy: 50, rx: 30, ry: 20 };
  const b = { cx: 180, cy: 50, rx: 30, ry: 20 };

  it('exposes side and corner ports around a box', () => {
    expect(snapPoints(a).map((p) => p.port)).toEqual([
      'top',
      'right',
      'bottom',
      'left',
      'top-left',
      'top-right',
      'bottom-right',
      'bottom-left',
    ]);
  });

  it('snaps horizontal connections to side ports', () => {
    const r = snapEndpoints(a, b);
    expect(r.start).toMatchObject({ port: 'right', x: 80, y: 50 });
    expect(r.end).toMatchObject({ port: 'left', x: 150, y: 50 });
  });

  it('snaps diagonal connections to nearest corner ports', () => {
    const r = snapEndpoints(a, { cx: 180, cy: 140, rx: 30, ry: 20 });
    expect(r.start).toMatchObject({ port: 'bottom-right', x: 80, y: 70 });
    expect(r.end).toMatchObject({ port: 'top-left', x: 150, y: 120 });
  });

  it('finds the nearest port toward a free pointer', () => {
    expect(nearestSnapPoint(a, { x: 100, y: 10 }).port).toBe('top-right');
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

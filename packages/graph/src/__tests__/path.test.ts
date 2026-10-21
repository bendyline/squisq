import { describe, expect, it } from 'vitest';
import { pointAlongPolyline, polylineLength, polylinePath } from '../path.js';

describe('polylinePath', () => {
  it('draws straight segments without a radius', () => {
    expect(
      polylinePath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
      ]),
    ).toBe('M0 0 L10 0 L10 20');
  });

  it('rounds corners, never by more than half a leg', () => {
    expect(
      polylinePath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 4 },
        ],
        { radius: 6 },
      ),
    ).toBe('M0 0 L8 0 Q10 0 10 2 L10 4');
  });

  it('handles empty and single-point input', () => {
    expect(polylinePath([])).toBe('');
    expect(polylinePath([{ x: 1.234, y: 5 }])).toBe('M1.23 5');
  });
});

describe('pointAlongPolyline', () => {
  const route = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('measures length', () => {
    expect(polylineLength(route)).toBe(20);
  });

  it('finds the midpoint and the direction of travel', () => {
    expect(pointAlongPolyline(route, 0.5)).toEqual({ x: 10, y: 0, angle: 0 });
    expect(pointAlongPolyline(route, 0.75)).toEqual({ x: 10, y: 5, angle: 90 });
    expect(pointAlongPolyline(route, 1)).toEqual({ x: 10, y: 10, angle: 90 });
    expect(pointAlongPolyline(route, -1)).toEqual({ x: 0, y: 0, angle: 0 });
  });
});

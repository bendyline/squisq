import { describe, it, expect } from 'vitest';
import { calculateBearing, haversineDistance } from '../spatial/Haversine';
import {
  destinationPoint,
  interpolateGreatCircle,
  sampleGreatCircle,
} from '../spatial/GreatCircle';

const SEATTLE = { lat: 47.6062, lng: -122.3321 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

/** Smallest angle between two compass bearings, degrees. */
const bearingOff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('interpolateGreatCircle', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(interpolateGreatCircle(SEATTLE, LONDON, 0).lat).toBeCloseTo(SEATTLE.lat, 9);
    expect(interpolateGreatCircle(SEATTLE, LONDON, 1).lng).toBeCloseTo(LONDON.lng, 9);
  });

  it('splits the route into equal great-circle distances', () => {
    const middle = interpolateGreatCircle(SEATTLE, LONDON, 0.5);
    expect(haversineDistance(SEATTLE, middle)).toBeCloseTo(haversineDistance(middle, LONDON), 6);
    // The shortest path bends north of both cities.
    expect(middle.lat).toBeGreaterThan(LONDON.lat);
  });

  it('handles coincident points', () => {
    expect(interpolateGreatCircle(SEATTLE, SEATTLE, 0.3)).toEqual(SEATTLE);
  });
});

describe('sampleGreatCircle', () => {
  it('includes both endpoints and clamps to two samples', () => {
    const points = sampleGreatCircle(SEATTLE, LONDON, 5);
    expect(points).toHaveLength(5);
    expect(points[4].lat).toBeCloseTo(LONDON.lat, 9);
    expect(sampleGreatCircle(SEATTLE, LONDON, 0)).toHaveLength(2);
  });
});

describe('destinationPoint', () => {
  it('lands the given distance away along the bearing', () => {
    for (const bearing of [0, 45, 90, 200, 315]) {
      const to = destinationPoint(SEATTLE, bearing, 50_000);
      expect(haversineDistance(SEATTLE, to) * 1000).toBeCloseTo(50_000, -2);
      expect(bearingOff(calculateBearing(SEATTLE, to), bearing)).toBeLessThan(0.5);
    }
  });

  it('wraps across the antimeridian', () => {
    const to = destinationPoint({ lat: 0, lng: 179.9 }, 90, 50_000);
    expect(to.lng).toBeLessThan(-179.4);
    expect(to.lng).toBeGreaterThanOrEqual(-180);
  });
});

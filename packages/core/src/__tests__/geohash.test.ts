import { describe, it, expect } from 'vitest';
import {
  encodeGeohash,
  decodeGeohash,
  getNeighbors,
  getGeohash4Neighbors,
  getGeohashPrefix,
  geohashToHierarchicalPath,
  getGeohashPath,
  geohashOverlapsBounds,
} from '../spatial/Geohash';

describe('encodeGeohash / decodeGeohash round-trip', () => {
  it('encodes and decodes Seattle', () => {
    const lat = 47.6062;
    const lng = -122.3321;
    const hash = encodeGeohash(lat, lng, 6);
    expect(hash).toHaveLength(6);

    const decoded = decodeGeohash(hash);
    expect(decoded.lat).toBeCloseTo(lat, 1);
    expect(decoded.lng).toBeCloseTo(lng, 1);
  });

  it('encodes and decodes equator/prime meridian', () => {
    const hash = encodeGeohash(0, 0, 4);
    expect(hash).toHaveLength(4);
    const decoded = decodeGeohash(hash);
    expect(decoded.lat).toBeCloseTo(0, 0);
    expect(decoded.lng).toBeCloseTo(0, 0);
  });

  it('defaults to precision 9', () => {
    const hash = encodeGeohash(47.6, -122.3);
    expect(hash).toHaveLength(9);
  });
});

describe('getNeighbors', () => {
  it('returns 8 neighbors', () => {
    const neighbors = getNeighbors('c23n');
    expect(neighbors).toHaveLength(8);
    neighbors.forEach((n) => expect(n).toHaveLength(4));
  });
});

describe('getGeohash4Neighbors', () => {
  it('returns center + 8 neighbors (9 total)', () => {
    const result = getGeohash4Neighbors('c23n');
    expect(result).toHaveLength(9);
    expect(result[0]).toBe('c23n');
  });

  it('throws for non-4-char input', () => {
    expect(() => getGeohash4Neighbors('c2')).toThrow();
    expect(() => getGeohash4Neighbors('c23nn')).toThrow();
  });
});

describe('getGeohashPrefix', () => {
  it('extracts prefix', () => {
    expect(getGeohashPrefix('c23nxy', 4)).toBe('c23n');
    expect(getGeohashPrefix('c23nxy', 2)).toBe('c2');
  });
});

describe('geohashToHierarchicalPath', () => {
  it('converts 4-char geohash to path', () => {
    expect(geohashToHierarchicalPath('c23n')).toBe('c/2/3/n');
    expect(geohashToHierarchicalPath('9q8y')).toBe('9/q/8/y');
  });

  it('throws for non-4-char input', () => {
    expect(() => geohashToHierarchicalPath('c2')).toThrow();
  });
});

describe('getGeohashPath', () => {
  it('returns empty for same cell', () => {
    expect(getGeohashPath('c23n', 'c23n')).toEqual([]);
  });

  it('returns intermediate cells between two geohashes', () => {
    const path = getGeohashPath('c23n', 'c24k');
    expect(path.length).toBeGreaterThan(0);
    path.forEach((h) => {
      expect(h).toHaveLength(4);
      expect(h).not.toBe('c23n');
      expect(h).not.toBe('c24k');
    });
  });
});

describe('geohashOverlapsBounds', () => {
  it('detects overlap', () => {
    // Seattle area: c23n
    const bounds = { north: 48, south: 47, east: -122, west: -123 };
    const hash = encodeGeohash(47.6, -122.3, 4);
    expect(geohashOverlapsBounds(hash, bounds)).toBe(true);
  });

  it('detects non-overlap', () => {
    // Tokyo area bounds
    const bounds = { north: 36, south: 35, east: 140, west: 139 };
    // Seattle geohash
    const hash = encodeGeohash(47.6, -122.3, 4);
    expect(geohashOverlapsBounds(hash, bounds)).toBe(false);
  });
});

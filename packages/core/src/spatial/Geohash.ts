/**
 * Geohash Utilities
 *
 * Provides geohash encoding/decoding and spatial utilities using the standard
 * ngeohash library for core operations, plus custom utilities for overlap checking
 * and distance calculation.
 *
 * Geohashes are a hierarchical spatial indexing system that divides the world
 * into a grid of cells. Each additional character narrows the area by ~1/32.
 *
 * Precision guide:
 * - 4 chars: ~39km x 19km (used for tile indexing)
 * - 5 chars: ~5km x 5km
 * - 6 chars: ~1.2km x 0.6km
 */

import ngeohash from 'ngeohash';

/**
 * Encode latitude/longitude to a geohash string.
 * Uses the standard ngeohash library.
 */
export function encodeGeohash(lat: number, lng: number, precision = 9): string {
  return ngeohash.encode(lat, lng, precision);
}

/**
 * Decode a geohash to latitude/longitude center with error bounds.
 * Uses the standard ngeohash library.
 */
export function decodeGeohash(hash: string): {
  lat: number;
  lng: number;
  latErr: number;
  lngErr: number;
} {
  const result = ngeohash.decode(hash);
  return {
    lat: result.latitude,
    lng: result.longitude,
    latErr: result.error.latitude,
    lngErr: result.error.longitude,
  };
}

/**
 * Get the 8 neighboring geohash cells.
 * Returns up to 8 neighbors (fewer at poles or antimeridian).
 * Uses the standard ngeohash library.
 */
export function getNeighbors(hash: string): string[] {
  return ngeohash.neighbors(hash);
}

/**
 * Get a 3x3 grid of geohash4 cells (center + 8 neighbors).
 * Used for landing bonus expansions in Fly mode.
 *
 * @param geohash4 - Center geohash4 cell
 * @returns Array of 9 geohash4 cells (center first, then neighbors)
 *
 * @example
 * getGeohash4Neighbors('c23n')
 * // => ['c23n', 'c23p', 'c23q', 'c23j', 'c23m', 'c23k', 'c23h', 'c23e', 'c23s']
 */
export function getGeohash4Neighbors(geohash4: string): string[] {
  if (geohash4.length !== 4) {
    throw new Error(`getGeohash4Neighbors requires 4-char geohash, got: ${geohash4}`);
  }
  const neighbors = getNeighbors(geohash4);
  return [geohash4, ...neighbors];
}

/**
 * Get the prefix of a geohash at a given precision.
 * Simple helper for extracting geohash prefixes for directory organization.
 */
export function getGeohashPrefix(geohash: string, precision: number): string {
  return geohash.slice(0, precision);
}

/**
 * Convert a geohash prefix to a hierarchical path.
 *
 * Examples:
 *   "9mud" -> "9/m/u/d"
 *   "9q8y" -> "9/q/8/y"
 *   "c24k" -> "c/2/4/k"
 *
 * This is used for organizing files in hierarchical directories to avoid
 * thousands of folders in a single directory, which causes filesystem
 * performance issues.
 */
export function geohashToHierarchicalPath(geohash4: string): string {
  if (geohash4.length !== 4) {
    throw new Error(`geohashToHierarchicalPath requires 4-char geohash, got: ${geohash4}`);
  }
  const [c1, c2, c3, c4] = geohash4.split('');
  return `${c1}/${c2}/${c3}/${c4}`;
}

/**
 * Compute all geohash cells along the path between two geohash cells.
 * Interpolates lat/lng points between the centers of `from` and `to`,
 * encoding each to a geohash at the given precision, and returns the
 * deduplicated list of intermediate cells (excluding `from` and `to`).
 */
export function getGeohashPath(from: string, to: string, precision = 4): string[] {
  if (from === to) return [];

  const fromCenter = decodeGeohash(from);
  const toCenter = decodeGeohash(to);

  // Compute approximate distance to determine step count
  const dLat = Math.abs(toCenter.lat - fromCenter.lat);
  const dLng = Math.abs(toCenter.lng - fromCenter.lng);
  // Rough km: 1 degree lat ≈ 111km, 1 degree lng ≈ 111km * cos(midLat)
  const midLatRad = ((fromCenter.lat + toCenter.lat) / 2) * (Math.PI / 180);
  const approxKm = Math.sqrt(
    (dLat * 111) ** 2 + (dLng * 111 * Math.cos(midLatRad)) ** 2
  );

  // Step every ~15km to avoid skipping any geohash4 cell (~39x19km)
  const steps = Math.max(2, Math.ceil(approxKm / 15));

  const seen = new Set<string>();
  seen.add(from);
  seen.add(to);

  const path: string[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const lat = fromCenter.lat + t * (toCenter.lat - fromCenter.lat);
    const lng = fromCenter.lng + t * (toCenter.lng - fromCenter.lng);
    const hash = encodeGeohash(lat, lng, precision);
    if (!seen.has(hash)) {
      seen.add(hash);
      path.push(hash);
    }
  }

  return path;
}

/**
 * Check if a geohash cell overlaps with a bounding box.
 * Custom implementation (not available in ngeohash).
 */
export function geohashOverlapsBounds(
  hash: string,
  bounds: { north: number; south: number; east: number; west: number }
): boolean {
  const { lat, lng, latErr, lngErr } = decodeGeohash(hash);

  const hashNorth = lat + latErr;
  const hashSouth = lat - latErr;
  const hashEast = lng + lngErr;
  const hashWest = lng - lngErr;

  return !(
    hashNorth < bounds.south ||
    hashSouth > bounds.north ||
    hashEast < bounds.west ||
    hashWest > bounds.east
  );
}

// haversineDistance is now in shared/spatial/Haversine.ts (canonical location).
// Re-export for backwards compatibility with existing imports.
export { haversineDistance } from './Haversine.js';
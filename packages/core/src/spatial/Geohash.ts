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
import { haversineDistance } from './Haversine.js';

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
  if (geohash4.length !== 4) return [];
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
  if (geohash4.length !== 4) return '';
  const [c1, c2, c3, c4] = geohash4.split('');
  return `${c1}/${c2}/${c3}/${c4}`;
}

/**
 * Compute all geohash cells along the great-circle path between two geohash cells.
 * Samples points along the spherical arc from `from` to `to`, encoding each to a
 * geohash at the given precision, and returns the deduplicated list of intermediate
 * cells (excluding `from` and `to`).
 *
 * Uses spherical linear interpolation (SLERP) via 3D unit vectors, which correctly
 * handles antimeridian crossings and polar paths — both of which flat lat/lng
 * interpolation gets wrong.
 */
export function getGeohashPath(from: string, to: string, precision = 4): string[] {
  if (from === to) return [];

  const fromCenter = decodeGeohash(from);
  const toCenter = decodeGeohash(to);

  // Use haversine for accurate great-circle distance (step sizing)
  const distKm = haversineDistance(
    { lat: fromCenter.lat, lng: fromCenter.lng },
    { lat: toCenter.lat, lng: toCenter.lng },
  );

  // Step every ~15km to avoid skipping any geohash4 cell (~39x19km)
  const steps = Math.max(2, Math.ceil(distKm / 15));

  // Convert endpoints to unit Cartesian vectors for SLERP
  const φ1 = (fromCenter.lat * Math.PI) / 180;
  const λ1 = (fromCenter.lng * Math.PI) / 180;
  const φ2 = (toCenter.lat * Math.PI) / 180;
  const λ2 = (toCenter.lng * Math.PI) / 180;

  const x1 = Math.cos(φ1) * Math.cos(λ1);
  const y1 = Math.cos(φ1) * Math.sin(λ1);
  const z1 = Math.sin(φ1);
  const x2 = Math.cos(φ2) * Math.cos(λ2);
  const y2 = Math.cos(φ2) * Math.sin(λ2);
  const z2 = Math.sin(φ2);

  // Central angle between the two points
  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const d = Math.acos(dot);
  // Near-antipodal fallback: sin(d)≈0 means the great circle is undefined.
  // Extremely unlikely for geohash path use; fall back to linear lat/lng.
  const useLinear = Math.abs(Math.sin(d)) < 1e-10;

  const seen = new Set<string>();
  seen.add(from);
  seen.add(to);

  const path: string[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    let lat: number;
    let lng: number;
    if (useLinear) {
      lat = fromCenter.lat + t * (toCenter.lat - fromCenter.lat);
      lng = fromCenter.lng + t * (toCenter.lng - fromCenter.lng);
    } else {
      const A = Math.sin((1 - t) * d) / Math.sin(d);
      const B = Math.sin(t * d) / Math.sin(d);
      const x = A * x1 + B * x2;
      const y = A * y1 + B * y2;
      const z = A * z1 + B * z2;
      lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
      lng = (Math.atan2(y, x) * 180) / Math.PI;
    }
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
  bounds: { north: number; south: number; east: number; west: number },
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

/**
 * Haversine Distance Calculation
 *
 * Provides accurate distance calculation between two geographic coordinates
 * using the Haversine formula, which accounts for Earth's curvature.
 */

import type { Coordinates } from '../schemas/Types.js';

/**
 * Calculate distance between two coordinates using Haversine formula.
 *
 * @param from Start coordinates
 * @param to End coordinates
 * @returns Distance in kilometers
 */
export function haversineDistance(from: Coordinates, to: Coordinates): number {
  const R = 6371; // Earth's radius in kilometers

  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate bearing from one coordinate to another.
 *
 * @param from Start coordinates
 * @param to End coordinates
 * @returns Bearing in degrees (0-360, where 0 = north, 90 = east)
 */
export function calculateBearing(from: Coordinates, to: Coordinates): number {
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const x = Math.sin(dLng) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  const bearing = Math.atan2(x, y);
  return ((bearing * 180) / Math.PI + 360) % 360;
}

/**
 * Convert degrees to radians.
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

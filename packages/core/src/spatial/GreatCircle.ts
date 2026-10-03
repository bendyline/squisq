/**
 * Great-circle paths on a spherical Earth.
 *
 * `interpolateGreatCircle` and `sampleGreatCircle` walk the shortest path between two
 * coordinates (spherical linear interpolation), which stays true over long and high-latitude
 * routes where a straight lat/lng line distorts badly: use them to sample points along a route,
 * for example to find places near it. `destinationPoint` goes the other way: from a coordinate
 * along a compass bearing for a distance, for example to project a moving position ahead of
 * itself. The sphere is the same one `haversineDistance` uses (mean radius 6,371 km), so the
 * two agree.
 */

import type { Coordinates } from '../schemas/Types.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Mean Earth radius in meters (the sphere `haversineDistance` uses). */
const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Interpolate a point a `fraction` (0..1) of the way along the great-circle path from `from`
 * to `to`. At fraction 0 returns `from`; at 1 returns `to`.
 */
export function interpolateGreatCircle(
  from: Coordinates,
  to: Coordinates,
  fraction: number,
): Coordinates {
  const lat1 = from.lat * DEG2RAD;
  const lon1 = from.lng * DEG2RAD;
  const lat2 = to.lat * DEG2RAD;
  const lon2 = to.lng * DEG2RAD;

  // Angular distance between the points.
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const delta = 2 * Math.asin(Math.min(1, Math.sqrt(a)));

  // Coincident points (or numerically tiny): nothing to interpolate.
  if (delta === 0) return { lat: from.lat, lng: from.lng };

  const A = Math.sin((1 - fraction) * delta) / Math.sin(delta);
  const B = Math.sin(fraction * delta) / Math.sin(delta);

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);

  return { lat: lat * RAD2DEG, lng: lon * RAD2DEG };
}

/**
 * Sample `samples` evenly spaced points (both endpoints included) along the great-circle path.
 * `samples` is clamped to at least 2.
 */
export function sampleGreatCircle(
  from: Coordinates,
  to: Coordinates,
  samples: number,
): Coordinates[] {
  const n = Math.max(2, Math.floor(samples));
  const points: Coordinates[] = [];
  for (let i = 0; i < n; i++) {
    points.push(interpolateGreatCircle(from, to, i / (n - 1)));
  }
  return points;
}

/**
 * The point `distanceMeters` from `from` along the great circle that starts at compass bearing
 * `bearingDeg` (0 north, 90 east). Longitude is normalized to [-180, 180).
 */
export function destinationPoint(
  from: Coordinates,
  bearingDeg: number,
  distanceMeters: number,
): Coordinates {
  const delta = distanceMeters / EARTH_RADIUS_METERS;
  const theta = bearingDeg * DEG2RAD;
  const lat1 = from.lat * DEG2RAD;
  const lon1 = from.lng * DEG2RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
    );
  const lng = ((((lon2 * RAD2DEG + 180) % 360) + 360) % 360) - 180;
  return { lat: lat2 * RAD2DEG, lng };
}

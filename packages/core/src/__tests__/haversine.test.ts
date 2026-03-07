import { describe, it, expect } from 'vitest';
import { haversineDistance, calculateBearing } from '../spatial/Haversine';

describe('haversineDistance', () => {
  it('returns 0 for same point', () => {
    const p = { lat: 47.6062, lng: -122.3321 };
    expect(haversineDistance(p, p)).toBe(0);
  });

  it('calculates Seattle to Portland (~233 km)', () => {
    const seattle = { lat: 47.6062, lng: -122.3321 };
    const portland = { lat: 45.5152, lng: -122.6784 };
    const dist = haversineDistance(seattle, portland);
    expect(dist).toBeGreaterThan(230);
    expect(dist).toBeLessThan(240);
  });

  it('calculates London to Paris (~344 km)', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const paris = { lat: 48.8566, lng: 2.3522 };
    const dist = haversineDistance(london, paris);
    expect(dist).toBeGreaterThan(340);
    expect(dist).toBeLessThan(350);
  });

  it('calculates antipodal points (~20,000 km)', () => {
    const p1 = { lat: 0, lng: 0 };
    const p2 = { lat: 0, lng: 180 };
    const dist = haversineDistance(p1, p2);
    expect(dist).toBeGreaterThan(20000);
    expect(dist).toBeLessThan(20100);
  });
});

describe('calculateBearing', () => {
  it('returns ~0 for due north', () => {
    const from = { lat: 0, lng: 0 };
    const to = { lat: 10, lng: 0 };
    const bearing = calculateBearing(from, to);
    expect(bearing).toBeCloseTo(0, 0);
  });

  it('returns ~90 for due east', () => {
    const from = { lat: 0, lng: 0 };
    const to = { lat: 0, lng: 10 };
    const bearing = calculateBearing(from, to);
    expect(bearing).toBeCloseTo(90, 0);
  });

  it('returns ~180 for due south', () => {
    const from = { lat: 10, lng: 0 };
    const to = { lat: 0, lng: 0 };
    const bearing = calculateBearing(from, to);
    expect(bearing).toBeCloseTo(180, 0);
  });

  it('returns ~270 for due west', () => {
    const from = { lat: 0, lng: 10 };
    const to = { lat: 0, lng: 0 };
    const bearing = calculateBearing(from, to);
    expect(bearing).toBeCloseTo(270, 0);
  });
});

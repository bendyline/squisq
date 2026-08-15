import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_RESOLUTIONS,
  DEFAULT_DASHBOARD_RESOLUTION,
  dashboardFamilyForDimensions,
  resolveDashboardDimensions,
  validateDashboardImageDimensions,
} from '../dashboardImage.js';

describe('DASHBOARD_RESOLUTIONS', () => {
  it('has unique ids and every preset passes the validator', () => {
    const ids = DASHBOARD_RESOLUTIONS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_DASHBOARD_RESOLUTION);
    for (const preset of DASHBOARD_RESOLUTIONS) {
      expect(validateDashboardImageDimensions(preset.width, preset.height)).toBeNull();
      expect(dashboardFamilyForDimensions(preset.width, preset.height)).toBe(preset.family);
    }
  });
});

describe('validateDashboardImageDimensions', () => {
  it('accepts sane sizes including odd dimensions', () => {
    expect(validateDashboardImageDimensions(1920, 1080)).toBeNull();
    expect(validateDashboardImageDimensions(64, 64)).toBeNull();
    expect(validateDashboardImageDimensions(7680, 4320)).toBeNull();
    // Odd dimensions are legal — the even rule is H.264-only.
    expect(validateDashboardImageDimensions(851, 479)).toBeNull();
  });

  it('rejects fractional, undersized, oversized, and over-budget sizes', () => {
    expect(validateDashboardImageDimensions(1920.5, 1080)).toContain('whole pixel');
    expect(validateDashboardImageDimensions(63, 1080)).toContain('at least 64');
    expect(validateDashboardImageDimensions(64, 63)).toContain('at least 64');
    expect(validateDashboardImageDimensions(7681, 1080)).toContain('at most 7680');
    expect(validateDashboardImageDimensions(7680, 7680)).toContain('total pixels');
  });
});

describe('resolveDashboardDimensions', () => {
  it('defaults to Full HD and resolves named presets', () => {
    expect(resolveDashboardDimensions()).toEqual({
      width: 1920,
      height: 1080,
      family: 'landscape',
    });
    expect(resolveDashboardDimensions({ resolution: 'square' })).toEqual({
      width: 1080,
      height: 1080,
      family: 'square',
    });
    expect(resolveDashboardDimensions({ resolution: 'portrait-4k' })).toEqual({
      width: 2160,
      height: 3840,
      family: 'portrait',
    });
  });

  it('accepts custom dimensions and derives the nearest family', () => {
    expect(resolveDashboardDimensions({ width: 1600, height: 900 })).toEqual({
      width: 1600,
      height: 900,
      family: 'landscape',
    });
    expect(resolveDashboardDimensions({ width: 1440, height: 1080 }).family).toBe('standard');
    expect(resolveDashboardDimensions({ width: 1000, height: 1000 }).family).toBe('square');
    expect(resolveDashboardDimensions({ width: 720, height: 1280 }).family).toBe('portrait');
  });

  it('rejects contradictory or partial input before any rendering', () => {
    expect(() =>
      resolveDashboardDimensions({ resolution: 'fhd', width: 800, height: 600 }),
    ).toThrow(/not both/);
    expect(() => resolveDashboardDimensions({ width: 800 })).toThrow(/both width and height/);
    expect(() => resolveDashboardDimensions({ height: 600 })).toThrow(/both width and height/);
    expect(() => resolveDashboardDimensions({ width: 10, height: 10 })).toThrow(/at least 64/);
    expect(() => resolveDashboardDimensions({ resolution: '8k' })).toThrow(/Unknown resolution/);
  });
});

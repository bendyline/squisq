import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_ZOOM_LEVELS,
  desiredCellZoom,
  normalizeDashboardZoom,
  resolveDashboardZooms,
} from '../doc/dashboard/dashboardZoom';

describe('normalizeDashboardZoom', () => {
  it('accepts multipliers and percent spellings', () => {
    expect(normalizeDashboardZoom(1)).toBe(1);
    expect(normalizeDashboardZoom(1.5)).toBe(1.5);
    expect(normalizeDashboardZoom(2)).toBe(2);
    expect(normalizeDashboardZoom(100)).toBe(1);
    expect(normalizeDashboardZoom(150)).toBe(1.5);
    expect(normalizeDashboardZoom(200)).toBe(2);
    expect(normalizeDashboardZoom('150')).toBe(1.5);
    expect(normalizeDashboardZoom('200%')).toBe(2);
  });

  it('rejects values off the closed ladder', () => {
    expect(normalizeDashboardZoom(1.25)).toBeUndefined();
    expect(normalizeDashboardZoom(300)).toBeUndefined();
    expect(normalizeDashboardZoom(0)).toBeUndefined();
    expect(normalizeDashboardZoom('huge')).toBeUndefined();
    expect(normalizeDashboardZoom(undefined)).toBeUndefined();
    expect(DASHBOARD_ZOOM_LEVELS).toEqual([1, 1.5, 2]);
  });
});

describe('desiredCellZoom', () => {
  it('boosts short text-led blocks and leaves long ones alone', () => {
    expect(desiredCellZoom({ template: 'content', textLength: 80 })).toBe(2);
    expect(desiredCellZoom({ template: 'content', textLength: 200 })).toBe(1.5);
    expect(desiredCellZoom({ template: 'content', textLength: 500 })).toBe(1);
    expect(desiredCellZoom({ template: 'list', textLength: 90 })).toBe(2);
    expect(desiredCellZoom({ template: 'quote', textLength: 90 })).toBe(2);
  });

  it('never boosts spatial, chart, or display-scaled templates', () => {
    for (const template of [
      'lineChart',
      'barChart',
      'diagram',
      'tree',
      'timeline',
      'map',
      'photoGrid',
      'imageWithCaption',
      'statHighlight',
      'pullQuote',
      'fullBleedQuote',
      'title',
    ]) {
      expect(desiredCellZoom({ template, textLength: 10 })).toBe(1);
    }
    expect(desiredCellZoom({ textLength: 10 })).toBe(1);
  });
});

describe('resolveDashboardZooms', () => {
  it('passes uniform picks through', () => {
    expect(
      resolveDashboardZooms(
        [
          { template: 'lineChart', textLength: 40 },
          { template: 'content', textLength: 40 },
          { template: 'content', textLength: 60 },
        ],
        'auto',
      ),
    ).toEqual([1, 2, 2]);
  });

  it('quantizes mixed boosts to one level — majority wins', () => {
    const zooms = resolveDashboardZooms(
      [
        { template: 'content', textLength: 40 }, // wants 2
        { template: 'content', textLength: 200 }, // wants 1.5
        { template: 'content', textLength: 220 }, // wants 1.5
        { template: 'content', textLength: 500 }, // stays 1
      ],
      'auto',
    );
    expect(zooms).toEqual([1.5, 1.5, 1.5, 1]);
    expect(new Set(zooms.filter((zoom) => zoom !== 1)).size).toBe(1);
  });

  it('breaks boost ties toward 2×', () => {
    expect(
      resolveDashboardZooms(
        [
          { template: 'content', textLength: 40 }, // wants 2
          { template: 'content', textLength: 200 }, // wants 1.5
        ],
        'auto',
      ),
    ).toEqual([2, 2]);
  });

  it('honors explicit pins and rallies autos to the pinned level', () => {
    const zooms = resolveDashboardZooms(
      [
        { template: 'content', textLength: 40, explicit: 1.5 },
        { template: 'content', textLength: 40 }, // wants 2, snaps to the pin
        { template: 'lineChart', textLength: 40 },
      ],
      'auto',
    );
    expect(zooms).toEqual([1.5, 1.5, 1]);
  });

  it('never changes an explicit pin, even against the majority', () => {
    const zooms = resolveDashboardZooms(
      [
        { template: 'content', textLength: 40, explicit: 2 },
        { template: 'content', textLength: 200 }, // wants 1.5 → snaps to 2 (pin outweighs)
      ],
      'auto',
    );
    expect(zooms).toEqual([2, 2]);
  });

  it("mode 'off' pins every non-explicit cell to 1×", () => {
    expect(
      resolveDashboardZooms(
        [
          { template: 'content', textLength: 40 },
          { template: 'content', textLength: 40, explicit: 2 },
        ],
        'off',
      ),
    ).toEqual([1, 2]);
  });
});

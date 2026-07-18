/**
 * Chart engine math: numeric cell parsing, column-role resolution,
 * nice-tick scales, arc/line geometry, and stacking offsets.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCellNumber,
  isNumericColumn,
  resolveColumnRef,
  buildChartData,
  niceTicks,
  formatChartValue,
  arcPath,
  pointOnCircle,
  polylinePath,
  areaPath,
  stackSeries,
  layoutLegend,
  categoryLabelStep,
} from '../doc/templates/chart/index.js';

describe('parseCellNumber', () => {
  it('parses plain numbers', () => {
    expect(parseCellNumber('42')).toBe(42);
    expect(parseCellNumber('3.14')).toBeCloseTo(3.14);
    expect(parseCellNumber('-7')).toBe(-7);
    expect(parseCellNumber('+12')).toBe(12);
    expect(parseCellNumber('.5')).toBe(0.5);
    expect(parseCellNumber('1e3')).toBe(1000);
  });

  it('strips currency symbols, commas, and percent signs', () => {
    expect(parseCellNumber('$1,234.56')).toBeCloseTo(1234.56);
    expect(parseCellNumber('€2 500')).toBe(2500);
    expect(parseCellNumber('45%')).toBe(45);
    expect(parseCellNumber('-$300')).toBe(-300);
    expect(parseCellNumber('£1,000,000')).toBe(1_000_000);
  });

  it('reads accounting negatives', () => {
    expect(parseCellNumber('(300)')).toBe(-300);
    expect(parseCellNumber('($1,234)')).toBe(-1234);
  });

  it('returns null for placeholders and mixed text', () => {
    expect(parseCellNumber('')).toBeNull();
    expect(parseCellNumber('   ')).toBeNull();
    expect(parseCellNumber('—')).toBeNull();
    expect(parseCellNumber('N/A')).toBeNull();
    expect(parseCellNumber('12 units')).toBeNull();
    expect(parseCellNumber('5m')).toBeNull(); // ambiguous suffix, deliberately unparsed
    expect(parseCellNumber('two')).toBeNull();
  });
});

describe('isNumericColumn', () => {
  const rows = [
    ['West', '100', 'high'],
    ['East', '200', '12'],
    ['South', '—', 'low'],
  ];

  it('accepts a column whose non-empty cells are mostly numeric', () => {
    expect(isNumericColumn(rows, 1)).toBe(true);
  });

  it('rejects text columns and mixed columns below the threshold', () => {
    expect(isNumericColumn(rows, 0)).toBe(false);
    expect(isNumericColumn(rows, 2)).toBe(false);
  });

  it('rejects a column with no parseable cells', () => {
    expect(isNumericColumn([['a'], ['b']], 0)).toBe(false);
  });
});

describe('resolveColumnRef', () => {
  const headers = ['Region', 'Q1', 'Q2'];

  it('matches header names case-insensitively', () => {
    expect(resolveColumnRef('q1', headers)).toBe(1);
    expect(resolveColumnRef(' Region ', headers)).toBe(0);
  });

  it('falls back to 0-based indexes with bounds checking', () => {
    expect(resolveColumnRef('2', headers)).toBe(2);
    expect(resolveColumnRef('3', headers)).toBeNull();
  });

  it('returns null for unknown names', () => {
    expect(resolveColumnRef('Q9', headers)).toBeNull();
  });
});

describe('buildChartData', () => {
  const table = {
    headers: ['Region', 'Q1', 'Q2', 'Notes'],
    rows: [
      ['West', '1,200', '1,400', 'strong'],
      ['East', '$900', '1,100', 'ok'],
      ['South', '—', '800', 'gap'],
    ],
  };

  it('defaults label to the first column and values to all numeric columns', () => {
    const data = buildChartData(table);
    expect(data).not.toBeNull();
    expect(data!.labels).toEqual(['West', 'East', 'South']);
    expect(data!.labelHeader).toBe('Region');
    expect(data!.series.map((s) => s.name)).toEqual(['Q1', 'Q2']);
    expect(data!.series[0].values).toEqual([1200, 900, null]);
    expect(data!.series[1].values).toEqual([1400, 1100, 800]);
  });

  it('honors explicit column roles by name and by index', () => {
    const data = buildChartData(table, { labelColumn: 'Notes', valueColumns: ['1'] });
    expect(data!.labelHeader).toBe('Notes');
    expect(data!.labels).toEqual(['strong', 'ok', 'gap']);
    expect(data!.series).toHaveLength(1);
    expect(data!.series[0].name).toBe('Q1');
  });

  it('warns and skips unresolvable references', () => {
    const data = buildChartData(table, { labelColumn: 'Nope', valueColumns: ['Q1', 'Q9'] });
    expect(data!.labelHeader).toBe('Region');
    expect(data!.series.map((s) => s.name)).toEqual(['Q1']);
    expect(data!.warnings.some((w) => w.includes('Nope'))).toBe(true);
    expect(data!.warnings.some((w) => w.includes('Q9'))).toBe(true);
  });

  it('returns null when no value column resolves', () => {
    expect(
      buildChartData({
        headers: ['A', 'B'],
        rows: [
          ['x', 'y'],
          ['z', 'w'],
        ],
      }),
    ).toBeNull();
    expect(buildChartData({ headers: [], rows: [] })).toBeNull();
  });

  it('projects the label column to numbers for scatter x-axes', () => {
    const numeric = buildChartData({
      headers: ['X', 'Y'],
      rows: [
        ['1', '10'],
        ['2.5', '20'],
        ['n/a', '30'],
      ],
    });
    expect(numeric!.labelNumbers).toEqual([1, 2.5, null]);
  });
});

describe('niceTicks', () => {
  it('covers the input domain with evenly spaced ticks', () => {
    for (const [min, max] of [
      [0, 100],
      [3, 97],
      [-40, 260],
      [0.02, 0.87],
      [12_000, 950_000],
      [-5, -1],
    ] as const) {
      const { ticks, niceMin, niceMax, step } = niceTicks(min, max, 5);
      expect(niceMin).toBeLessThanOrEqual(min);
      expect(niceMax).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeGreaterThanOrEqual(3);
      expect(ticks.length).toBeLessThanOrEqual(9);
      expect(ticks[0]).toBe(niceMin);
      expect(ticks[ticks.length - 1]).toBeCloseTo(niceMax, 6);
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 6);
      }
    }
  });

  it('includes zero when the caller anchors the domain at zero', () => {
    const { ticks } = niceTicks(Math.min(0, 12), Math.max(0, 87), 5);
    expect(ticks).toContain(0);
  });

  it('pads degenerate domains', () => {
    const flat = niceTicks(50, 50, 5);
    expect(flat.niceMin).toBeLessThan(50);
    expect(flat.niceMax).toBeGreaterThan(50);

    const zero = niceTicks(0, 0, 5);
    expect(zero.niceMax).toBeGreaterThan(0);
    expect(zero.niceMin).toBe(0); // flat non-negative data doesn't invent negatives
  });

  it('handles inverted and non-finite inputs defensively', () => {
    const swapped = niceTicks(10, 2, 5);
    expect(swapped.niceMin).toBeLessThanOrEqual(2);
    expect(swapped.niceMax).toBeGreaterThanOrEqual(10);
    const bad = niceTicks(Number.NaN, Number.POSITIVE_INFINITY, 5);
    expect(bad.ticks.length).toBeGreaterThan(0);
  });
});

describe('formatChartValue', () => {
  it('applies K/M suffixes sign-aware and appends units', () => {
    expect(formatChartValue(1_500_000)).toBe('1.5M');
    expect(formatChartValue(2_500)).toBe('2.5K');
    expect(formatChartValue(25_000)).toBe('25K');
    expect(formatChartValue(-1_200)).toBe('-1.2K');
    expect(formatChartValue(950)).toBe('950');
    expect(formatChartValue(0)).toBe('0');
    expect(formatChartValue(42, 'km')).toBe('42 km');
    expect(formatChartValue(Number.NaN)).toBe('—');
  });
});

describe('arc geometry', () => {
  it("places circle points clockwise from 12 o'clock", () => {
    expect(pointOnCircle(0, 0, 10, 0)).toEqual({ x: 0, y: -10 });
    expect(pointOnCircle(0, 0, 10, 90)).toEqual({ x: 10, y: 0 });
    expect(pointOnCircle(0, 0, 10, 180)).toEqual({ x: 0, y: 10 });
    expect(pointOnCircle(0, 0, 10, 270)).toEqual({ x: -10, y: 0 });
  });

  it('draws pie wedges through the center and donut sectors as rings', () => {
    const wedge = arcPath(100, 100, 50, 0, 0, 90);
    expect(wedge.startsWith('M 100 100')).toBe(true);
    expect(wedge).toContain('A 50 50 0 0 1 150 100');
    expect(wedge.endsWith('Z')).toBe(true);

    const sector = arcPath(100, 100, 50, 25, 0, 90);
    expect(sector.startsWith('M 100 50')).toBe(true);
    expect(sector).toContain('A 25 25 0 0 0'); // inner arc sweeps back
    expect(sector.endsWith('Z')).toBe(true);
  });

  it('uses the large-arc flag past 180° and survives full-circle sweeps', () => {
    expect(arcPath(0, 0, 10, 0, 0, 270)).toContain('A 10 10 0 1 1');
    const full = arcPath(0, 0, 10, 0, 0, 360);
    expect(full.length).toBeGreaterThan(0);
    // Clamped just under 360°: endpoints must not coincide.
    const end = full.match(/A [\d. ]+ 1 (-?[\d.]+) (-?[\d.]+)/);
    expect(end).not.toBeNull();
    expect(`${end![1]} ${end![2]}`).not.toBe('0 -10');
  });

  it('returns empty paths for degenerate sweeps', () => {
    expect(arcPath(0, 0, 10, 0, 90, 90)).toBe('');
    expect(arcPath(0, 0, 10, 0, 90, 45)).toBe('');
  });
});

describe('line geometry', () => {
  const points = [
    { x: 0, y: 10 },
    { x: 50, y: 4 },
    { x: 100, y: 20 },
  ];

  it('builds polylines and closed areas', () => {
    expect(polylinePath(points)).toBe('M 0 10 L 50 4 L 100 20');
    const area = areaPath(points, 100);
    expect(area).toBe('M 0 10 L 50 4 L 100 20 L 100 100 L 0 100 Z');
    expect(polylinePath([])).toBe('');
    expect(areaPath([], 100)).toBe('');
  });
});

describe('stackSeries', () => {
  it('accumulates positive values upward per category', () => {
    const extents = stackSeries([
      { name: 'a', values: [10, 20] },
      { name: 'b', values: [5, 15] },
    ]);
    expect(extents[0][0]).toEqual({ y0: 0, y1: 10 });
    expect(extents[1][0]).toEqual({ y0: 10, y1: 15 });
    expect(extents[1][1]).toEqual({ y0: 20, y1: 35 });
  });

  it('stacks negatives downward and treats nulls as zero-extent', () => {
    const extents = stackSeries([
      { name: 'a', values: [10, -5] },
      { name: 'b', values: [null, -10] },
      { name: 'c', values: [3, 7] },
    ]);
    expect(extents[0][1]).toEqual({ y0: -5, y1: 0 });
    expect(extents[1][1]).toEqual({ y0: -15, y1: -5 });
    expect(extents[1][0].y0).toBe(extents[1][0].y1); // null occupies no extent
    expect(extents[2][0]).toEqual({ y0: 10, y1: 13 });
    expect(extents[2][1]).toEqual({ y0: 0, y1: 7 });
  });
});

describe('legend + label density', () => {
  it('wraps legend entries into rows within the available width', () => {
    const legend = layoutLegend(['Alpha', 'Beta', 'Gamma', 'Delta'], 20, 300);
    expect(legend.items).toHaveLength(4);
    expect(legend.rows).toBeGreaterThan(1);
    expect(legend.items.map((i) => i.index)).toEqual([0, 1, 2, 3]);
    for (const item of legend.items) {
      expect(item.x).toBeGreaterThanOrEqual(0);
    }
  });

  it('skips category labels when they would collide', () => {
    expect(categoryLabelStep(4, 1600, 22)).toBe(1);
    expect(categoryLabelStep(40, 1600, 22)).toBeGreaterThan(1);
    expect(categoryLabelStep(1, 100, 22)).toBe(1);
  });
});

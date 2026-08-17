import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DASHBOARD_LAYOUTS,
  getDashboardLayoutSummaries,
  listDashboardLayouts,
} from '../doc/dashboard/builtinDashboardLayouts';
import {
  layoutCapacity,
  resolveLayoutCells,
  transposeCells,
  validateDashboardLayoutDefinition,
  type DashboardLayoutDefinition,
} from '../doc/dashboard/DashboardLayout';
import {
  DASHBOARD_AUTO_LAYOUT_ID,
  chooseDashboardLayout,
  resolveDashboardLayoutDefinition,
} from '../doc/dashboard/chooseDashboardLayout';
import { writeDashboardLayoutsToFrontmatter } from '../doc/dashboard/dashboardLayoutsFrontmatter';

const EXPECTED_CAPACITIES: Record<string, number> = {
  'focus-1': 1,
  'split-2': 2,
  'hero-left': 3,
  'grid-2x2': 4,
  'hero-top': 4,
  'mosaic-5': 5,
  'grid-3x2': 6,
  'grid-3x3': 9,
  'grid-4x3': 12,
  'grid-4x4': 16,
};

function customLayout(
  name: string,
  cellCount: number,
  extra: Partial<DashboardLayoutDefinition> = {},
): DashboardLayoutDefinition {
  const height = 100 / cellCount;
  return {
    name,
    label: name,
    cells: {
      landscape: Array.from({ length: cellCount }, (_, index) => ({
        x: '0%',
        y: `${index * height}%`,
        width: '100%',
        height: `${height}%`,
      })),
    },
    ...extra,
  };
}

describe('built-in dashboard layouts', () => {
  it('every built-in passes validation with its declared capacity', () => {
    expect(BUILTIN_DASHBOARD_LAYOUTS.map((def) => def.name)).toEqual(
      Object.keys(EXPECTED_CAPACITIES),
    );
    for (const def of BUILTIN_DASHBOARD_LAYOUTS) {
      const result = validateDashboardLayoutDefinition(def);
      expect(result.valid, `${def.name}: ${JSON.stringify(result.errors)}`).toBe(true);
      expect(layoutCapacity(def)).toBe(EXPECTED_CAPACITIES[def.name]);
    }
  });

  it('per-orientation variants keep the landscape cell count', () => {
    for (const def of BUILTIN_DASHBOARD_LAYOUTS) {
      const capacity = layoutCapacity(def);
      if (def.cells.portrait) expect(def.cells.portrait).toHaveLength(capacity);
      if (def.cells.square) expect(def.cells.square).toHaveLength(capacity);
    }
  });

  it('built-ins survive the frontmatter codec byte-for-byte semantics', () => {
    // Sanity: the codec can serialize every built-in without throwing.
    expect(writeDashboardLayoutsToFrontmatter(BUILTIN_DASHBOARD_LAYOUTS)).toBeTruthy();
  });
});

describe('transposeCells', () => {
  it('swaps axes so a row becomes a column', () => {
    const [left, right] = transposeCells([
      { x: '0%', y: '0%', width: '49%', height: '100%' },
      { x: '51%', y: '0%', width: '49%', height: '100%', block: 2 },
    ]);
    expect(left).toEqual({ x: '0%', y: '0%', width: '100%', height: '49%' });
    expect(right).toEqual({ x: '0%', y: '51%', width: '100%', height: '49%', block: 2 });
  });
});

describe('resolveLayoutCells', () => {
  const contentRect = { x: 0, y: 100, width: 1920, height: 980 };

  it('resolves %-strings against the content rect (not the canvas)', () => {
    const def = customLayout('halves', 2);
    const cells = resolveLayoutCells(def, 'landscape', contentRect);
    expect(cells[0].rect).toEqual({ x: 0, y: 100, width: 1920, height: 490 });
    expect(cells[1].rect).toEqual({ x: 0, y: 590, width: 1920, height: 490 });
  });

  it('falls back to transposed landscape cells in portrait', () => {
    const def: DashboardLayoutDefinition = {
      name: 'row',
      label: 'Row',
      cells: { landscape: [{ x: '0%', y: '0%', width: '50%', height: '100%' }] },
    };
    const [cell] = resolveLayoutCells(def, 'portrait', { x: 0, y: 0, width: 1080, height: 1920 });
    // Transposed: width 100%, height 50%.
    expect(cell.rect).toEqual({ x: 0, y: 0, width: 1080, height: 960 });
  });

  it('uses landscape cells for square when no square variant exists', () => {
    const def = customLayout('halves', 2);
    const cells = resolveLayoutCells(def, 'square', { x: 0, y: 0, width: 1080, height: 1080 });
    expect(cells).toHaveLength(2);
    expect(cells[0].rect.height).toBe(540);
  });
});

describe('validateDashboardLayoutDefinition', () => {
  it('normalizes numeric and bare-string percents', () => {
    const result = validateDashboardLayoutDefinition({
      name: 'Loose',
      label: 'Loose',
      cells: { landscape: [{ x: 0, y: '10', width: 50, height: '90%' }] },
    });
    expect(result.valid).toBe(true);
    expect(result.layout?.name).toBe('loose');
    expect(result.layout?.cells.landscape[0]).toEqual({
      x: '0%',
      y: '10%',
      width: '50%',
      height: '90%',
    });
  });

  it('rejects mismatched per-orientation cell counts', () => {
    const result = validateDashboardLayoutDefinition({
      name: 'bad',
      label: 'Bad',
      cells: {
        landscape: [
          { x: '0%', y: '0%', width: '100%', height: '50%' },
          { x: '0%', y: '50%', width: '100%', height: '50%' },
        ],
        portrait: [{ x: '0%', y: '0%', width: '100%', height: '100%' }],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path === 'cells.portrait')).toBe(true);
  });

  it('normalizes cell zoom (percent or multiplier) and rejects off-ladder values', () => {
    const valid = validateDashboardLayoutDefinition({
      name: 'zoomy',
      label: 'Zoomy',
      cells: { landscape: [{ x: '0%', y: '0%', width: '100%', height: '100%', zoom: 200 }] },
    });
    expect(valid.valid).toBe(true);
    expect(valid.layout?.cells.landscape[0].zoom).toBe(2);
    const invalid = validateDashboardLayoutDefinition({
      name: 'zoomy',
      label: 'Zoomy',
      cells: { landscape: [{ x: '0%', y: '0%', width: '100%', height: '100%', zoom: 300 }] },
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.some((error) => error.path.endsWith('.zoom'))).toBe(true);
  });

  it('rejects invalid block assignments and slugs', () => {
    expect(
      validateDashboardLayoutDefinition({
        name: 'ok',
        label: 'Ok',
        cells: { landscape: [{ x: '0%', y: '0%', width: '100%', height: '100%', block: 0 }] },
      }).valid,
    ).toBe(false);
    expect(
      validateDashboardLayoutDefinition({
        name: 'Not A Slug!',
        label: 'X',
        cells: { landscape: [{ x: '0%', y: '0%', width: '100%', height: '100%' }] },
      }).valid,
    ).toBe(false);
  });
});

describe('chooseDashboardLayout', () => {
  it('walks the deterministic capacity ladder', () => {
    const expectations: Array<[number, string]> = [
      [0, 'focus-1'],
      [1, 'focus-1'],
      [2, 'split-2'],
      [3, 'hero-left'],
      [4, 'grid-2x2'],
      [5, 'mosaic-5'],
      [6, 'grid-3x2'],
      [7, 'grid-3x3'],
      [9, 'grid-3x3'],
      [10, 'grid-4x3'],
      [12, 'grid-4x3'],
      [13, 'grid-4x4'],
      [16, 'grid-4x4'],
    ];
    for (const [count, expected] of expectations) {
      expect(chooseDashboardLayout(count, 'landscape').name, `count ${count}`).toBe(expected);
    }
  });

  it('overflows onto the largest layout when nothing fits', () => {
    expect(chooseDashboardLayout(40, 'landscape').name).toBe('grid-4x4');
  });

  it('excludes auto:false layouts (hero-top never wins the 4-block case)', () => {
    expect(chooseDashboardLayout(4, 'landscape').name).toBe('grid-2x2');
  });

  it('prefers a custom layout over a built-in at equal capacity', () => {
    const custom = customLayout('my-quad', 4);
    expect(chooseDashboardLayout(4, 'landscape', [custom]).name).toBe('my-quad');
    // And a custom auto:false layout stays out of the ladder.
    const pickerOnly = customLayout('picker-only', 4, { auto: false });
    expect(chooseDashboardLayout(4, 'landscape', [pickerOnly]).name).toBe('grid-2x2');
  });
});

describe('resolveDashboardLayoutDefinition', () => {
  it('resolves built-ins and lets customs win name collisions', () => {
    expect(resolveDashboardLayoutDefinition('grid-2x2')?.label).toBe('Grid 2×2');
    const shadow = customLayout('grid-2x2', 2);
    expect(resolveDashboardLayoutDefinition('grid-2x2', [shadow])).toBe(shadow);
    expect(resolveDashboardLayoutDefinition('nope')).toBeUndefined();
  });
});

describe('layout listings', () => {
  it('summaries mirror the built-in table', () => {
    const summaries = getDashboardLayoutSummaries();
    expect(summaries.map((summary) => summary.id)).toEqual(Object.keys(EXPECTED_CAPACITIES));
    expect(summaries.every((summary) => !summary.custom)).toBe(true);
  });

  it('listDashboardLayouts places doc customs first and dedupes shadowed built-ins', () => {
    const frontmatter = {
      'squisq-dashboard-layouts': JSON.stringify({
        'kpi-wall': {
          lb: 'KPI Wall',
          ce: { ls: [{ x: '0%', y: '0%', wd: '100%', hg: '100%' }] },
        },
        'grid-2x2': {
          lb: 'Shadowed Grid',
          ce: { ls: [{ x: '0%', y: '0%', wd: '100%', hg: '100%' }] },
        },
      }),
    };
    const layouts = listDashboardLayouts({ frontmatter });
    expect(layouts[0]).toMatchObject({ id: 'kpi-wall', label: 'KPI Wall', custom: true });
    const gridEntries = layouts.filter((layout) => layout.id === 'grid-2x2');
    expect(gridEntries).toHaveLength(1);
    expect(gridEntries[0].label).toBe('Shadowed Grid');
    expect(DASHBOARD_AUTO_LAYOUT_ID).toBe('auto');
  });
});

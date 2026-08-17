/**
 * Built-in dashboard layouts.
 *
 * Built-ins use the exact same JSON-serializable schema as user-authored
 * custom layouts (`squisq-dashboard-layouts` frontmatter), so pickers,
 * validation, and the auto-pick ladder treat both uniformly. Gutters are
 * baked into the `%` rects (the photoGrid convention) rather than being a
 * separate spacing model.
 */

import type { Doc } from '../../schemas/Doc.js';
import type { DashboardCellDefinition, DashboardLayoutDefinition } from './DashboardLayout.js';
import { layoutCapacity } from './DashboardLayout.js';
import { readDashboardLayoutsFromFrontmatter } from './dashboardLayoutsFrontmatter.js';

/** Gutter between cells, in percent of the content rect's axis. */
const GAP = 2;

function pct(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

/** A uniform cols×rows grid with baked-in gutters. */
function gridCells(cols: number, rows: number, gap = GAP): DashboardCellDefinition[] {
  const cellW = (100 - (cols - 1) * gap) / cols;
  const cellH = (100 - (rows - 1) * gap) / rows;
  const cells: DashboardCellDefinition[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        x: pct(col * (cellW + gap)),
        y: pct(row * (cellH + gap)),
        width: pct(cellW),
        height: pct(cellH),
      });
    }
  }
  return cells;
}

/** One large "hero" cell plus a rail of stacked companions. */
function heroRow(heroWidth: number, companions: number, gap = GAP): DashboardCellDefinition[] {
  const railX = heroWidth + gap;
  const railW = 100 - railX;
  const cellH = (100 - (companions - 1) * gap) / companions;
  const cells: DashboardCellDefinition[] = [
    { x: '0%', y: '0%', width: pct(heroWidth), height: '100%' },
  ];
  for (let i = 0; i < companions; i++) {
    cells.push({
      x: pct(railX),
      y: pct(i * (cellH + gap)),
      width: pct(railW),
      height: pct(cellH),
    });
  }
  return cells;
}

/** A full-width hero band on top plus a row of cells below. */
function heroBand(heroHeight: number, below: number, gap = GAP): DashboardCellDefinition[] {
  const rowY = heroHeight + gap;
  const rowH = 100 - rowY;
  const cellW = (100 - (below - 1) * gap) / below;
  const cells: DashboardCellDefinition[] = [
    { x: '0%', y: '0%', width: '100%', height: pct(heroHeight) },
  ];
  for (let i = 0; i < below; i++) {
    cells.push({
      x: pct(i * (cellW + gap)),
      y: pct(rowY),
      width: pct(cellW),
      height: pct(rowH),
    });
  }
  return cells;
}

/** Hero on the left, a 2×2 grid on the right (the 5-cell mosaic). */
function mosaicCells(heroWidth: number, gap = GAP): DashboardCellDefinition[] {
  const gridX = heroWidth + gap;
  const gridW = 100 - gridX;
  const cellW = (gridW - gap) / 2;
  const cellH = (100 - gap) / 2;
  const cells: DashboardCellDefinition[] = [
    { x: '0%', y: '0%', width: pct(heroWidth), height: '100%' },
  ];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      cells.push({
        x: pct(gridX + col * (cellW + gap)),
        y: pct(row * (cellH + gap)),
        width: pct(cellW),
        height: pct(cellH),
      });
    }
  }
  return cells;
}

/**
 * The built-in layout library, ordered by capacity — the auto-pick ladder
 * walks this order. `hero-top` opts out of auto-pick (`auto: false`) so
 * `grid-2x2` wins the 4-block case; it stays available in pickers.
 */
export const BUILTIN_DASHBOARD_LAYOUTS: readonly DashboardLayoutDefinition[] = Object.freeze([
  {
    name: 'focus-1',
    label: 'Focus',
    description: 'One block fills the dashboard.',
    cells: { landscape: [{ x: '0%', y: '0%', width: '100%', height: '100%' }] },
  },
  {
    name: 'split-2',
    label: 'Split',
    description: 'Two blocks side by side.',
    cells: { landscape: gridCells(2, 1) },
  },
  {
    name: 'hero-left',
    label: 'Hero + 2',
    description: 'A large lead block with two companions.',
    cells: {
      landscape: heroRow(58, 2),
      portrait: [
        { x: '0%', y: '0%', width: '100%', height: pct(46) },
        { x: '0%', y: pct(48), width: '100%', height: pct(25) },
        { x: '0%', y: pct(75), width: '100%', height: pct(25) },
      ],
    },
  },
  {
    name: 'grid-2x2',
    label: 'Grid 2×2',
    description: 'Four blocks in a balanced grid.',
    cells: { landscape: gridCells(2, 2) },
  },
  {
    name: 'hero-top',
    label: 'Hero band',
    description: 'A wide lead band with three blocks below.',
    cells: {
      landscape: heroBand(46, 3),
      portrait: [
        { x: '0%', y: '0%', width: '100%', height: pct(40) },
        { x: '0%', y: pct(42), width: '100%', height: pct(18) },
        { x: '0%', y: pct(62), width: '100%', height: pct(18) },
        { x: '0%', y: pct(82), width: '100%', height: pct(18) },
      ],
    },
    auto: false,
  },
  {
    name: 'mosaic-5',
    label: 'Mosaic',
    description: 'A hero block beside a 2×2 grid.',
    cells: {
      landscape: mosaicCells(58),
      portrait: [
        { x: '0%', y: '0%', width: '100%', height: pct(40) },
        { x: '0%', y: pct(42), width: pct(49), height: pct(27) },
        { x: pct(51), y: pct(42), width: pct(49), height: pct(27) },
        { x: '0%', y: pct(71), width: pct(49), height: pct(29) },
        { x: pct(51), y: pct(71), width: pct(49), height: pct(29) },
      ],
    },
  },
  {
    name: 'grid-3x2',
    label: 'Grid 3×2',
    description: 'Six blocks in three columns.',
    cells: { landscape: gridCells(3, 2) },
  },
  {
    name: 'grid-3x3',
    label: 'Grid 3×3',
    description: 'Nine blocks in a square grid.',
    cells: { landscape: gridCells(3, 3), square: gridCells(3, 3) },
  },
  {
    name: 'grid-4x3',
    label: 'Grid 4×3',
    description: 'Twelve blocks in four columns.',
    cells: { landscape: gridCells(4, 3) },
  },
  {
    name: 'grid-4x4',
    label: 'Grid 4×4',
    description: 'Sixteen blocks — the densest wall.',
    cells: { landscape: gridCells(4, 4) },
  },
]);

/** Picker-facing summary of a layout. */
export interface DashboardLayoutSummary {
  id: string;
  label: string;
  description?: string;
  capacity: number;
  /** True for layouts defined by the document rather than built in. */
  custom: boolean;
}

function summarize(def: DashboardLayoutDefinition, custom: boolean): DashboardLayoutSummary {
  return {
    id: def.name,
    label: def.label,
    ...(def.description ? { description: def.description } : {}),
    capacity: layoutCapacity(def),
    custom,
  };
}

/** Summaries of the built-in layouts, in ladder order. */
export function getDashboardLayoutSummaries(): DashboardLayoutSummary[] {
  return BUILTIN_DASHBOARD_LAYOUTS.map((def) => summarize(def, false));
}

/**
 * Every layout available to a document: its frontmatter-defined custom
 * layouts first (they win name collisions), then the built-ins. This is
 * the list pickers and CLI `--layout` validation enumerate.
 */
export function listDashboardLayouts(
  doc: Pick<Doc, 'frontmatter'> | undefined,
): DashboardLayoutSummary[] {
  const customs = readDashboardLayoutsFromFrontmatter(doc?.frontmatter) ?? [];
  const customNames = new Set(customs.map((def) => def.name));
  return [
    ...customs.map((def) => summarize(def, true)),
    ...BUILTIN_DASHBOARD_LAYOUTS.filter((def) => !customNames.has(def.name)).map((def) =>
      summarize(def, false),
    ),
  ];
}

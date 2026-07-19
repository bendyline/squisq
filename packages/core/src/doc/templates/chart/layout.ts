/**
 * Chart frame + series layout math: band allocation (title / plot /
 * legend / table), stacking offsets, legend rows, and category-label
 * density. Pure functions over pixel dimensions — no theme access.
 */

import type { ChartSeries } from './types.js';

export interface PxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChartFrameOptions {
  viewportWidth: number;
  viewportHeight: number;
  hasTitle: boolean;
  titleFontSize: number;
  /** Extra left gutter for value-axis tick labels (px). 0 for pie/donut. */
  leftGutter: number;
  /** Extra bottom gutter for category/x-axis labels (px). 0 for pie/donut/bar. */
  bottomGutter: number;
  /** Number of legend rows (0 = no legend band). */
  legendRows: number;
  legendRowHeight: number;
  /** Table band request; 0 rows = no table band. */
  tableRowCount: number;
  tableFontSize: number;
}

export interface ChartFrame {
  titleBand?: PxRect;
  /** The axis-inclusive chart area (gutters included). */
  chartArea: PxRect;
  /** The mark-drawing area (chartArea minus gutters). */
  plot: PxRect;
  legendBand?: PxRect;
  tableBand?: PxRect;
}

/** Allocate vertical bands: title → chart (plot + gutters) → legend → table. */
export function computeChartFrame(options: ChartFrameOptions): ChartFrame {
  const W = options.viewportWidth;
  const H = options.viewportHeight;
  const marginX = W * 0.06;
  const marginY = H * 0.06;
  const innerWidth = W - marginX * 2;

  let cursor = marginY;
  let titleBand: PxRect | undefined;
  if (options.hasTitle) {
    titleBand = { x: marginX, y: cursor, width: innerWidth, height: options.titleFontSize * 2.2 };
    cursor = titleBand.y + titleBand.height;
  }

  let tableBand: PxRect | undefined;
  let tableHeight = 0;
  if (options.tableRowCount > 0) {
    // dataTable's natural-height heuristic, clamped so the chart keeps
    // at least ~60% of the space below the title.
    tableHeight = Math.min(H * 0.4, (options.tableRowCount + 1) * options.tableFontSize * 2.4);
  }

  const legendHeight = options.legendRows > 0 ? options.legendRows * options.legendRowHeight : 0;

  const chartArea: PxRect = {
    x: marginX,
    y: cursor,
    width: innerWidth,
    height: Math.max(40, H - marginY - cursor - legendHeight - tableHeight),
  };
  cursor = chartArea.y + chartArea.height;

  let legendBand: PxRect | undefined;
  if (legendHeight > 0) {
    legendBand = { x: marginX, y: cursor, width: innerWidth, height: legendHeight };
    cursor += legendHeight;
  }

  if (tableHeight > 0) {
    tableBand = { x: marginX, y: cursor, width: innerWidth, height: tableHeight };
  }

  const plot: PxRect = {
    x: chartArea.x + options.leftGutter,
    y: chartArea.y,
    width: Math.max(20, chartArea.width - options.leftGutter),
    height: Math.max(20, chartArea.height - options.bottomGutter),
  };

  return { titleBand, chartArea, plot, legendBand, tableBand };
}

/** Stacked extent of one series value within one category. */
export interface StackedExtent {
  /** Lower bound in data units. */
  y0: number;
  /** Upper bound in data units. */
  y1: number;
}

/**
 * Cumulative stacking offsets per category: positive values stack up
 * from 0, negative values stack down from 0, null values occupy no
 * extent. Result is indexed [seriesIndex][rowIndex].
 */
export function stackSeries(series: ChartSeries[]): StackedExtent[][] {
  const rowCount = series.reduce((max, s) => Math.max(max, s.values.length), 0);
  const positive = new Array<number>(rowCount).fill(0);
  const negative = new Array<number>(rowCount).fill(0);

  return series.map((s) =>
    Array.from({ length: rowCount }, (_, row) => {
      const value = s.values[row];
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return { y0: positive[row], y1: positive[row] };
      }
      if (value >= 0) {
        const y0 = positive[row];
        positive[row] += value;
        return { y0, y1: positive[row] };
      }
      const y1 = negative[row];
      negative[row] += value;
      return { y0: negative[row], y1 };
    }),
  );
}

export interface LegendItemLayout {
  label: string;
  /** Index of this entry in the input label list (drives swatch color). */
  index: number;
  /** Offset within the legend band. */
  x: number;
  y: number;
  swatchSize: number;
}

export interface LegendLayout {
  items: LegendItemLayout[];
  rows: number;
  rowHeight: number;
}

/**
 * Wrap legend entries into centered rows. Width estimation uses the same
 * character-width heuristic as comparisonBar (~0.58 × fontSize per char).
 */
export function layoutLegend(labels: string[], fontSize: number, maxWidth: number): LegendLayout {
  const swatchSize = fontSize * 0.9;
  const gap = fontSize * 1.6;
  const rowHeight = fontSize * 2;
  const widths = labels.map(
    (label) => swatchSize + fontSize * 0.5 + label.length * fontSize * 0.58,
  );

  const rows: number[][] = [];
  let current: number[] = [];
  let currentWidth = 0;
  widths.forEach((width, index) => {
    const extra = current.length > 0 ? gap : 0;
    if (current.length > 0 && currentWidth + extra + width > maxWidth) {
      rows.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(index);
    currentWidth += (current.length > 1 ? gap : 0) + width;
  });
  if (current.length > 0) rows.push(current);

  const items: LegendItemLayout[] = [];
  rows.forEach((rowIndexes, rowIndex) => {
    const rowWidth = rowIndexes.reduce(
      (sum, index, i) => sum + widths[index] + (i > 0 ? gap : 0),
      0,
    );
    let x = Math.max(0, (maxWidth - rowWidth) / 2);
    rowIndexes.forEach((index) => {
      items.push({ label: labels[index], index, x, y: rowIndex * rowHeight, swatchSize });
      x += widths[index] + gap;
    });
  });

  return { items, rows: rows.length, rowHeight };
}

/**
 * Category-label density: show every `step`-th label so labels keep a
 * minimum pitch (~6 characters of the label font) along the axis.
 */
export function categoryLabelStep(
  categoryCount: number,
  axisLength: number,
  fontSize: number,
): number {
  if (categoryCount <= 1) return 1;
  const minPitch = fontSize * 6;
  const pitch = axisLength / categoryCount;
  return Math.max(1, Math.ceil(minPitch / Math.max(1, pitch)));
}

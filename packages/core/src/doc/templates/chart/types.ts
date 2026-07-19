/**
 * Chart engine data model.
 *
 * The chart templates (barChart, columnChart, pieChart, donutChart,
 * lineChart, areaChart, scatterChart) are thin wrappers over one shared
 * engine. The engine consumes a plain string table — normally the first
 * markdown table in the block body — and a set of column-role options,
 * and produces pure SVG layers.
 */

export type ChartKind = 'bar' | 'column' | 'pie' | 'donut' | 'line' | 'area' | 'scatter';

/** One value column projected to numbers (null = unparseable cell → gap). */
export interface ChartSeries {
  name: string;
  values: (number | null)[];
}

/** Numeric projection of a string table, ready to plot. */
export interface ChartData {
  /** Category labels, one per table row (label column cells verbatim). */
  labels: string[];
  /** One entry per resolved value column. */
  series: ChartSeries[];
  /** Header text of the label column. */
  labelHeader: string;
  /**
   * Numeric projection of the label column (scatter x-axis). Null per
   * non-numeric cell; scatter falls back to row index when too sparse.
   */
  labelNumbers: (number | null)[];
  /** Non-fatal issues encountered while mapping columns (for tests/tools). */
  warnings: string[];
}

/** The string table the engine plots (extracted markdown table shape). */
export interface ChartTableData {
  headers: string[];
  rows: string[][];
}

/**
 * Structural input the engine reads off a chart template's typed input.
 * Every chart template input interface is assignable to this.
 */
export interface ChartRenderInput {
  title?: string;
  headers?: string[];
  rows?: string[][];
  /** Category/label column — header name or 0-based index. Default: first column. */
  labelColumn?: string;
  /** Value columns — header names or 0-based indexes. Default: all numeric columns. */
  valueColumns?: string[];
  /** Render the source table beneath the chart. */
  showTable?: boolean;
  /** Show a series legend (default: on when it adds information). */
  showLegend?: boolean;
  /** Print numeric value labels on marks. */
  showValues?: boolean;
  /** Stack series instead of grouping (bar/column only). */
  stacked?: boolean;
  /** Unit suffix for tick/value labels (e.g. "km"). */
  unit?: string;
  colorScheme?: string;
}

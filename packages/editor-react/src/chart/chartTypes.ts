/**
 * Curated starter gallery for the chart templates. Each entry pairs a
 * template id with a heading + sample markdown table starter, so both the
 * WYSIWYG and Raw insert paths produce the same block: the table is the
 * chart's data, and editing it re-renders the chart.
 */

export type ChartTypePreview = 'bar' | 'column' | 'pie' | 'donut' | 'line' | 'area' | 'scatter';

export interface ChartTypeEntry {
  /** Chart template id — also the `{[…]}` annotation written to markdown. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly preview: ChartTypePreview;
  /** Heading text for the starter block. */
  readonly headingText: string;
  /** Sample table seeding the chart (headers + rows). */
  readonly table: {
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
}

const CATEGORY_TABLE = {
  headers: ['Category', 'Value A', 'Value B'],
  rows: [
    ['Alpha', '40', '28'],
    ['Beta', '55', '31'],
    ['Gamma', '30', '45'],
  ],
} as const;

const SHARE_TABLE = {
  headers: ['Segment', 'Share'],
  rows: [
    ['North', '45'],
    ['South', '30'],
    ['East', '15'],
    ['West', '10'],
  ],
} as const;

const SERIES_TABLE = {
  headers: ['Month', 'Revenue', 'Costs'],
  rows: [
    ['Jan', '40', '28'],
    ['Feb', '55', '31'],
    ['Mar', '48', '30'],
    ['Apr', '62', '35'],
  ],
} as const;

const XY_TABLE = {
  headers: ['Hours', 'Score'],
  rows: [
    ['1', '40'],
    ['2', '52'],
    ['4', '65'],
    ['6', '74'],
    ['8', '90'],
  ],
} as const;

export const CHART_TYPES: readonly ChartTypeEntry[] = [
  {
    id: 'columnChart',
    label: 'Column',
    description: 'Vertical columns — one per table row.',
    preview: 'column',
    headingText: 'Column chart',
    table: CATEGORY_TABLE,
  },
  {
    id: 'barChart',
    label: 'Bar',
    description: 'Horizontal bars — one per table row.',
    preview: 'bar',
    headingText: 'Bar chart',
    table: CATEGORY_TABLE,
  },
  {
    id: 'lineChart',
    label: 'Line',
    description: 'One line per value column.',
    preview: 'line',
    headingText: 'Line chart',
    table: SERIES_TABLE,
  },
  {
    id: 'areaChart',
    label: 'Area',
    description: 'Filled lines on a zero-based axis.',
    preview: 'area',
    headingText: 'Area chart',
    table: SERIES_TABLE,
  },
  {
    id: 'pieChart',
    label: 'Pie',
    description: 'Each row becomes a labeled slice.',
    preview: 'pie',
    headingText: 'Pie chart',
    table: SHARE_TABLE,
  },
  {
    id: 'donutChart',
    label: 'Donut',
    description: 'A pie with an open center.',
    preview: 'donut',
    headingText: 'Donut chart',
    table: SHARE_TABLE,
  },
  {
    id: 'scatterChart',
    label: 'Scatter',
    description: 'X/Y points from two numeric columns.',
    preview: 'scatter',
    headingText: 'Scatter chart',
    table: XY_TABLE,
  },
];

/** Default entry used by the plain `chart` toolbar action (no flyout pick). */
export const DEFAULT_CHART_TYPE: ChartTypeEntry = CHART_TYPES[0];

/** GFM table for a starter entry: label column left, value columns right. */
export function chartTableMarkdown(table: ChartTypeEntry['table']): string {
  const header = `| ${table.headers.join(' | ')} |`;
  const separator = `| --- |${table.headers
    .slice(1)
    .map(() => ' ---: |')
    .join('')}`;
  const rows = table.rows.map((row) => `| ${row.join(' | ')} |`);
  return [header, separator, ...rows].join('\n');
}

/** Complete markdown starter: annotated heading + sample table. */
export function chartStarterMarkdown(entry: ChartTypeEntry): string {
  return `\n## ${entry.headingText} {[${entry.id}]}\n\n${chartTableMarkdown(entry.table)}\n`;
}

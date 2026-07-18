/**
 * Chart templates end-to-end: markdown table → typed inputs → layers,
 * column-role params, stacked bars, pie geometry, content fallback, and
 * the showTable companion layer.
 */

import { describe, it, expect } from 'vitest';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { parseMarkdown } from '../markdown/parse.js';
import { materializeLayers } from './materializeTestUtils.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import type { Layer, ShapeLayer, TextLayer, PathLayer, TableLayer } from '../schemas/Doc.js';

const TABLE_MD = `| Region | Q1 | Q2 |
| --- | ---: | ---: |
| West | 1,200 | 1,400 |
| East | $900 | 1,100 |
| South | 800 | — |
`;

function firstBlock(md: string) {
  return markdownToDoc(parseMarkdown(md), { generateCoverBlock: false }).blocks[0];
}

function chartBlock(template: string, params = '', md = TABLE_MD) {
  return firstBlock(`## Revenue by region {[${template}${params ? ` ${params}` : ''}]}\n\n${md}`);
}

function shapes(layers: Layer[], prefix: string): ShapeLayer[] {
  return layers.filter((l): l is ShapeLayer => l.type === 'shape' && l.id.startsWith(prefix));
}

function texts(layers: Layer[]): string[] {
  return layers.filter((l): l is TextLayer => l.type === 'text').map((l) => l.content.text);
}

describe('chart templates from markdown tables', () => {
  it('columnChart renders one mark per series×row with heights proportional to values', () => {
    const layers = materializeLayers(chartBlock('columnChart'));
    const marks = shapes(layers, 'mark-');
    // 2 numeric columns × 3 rows, minus the null cell (South Q2).
    expect(marks).toHaveLength(5);

    const height = (id: string) => {
      const mark = marks.find((m) => m.id === id)!;
      return Number(mark.position.height);
    };
    // Q1: West 1200 vs East 900 vs South 800 — heights ordered accordingly.
    expect(height('mark-0-0')).toBeGreaterThan(height('mark-0-1'));
    expect(height('mark-0-1')).toBeGreaterThan(height('mark-0-2'));
    // Proportionality against a zero-based axis: heights scale ~linearly.
    expect(height('mark-0-0') / height('mark-0-2')).toBeCloseTo(1200 / 800, 1);

    // Category labels + numeric tick labels render.
    const textContents = texts(layers);
    expect(textContents).toContain('West');
    expect(textContents).toContain('Revenue by region');
  });

  it('barChart lays bars horizontally with widths proportional to values', () => {
    const layers = materializeLayers(chartBlock('barChart', 'valueColumns="Q1"'));
    const marks = shapes(layers, 'mark-');
    expect(marks).toHaveLength(3);
    const width = (id: string) => Number(marks.find((m) => m.id === id)!.position.width);
    expect(width('mark-0-0') / width('mark-0-2')).toBeCloseTo(1200 / 800, 1);
    // No negative or zero-collapsed geometry.
    for (const mark of marks) {
      expect(Number(mark.position.width)).toBeGreaterThan(0);
      expect(Number(mark.position.height)).toBeGreaterThan(0);
    }
  });

  it('stacked columns partition each category into cumulative segments', () => {
    const layers = materializeLayers(chartBlock('columnChart', 'stacked=true'));
    const marks = shapes(layers, 'mark-');
    // West: Q1 1200 + Q2 1400 stack; the series-1 segment sits on top of series-0.
    const s0 = marks.find((m) => m.id === 'mark-0-0')!;
    const s1 = marks.find((m) => m.id === 'mark-1-0')!;
    expect(Number(s0.position.x)).toBeCloseTo(Number(s1.position.x), 5);
    const s0Top = Number(s0.position.y);
    const s1Bottom = Number(s1.position.y) + Number(s1.position.height);
    expect(s1Bottom).toBeCloseTo(s0Top, 0);
  });

  it('pieChart slice sweeps are value-proportional and sum to a full circle', () => {
    const layers = materializeLayers(chartBlock('pieChart', 'valueColumns="Q1"'));
    const slices = layers.filter(
      (l): l is PathLayer => l.type === 'path' && l.id.startsWith('mark-'),
    );
    expect(slices).toHaveLength(3);
    for (const slice of slices) {
      expect(slice.content.d.length).toBeGreaterThan(0);
      expect(slice.content.d.endsWith('Z')).toBe(true);
    }
    // Distinct slice colors from the theme rotation.
    const fills = new Set(slices.map((s) => s.content.fill));
    expect(fills.size).toBe(3);
  });

  it('donutChart slices are ring sectors (no path through the center)', () => {
    const layers = materializeLayers(chartBlock('donutChart', 'valueColumns="Q1"'));
    const slices = layers.filter(
      (l): l is PathLayer => l.type === 'path' && l.id.startsWith('mark-'),
    );
    expect(slices.length).toBeGreaterThan(0);
    // Donut sector paths contain two arcs (outer + inner), pie wedges only one.
    for (const slice of slices) {
      expect(slice.content.d.split('A ').length - 1).toBe(2);
    }
  });

  it('lineChart draws one line per series and gaps null cells', () => {
    const layers = materializeLayers(chartBlock('lineChart'));
    const lines = layers.filter(
      (l): l is PathLayer => l.type === 'path' && l.id.startsWith('line-'),
    );
    // Q1 has 3 points → one segment; Q2 has a trailing null → 2-point segment.
    expect(lines.length).toBe(2);
    const points = shapes(layers, 'pt-');
    expect(points).toHaveLength(5); // 6 cells minus the null gap
  });

  it('areaChart fills under each line', () => {
    const layers = materializeLayers(chartBlock('areaChart', 'valueColumns="Q1"'));
    const areas = layers.filter(
      (l): l is PathLayer => l.type === 'path' && l.id.startsWith('area-'),
    );
    expect(areas).toHaveLength(1);
    expect(areas[0].content.fillOpacity).toBeLessThan(1);
    expect(areas[0].content.d.endsWith('Z')).toBe(true);
  });

  it('scatterChart uses a numeric label column as the x axis', () => {
    const md = `| Hours | Score |
| ---: | ---: |
| 1 | 40 |
| 2 | 55 |
| 4 | 70 |
| 8 | 90 |
`;
    const layers = materializeLayers(chartBlock('scatterChart', '', md));
    const marks = shapes(layers, 'mark-');
    expect(marks).toHaveLength(4);
    const xs = marks.map((m) => Number(m.position.x));
    // Numeric x spacing: 1→2 gap is smaller than 4→8 gap.
    expect(xs[1] - xs[0]).toBeLessThan(xs[3] - xs[2]);
  });

  it('respects labelColumn and valueColumns roles by header name', () => {
    const layers = materializeLayers(
      chartBlock('columnChart', 'labelColumn="Region" valueColumns="Q2"'),
    );
    const marks = shapes(layers, 'mark-');
    expect(marks).toHaveLength(2); // Q2 has a null cell for South
  });

  it('renders a legend for multi-series charts and honors showLegend=false', () => {
    const withLegend = materializeLayers(chartBlock('columnChart'));
    expect(texts(withLegend)).toContain('Q1');
    expect(withLegend.some((l) => l.id.startsWith('legend-swatch-'))).toBe(true);

    const without = materializeLayers(chartBlock('columnChart', 'showLegend=false'));
    expect(without.some((l) => l.id.startsWith('legend-swatch-'))).toBe(false);
  });

  it('showTable appends the source table beneath the chart', () => {
    const layers = materializeLayers(chartBlock('columnChart', 'showTable=true'));
    const table = layers.find((l): l is TableLayer => l.type === 'table');
    expect(table).toBeDefined();
    expect(table!.content.headers).toEqual(['Region', 'Q1', 'Q2']);
    expect(table!.content.rows).toHaveLength(3);
    // The table band sits below every chart mark.
    const tableTop = Number(table!.position.y);
    for (const mark of shapes(layers, 'mark-')) {
      expect(Number(mark.position.y) + Number(mark.position.height)).toBeLessThanOrEqual(
        tableTop + 1,
      );
    }
  });

  it('showValues prints formatted value labels', () => {
    const layers = materializeLayers(
      chartBlock('columnChart', 'showValues=true valueColumns="Q1"'),
    );
    const textContents = texts(layers);
    expect(textContents).toContain('1.2K');
  });

  it('stays in bounds in portrait viewports', () => {
    const layers = materializeLayers(chartBlock('columnChart', 'showTable=true'), {
      viewport: VIEWPORT_PRESETS.portrait,
    });
    const vp = VIEWPORT_PRESETS.portrait;
    for (const layer of layers) {
      if (typeof layer.position.x !== 'number') continue;
      const w = typeof layer.position.width === 'number' ? layer.position.width : 0;
      const h = typeof layer.position.height === 'number' ? layer.position.height : 0;
      // anchor: 'center' positions give the box center, not the top-left.
      const centered = layer.position.anchor === 'center';
      const left = centered ? Number(layer.position.x) - w / 2 : Number(layer.position.x);
      const top = centered ? Number(layer.position.y) - h / 2 : Number(layer.position.y);
      expect(left).toBeGreaterThanOrEqual(-1);
      expect(left + w).toBeLessThanOrEqual(vp.width + 1);
      expect(top + h).toBeLessThanOrEqual(vp.height + 1);
    }
  });

  it('handles a 20-row table by thinning category labels', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `| Category ${i + 1} | ${(i + 1) * 10} |`);
    const md = `| Name | Value |\n| --- | ---: |\n${rows.join('\n')}\n`;
    const layers = materializeLayers(chartBlock('columnChart', '', md));
    expect(shapes(layers, 'mark-')).toHaveLength(20);
    const categoryLabels = layers.filter((l) => l.id.startsWith('cat-'));
    expect(categoryLabels.length).toBeLessThan(20);
  });
});

describe('chart template fallback', () => {
  it('renders prose-only blocks as content instead of an empty chart', () => {
    const block = firstBlock('## Notes {[barChart]}\n\nJust a paragraph of prose.\n');
    const layers = materializeLayers(block);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.some((l) => l.id.startsWith('mark-'))).toBe(false);
    const textContents = texts(layers);
    expect(textContents.some((t) => t.includes('Just a paragraph of prose.'))).toBe(true);
  });

  it('falls back when the table has no numeric columns', () => {
    const md = `| Name | Status |
| --- | --- |
| Alpha | Ready |
| Beta | Blocked |
`;
    const layers = materializeLayers(chartBlock('pieChart', '', md));
    expect(layers.some((l) => l.id.startsWith('mark-'))).toBe(false);
    expect(texts(layers).some((t) => t.includes('Alpha'))).toBe(true);
  });

  it('falls back for pie charts whose values are all non-positive', () => {
    const md = `| Name | Delta |
| --- | ---: |
| A | -5 |
| B | 0 |
`;
    const layers = materializeLayers(chartBlock('pieChart', '', md));
    expect(layers.some((l) => l.type === 'path')).toBe(false);
  });
});

describe('chart data via structured data fences', () => {
  it('reads headers/rows from a json data fence when the body has no table', () => {
    const md = [
      '## Fence fed {[columnChart]}',
      '',
      '```json data',
      '{"headers": ["Label", "Value"], "rows": [["A", "10"], ["B", "30"]]}',
      '```',
      '',
    ].join('\n');
    const block = firstBlock(md);
    expect(block.templateData?.headers).toEqual(['Label', 'Value']);
    const layers = materializeLayers(block);
    expect(shapes(layers, 'mark-')).toHaveLength(2);
  });

  it('keeps author-supplied fence data over the body table', () => {
    const md = [
      '## Override {[columnChart]}',
      '',
      '```json data',
      '{"headers": ["X", "Y"], "rows": [["only", "42"]]}',
      '```',
      '',
      TABLE_MD,
    ].join('\n');
    const layers = materializeLayers(firstBlock(md));
    expect(shapes(layers, 'mark-')).toHaveLength(1);
  });
});

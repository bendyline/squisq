/**
 * Shared chart rendering engine.
 *
 * All seven chart templates delegate here. The engine reads the block's
 * markdown table (already-typed `headers`/`rows` win, else the first
 * table in the block body), projects it to numeric series, and emits
 * pure SVG layers — shape rects for bars, path arcs/lines for pie and
 * line families, text for axes/labels — so charts render identically in
 * the player, page mode, and every export path.
 *
 * When the block has no table (or the table has no numeric columns) the
 * engine renders the block as ordinary content instead, so annotating a
 * prose block with `{[barChart]}` degrades gracefully.
 */

import type { Animation, Layer } from '../../../schemas/Doc.js';
import type { ContentBlockInput, TemplateContext } from '../../../schemas/BlockTemplates.js';
import type { MarkdownBlockNode } from '../../../markdown/types.js';
import {
  getTemplateHint,
  getThemeFont,
  resolveColorScheme,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
} from '../../utils/themeUtils.js';
import { pickContrastingText, withAlpha } from '../../../schemas/colorUtils.js';
import { createBackgroundLayer } from '../captionUtils.js';
import { contentBlock } from '../contentBlock.js';
import { extractTableFromContents } from '../../templateInputs.js';
import type { ChartData, ChartKind, ChartRenderInput } from './types.js';
import { buildChartData } from './parse.js';
import { formatChartValue, niceTicks, type NiceTicks } from './scale.js';
import { arcPath, areaPath, polylinePath, type ChartPoint } from './geometry.js';
import {
  categoryLabelStep,
  computeChartFrame,
  layoutLegend,
  stackSeries,
  type ChartFrame,
  type PxRect,
} from './layout.js';

const TEMPLATE_ID: Record<ChartKind, string> = {
  bar: 'barChart',
  column: 'columnChart',
  pie: 'pieChart',
  donut: 'donutChart',
  line: 'lineChart',
  area: 'areaChart',
  scatter: 'scatterChart',
};

interface ResolvedTable {
  headers: string[];
  rows: string[][];
  align?: (('left' | 'right' | 'center') | null)[];
}

/** Everything the per-kind mark builders need. */
interface Paint {
  kind: ChartKind;
  input: ChartRenderInput;
  context: TemplateContext;
  data: ChartData;
  frame: ChartFrame;
  colors: string[];
  axisFontSize: number;
  labelFontSize: number;
  bodyFont: string;
  gridColor: string;
  axisTextColor: string;
  entrance: (index: number) => Animation;
}

export function renderChart(
  kind: ChartKind,
  input: ChartRenderInput,
  context: TemplateContext,
): Layer[] {
  const table = resolveTable(input, context);
  const data = table ? buildChartData(table, input) : null;
  if (!table || !data) return contentFallback(input, context);

  const { theme, viewport } = context;
  const templateId = TEMPLATE_ID[kind];
  const title = (input.title ?? '').trim();

  const titleFontSize = themedFontSize(44, context, true);
  const axisFontSize = themedFontSize(20, context, false);
  const labelFontSize = themedFontSize(22, context, false);
  const legendFontSize = themedFontSize(22, context, false);
  const tableFontSize = themedFontSize(20, context, false);
  const bodyFont = getThemeFont(context, 'body');

  const isRadial = kind === 'pie' || kind === 'donut';
  const legendLabels = resolveLegendLabels(kind, input, data);
  const colors = seriesColors(
    context,
    input.colorScheme,
    isRadial ? data.labels.length : data.series.length,
  );

  // Pie/donut with no positive values has nothing to draw — treat like no table.
  if (isRadial && !data.series[0].values.some((v) => v !== null && v > 0)) {
    return contentFallback(input, context);
  }

  const innerWidth = viewport.width * 0.88;
  const legend =
    legendLabels.length > 0 ? layoutLegend(legendLabels, legendFontSize, innerWidth) : null;

  const gutters = computeGutters(kind, data, input, context, axisFontSize, labelFontSize);
  const frame = computeChartFrame({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    hasTitle: title.length > 0,
    titleFontSize,
    leftGutter: gutters.left,
    bottomGutter: gutters.bottom,
    legendRows: legend?.rows ?? 0,
    legendRowHeight: legendFontSize * 2,
    tableRowCount: input.showTable === true ? table.rows.length : 0,
    tableFontSize,
  });

  const entranceHint = getTemplateHint<string>(context, templateId, 'entrance', 'staggered');
  const entrance = (index: number): Animation => ({
    type: 'fadeIn',
    duration: 0.6,
    delay: entranceHint === 'subtle' ? 0.1 : Math.min(1.2, 0.2 + index * 0.08),
  });

  const paint: Paint = {
    kind,
    input,
    context,
    data,
    frame,
    colors,
    axisFontSize,
    labelFontSize,
    bodyFont,
    gridColor: withAlpha(theme.colors.text, 0.12),
    axisTextColor: theme.colors.textMuted,
    entrance,
  };

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 170))];

  if (title && frame.titleBand) {
    layers.push({
      type: 'text',
      id: 'title',
      content: {
        text: title,
        style: {
          fontSize: titleFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: frame.titleBand.x + frame.titleBand.width / 2,
        y: frame.titleBand.y + frame.titleBand.height / 2,
        width: frame.titleBand.width,
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 0.8 },
    });
  }

  switch (kind) {
    case 'bar':
      layers.push(...paintBars(paint));
      break;
    case 'column':
      layers.push(...paintColumns(paint));
      break;
    case 'pie':
    case 'donut':
      layers.push(...paintRadial(paint));
      break;
    case 'line':
    case 'area':
      layers.push(...paintLines(paint));
      break;
    case 'scatter':
      layers.push(...paintScatter(paint));
      break;
  }

  if (legend && frame.legendBand) {
    layers.push(...paintLegend(paint, legend, frame.legendBand, legendFontSize));
  }

  if (input.showTable === true && frame.tableBand) {
    layers.push(tableLayer(table, frame.tableBand, tableFontSize, input, context));
  }

  return layers;
}

// ============================================
// Data + frame resolution
// ============================================

function resolveTable(input: ChartRenderInput, context: TemplateContext): ResolvedTable | null {
  if (
    Array.isArray(input.headers) &&
    input.headers.length > 0 &&
    Array.isArray(input.rows) &&
    input.rows.length > 0
  ) {
    return { headers: input.headers, rows: input.rows };
  }
  const contents =
    (input as { contents?: MarkdownBlockNode[] }).contents ?? context.block?.contents;
  return extractTableFromContents(contents);
}

function contentFallback(input: ChartRenderInput, context: TemplateContext): Layer[] {
  const fallbackInput = {
    ...input,
    template: 'content',
    title: input.title ?? context.block?.title ?? '',
  } as unknown as ContentBlockInput;
  return contentBlock(fallbackInput, context);
}

function resolveLegendLabels(kind: ChartKind, input: ChartRenderInput, data: ChartData): string[] {
  if (input.showLegend === false) return [];
  if (kind === 'pie' || kind === 'donut') return data.labels;
  if (data.series.length > 1 || input.showLegend === true) {
    return data.series.map((s) => s.name);
  }
  return [];
}

/**
 * Rotate series/slice colors through the theme's color-scheme accents,
 * starting from the requested scheme. Overflow beyond the distinct
 * accents wraps with translucent variants so long series stay legible.
 */
function seriesColors(
  context: TemplateContext,
  schemeName: string | undefined,
  count: number,
): string[] {
  const schemes = context.theme.colorSchemes;
  const names = Object.keys(schemes);
  const primary = resolveColorScheme(context, schemeName).accent;

  const palette: string[] = [primary];
  const start = schemeName && names.includes(schemeName) ? names.indexOf(schemeName) : 0;
  for (let i = 1; i < names.length && palette.length < count; i++) {
    const accent = schemes[names[(start + i) % names.length]].accent;
    if (!palette.some((c) => c.toLowerCase() === accent.toLowerCase())) palette.push(accent);
  }
  const distinct = palette.length;
  for (let i = 0; palette.length < count; i++) {
    palette.push(withAlpha(palette[i % distinct], 0.55));
  }
  return palette.slice(0, Math.max(1, count));
}

function computeGutters(
  kind: ChartKind,
  data: ChartData,
  input: ChartRenderInput,
  context: TemplateContext,
  axisFontSize: number,
  labelFontSize: number,
): { left: number; bottom: number } {
  if (kind === 'pie' || kind === 'donut') return { left: 0, bottom: 0 };

  if (kind === 'bar') {
    // Horizontal bars: category labels in the left gutter, value ticks below.
    const longest = data.labels.reduce((max, label) => Math.max(max, label.length), 0);
    const left = Math.min(
      context.viewport.width * 0.24,
      Math.max(labelFontSize * 3, longest * labelFontSize * 0.58 + 16),
    );
    return { left, bottom: axisFontSize * 2.4 };
  }

  // Vertical value axis: tick labels in the left gutter.
  const ticks = valueTicks(kind, data, input);
  const longestTick = ticks.ticks.reduce(
    (max, tick) => Math.max(max, formatChartValue(tick, input.unit).length),
    0,
  );
  return {
    left: Math.max(axisFontSize * 2.5, longestTick * axisFontSize * 0.6 + 16),
    bottom: labelFontSize * 2.6,
  };
}

/** Value-axis ticks for the cartesian kinds. */
function valueTicks(kind: ChartKind, data: ChartData, input: ChartRenderInput): NiceTicks {
  let values: number[];
  if ((kind === 'bar' || kind === 'column') && input.stacked === true) {
    const extents = stackSeries(data.series).flat();
    values = extents.flatMap((e) => [e.y0, e.y1]);
  } else {
    values = data.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  }
  if (values.length === 0) values = [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  // Bars, columns, and areas measure from zero; lines/scatter may float.
  if (kind !== 'line' && kind !== 'scatter') {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  return niceTicks(min, max, 5);
}

// ============================================
// Shared axis painting
// ============================================

/** Horizontal gridlines + left tick labels for a vertical value axis. */
function paintValueAxisY(paint: Paint, scale: NiceTicks, yFor: (v: number) => number): Layer[] {
  const { frame, gridColor, axisTextColor, axisFontSize, bodyFont, input } = paint;
  const layers: Layer[] = [];
  scale.ticks.forEach((tick, index) => {
    const y = yFor(tick);
    layers.push({
      type: 'shape',
      id: `grid-${index}`,
      content: {
        shape: 'rect',
        fill: tick === 0 ? withAlpha(paint.context.theme.colors.text, 0.35) : gridColor,
      },
      position: {
        x: frame.plot.x,
        y: y - (tick === 0 ? 1 : 0.5),
        width: frame.plot.width,
        height: tick === 0 ? 2 : 1,
      },
    });
    layers.push({
      type: 'text',
      id: `tick-${index}`,
      content: {
        text: formatChartValue(tick, input.unit),
        style: {
          fontSize: axisFontSize,
          fontFamily: bodyFont,
          color: axisTextColor,
          textAlign: 'center',
        },
      },
      position: {
        x: frame.chartArea.x + (frame.plot.x - frame.chartArea.x) / 2,
        y,
        anchor: 'center',
      },
    });
  });
  return layers;
}

/** Category labels along the bottom of the plot (density-limited). */
function paintCategoryAxisX(paint: Paint, xForCenter: (index: number) => number): Layer[] {
  const { frame, data, labelFontSize, axisTextColor, bodyFont } = paint;
  const step = categoryLabelStep(data.labels.length, frame.plot.width, labelFontSize);
  const layers: Layer[] = [];
  data.labels.forEach((label, index) => {
    if (index % step !== 0 || !label) return;
    layers.push({
      type: 'text',
      id: `cat-${index}`,
      content: {
        text: label,
        style: {
          fontSize: labelFontSize,
          fontFamily: bodyFont,
          color: axisTextColor,
          textAlign: 'center',
        },
      },
      position: {
        x: xForCenter(index),
        y: frame.plot.y + frame.plot.height + labelFontSize * 1.2,
        anchor: 'center',
      },
    });
  });
  return layers;
}

// ============================================
// Mark builders
// ============================================

function paintColumns(paint: Paint): Layer[] {
  const { frame, data, colors, input, entrance } = paint;
  const scale = valueTicks('column', data, input);
  const yFor = (v: number): number =>
    frame.plot.y + frame.plot.height * (1 - (v - scale.niceMin) / (scale.niceMax - scale.niceMin));

  const layers: Layer[] = paintValueAxisY(paint, scale, yFor);
  const n = data.labels.length;
  const band = frame.plot.width / Math.max(1, n);
  const innerPad = band * 0.15;
  layers.push(...paintCategoryAxisX(paint, (i) => frame.plot.x + (i + 0.5) * band));

  const stacked = input.stacked === true && data.series.length > 1;
  const extents = stacked ? stackSeries(data.series) : null;
  const groupWidth = band - innerPad * 2;
  const barWidth = stacked
    ? groupWidth
    : Math.max(2, (groupWidth - 4 * (data.series.length - 1)) / data.series.length);

  data.series.forEach((series, s) => {
    series.values.forEach((value, i) => {
      if (i >= n) return;
      const extent = extents
        ? extents[s][i]
        : value === null
          ? null
          : { y0: Math.min(0, value), y1: Math.max(0, value) };
      if (!extent || extent.y0 === extent.y1) return;
      const top = yFor(extent.y1);
      const height = Math.max(1, yFor(extent.y0) - top);
      const x = stacked
        ? frame.plot.x + i * band + innerPad
        : frame.plot.x + i * band + innerPad + s * (barWidth + 4);
      layers.push({
        type: 'shape',
        id: `mark-${s}-${i}`,
        content: { shape: 'rect', fill: colors[s], borderRadius: stacked ? 0 : 3 },
        position: { x, y: top, width: barWidth, height },
        animation: entrance(i + s),
      });
      if (input.showValues === true && value !== null && !stacked) {
        layers.push(
          valueLabel(
            paint,
            `val-${s}-${i}`,
            value,
            x + barWidth / 2,
            value >= 0 ? top - paint.axisFontSize * 0.9 : top + height + paint.axisFontSize * 0.9,
          ),
        );
      }
    });
  });
  return layers;
}

function paintBars(paint: Paint): Layer[] {
  const {
    frame,
    data,
    colors,
    input,
    entrance,
    labelFontSize,
    axisFontSize,
    bodyFont,
    axisTextColor,
    gridColor,
  } = paint;
  const scale = valueTicks('bar', data, input);
  const xFor = (v: number): number =>
    frame.plot.x + frame.plot.width * ((v - scale.niceMin) / (scale.niceMax - scale.niceMin));

  const layers: Layer[] = [];
  // Vertical gridlines + value ticks along the bottom.
  scale.ticks.forEach((tick, index) => {
    const x = xFor(tick);
    layers.push({
      type: 'shape',
      id: `grid-${index}`,
      content: {
        shape: 'rect',
        fill: tick === 0 ? withAlpha(paint.context.theme.colors.text, 0.35) : gridColor,
      },
      position: {
        x: x - (tick === 0 ? 1 : 0.5),
        y: frame.plot.y,
        width: tick === 0 ? 2 : 1,
        height: frame.plot.height,
      },
    });
    layers.push({
      type: 'text',
      id: `tick-${index}`,
      content: {
        text: formatChartValue(tick, input.unit),
        style: {
          fontSize: axisFontSize,
          fontFamily: bodyFont,
          color: axisTextColor,
          textAlign: 'center',
        },
      },
      position: { x, y: frame.plot.y + frame.plot.height + axisFontSize * 1.2, anchor: 'center' },
    });
  });

  const n = data.labels.length;
  const band = frame.plot.height / Math.max(1, n);
  const innerPad = band * 0.15;
  const stacked = input.stacked === true && data.series.length > 1;
  const extents = stacked ? stackSeries(data.series) : null;
  const groupHeight = band - innerPad * 2;
  const barHeight = stacked
    ? groupHeight
    : Math.max(2, (groupHeight - 4 * (data.series.length - 1)) / data.series.length);

  // Category labels in the left gutter.
  data.labels.forEach((label, i) => {
    if (!label) return;
    layers.push({
      type: 'text',
      id: `cat-${i}`,
      content: {
        text: label,
        style: {
          fontSize: labelFontSize,
          fontFamily: bodyFont,
          color: axisTextColor,
          textAlign: 'center',
        },
      },
      position: {
        x: frame.chartArea.x + (frame.plot.x - frame.chartArea.x) / 2,
        y: frame.plot.y + (i + 0.5) * band,
        anchor: 'center',
      },
    });
  });

  data.series.forEach((series, s) => {
    series.values.forEach((value, i) => {
      if (i >= n) return;
      const extent = extents
        ? extents[s][i]
        : value === null
          ? null
          : { y0: Math.min(0, value), y1: Math.max(0, value) };
      if (!extent || extent.y0 === extent.y1) return;
      const left = xFor(extent.y0);
      const width = Math.max(1, xFor(extent.y1) - left);
      const y = stacked
        ? frame.plot.y + i * band + innerPad
        : frame.plot.y + i * band + innerPad + s * (barHeight + 4);
      layers.push({
        type: 'shape',
        id: `mark-${s}-${i}`,
        content: { shape: 'rect', fill: colors[s], borderRadius: stacked ? 0 : 3 },
        position: { x: left, y, width, height: barHeight },
        animation: entrance(i + s),
      });
      if (input.showValues === true && value !== null && !stacked) {
        const labelX = value >= 0 ? left + width + axisFontSize * 1.6 : left - axisFontSize * 1.6;
        layers.push(valueLabel(paint, `val-${s}-${i}`, value, labelX, y + barHeight / 2));
      }
    });
  });
  return layers;
}

function paintRadial(paint: Paint): Layer[] {
  const { kind, frame, data, colors, input, entrance, context } = paint;
  const slices = data.labels
    .map((label, index) => ({ label, value: data.series[0].values[index], index }))
    .filter(
      (s): s is { label: string; value: number; index: number } =>
        s.value !== null && Number.isFinite(s.value) && s.value > 0,
    );
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  const cx = frame.chartArea.x + frame.chartArea.width / 2;
  const cy = frame.chartArea.y + frame.chartArea.height / 2;
  const rOuter = Math.min(frame.chartArea.width, frame.chartArea.height) * 0.42;
  const rInner = kind === 'donut' ? rOuter * 0.55 : 0;

  const layers: Layer[] = [];
  let startDeg = 0;
  slices.forEach((slice, order) => {
    const sweep = (slice.value / total) * 360;
    layers.push({
      type: 'path',
      id: `mark-${slice.index}`,
      content: {
        d: arcPath(cx, cy, rOuter, rInner, startDeg, startDeg + sweep),
        fill: colors[slice.index % colors.length],
        stroke: context.theme.colors.background,
        strokeWidth: 2,
      },
      position: { x: cx - rOuter, y: cy - rOuter, width: rOuter * 2, height: rOuter * 2 },
      animation: entrance(order),
    });
    if (input.showValues === true && sweep >= 14) {
      const mid = startDeg + sweep / 2;
      const rad = ((mid - 90) * Math.PI) / 180;
      const rLabel = rInner > 0 ? (rInner + rOuter) / 2 : rOuter * 0.68;
      const pctText = `${Math.round((slice.value / total) * 100)}%`;
      layers.push({
        type: 'text',
        id: `val-${slice.index}`,
        content: {
          text: pctText,
          style: {
            fontSize: paint.axisFontSize,
            fontFamily: paint.bodyFont,
            fontWeight: 'bold',
            color: pickContrastingText(colors[slice.index % colors.length]),
            textAlign: 'center',
          },
        },
        position: {
          x: cx + rLabel * Math.cos(rad),
          y: cy + rLabel * Math.sin(rad),
          anchor: 'center',
        },
        animation: entrance(order),
      });
    }
    startDeg += sweep;
  });
  return layers;
}

function paintLines(paint: Paint): Layer[] {
  const { kind, frame, data, colors, input, entrance } = paint;
  const scale = valueTicks(kind, data, input);
  const yFor = (v: number): number =>
    frame.plot.y + frame.plot.height * (1 - (v - scale.niceMin) / (scale.niceMax - scale.niceMin));

  const n = data.labels.length;
  const band = frame.plot.width / Math.max(1, n);
  const xForCenter = (i: number): number => frame.plot.x + (i + 0.5) * band;

  const layers: Layer[] = paintValueAxisY(paint, scale, yFor);
  layers.push(...paintCategoryAxisX(paint, xForCenter));

  const baselineY = yFor(Math.max(scale.niceMin, Math.min(scale.niceMax, 0)));
  const showPoints = n <= 30;

  data.series.forEach((series, s) => {
    // Split into segments of consecutive non-null values (nulls are gaps).
    const segments: ChartPoint[][] = [];
    let current: ChartPoint[] = [];
    series.values.forEach((value, i) => {
      if (i >= n) return;
      if (value === null) {
        if (current.length > 0) segments.push(current);
        current = [];
        return;
      }
      current.push({ x: xForCenter(i), y: yFor(value) });
    });
    if (current.length > 0) segments.push(current);

    segments.forEach((segment, seg) => {
      if (kind === 'area' && segment.length > 1) {
        layers.push({
          type: 'path',
          id: `area-${s}-${seg}`,
          content: {
            d: areaPath(segment, baselineY),
            fill: colors[s],
            fillOpacity: 0.25,
            stroke: 'none',
            strokeWidth: 0,
          },
          position: {
            x: frame.plot.x,
            y: frame.plot.y,
            width: frame.plot.width,
            height: frame.plot.height,
          },
          animation: entrance(s),
        });
      }
      if (segment.length > 1) {
        layers.push({
          type: 'path',
          id: `line-${s}-${seg}`,
          content: { d: polylinePath(segment), stroke: colors[s], strokeWidth: 4, fill: 'none' },
          position: {
            x: frame.plot.x,
            y: frame.plot.y,
            width: frame.plot.width,
            height: frame.plot.height,
          },
          animation: entrance(s),
        });
      }
    });

    if (showPoints) {
      series.values.forEach((value, i) => {
        if (i >= n || value === null) return;
        const r = 5;
        layers.push({
          type: 'shape',
          id: `pt-${s}-${i}`,
          content: { shape: 'circle', fill: colors[s] },
          position: { x: xForCenter(i) - r, y: yFor(value) - r, width: r * 2, height: r * 2 },
          animation: entrance(s),
        });
        if (input.showValues === true) {
          layers.push(
            valueLabel(
              paint,
              `val-${s}-${i}`,
              value,
              xForCenter(i),
              yFor(value) - paint.axisFontSize,
            ),
          );
        }
      });
    }
  });
  return layers;
}

function paintScatter(paint: Paint): Layer[] {
  const { frame, data, colors, input, entrance } = paint;
  const scale = valueTicks('scatter', data, input);
  const yFor = (v: number): number =>
    frame.plot.y + frame.plot.height * (1 - (v - scale.niceMin) / (scale.niceMax - scale.niceMin));

  const layers: Layer[] = paintValueAxisY(paint, scale, yFor);

  // Numeric x when the label column is mostly numeric, else row index.
  const numericCount = data.labelNumbers.filter((v) => v !== null).length;
  const numericX = data.labels.length > 0 && numericCount / data.labels.length >= 0.6;

  let xFor: (rowIndex: number) => number | null;
  if (numericX) {
    const xs = data.labelNumbers.filter((v): v is number => v !== null);
    const xScale = niceTicks(Math.min(...xs), Math.max(...xs), 5);
    const span = xScale.niceMax - xScale.niceMin;
    xFor = (i) => {
      const v = data.labelNumbers[i];
      return v === null ? null : frame.plot.x + frame.plot.width * ((v - xScale.niceMin) / span);
    };
    // X ticks along the bottom.
    xScale.ticks.forEach((tick, index) => {
      const x = frame.plot.x + frame.plot.width * ((tick - xScale.niceMin) / span);
      layers.push({
        type: 'shape',
        id: `xgrid-${index}`,
        content: { shape: 'rect', fill: paint.gridColor },
        position: { x: x - 0.5, y: frame.plot.y, width: 1, height: frame.plot.height },
      });
      layers.push({
        type: 'text',
        id: `xtick-${index}`,
        content: {
          text: formatChartValue(tick),
          style: {
            fontSize: paint.axisFontSize,
            fontFamily: paint.bodyFont,
            color: paint.axisTextColor,
            textAlign: 'center',
          },
        },
        position: {
          x,
          y: frame.plot.y + frame.plot.height + paint.axisFontSize * 1.2,
          anchor: 'center',
        },
      });
    });
  } else {
    const band = frame.plot.width / Math.max(1, data.labels.length);
    xFor = (i) => frame.plot.x + (i + 0.5) * band;
    layers.push(...paintCategoryAxisX(paint, (i) => frame.plot.x + (i + 0.5) * band));
  }

  const r = 7;
  data.series.forEach((series, s) => {
    series.values.forEach((value, i) => {
      if (value === null) return;
      const x = xFor(i);
      if (x === null) return;
      layers.push({
        type: 'shape',
        id: `mark-${s}-${i}`,
        content: { shape: 'circle', fill: colors[s], fillOpacity: 0.85 },
        position: { x: x - r, y: yFor(value) - r, width: r * 2, height: r * 2 },
        animation: entrance(Math.floor(i / 3) + s),
      });
    });
  });
  return layers;
}

// ============================================
// Legend, value labels, table
// ============================================

function paintLegend(
  paint: Paint,
  legend: ReturnType<typeof layoutLegend>,
  band: PxRect,
  fontSize: number,
): Layer[] {
  const layers: Layer[] = [];
  legend.items.forEach((item, index) => {
    const color = paint.colors[item.index % paint.colors.length];
    const rowCenterY = band.y + item.y + legend.rowHeight / 2;
    layers.push({
      type: 'shape',
      id: `legend-swatch-${index}`,
      content: { shape: 'rect', fill: color, borderRadius: 3 },
      position: {
        x: band.x + item.x,
        y: rowCenterY - item.swatchSize / 2,
        width: item.swatchSize,
        height: item.swatchSize,
      },
    });
    layers.push({
      type: 'text',
      id: `legend-label-${index}`,
      content: {
        text: item.label,
        style: { fontSize, fontFamily: paint.bodyFont, color: paint.context.theme.colors.text },
      },
      position: {
        x: band.x + item.x + item.swatchSize + fontSize * 0.5,
        y: rowCenterY - fontSize * 0.62,
      },
    });
  });
  return layers;
}

function valueLabel(paint: Paint, id: string, value: number, x: number, y: number): Layer {
  return {
    type: 'text',
    id,
    content: {
      text: formatChartValue(value, paint.input.unit),
      style: {
        fontSize: paint.axisFontSize,
        fontFamily: paint.bodyFont,
        fontWeight: 'bold',
        color: paint.context.theme.colors.text,
        textAlign: 'center',
      },
    },
    position: { x, y, anchor: 'center' },
  };
}

function tableLayer(
  table: ResolvedTable,
  band: PxRect,
  fontSize: number,
  input: ChartRenderInput,
  context: TemplateContext,
): Layer {
  const { theme } = context;
  const colors = resolveColorScheme(context, input.colorScheme);
  return {
    type: 'table',
    id: 'table',
    content: {
      headers: table.headers,
      rows: table.rows,
      align: table.align,
      style: {
        headerBackground: colors.accent,
        headerColor: pickContrastingText(colors.accent),
        cellBackground: withAlpha(theme.colors.text, 0.04),
        cellColor: theme.colors.text,
        borderColor: withAlpha(theme.colors.text, 0.15),
        fontSize,
        fontFamily: getThemeFont(context, 'body'),
        headerFontFamily: getThemeFont(context, 'title'),
        borderRadius: 8,
      },
    },
    position: { x: band.x, y: band.y, width: band.width, height: band.height },
    animation: { type: 'fadeIn', duration: 1, delay: 0.4 },
  };
}

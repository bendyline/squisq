/**
 * Chart Templates
 *
 * Seven chart templates over one shared engine (`chart/render.ts`): the
 * block's markdown table becomes the chart's data, column-role params
 * (`labelColumn`, `valueColumns`) map columns to axes, and a block with
 * no chartable table renders as ordinary content instead.
 */

import type { Layer } from '../../schemas/Doc.js';
import type {
  AreaChartInput,
  BarChartInput,
  ColumnChartInput,
  DonutChartInput,
  LineChartInput,
  PieChartInput,
  ScatterChartInput,
  TemplateContext,
} from '../../schemas/BlockTemplates.js';
import { renderChart } from './chart/render.js';

export function barChart(input: BarChartInput, context: TemplateContext): Layer[] {
  return renderChart('bar', input, context);
}

export function columnChart(input: ColumnChartInput, context: TemplateContext): Layer[] {
  return renderChart('column', input, context);
}

export function pieChart(input: PieChartInput, context: TemplateContext): Layer[] {
  return renderChart('pie', input, context);
}

export function donutChart(input: DonutChartInput, context: TemplateContext): Layer[] {
  return renderChart('donut', input, context);
}

export function lineChart(input: LineChartInput, context: TemplateContext): Layer[] {
  return renderChart('line', input, context);
}

export function areaChart(input: AreaChartInput, context: TemplateContext): Layer[] {
  return renderChart('area', input, context);
}

export function scatterChart(input: ScatterChartInput, context: TemplateContext): Layer[] {
  return renderChart('scatter', input, context);
}

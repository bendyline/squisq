/** Chart engine public surface (used by the chart templates and tests). */

export * from './types.js';
export { parseCellNumber, isNumericColumn, resolveColumnRef, buildChartData } from './parse.js';
export { niceTicks, formatChartValue, type NiceTicks } from './scale.js';
export { arcPath, polylinePath, areaPath, pointOnCircle, type ChartPoint } from './geometry.js';
export {
  computeChartFrame,
  stackSeries,
  layoutLegend,
  categoryLabelStep,
  type ChartFrame,
  type PxRect,
  type StackedExtent,
  type LegendLayout,
  type LegendItemLayout,
} from './layout.js';
export { renderChart } from './render.js';

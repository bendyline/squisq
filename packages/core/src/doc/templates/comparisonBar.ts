/**
 * Comparison Bar Template
 *
 * Two horizontal bars showing relative numeric values side by side.
 * Bar widths are proportional to the values for immediate visual comparison.
 * Good for population, distance, or measurement comparisons.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { ComparisonBarInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { COLOR_SCHEMES, scaledFontSize } from '../../schemas/BlockTemplates.js';

export function comparisonBar(input: ComparisonBarInput, context: TemplateContext): Layer[] {
  const { leftLabel, leftValue, rightLabel, rightValue, unit, colorScheme = 'blue' } = input;
  const { theme } = context;
  const colors = COLOR_SCHEMES[colorScheme] ?? COLOR_SCHEMES.blue;

  const labelFontSize = scaledFontSize(28, context, false);
  const valueFontSize = scaledFontSize(48, context, true);

  // Calculate proportional bar widths (max bar = 65% of viewport width)
  const maxValue = Math.max(leftValue, rightValue, 1);
  const maxBarWidth = 65;
  const leftBarWidth = (leftValue / maxValue) * maxBarWidth;
  const rightBarWidth = (rightValue / maxValue) * maxBarWidth;

  // Bar positioning
  const barStartX = 15;
  const barHeight = 6; // % of viewport height
  const topBarY = 36;
  const bottomBarY = 58;

  // Format values for display
  const formatValue = (v: number): string => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`;
    return v.toLocaleString();
  };

  const leftDisplay = unit ? `${formatValue(leftValue)} ${unit}` : formatValue(leftValue);
  const rightDisplay = unit ? `${formatValue(rightValue)} ${unit}` : formatValue(rightValue);

  return [
    // Background
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `linear-gradient(180deg, ${theme.background} 0%, #0f1520 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },

    // Top bar label
    {
      type: 'text',
      id: 'left-label',
      content: {
        text: leftLabel,
        style: { fontSize: labelFontSize, color: theme.textMuted },
      },
      position: { x: `${barStartX}%`, y: `${topBarY - 8}%` },
    },

    // Top bar value
    {
      type: 'text',
      id: 'left-value',
      content: {
        text: leftDisplay,
        style: { fontSize: valueFontSize, fontWeight: 'bold', color: colors.text },
      },
      position: { x: `${barStartX + leftBarWidth + 2}%`, y: `${topBarY - 1}%` },
      animation: { type: 'fadeIn', duration: 0.8, delay: 0.3 },
    },

    // Top bar
    {
      type: 'shape',
      id: 'left-bar',
      content: {
        shape: 'rect',
        fill: colors.text,
        borderRadius: 4,
      },
      position: {
        x: `${barStartX}%`,
        y: `${topBarY}%`,
        width: `${leftBarWidth}%`,
        height: `${barHeight}%`,
      },
      animation: { type: 'fadeIn', duration: 1 },
    },

    // Bottom bar label
    {
      type: 'text',
      id: 'right-label',
      content: {
        text: rightLabel,
        style: { fontSize: labelFontSize, color: theme.textMuted },
      },
      position: { x: `${barStartX}%`, y: `${bottomBarY - 8}%` },
    },

    // Bottom bar value
    {
      type: 'text',
      id: 'right-value',
      content: {
        text: rightDisplay,
        style: { fontSize: valueFontSize, fontWeight: 'bold', color: colors.accent },
      },
      position: { x: `${barStartX + rightBarWidth + 2}%`, y: `${bottomBarY - 1}%` },
      animation: { type: 'fadeIn', duration: 0.8, delay: 0.6 },
    },

    // Bottom bar
    {
      type: 'shape',
      id: 'right-bar',
      content: {
        shape: 'rect',
        fill: colors.accent,
        borderRadius: 4,
      },
      position: {
        x: `${barStartX}%`,
        y: `${bottomBarY}%`,
        width: `${rightBarWidth}%`,
        height: `${barHeight}%`,
      },
      animation: { type: 'fadeIn', duration: 1, delay: 0.3 },
    },
  ];
}

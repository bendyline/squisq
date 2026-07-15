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
import {
  resolveColorScheme,
  getThemeFont,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';

export function comparisonBar(input: ComparisonBarInput, context: TemplateContext): Layer[] {
  const { leftLabel, rightLabel, unit, colorScheme = 'blue' } = input;
  const { theme, viewport } = context;
  const colors = resolveColorScheme(context, colorScheme);

  // Defensive: coerce non-finite values to 0. Callers should pass real numbers,
  // but a NaN would otherwise render as literal "NaN" text and collapse every
  // bar/label to a `NaN%` position, cramming the block against its left edge.
  const leftValue = Number.isFinite(input.leftValue) ? input.leftValue : 0;
  const rightValue = Number.isFinite(input.rightValue) ? input.rightValue : 0;

  const labelFontSize = themedFontSize(28, context, false);
  const valueFontSize = themedFontSize(48, context, true);

  // Format values for display
  const formatValue = (v: number): string => {
    if (!Number.isFinite(v)) return '—';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`;
    return v.toLocaleString();
  };

  const leftDisplay = unit ? `${formatValue(leftValue)} ${unit}` : formatValue(leftValue);
  const rightDisplay = unit ? `${formatValue(rightValue)} ${unit}` : formatValue(rightValue);

  // Bar positioning
  const barStartX = 15;
  const barHeight = 6; // % of viewport height
  const topBarY = 36;
  const bottomBarY = 58;

  // Bar GEOMETRY is driven by the non-negative part of each value. A bar has
  // no negative extent to draw: `width: '-32%'` is an invalid SVG rect that
  // renderers silently drop, and the trailing label — positioned relative to
  // the bar's end — lands at a negative x, off the left edge of the block.
  // A negative value therefore draws no bar; its label still reports the real
  // number, so the block stays honest rather than inventing a magnitude.
  const leftExtent = Math.max(0, leftValue);
  const rightExtent = Math.max(0, rightValue);

  // Calculate proportional bar widths. The widest bar must leave room
  // for its trailing value label inside a 96% safe area — otherwise a
  // long label ("84 clarity score") runs off the right edge of the block.
  const maxValue = Math.max(leftExtent, rightExtent, 1);
  const longestLabelPx = Math.max(leftDisplay.length, rightDisplay.length) * valueFontSize * 0.58;
  const labelWidthPct = (longestLabelPx / viewport.width) * 100;
  const maxBarWidth = Math.max(20, Math.min(65, 96 - barStartX - labelWidthPct - 2));
  const leftBarWidth = (leftExtent / maxValue) * maxBarWidth;
  const rightBarWidth = (rightExtent / maxValue) * maxBarWidth;

  return [
    // Background
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: themedSurfaceGradient(context, 180),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },

    // Top bar label
    {
      type: 'text',
      id: 'left-label',
      content: {
        text: leftLabel,
        style: {
          fontSize: labelFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
        },
      },
      position: { x: `${barStartX}%`, y: `${topBarY - 8}%` },
    },

    // Top bar value
    {
      type: 'text',
      id: 'left-value',
      content: {
        text: leftDisplay,
        style: {
          fontSize: valueFontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'bold',
          color: colors.text,
        },
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
        style: {
          fontSize: labelFontSize,
          fontFamily: getThemeFont(context, 'body'),
          color: theme.colors.textMuted,
        },
      },
      position: { x: `${barStartX}%`, y: `${bottomBarY - 8}%` },
    },

    // Bottom bar value
    {
      type: 'text',
      id: 'right-value',
      content: {
        text: rightDisplay,
        style: {
          fontSize: valueFontSize,
          fontFamily: getThemeFont(context, 'body'),
          fontWeight: 'bold',
          color: colors.accent,
        },
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

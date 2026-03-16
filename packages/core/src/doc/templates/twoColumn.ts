/**
 * Two Column Template
 *
 * Side-by-side comparison of two items.
 * Each column has a label and optional sublabel.
 * Adapts font sizes and positioning for different viewports.
 *
 * Portrait mode: Stacks columns vertically (top/bottom) instead of side-by-side.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { TwoColumnInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { resolveColorScheme } from '../utils/themeUtils.js';
import { getTwoColumnPositions } from '../../schemas/LayoutStrategy.js';

export function twoColumn(input: TwoColumnInput, context: TemplateContext): Layer[] {
  const { left, right, header, leftColor = 'green', rightColor = 'blue' } = input;

  // Guard: required fields may be absent when generated from sparse markdown
  if (!left?.label || !right?.label) return [];

  const { theme, layout, orientation } = context;
  const leftColors = resolveColorScheme(context, leftColor);
  const rightColors = resolveColorScheme(context, rightColor);

  // Get column positions based on orientation
  const positions = getTwoColumnPositions(orientation);
  const isStacked = layout.stackColumns;

  // Column width ~42% for side-by-side, ~85% for stacked
  const columnWidth = isStacked ? '85%' : '42%';

  // Calculate font sizes based on viewport
  const headerFontSize = scaledFontSize(32, context, false);
  const labelFontSize = scaledFontSize(44, context, true);
  const sublabelFontSize = scaledFontSize(22, context, false);

  const layers: Layer[] = [
    // Background — subtle gradient to add depth
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: `linear-gradient(135deg, ${theme.colors.background} 0%, #16202e 100%)`,
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  if (!isStacked) {
    // Left column background panel
    layers.push({
      type: 'shape',
      id: 'left-panel',
      content: {
        shape: 'rect',
        fill: 'rgba(255, 255, 255, 0.04)',
      },
      position: { x: '3%', y: '15%', width: '44%', height: '70%' },
    });

    // Right column background panel
    layers.push({
      type: 'shape',
      id: 'right-panel',
      content: {
        shape: 'rect',
        fill: 'rgba(255, 255, 255, 0.04)',
      },
      position: { x: '53%', y: '15%', width: '44%', height: '70%' },
    });
  }

  // Header position adjusts based on layout
  const headerY = isStacked ? '12%' : '22%';

  // Add header if provided
  if (header) {
    layers.push({
      type: 'text',
      id: 'header',
      content: {
        text: header,
        style: {
          fontSize: headerFontSize,
          color: theme.colors.textMuted,
          textAlign: 'center',
        },
      },
      position: { x: '50%', y: headerY, anchor: 'center' },
      animation: { type: 'fadeIn', duration: 0.8 },
    });
  }

  // Calculate Y positions based on layout mode and header presence
  let leftY: string;
  let leftSublabelY: string;
  let rightY: string;
  let rightSublabelY: string;

  if (isStacked) {
    // Portrait: stacked vertically
    leftY = header ? '30%' : '25%';
    leftSublabelY = header ? '40%' : '35%';
    rightY = header ? '60%' : '55%';
    rightSublabelY = header ? '70%' : '65%';
  } else {
    // Landscape/square: side by side — vertically centered in panels (15%-85%)
    const baseY = header ? '47%' : '45%';
    const sublabelOffset = header ? '58%' : '56%';
    leftY = baseY;
    leftSublabelY = sublabelOffset;
    rightY = baseY;
    rightSublabelY = sublabelOffset;
  }

  // Left column (or top in portrait)
  layers.push({
    type: 'text',
    id: 'left-label',
    content: {
      text: left.label,
      style: {
        fontSize: labelFontSize,
        fontWeight: 'bold',
        color: leftColors.text,
        textAlign: 'center',
        lineHeight: 1.3,
      },
    },
    position: {
      x: positions.left.x,
      y: leftY,
      anchor: 'center',
      width: columnWidth,
    },
    animation: { type: 'fadeIn', duration: 1 },
  });

  if (left.sublabel) {
    layers.push({
      type: 'text',
      id: 'left-sublabel',
      content: {
        text: left.sublabel,
        style: {
          fontSize: sublabelFontSize,
          color: theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: 1.4,
        },
      },
      position: {
        x: positions.left.x,
        y: leftSublabelY,
        anchor: 'center',
        width: columnWidth,
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 0.3 },
    });
  }

  // Visual connector between columns (bold arrow)
  const connectorFontSize = scaledFontSize(120, context, true);
  const connectorY = isStacked ? '48%' : '50%'; // Centered in viewport
  const connectorSymbol = isStacked ? '\u2193' : '\u2192'; // ↓ for stacked, → for side-by-side

  layers.push({
    type: 'text',
    id: 'connector',
    content: {
      text: connectorSymbol,
      style: {
        fontSize: connectorFontSize,
        fontWeight: 'bold',
        color: 'rgba(255, 255, 255, 0.6)',
        textAlign: 'center',
      },
    },
    position: {
      x: '50%',
      y: connectorY,
      anchor: 'center',
    },
    animation: { type: 'fadeIn', duration: 0.6, delay: 0.4 },
  });

  // Right column (or bottom in portrait)
  layers.push({
    type: 'text',
    id: 'right-label',
    content: {
      text: right.label,
      style: {
        fontSize: labelFontSize,
        fontWeight: 'bold',
        color: rightColors.text,
        textAlign: 'center',
        lineHeight: 1.3,
      },
    },
    position: {
      x: positions.right.x,
      y: rightY,
      anchor: 'center',
      width: columnWidth,
    },
    animation: { type: 'fadeIn', duration: 1, delay: 0.5 },
  });

  if (right.sublabel) {
    layers.push({
      type: 'text',
      id: 'right-sublabel',
      content: {
        text: right.sublabel,
        style: {
          fontSize: sublabelFontSize,
          color: theme.colors.textMuted,
          textAlign: 'center',
          lineHeight: 1.4,
        },
      },
      position: {
        x: positions.right.x,
        y: rightSublabelY,
        anchor: 'center',
        width: columnWidth,
      },
      animation: { type: 'fadeIn', duration: 0.8, delay: 0.8 },
    });
  }

  return layers;
}

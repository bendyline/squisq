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
import {
  resolveColorScheme,
  getThemeFont,
  themedEntrance,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';
import { withAlpha } from '../../schemas/colorUtils.js';
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

  // Calculate font sizes based on viewport. The header is the block's
  // title, so it sits a step ABOVE the column labels in the hierarchy —
  // it used to render smaller and dimmer than the labels, which read as
  // an inverted hierarchy.
  const headerFontSize = themedFontSize(36, context, true);
  const labelFontSize = themedFontSize(44, context, true);
  const sublabelFontSize = themedFontSize(22, context, false);

  // Panels drop below the header band so the title never overlaps them.
  const panelTop = header && !isStacked ? 22 : 15;
  const panelHeight = header && !isStacked ? 64 : 70;

  const layers: Layer[] = [
    // Background — subtle gradient to add depth
    {
      type: 'shape',
      id: 'bg',
      content: {
        shape: 'rect',
        fill: themedSurfaceGradient(context, 135),
      },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    },
  ];

  if (!isStacked) {
    // Column background panels — tinted from the theme text color so
    // they stay visible on light and dark surfaces alike.
    const panelFill = withAlpha(theme.colors.text, 0.05);
    layers.push({
      type: 'shape',
      id: 'left-panel',
      content: {
        shape: 'rect',
        fill: panelFill,
        borderRadius: 12,
      },
      position: { x: '3%', y: `${panelTop}%`, width: '44%', height: `${panelHeight}%` },
    });

    layers.push({
      type: 'shape',
      id: 'right-panel',
      content: {
        shape: 'rect',
        fill: panelFill,
        borderRadius: 12,
      },
      position: { x: '53%', y: `${panelTop}%`, width: '44%', height: `${panelHeight}%` },
    });
  }

  // Header position adjusts based on layout — always clear of the panels.
  const headerY = isStacked ? '8%' : '12%';

  // Add header if provided
  if (header) {
    layers.push({
      type: 'text',
      id: 'header',
      content: {
        text: header,
        style: {
          fontSize: headerFontSize,
          fontFamily: getThemeFont(context, 'title'),
          fontWeight: 'bold',
          color: theme.colors.text,
          textAlign: 'center',
        },
      },
      position: { x: '50%', y: headerY, anchor: 'center' },
      animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 0.8 }),
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
    // Landscape/square: side by side — vertically centered in the panels.
    const panelCenter = panelTop + panelHeight / 2;
    leftY = `${panelCenter - 4}%`;
    leftSublabelY = `${panelCenter + 7}%`;
    rightY = `${panelCenter - 4}%`;
    rightSublabelY = `${panelCenter + 7}%`;
  }

  // Left column (or top in portrait)
  layers.push({
    type: 'text',
    id: 'left-label',
    content: {
      text: left.label,
      style: {
        fontSize: labelFontSize,
        fontFamily: getThemeFont(context, 'body'),
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
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1 }),
  });

  if (left.sublabel) {
    layers.push({
      type: 'text',
      id: 'left-sublabel',
      content: {
        text: left.sublabel,
        style: {
          fontSize: sublabelFontSize,
          fontFamily: getThemeFont(context, 'body'),
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

  // Visual connector between columns — sized to fit inside the gutter
  // between the panels (a 120px glyph used to cross both panel edges),
  // tinted from the theme text color so it shows on any surface.
  const connectorFontSize = themedFontSize(64, context, true);
  const connectorY = isStacked ? '48%' : `${panelTop + panelHeight / 2}%`;
  const connectorSymbol = isStacked ? '\u2193' : '\u2192'; // ↓ for stacked, → for side-by-side

  layers.push({
    type: 'text',
    id: 'connector',
    content: {
      text: connectorSymbol,
      style: {
        fontSize: connectorFontSize,
        fontFamily: getThemeFont(context, 'title'),
        fontWeight: 'bold',
        color: withAlpha(theme.colors.text, 0.45),
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
        fontFamily: getThemeFont(context, 'body'),
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
    animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 1, delay: 0.5 }),
  });

  if (right.sublabel) {
    layers.push({
      type: 'text',
      id: 'right-sublabel',
      content: {
        text: right.sublabel,
        style: {
          fontSize: sublabelFontSize,
          fontFamily: getThemeFont(context, 'body'),
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

/**
 * Data Table Template
 *
 * Renders a themed table with header row and data rows.
 * Uses a TableLayer (foreignObject-based HTML table inside SVG)
 * for proper table layout within the viewport.
 *
 * Adapts font sizes for different viewports and uses theme colors
 * for header background, text, borders, and body cells.
 */

import type { Layer } from '../../schemas/Doc.js';
import type { DataTableInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import { scaledFontSize } from '../../schemas/BlockTemplates.js';
import { getThemeFont, resolveColorScheme } from '../utils/themeUtils.js';
import { createBackgroundLayer } from './captionUtils.js';

export function dataTable(input: DataTableInput, context: TemplateContext): Layer[] {
  const { title, headers, rows, align, colorScheme } = input;
  const { theme } = context;

  const colors = resolveColorScheme(context, colorScheme);
  const titleFontSize = scaledFontSize(48, context, true);
  const tableFontSize = scaledFontSize(28, context, false);

  const layers: Layer[] = [
    createBackgroundLayer(
      'bg',
      `linear-gradient(170deg, ${theme.colors.background} 0%, #0f1520 100%)`,
    ),
  ];

  // Optional title above the table
  if (title) {
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
          shadow: true,
        },
      },
      position: { x: '50%', y: '10%', width: '80%', anchor: 'center' },
      animation: { type: 'fadeIn', duration: 0.8 },
    });
  }

  // Table layer
  layers.push({
    type: 'table',
    id: 'table',
    content: {
      headers,
      rows,
      align,
      style: {
        headerBackground: colors.accent,
        headerColor: colors.text,
        cellBackground: 'rgba(255,255,255,0.05)',
        cellColor: theme.colors.text,
        borderColor: 'rgba(255,255,255,0.12)',
        fontSize: tableFontSize,
        fontFamily: getThemeFont(context, 'body'),
        headerFontFamily: getThemeFont(context, 'title'),
        borderRadius: 8,
      },
    },
    position: {
      x: '10%',
      y: title ? '18%' : '8%',
      width: '80%',
      height: title ? '74%' : '84%',
    },
    animation: { type: 'fadeIn', duration: 1, delay: title ? 0.4 : 0 },
  });

  return layers;
}

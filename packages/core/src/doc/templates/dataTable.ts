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
import {
  getThemeFont,
  resolveColorScheme,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';
import { pickContrastingText, withAlpha } from '../../schemas/colorUtils.js';
import { createBackgroundLayer } from './captionUtils.js';

/** Body rows the slide viewport is designed to show before scrolling. */
const MAX_VISIBLE_ROWS = 10;

export function dataTable(input: DataTableInput, context: TemplateContext): Layer[] {
  const { title, headers, rows, align, colorScheme } = input;
  const { theme, viewport } = context;

  // Data-backed blocks are materialized once before their sidecar preview has
  // resolved. Keep that intermediate render valid: the async projection will
  // replace these empty arrays with the bounded table window when it lands.
  const resolvedHeaders = Array.isArray(headers) ? headers : [];
  const resolvedRows = Array.isArray(rows) ? rows : [];

  const colors = resolveColorScheme(context, colorScheme);
  const titleFontSize = themedFontSize(48, context, true);
  const tableFontSize = themedFontSize(28, context, false);

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 170))];

  // Size the table band from its natural content height (header + rows at
  // ~2.4× line height for cell padding) and center the title+table as one
  // group — a full-height band left a ~200px orphan gap under the title.
  // `rows` is required by the schema but may be missing on partially-
  // authored blocks in live preview; treat it as empty rather than throwing.
  const rowCount = Math.max(
    1,
    Math.min(resolvedRows.length, MAX_VISIBLE_ROWS) + (resolvedHeaders.length > 0 ? 1 : 0),
  );
  const naturalTableHPct = Math.min(74, ((rowCount * tableFontSize * 2.4) / viewport.height) * 100);
  const titleBandPct = title ? (titleFontSize * 2.2 * 100) / viewport.height : 0;
  const groupTopPct = Math.max(8, (100 - titleBandPct - naturalTableHPct) / 2);

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
          shadow: shouldUseShadow(context),
        },
      },
      position: {
        x: '50%',
        y: `${groupTopPct + titleBandPct / 2}%`,
        width: '80%',
        anchor: 'center',
      },
      animation: { type: 'fadeIn', duration: 0.8 },
    });
  }

  // Table layer. Header text color is picked for contrast against the
  // header fill — pairing two mid-tones from the same scheme made the
  // header row read as a smudge in most themes.
  layers.push({
    type: 'table',
    id: 'table',
    content: {
      headers: resolvedHeaders,
      rows: resolvedRows,
      maxVisibleRows: MAX_VISIBLE_ROWS,
      align,
      style: {
        headerBackground: colors.accent,
        headerColor: pickContrastingText(colors.accent),
        cellBackground: withAlpha(theme.colors.text, 0.04),
        cellColor: theme.colors.text,
        borderColor: withAlpha(theme.colors.text, 0.15),
        fontSize: tableFontSize,
        fontFamily: getThemeFont(context, 'body'),
        headerFontFamily: getThemeFont(context, 'title'),
        borderRadius: 8,
      },
    },
    position: {
      x: '10%',
      y: `${groupTopPct + titleBandPct}%`,
      width: '80%',
      height: `${naturalTableHPct}%`,
    },
    animation: { type: 'fadeIn', duration: 1, delay: title ? 0.4 : 0 },
  });

  return layers;
}

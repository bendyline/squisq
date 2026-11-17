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
import { featureTableWidthEm, fitFeatureTable } from '../featureTable.js';

/** Body rows the slide viewport is designed to show before scrolling. */
const MAX_VISIBLE_ROWS = 10;
/** Share of the frame the table band may take. */
const MAX_TABLE_HEIGHT_PCT = 74;
/** Table width, as a share of the frame. */
const TABLE_WIDTH_PCT = 80;
/**
 * Smallest share of its themed size a too-wide table's type may shrink to
 * while its cells wrap. Below it the table keeps that size and scrolls.
 */
const MIN_WRAPPED_TYPE_SHARE = 0.6;

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
  let tableFontSize = themedFontSize(28, context, false);

  const layers: Layer[] = [createBackgroundLayer('bg', themedSurfaceGradient(context, 170))];

  // Size the table band from its natural content height (header + rows at
  // ~2.4× line height for cell padding) and center the title+table as one
  // group — a full-height band left a ~200px orphan gap under the title.
  // `rows` is required by the schema but may be missing on partially-
  // authored blocks in live preview; treat it as empty rather than throwing.
  const visibleRows = Math.min(resolvedRows.length, MAX_VISIBLE_ROWS);
  const hasHeader = resolvedHeaders.length > 0;
  const rowCount = Math.max(1, visibleRows + (hasHeader ? 1 : 0));
  // TableLayer's rules add to the row boxes: a 2px rule under the header, 1px
  // between body rows, and the 1px frame. Leaving them out overflowed the band
  // by a few pixels, which scrolled the table and clipped its last row. The
  // extra pixel absorbs sub-pixel row rounding.
  const ruleHeight = (hasHeader ? 2 : 0) + Math.max(0, visibleRows - 1) + 2 + 1;
  let naturalTableHPct = Math.min(
    MAX_TABLE_HEIGHT_PCT,
    ((rowCount * tableFontSize * 2.4 + ruleHeight) / viewport.height) * 100,
  );
  const titleBandPct = title ? (titleFontSize * 2.2 * 100) / viewport.height : 0;

  // A table wider than its box ran off the slide's right edge: one-line cells
  // in a sideways scroller, which a still slide, a video, or a phone in
  // portrait never shows. Such a table wraps its cells to the box instead, at
  // the largest type size (down to a readable floor) at which the visible
  // rows still fit the band.
  const tableWidthPx = (TABLE_WIDTH_PCT / 100) * viewport.width;
  const visibleTable = {
    headers: resolvedHeaders.map(String),
    rows: resolvedRows
      .slice(0, MAX_VISIBLE_ROWS)
      .map((row) => (Array.isArray(row) ? row.map(String) : [])),
  };
  let wrap = false;
  if (
    visibleTable.headers.length + visibleTable.rows.length > 0 &&
    featureTableWidthEm(visibleTable) * tableFontSize > tableWidthPx
  ) {
    const fit = fitFeatureTable(
      visibleTable,
      { width: tableWidthPx, height: (MAX_TABLE_HEIGHT_PCT / 100) * viewport.height },
      tableFontSize,
      Math.max(1, Math.round(tableFontSize * MIN_WRAPPED_TYPE_SHARE)),
    );
    wrap = true;
    tableFontSize = fit.fontSize;
    naturalTableHPct = Math.min(MAX_TABLE_HEIGHT_PCT, (fit.height / viewport.height) * 100);
  }
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
      ...(wrap ? { wrap } : {}),
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
      x: `${(100 - TABLE_WIDTH_PCT) / 2}%`,
      y: `${groupTopPct + titleBandPct}%`,
      width: `${TABLE_WIDTH_PCT}%`,
      height: `${naturalTableHPct}%`,
    },
    animation: { type: 'fadeIn', duration: 1, delay: title ? 0.4 : 0 },
  });

  return layers;
}

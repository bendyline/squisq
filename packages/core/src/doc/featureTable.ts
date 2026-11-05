/**
 * A body table shown as a summary slide's feature (`appendRichContentLayers`).
 * Unlike a `dataTable` slide, which scrolls a fixed window of rows, the whole
 * table must be readable in its box: cells wrap at their column widths and
 * keep their own line breaks, and one type size is chosen so every row fits.
 * The sizing estimates the browser's automatic table layout from character
 * counts, the same way the prose fitters estimate wrapped lines.
 */

import type { TableLayer } from '../schemas/Doc.js';
import type { TemplateContext } from '../schemas/BlockTemplates.js';
import type { ExtractedTableData } from './structuredData.js';
import type { LayerRect } from './richMediaLayout.js';
import { pickContrastingText, withAlpha } from '../schemas/colorUtils.js';
import { getThemeFont } from './utils/themeUtils.js';

/** Average advance of a body-face character, in em; bold headers run wider. */
const CHARACTER_EM = 0.55;
const HEADER_CHARACTER_EM = 0.6;
/** TableLayer pads each cell 0.75em at the sides and 0.6em above and below a 1.2em line. */
const CELL_SIDE_EM = 1.5;
const LINE_EM = 1.2;
const CELL_TOP_EM = 1.2;
/** Estimates are approximate; leave the renderer this share of the box. */
const SAFETY = 0.92;

interface Column {
  /** Longest unbreakable run, in em at 1px type. */
  word: number;
  /** Widest line as written, in em. */
  line: number;
}

function rowsOf(table: ExtractedTableData): Array<{ cells: string[]; em: number }> {
  return [
    ...(table.headers.length ? [{ cells: table.headers, em: HEADER_CHARACTER_EM }] : []),
    ...table.rows.map((cells) => ({ cells, em: CHARACTER_EM })),
  ];
}

function columns(table: ExtractedTableData): Column[] {
  const count = Math.max(1, ...rowsOf(table).map((row) => row.cells.length));
  return Array.from({ length: count }, (_, index) =>
    rowsOf(table).reduce<Column>(
      (column, row) => {
        const lines = (row.cells[index] ?? '').split('\n');
        const words = lines.flatMap((line) => line.split(/\s+/u));
        return {
          word: Math.max(column.word, ...words.map((word) => word.length * row.em)),
          line: Math.max(column.line, ...lines.map((line) => line.trim().length * row.em)),
        };
      },
      { word: 0, line: 0 },
    ),
  );
}

/** Column text widths (em) for `space` em of text: as written when they fit,
 * otherwise each column shrinks toward its longest word, in proportion. */
function columnWidths(cols: readonly Column[], space: number): number[] | null {
  const words = cols.reduce((sum, column) => sum + column.word, 0);
  const lines = cols.reduce((sum, column) => sum + column.line, 0);
  if (words > space) return null;
  if (lines <= space) return cols.map((column) => column.line);
  const share = (space - words) / Math.max(1e-6, lines - words);
  return cols.map((column) => column.word + (column.line - column.word) * share);
}

/** Height of the whole table, in em, with columns `widths` em wide. */
function tableHeight(table: ExtractedTableData, widths: readonly number[]): number {
  return rowsOf(table).reduce((height, row) => {
    const lines = Math.max(
      1,
      ...row.cells.map((cell, index) =>
        cell
          .split('\n')
          .reduce(
            (sum, line) =>
              sum + Math.max(1, Math.ceil((line.trim().length * row.em) / (widths[index] || 1))),
            0,
          ),
      ),
    );
    return height + lines * LINE_EM + CELL_TOP_EM;
  }, 0);
}

/** The table's shape set as written, without wrapping (width / height). */
export function featureTableAspect(table: ExtractedTableData): number {
  const cols = columns(table);
  const widths = cols.map((column) => column.line);
  const width = widths.reduce((sum, value) => sum + value + CELL_SIDE_EM, 0);
  return width / Math.max(1, tableHeight(table, widths));
}

/** The largest type size, in px, from `max` down to `min`, at which every row
 * fits `box`, and the height the table then needs (at most the box's). */
export function fitFeatureTable(
  table: ExtractedTableData,
  box: { width: number; height: number },
  max: number,
  min: number,
): { fontSize: number; height: number } {
  const cols = columns(table);
  const height = (size: number): number | null => {
    const widths = columnWidths(cols, (box.width * SAFETY) / size - cols.length * CELL_SIDE_EM);
    // Rules: the 1px frame and a 2px rule under the header.
    return widths ? tableHeight(table, widths) * size + 4 : null;
  };
  for (let size = Math.floor(max); size > min; size--) {
    const needed = height(size);
    if (needed !== null && needed <= box.height * SAFETY)
      return { fontSize: size, height: Math.min(box.height, needed / SAFETY) };
  }
  return { fontSize: min, height: box.height };
}

/** A themed table filling `rect`, its type sized so the whole table shows. */
export function featureTableLayer(
  id: string,
  table: ExtractedTableData,
  rect: LayerRect,
  context: TemplateContext,
): TableLayer {
  const { theme, viewport } = context;
  const unit = Math.min(viewport.width, viewport.height);
  // Edge-to-edge media bands suit pictures; a table keeps the slide's margins.
  const margin = unit * 0.045;
  const left = Math.max(rect.x, margin);
  const box = {
    x: left,
    y: rect.y,
    width: Math.min(rect.x + rect.width, viewport.width - margin) - left,
    height: Math.min(rect.y + rect.height, viewport.height - margin) - rect.y,
  };
  const { fontSize, height } = fitFeatureTable(table, box, unit * 0.03, Math.max(8, unit * 0.008));
  return {
    type: 'table',
    id,
    // As tall as its rows, centered in its box.
    position: { x: box.x, y: box.y + (box.height - height) / 2, width: box.width, height },
    content: {
      headers: table.headers,
      rows: table.rows,
      ...(table.align ? { align: table.align } : {}),
      wrap: true,
      style: {
        // The theme's own color: a summary slide has no color scheme to borrow.
        headerBackground: theme.colors.primary,
        headerColor: pickContrastingText(theme.colors.primary),
        cellBackground: withAlpha(theme.colors.text, 0.04),
        cellColor: theme.colors.text,
        borderColor: withAlpha(theme.colors.text, 0.15),
        fontSize,
        fontFamily: getThemeFont(context, 'body'),
        headerFontFamily: getThemeFont(context, 'title'),
        borderRadius: 8,
      },
    },
  };
}

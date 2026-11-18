/**
 * Native PowerPoint tables.
 *
 * The slideshow draws tables as tables: a `dataTable` slide's table layer,
 * and tables written in an ordinary slide's body (the content template's
 * rich text). The deck once wrote the first as a grid of separate text boxes
 * and flattened the second into lines of spaced words ("Item Cost Notes"),
 * so neither could be edited, resized or restyled as a table in PowerPoint.
 * Both now become one `a:tbl` graphic frame, styled the way the player draws
 * them, and a body that holds a table is split around it: the words above,
 * the table, the words below, stacked down the body's box.
 */

import type {
  TableLayer,
  TextLayer,
  TextParagraph,
  TextParagraphTable,
} from '@bendyline/squisq/schemas';
import { escapeXml } from '../ooxml/xmlUtils.js';
import { officeTypeface, parseCssColor, solidColorXml } from './drawingXml.js';
import type { ParsedColor } from './cssPaint.js';
import { resolveLayerRect, resolvePositionValue, toEmuRect, type LayerRect } from './geometry.js';
import { buildLayerTextShape } from './layerText.js';
import { DEFAULT_FONT } from './styles.js';
import { averageCharEm, estimateTextHeight, wrapByChars } from './textFit.js';

/** One canvas px is half a point: font sizes in hundredths of a point. */
const PX_TO_CENTIPOINTS = 50;
/** One canvas px in EMU, for borders and cell margins. */
const EMU_PER_PX = 12192000 / 1920;
/** The player draws a body's table at this fraction of the body's type size. */
const BODY_TABLE_EM = 0.76;
/** …with this space above and below it, in body ems (`margin: .35em 0`). */
const BODY_TABLE_GAP_EM = 0.35;
/** Smallest uniform shrink applied when a body with a table overflows its box. */
const MIN_FIT = 0.55;

export interface NativeTableStyle {
  /** Cell type size, canvas px. */
  fontSize: number;
  fontFamily?: string;
  headerFontFamily?: string;
  /** Cell text colour (CSS). */
  color: string;
  headerColor?: string;
  headerFill: ParsedColor | null;
  cellFill: ParsedColor | null;
  /** Fill of every second body row (the player's banding), if any. */
  evenRowFill: ParsedColor | null;
  border: ParsedColor | null;
  /** Border width, canvas px. */
  borderWidth: number;
  /** Cell padding, canvas px. */
  padX: number;
  padY: number;
  lineHeight: number;
  verticalAnchor: 't' | 'ctr';
}

function columnCount(table: TextParagraphTable): number {
  return Math.max(1, table.header.length, ...table.rows.map((row) => row.length));
}

/** Each row's height (canvas px) when the table is `width` wide. */
export function tableRowHeights(
  table: TextParagraphTable,
  style: NativeTableStyle,
  width: number,
): number[] {
  const columns = columnCount(table);
  const charPx =
    style.fontSize *
    averageCharEm({ fontSize: style.fontSize, fontFamily: style.fontFamily, color: style.color });
  const chars = Math.max(1, Math.floor((width / columns - style.padX * 2) / charPx));
  const lineHeight = style.fontSize * style.lineHeight;
  return [table.header, ...table.rows].map((row) => {
    const lines = Math.max(
      1,
      ...Array.from({ length: columns }, (_, index) =>
        (row[index] ?? '')
          .split('\n')
          .reduce((count, line) => count + wrapByChars(line, chars).length, 0),
      ),
    );
    return lines * lineHeight + style.padY * 2;
  });
}

function borderXml(tag: string, style: NativeTableStyle): string {
  if (!style.border || style.borderWidth <= 0) return `<a:${tag}><a:noFill/></a:${tag}>`;
  const width = Math.max(1, Math.round(style.borderWidth * EMU_PER_PX));
  return (
    `<a:${tag} w="${width}" cap="flat" cmpd="sng" algn="ctr">` +
    `${solidColorXml(style.border)}<a:prstDash val="solid"/></a:${tag}>`
  );
}

function cellXml(
  text: string,
  header: boolean,
  fill: ParsedColor | null,
  align: string | null | undefined,
  style: NativeTableStyle,
): string {
  const size = Math.max(100, Math.round(style.fontSize * PX_TO_CENTIPOINTS));
  const color = parseCssColor(header ? (style.headerColor ?? style.color) : style.color, '000000');
  const typeface = escapeXml(
    officeTypeface(
      header ? (style.headerFontFamily ?? style.fontFamily) : style.fontFamily,
      DEFAULT_FONT,
    ),
  );
  const algn = align === 'center' ? 'ctr' : align === 'right' ? 'r' : 'l';
  const runProps = `lang="en-US" sz="${size}"${header ? ' b="1"' : ''} dirty="0"`;
  const paragraphs = text
    .split('\n')
    .map(
      (line) =>
        `<a:p><a:pPr algn="${algn}"/>` +
        (line
          ? `<a:r><a:rPr ${runProps}>${solidColorXml(color)}<a:latin typeface="${typeface}"/>` +
            `</a:rPr><a:t>${escapeXml(line)}</a:t></a:r>`
          : '') +
        `<a:endParaRPr ${runProps}/></a:p>`,
    )
    .join('');
  const marX = Math.round(style.padX * EMU_PER_PX);
  const marY = Math.round(style.padY * EMU_PER_PX);
  // CT_TableCellProperties: the four edges, then the fill.
  return (
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</a:txBody>` +
    `<a:tcPr marL="${marX}" marR="${marX}" marT="${marY}" marB="${marY}" anchor="${style.verticalAnchor}">` +
    ['lnL', 'lnR', 'lnT', 'lnB'].map((tag) => borderXml(tag, style)).join('') +
    (fill ? solidColorXml(fill) : '<a:noFill/>') +
    `</a:tcPr></a:tc>`
  );
}

/**
 * One `p:graphicFrame` holding a native table: equal columns across `rect`,
 * rows `rowHeights` tall (canvas px), header row bold and tinted.
 */
export function nativeTableFrameXml(
  table: TextParagraphTable,
  style: NativeTableStyle,
  rect: LayerRect,
  rowHeights: readonly number[],
  shapeId: number,
  name: string,
): string {
  const columns = columnCount(table);
  const total = rowHeights.reduce((sum, height) => sum + height, 0);
  const area = toEmuRect({ ...rect, height: total });
  const columnWidth = Math.floor(area.width / columns);
  const grid = Array.from(
    { length: columns },
    (_, index) =>
      `<a:gridCol w="${index === columns - 1 ? area.width - columnWidth * (columns - 1) : columnWidth}"/>`,
  ).join('');
  const rows = [table.header, ...table.rows]
    .map((row, rowIndex) => {
      const header = rowIndex === 0;
      const fill = header
        ? style.headerFill
        : rowIndex % 2 === 0
          ? (style.evenRowFill ?? style.cellFill)
          : style.cellFill;
      const height = Math.max(1, Math.round((rowHeights[rowIndex] ?? 0) * EMU_PER_PX));
      const cells = Array.from({ length: columns }, (_, index) =>
        cellXml(row[index] ?? '', header, fill, table.align?.[index], style),
      ).join('');
      return `<a:tr h="${height}">${cells}</a:tr>`;
    })
    .join('');
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="${escapeXml(name)}"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/>` +
    `</p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${area.x}" y="${area.y}"/><a:ext cx="${area.width}" cy="${area.height}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr firstRow="1" bandRow="${style.evenRowFill ? 1 : 0}"/>` +
    `<a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

/** A `dataTable` slide's table layer as one native table filling its box. */
export function tableLayerXml(
  layer: TableLayer,
  table: TextParagraphTable,
  shapeId: number,
): string {
  const { style } = layer.content;
  const rect = resolveLayerRect(layer.position, 1920, 1080);
  const rowCount = table.rows.length + 1;
  const tableStyle: NativeTableStyle = {
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    headerFontFamily: style.headerFontFamily ?? style.fontFamily,
    color: style.cellColor,
    headerColor: style.headerColor,
    headerFill: style.headerBackground ? parseCssColor(style.headerBackground, 'FFFFFF') : null,
    cellFill: style.cellBackground ? parseCssColor(style.cellBackground, 'FFFFFF') : null,
    evenRowFill: null,
    border: style.borderColor ? parseCssColor(style.borderColor, '000000') : null,
    borderWidth: 1,
    padX: Math.max(4, style.fontSize * 0.25),
    padY: Math.max(4, style.fontSize * 0.25),
    lineHeight: 1.2,
    verticalAnchor: 'ctr',
  };
  // The player divides the layer's box among the rows; a row whose text
  // needs more room gets it.
  const needed = tableRowHeights(table, tableStyle, rect.width);
  const heights = needed.map((height) => Math.max(height, rect.height / rowCount));
  return nativeTableFrameXml(table, tableStyle, rect, heights, shapeId, layer.id);
}

/** Whether a text layer's body holds a table to write natively. */
export function hasTableParagraphs(layer: TextLayer): boolean {
  return layer.content.paragraphs?.some((paragraph) => paragraph.table) ?? false;
}

type Piece =
  { kind: 'text'; paragraphs: TextParagraph[] } | { kind: 'table'; table: TextParagraphTable };

/** The body cut at its tables, blank separator paragraphs trimmed from each run. */
function splitAtTables(paragraphs: readonly TextParagraph[]): Piece[] {
  const pieces: Piece[] = [];
  let run: TextParagraph[] = [];
  const flush = () => {
    while (run.length && !run[0]!.text.trim() && !run[0]!.list) run.shift();
    while (run.length && !run[run.length - 1]!.text.trim() && !run[run.length - 1]!.list) {
      run.pop();
    }
    if (run.length) pieces.push({ kind: 'text', paragraphs: run });
    run = [];
  };
  for (const paragraph of paragraphs) {
    if (paragraph.table) {
      flush();
      pieces.push({ kind: 'table', table: paragraph.table });
    } else {
      run.push(paragraph);
    }
  }
  flush();
  return pieces;
}

/** A paragraph's plain line, list marker and indent included (core's projection). */
function plainLine({ text, list }: TextParagraph): string {
  if (!list) return text;
  const marker =
    list.checked !== undefined
      ? list.checked
        ? '☑'
        : '☐'
      : list.ordered
        ? `${list.number ?? 1}.`
        : '•';
  return `${'  '.repeat(list.level)}${marker} ${text}`;
}

export interface TableBodyOptions {
  /** Canvas y the body must stop above (the next text below it), if any. */
  textBottom?: number;
  listIndentPx?: number;
  /** The slide's grow scale (see textFit.ts). */
  textScale: number;
  allocShapeId: () => number;
}

/**
 * A text layer whose body holds tables, as shapes: a text box for each run
 * of words and a native table for each table, stacked down the layer's box
 * in reading order. When the stack would overflow the box, everything
 * shrinks by one factor, as the player's fit would shrink the whole body.
 */
export function textLayerWithTablesXml(layer: TextLayer, options: TableBodyOptions): string[] {
  const pieces = splitAtTables(layer.content.paragraphs ?? []);
  const rect = resolveLayerRect(layer.position, 1920, 1);
  const boxHeight =
    layer.position.height != null
      ? resolvePositionValue(layer.position.height, 1080)
      : 1080 - rect.y;
  const bottom = Math.min(1060, options.textBottom ?? 1060, rect.y + boxHeight);
  const available = Math.max(1, bottom - rect.y);
  const base = layer.content.style;
  const color = parseCssColor(base.color, '000000');
  const tint = (alpha: number): ParsedColor => ({ hex: color.hex, alpha });

  const layout = (fit: number) => {
    const scale = options.textScale * fit;
    const bodySize = base.fontSize * scale;
    const tableSize = bodySize * BODY_TABLE_EM;
    const tableStyle: NativeTableStyle = {
      fontSize: tableSize,
      fontFamily: base.fontFamily,
      color: base.color,
      // The player: borders at 32% of the text colour, the header at 12%,
      // every second body row at 5%.
      headerFill: tint(12000),
      cellFill: null,
      evenRowFill: tint(5000),
      border: tint(32000),
      borderWidth: 1,
      padX: tableSize * 0.45,
      padY: tableSize * 0.28,
      lineHeight: 1.2,
      verticalAnchor: 't',
    };
    let y = rect.y;
    const placed: Array<
      | { kind: 'text'; layer: TextLayer; scale: number }
      | { kind: 'table'; table: TextParagraphTable; y: number; heights: number[] }
    > = [];
    pieces.forEach((piece, index) => {
      if (piece.kind === 'text') {
        const sub: TextLayer = {
          ...layer,
          id: `${layer.id}-text-${index}`,
          content: {
            text: piece.paragraphs.map(plainLine).join('\n'),
            ...(layer.content.html ? { html: layer.content.html } : {}),
            paragraphs: piece.paragraphs,
            style: base,
          },
          position: { x: rect.x, y, width: rect.width, height: 1, anchor: 'top-left' },
        };
        const height =
          estimateTextHeight(sub, scale, options.listIndentPx) +
          bodySize * 0.3; /* Office reserve */
        placed.push({
          kind: 'text',
          layer: { ...sub, position: { ...sub.position, height } },
          scale,
        });
        y += height;
      } else {
        y += bodySize * BODY_TABLE_GAP_EM;
        const heights = tableRowHeights(piece.table, tableStyle, rect.width);
        placed.push({ kind: 'table', table: piece.table, y, heights });
        y += heights.reduce((sum, height) => sum + height, 0) + bodySize * BODY_TABLE_GAP_EM;
      }
    });
    return { placed, used: y - rect.y, tableStyle };
  };

  let result = layout(1);
  if (result.used > available) {
    result = layout(Math.max(MIN_FIT, available / result.used));
  }
  return result.placed.map((item, index) =>
    item.kind === 'text'
      ? buildLayerTextShape(
          item.layer,
          options.allocShapeId(),
          bottom,
          options.listIndentPx,
          item.scale,
        )
      : nativeTableFrameXml(
          item.table,
          result.tableStyle,
          { x: rect.x, y: item.y, width: rect.width, height: 1 },
          item.heights,
          options.allocShapeId(),
          `${layer.id}-table-${index}`,
        ),
  );
}

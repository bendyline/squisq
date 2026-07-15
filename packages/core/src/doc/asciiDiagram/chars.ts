/**
 * Character classification for ASCII/Unicode box-and-line diagram art.
 *
 * The parse side accepts a superset (light/rounded/heavy/double Unicode
 * box-drawing plus ASCII `+ - |` and both arrow families); the render
 * side always emits one of the two `StyleVocab` tables below.
 *
 * Internal to the asciiDiagram module — not exported from the barrel.
 */

/**
 * THE GRID CELL UNIT: one Unicode CODE POINT = one grid cell.
 *
 * The parser builds its grid with `for (const ch of line)`, which iterates
 * code points, so the renderer MUST measure and index label text the same
 * way. Using `String.prototype.length` / `s[i]` (UTF-16 code units) instead
 * splits an astral-plane char (emoji) across two cells; the emitted line
 * then re-forms it as one code point and every column after it is off by
 * one in parse space, which desyncs the box borders and loses the box.
 *
 * Deliberate consequence: a char's cell count is its code-point count, NOT
 * its terminal display width. A CJK ideograph or an emoji occupies ONE cell
 * here but renders two columns wide in a monospace terminal, so such a box
 * looks ragged on screen even though it is internally consistent. Grid-cell
 * agreement between render and parse is the hard requirement (it is what
 * the fixpoint rests on); visual width is secondary and would break that
 * agreement unless the parser also measured width — which it cannot do
 * without guessing the viewer's font. The parser reports `wide-chars` so
 * callers can surface the caveat.
 */
export function toCells(s: string): string[] {
  return Array.from(s);
}

/** Grid cell count of a string (code points — see {@link toCells}). */
export function cellWidth(s: string): number {
  return toCells(s).length;
}

const TL_CORNERS = new Set(['┌', '╭', '┏', '╔']);
const TR_CORNERS = new Set(['┐', '╮', '┓', '╗']);
const BL_CORNERS = new Set(['└', '╰', '┗', '╚']);
const BR_CORNERS = new Set(['┘', '╯', '┛', '╝']);
const HORIZ = new Set(['─', '━', '═', '-']);
const VERT = new Set(['│', '┃', '║', '|']);
const JUNCTIONS = new Set([
  '├',
  '┤',
  '┬',
  '┴',
  '┼',
  '┣',
  '┫',
  '┳',
  '┻',
  '╋',
  '╠',
  '╣',
  '╦',
  '╩',
  '╬',
  '╞',
  '╡',
  '╥',
  '╨',
  '╫',
  '╪',
]);
/** Junctions whose stems include a vertical component (legal on side borders). */
const SIDE_JUNCTIONS = new Set(['├', '┤', '┼', '┣', '┫', '╋', '╠', '╣', '╬', '╞', '╡', '╫', '╪']);
/** Junctions whose stems include a horizontal component (legal on top/bottom borders). */
const FLAT_JUNCTIONS = new Set(['┬', '┴', '┼', '┳', '┻', '╋', '╦', '╩', '╬', '╥', '╨', '╫', '╪']);

const ARROW_UP = new Set(['▲', '↑']);
const ARROW_DOWN = new Set(['▼', '↓']);
const ARROW_LEFT = new Set(['◄', '←', '◀']);
const ARROW_RIGHT = new Set(['►', '→', '▶']);

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

export function isTlCorner(ch: string): boolean {
  return TL_CORNERS.has(ch);
}
export function isTrCorner(ch: string): boolean {
  return TR_CORNERS.has(ch);
}
export function isBlCorner(ch: string): boolean {
  return BL_CORNERS.has(ch);
}
export function isBrCorner(ch: string): boolean {
  return BR_CORNERS.has(ch);
}
export function isAnyCorner(ch: string): boolean {
  return TL_CORNERS.has(ch) || TR_CORNERS.has(ch) || BL_CORNERS.has(ch) || BR_CORNERS.has(ch);
}
export function isHoriz(ch: string): boolean {
  return HORIZ.has(ch);
}
export function isVert(ch: string): boolean {
  return VERT.has(ch);
}
export function isJunction(ch: string): boolean {
  return JUNCTIONS.has(ch);
}
export function isPlus(ch: string): boolean {
  return ch === '+';
}

/** Acceptable interior of a top/bottom border walk (corners excluded). */
export function isFlatBorderChar(ch: string): boolean {
  return isHoriz(ch) || FLAT_JUNCTIONS.has(ch) || isPlus(ch);
}

/** Acceptable interior of a left/right border walk (corners excluded). */
export function isSideBorderChar(ch: string): boolean {
  return isVert(ch) || SIDE_JUNCTIONS.has(ch) || isPlus(ch);
}

/**
 * Direction of an unconditional (Unicode) arrowhead, or null. ASCII
 * `^ v < >` are ambiguous with prose and must be gated on an adjacent
 * line character by the caller — use {@link asciiArrowDirection}.
 */
export function arrowDirection(ch: string): ArrowDirection | null {
  if (ARROW_UP.has(ch)) return 'up';
  if (ARROW_DOWN.has(ch)) return 'down';
  if (ARROW_LEFT.has(ch)) return 'left';
  if (ARROW_RIGHT.has(ch)) return 'right';
  return null;
}

/** Direction for ASCII arrow candidates (`^ v V < >`); caller applies the adjacency gate. */
export function asciiArrowDirection(ch: string): ArrowDirection | null {
  if (ch === '^') return 'up';
  if (ch === 'v' || ch === 'V') return 'down';
  if (ch === '<') return 'left';
  if (ch === '>') return 'right';
  return null;
}

/** True for any character that can be part of an edge polyline (lines, turns, junctions). */
export function isLineChar(ch: string): boolean {
  return isHoriz(ch) || isVert(ch) || isJunction(ch) || isPlus(ch) || isAnyCorner(ch);
}

/** True for structural Unicode box-drawing characters (used for the style vote). */
export function isUnicodeStructural(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  // Box Drawing block U+2500–U+257F plus the arrow glyphs we emit.
  return (
    (code >= 0x2500 && code <= 0x257f) ||
    ARROW_UP.has(ch) ||
    ARROW_DOWN.has(ch) ||
    ch === '←' ||
    ch === '→' ||
    ch === '◄' ||
    ch === '►' ||
    ch === '◀' ||
    ch === '▶'
  );
}

/** True for structural ASCII drawing characters (used for the style vote). */
export function isAsciiStructural(ch: string): boolean {
  return ch === '+' || ch === '-' || ch === '|';
}

export interface StyleVocab {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
  /** Horizontal border cell with a stem descending below it (e.g. a line leaving a bottom border). */
  stemDown: string;
  /** Horizontal border cell with a stem ascending above it (e.g. a line arriving at a top border). */
  stemUp: string;
  /** Vertical border cell with a stem extending leftward. */
  stemLeft: string;
  /** Vertical border cell with a stem extending rightward. */
  stemRight: string;
  cross: string;
  arrowUp: string;
  arrowDown: string;
  arrowLeft: string;
  arrowRight: string;
  /** Turn glyphs for routed edges: connects the two named directions. */
  turnDownRight: string;
  turnDownLeft: string;
  turnUpRight: string;
  turnUpLeft: string;
}

export const UNICODE_VOCAB: StyleVocab = {
  tl: '┌',
  tr: '┐',
  bl: '└',
  br: '┘',
  h: '─',
  v: '│',
  stemDown: '┬',
  stemUp: '┴',
  stemLeft: '┤',
  stemRight: '├',
  cross: '┼',
  arrowUp: '▲',
  arrowDown: '▼',
  arrowLeft: '◄',
  arrowRight: '►',
  // Named by the pair of open sides: e.g. turnDownRight opens downward and
  // to the right (a line coming from below turning to the right) = '┌'.
  turnDownRight: '┌',
  turnDownLeft: '┐',
  turnUpRight: '└',
  turnUpLeft: '┘',
};

export const ASCII_VOCAB: StyleVocab = {
  tl: '+',
  tr: '+',
  bl: '+',
  br: '+',
  h: '-',
  v: '|',
  stemDown: '+',
  stemUp: '+',
  stemLeft: '+',
  stemRight: '+',
  cross: '+',
  arrowUp: '^',
  arrowDown: 'v',
  arrowLeft: '<',
  arrowRight: '>',
  turnDownRight: '+',
  turnDownLeft: '+',
  turnUpRight: '+',
  turnUpLeft: '+',
};

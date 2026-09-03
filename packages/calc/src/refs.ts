/** A1 reference arithmetic shared by the lexer, parser, and evaluator. */

export const MAX_COL_INDEX = 16_383; // XFD
export const MAX_ROW_INDEX = 1_048_575;

export function columnIndexFromLetters(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export interface ParsedA1 {
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
}

const A1_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})$/;

/** `$B$4` → zero-based coordinates with absolute flags; null if not a ref. */
export function parseA1(text: string): ParsedA1 | null {
  const m = A1_RE.exec(text);
  if (!m) return null;
  const col = columnIndexFromLetters(m[2]!.toUpperCase());
  const row = Number.parseInt(m[4]!, 10) - 1;
  if (col > MAX_COL_INDEX || row < 0 || row > MAX_ROW_INDEX) return null;
  return { row, col, absCol: m[1] === '$', absRow: m[3] === '$' };
}

export function formatA1(row: number, col: number): string {
  return `${columnLetter(col)}${row + 1}`;
}

/** Text that could ONLY be a cell ref (used to tell refs from names). */
export function looksLikeA1(text: string): boolean {
  return parseA1(text) !== null;
}

const COL_ONLY_RE = /^(\$?)([A-Za-z]{1,3})$/;
const ROW_ONLY_RE = /^(\$?)([0-9]{1,7})$/;

/** `A` in a whole-column range `A:A`; null otherwise. */
export function parseColOnly(text: string): number | null {
  const m = COL_ONLY_RE.exec(text);
  if (!m) return null;
  const col = columnIndexFromLetters(m[2]!.toUpperCase());
  return col <= MAX_COL_INDEX ? col : null;
}

/** `3` in a whole-row range `3:5`; null otherwise. */
export function parseRowOnly(text: string): number | null {
  const m = ROW_ONLY_RE.exec(text);
  if (!m) return null;
  const row = Number.parseInt(m[2]!, 10) - 1;
  return row >= 0 && row <= MAX_ROW_INDEX ? row : null;
}

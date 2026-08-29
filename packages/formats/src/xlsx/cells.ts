/**
 * Shared SpreadsheetML cell model and A1-reference arithmetic.
 *
 * Import and export both need to move between a zero-based `(row, col)` grid
 * and Excel's `"B7"` addressing. That logic used to exist twice — `colIndex`
 * in `import.ts` and `columnLetter` in `export.ts` — as two halves of the same
 * bijection that never met. It lives here now, together with the richer cell
 * record the region splitter needs.
 *
 * {@link XlsxCell} carries three things the old plain-string grid could not:
 * the cell's *kind* (so a header row can be told apart from a data row, and so
 * export can safely re-emit a number as a number), and its *formula* (so a
 * round trip through markdown keeps `=B2*C2` rather than freezing the cached
 * result).
 */

/** Excel's last column, `XFD`, zero-based. */
export const MAX_COL_INDEX = 16_383;
/** Excel's last row, 1048576, zero-based. */
export const MAX_ROW_INDEX = 1_048_575;

/** What a cell holds, beyond its display text. */
export type XlsxCellKind = 'empty' | 'string' | 'number' | 'bool' | 'date' | 'error';

/** A single worksheet cell. */
export interface XlsxCell {
  /** Display text — exactly the string that goes into a markdown table cell. */
  text: string;
  /** What the cell holds. `empty` iff `text` is `''`. */
  kind: XlsxCellKind;
  /** Formula source WITHOUT the leading `=`, when the cell carries one. */
  formula?: string;
}

/** The empty cell. Shared because grids allocate a great many of them. */
export const EMPTY_CELL: Readonly<XlsxCell> = Object.freeze({ text: '', kind: 'empty' as const });

/**
 * Whether a cell holds anything at all.
 *
 * A formula with no cached result has empty text but is emphatically not an
 * empty cell — it must anchor a region like any other content.
 */
export function isOccupied(cell: XlsxCell): boolean {
  return cell.text !== '' || cell.formula !== undefined;
}

/** A zero-based, inclusive rectangle of cells. */
export interface CellRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Column letters for a zero-based index (0 → `"A"`, 26 → `"AA"`). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Zero-based column index for column letters (`"A"` → 0, `"AA"` → 26). */
export function columnIndexFromLetters(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Zero-based column index of a cell ref (`"B7"` → 1, `"AA1"` → 26).
 * Returns 0 for input with no leading letters — the historical behavior of
 * `import.ts`'s `colIndex`, which callers rely on to keep a malformed ref from
 * shifting the rest of the row.
 */
export function colIndex(ref: string): number {
  const m = /^\$?([A-Za-z]+)/.exec(ref);
  if (!m) return 0;
  return columnIndexFromLetters(m[1]!);
}

/** A parsed cell address. */
export interface ParsedCellRef {
  row: number;
  col: number;
}

/**
 * Parse a full cell ref into zero-based coordinates, rejecting anything that
 * is not a plain in-range A1 address. `$` anchors are accepted and ignored —
 * an anchor says how a ref behaves when copied, not where it points.
 *
 * Returns null for a malformed ref, a ref past `XFD1048576`, or a range.
 */
export function parseCellRef(ref: string): ParsedCellRef | null {
  const m = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})$/.exec(ref.trim());
  if (!m) return null;
  const col = columnIndexFromLetters(m[1]!);
  const row = Number.parseInt(m[2]!, 10) - 1;
  if (!Number.isFinite(row) || row < 0 || row > MAX_ROW_INDEX) return null;
  if (col < 0 || col > MAX_COL_INDEX) return null;
  return { row, col };
}

/** Format zero-based coordinates as a cell ref (`0, 1` → `"B1"`). */
export function formatCellRef(row: number, col: number): string {
  return `${columnLetter(col)}${row + 1}`;
}

/**
 * Parse a `"A1:D5"` range (or a bare `"A1"`) into a rectangle. Returns null
 * when either endpoint is malformed or out of range; endpoints given in any
 * corner order are normalized.
 */
export function parseRangeRef(ref: string): CellRect | null {
  const parts = ref.split(':');
  if (parts.length > 2) return null;
  const start = parseCellRef(parts[0] ?? '');
  if (!start) return null;
  const end = parts.length === 2 ? parseCellRef(parts[1]!) : start;
  if (!end) return null;
  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.col, end.col),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.col, end.col),
  };
}

// ============================================
// Shared-formula translation
// ============================================

/** Matches an A1 ref at a fixed position: `$?COL$?ROW`. */
const REF_AT = /(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})/y;

/** Characters that make a neighbouring token part of an identifier, not a ref. */
const IDENT_CHAR = /[A-Za-z0-9_.]/;

/**
 * Offset every *relative* A1 reference in a formula by `(dRow, dCol)`.
 *
 * This is what expands a shared formula: SpreadsheetML writes the text once on
 * the master cell (`<f t="shared" si="0" ref="D2:D10">B2*C2</f>`) and leaves
 * every follower an empty `<f t="shared" si="0"/>`, so a follower's real
 * formula only exists as "the master's, shifted". Excel computes that shift the
 * same way it does for a copy-paste: `$`-anchored parts hold, everything else
 * moves.
 *
 * Deliberately conservative about what counts as a reference:
 *   - text inside `"…"` string literals is copied verbatim (`"A1"` is a string);
 *   - `'Sheet Name'!` quoted prefixes are copied verbatim;
 *   - `Table[[#Headers],[Col]]` structured-reference brackets are copied
 *     verbatim, tracking nesting;
 *   - a candidate touching an identifier character on either side is not a ref
 *     (`my_A1`, `ATAN2(`);
 *   - a candidate immediately followed by `(` is a function name, not a ref —
 *     this is what keeps `LOG10(A1)` from being read as the cell `LOG10`;
 *   - a candidate whose column letters exceed `XFD` is not a ref.
 *
 * A reference shifted off the sheet becomes `#REF!`, matching Excel.
 * Sheet-qualified relative refs (`Sheet2!A1`) DO shift — relativity is a
 * property of the reference, not of which sheet it points at.
 */
export function translateFormula(text: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return text;

  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    // String literal — `""` is an escaped quote, not a terminator.
    if (ch === '"') {
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      out += text.slice(start, i);
      continue;
    }

    // Quoted sheet name — same escaping rule with `''`.
    if (ch === "'") {
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      out += text.slice(start, i);
      continue;
    }

    // Structured reference — brackets nest.
    if (ch === '[') {
      const start = i;
      let depth = 0;
      while (i < text.length) {
        if (text[i] === '[') depth++;
        else if (text[i] === ']') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      out += text.slice(start, i);
      continue;
    }

    REF_AT.lastIndex = i;
    const m = REF_AT.exec(text);
    if (m) {
      const before = i > 0 ? text[i - 1]! : '';
      const after = text[i + m[0].length] ?? '';
      const col = columnIndexFromLetters(m[2]!);
      const row = Number.parseInt(m[4]!, 10) - 1;
      const isRef =
        !IDENT_CHAR.test(before) &&
        !IDENT_CHAR.test(after) &&
        after !== '(' &&
        col <= MAX_COL_INDEX &&
        row >= 0 &&
        row <= MAX_ROW_INDEX;

      if (isRef) {
        const nextCol = m[1] === '$' ? col : col + dCol;
        const nextRow = m[3] === '$' ? row : row + dRow;
        if (nextCol < 0 || nextCol > MAX_COL_INDEX || nextRow < 0 || nextRow > MAX_ROW_INDEX) {
          out += '#REF!';
        } else {
          out += `${m[1]}${columnLetter(nextCol)}${m[3]}${nextRow + 1}`;
        }
        i += m[0].length;
        continue;
      }
    }

    out += ch;
    i++;
  }
  return out;
}

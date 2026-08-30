/**
 * XLSX → typed tables. Operates on literal grids, so nothing here touches XML;
 * the workbook-level entry point is covered by the round-trip suite.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_CELL, type XlsxCell } from '../xlsx/cells';
import {
  a1,
  cellValue,
  columnLetter,
  dominantKind,
  gridToTables,
  regionHasHeader,
} from '../xlsx/tables';

const str = (text: string): XlsxCell => ({ text, kind: 'string', value: text });
const num = (text: string, value: number): XlsxCell => ({ text, kind: 'number', value });
const date = (text: string, value: string): XlsxCell => ({ text, kind: 'date', value });
const bool = (value: boolean): XlsxCell => ({
  text: value ? 'TRUE' : 'FALSE',
  kind: 'bool',
  value,
});
const blank = (): XlsxCell => ({ ...EMPTY_CELL });

describe('cellValue', () => {
  it('returns the underlying value, not the rendering', () => {
    // The whole reason this module exists: a percent-formatted cell renders as
    // "15.0%" and is worth 0.15.
    expect(cellValue(num('15.0%', 0.15))).toBe(0.15);
    expect(cellValue(num('007', 7))).toBe(7);
    expect(cellValue(num('1,234.50', 1234.5))).toBe(1234.5);
    expect(cellValue(date('04/08/26', '2026-08-04'))).toBe('2026-08-04');
    expect(cellValue(bool(true))).toBe(true);
    expect(cellValue(str('North'))).toBe('North');
  });

  it('is null for a cell with nothing to store', () => {
    expect(cellValue(blank())).toBeNull();
    // An error is a condition, not a datum.
    expect(cellValue({ text: '#REF!', kind: 'error' })).toBeNull();
    // A formula whose result was never cached.
    expect(cellValue({ text: '', kind: 'empty', formula: 'B2*C2' })).toBeNull();
  });

  it('falls back to the text when a cell predates the value field', () => {
    expect(cellValue({ text: 'legacy', kind: 'string' })).toBe('legacy');
  });
});

describe('dominantKind', () => {
  it('needs a strict majority, because 50/50 really is mixed', () => {
    expect(dominantKind(['number', 'number', 'string'])).toBe('number');
    expect(dominantKind(['number', 'string'])).toBe('mixed');
    expect(dominantKind(['string', 'string', 'string'])).toBe('string');
  });

  it('ignores blanks, which every column has', () => {
    expect(dominantKind(['empty', 'number', 'empty', 'number'])).toBe('number');
    expect(dominantKind(['empty', 'empty'])).toBe('empty');
  });
});

describe('addressing', () => {
  it('matches the letters a user sees in Excel', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(a1(3, 1)).toBe('B4');
  });
});

describe('regionHasHeader', () => {
  it('reads a complete textual first row as a header', () => {
    expect(
      regionHasHeader([
        [str('Region'), str('Revenue')],
        [str('North'), num('1', 1)],
      ]),
    ).toBe(true);
  });

  it('does not, when the first row already carries data', () => {
    expect(
      regionHasHeader([
        [str('North'), num('1', 1)],
        [str('South'), num('2', 2)],
      ]),
    ).toBe(false);
    // One row cannot be both header and body.
    expect(regionHasHeader([[str('Region'), str('Revenue')]])).toBe(false);
  });
});

describe('gridToTables', () => {
  /**
   * A realistic sheet: a stray title, a captioned table, a blank gutter, and a
   * second table to the right — the shape region detection exists for.
   */
  const sheet: XlsxCell[][] = [
    [str('FY26 Planning'), blank(), blank(), blank(), blank(), blank()],
    [blank(), blank(), blank(), blank(), blank(), blank()],
    [blank(), str('Q3 Revenue'), blank(), blank(), blank(), blank()],
    [blank(), str('Region'), str('Share'), str('Closed'), blank(), str('Item')],
    [blank(), str('North'), num('15.0%', 0.15), bool(true), blank(), str('Widget')],
    [blank(), str('South'), num('9.5%', 0.095), bool(false), blank(), str('Gadget')],
  ];

  it('emits one table per island, with the caption as its title', () => {
    const tables = gridToTables('Sales', sheet);
    const titled = tables.find((t) => t.title === 'Q3 Revenue');
    expect(titled).toBeDefined();
    expect(titled?.sheet).toBe('Sales');
    expect(titled?.anchor).toBe('B4');
    expect(titled?.hasHeader).toBe(true);
    expect(titled?.columns.map((c) => c.name)).toEqual(['Region', 'Share', 'Closed']);
  });

  it('carries values, not renderings — the point of the whole module', () => {
    const table = gridToTables('Sales', sheet).find((t) => t.title === 'Q3 Revenue');
    expect(table?.rows).toEqual([
      ['North', 0.15, true],
      ['South', 0.095, false],
    ]);
    // Not '15.0%'. A consumer summing this column gets 0.245, not a parse error.
    expect(table?.rows.flat()).not.toContain('15.0%');
  });

  it('types each column from its body, not its header', () => {
    const table = gridToTables('Sales', sheet).find((t) => t.title === 'Q3 Revenue');
    expect(table?.columns.map((c) => c.kind)).toEqual(['string', 'number', 'bool']);
  });

  it('drops stray labels rather than inventing one-cell tables', () => {
    // 'FY26 Planning' is a note, not data; a table per stray would bury the
    // real ones.
    const tables = gridToTables('Sales', sheet);
    expect(tables.every((t) => t.rows.length > 0)).toBe(true);
    expect(tables.some((t) => t.rows.flat().includes('FY26 Planning'))).toBe(false);
  });

  it('names headerless columns by their real sheet letters', () => {
    const headerless: XlsxCell[][] = [
      [blank(), str('North'), num('1', 1)],
      [blank(), str('South'), num('2', 2)],
    ];
    const [table] = gridToTables('Raw', headerless);
    expect(table?.hasHeader).toBe(false);
    // B and C — what the user sees in Excel, not a synthetic col_0.
    expect(table?.columns.map((c) => c.name)).toEqual(['B', 'C']);
  });

  it('keeps every row the same width as its columns', () => {
    const ragged: XlsxCell[][] = [[str('a'), str('b'), str('c')], [str('1'), str('2')], [str('3')]];
    const [table] = gridToTables('Ragged', ragged);
    for (const row of table?.rows ?? []) expect(row).toHaveLength(table?.columns.length ?? 0);
    expect(table?.rows[1]).toEqual(['3', null, null]);
  });

  it('keeps a lone row rather than guessing it away, and lets a caller raise the bar', () => {
    const loneRow = [[str('Region'), str('Revenue')]];
    // One row cannot be both header and body, so it is read as data. That is
    // ambiguous — it may well be a stranded label — but emitting a small odd
    // table is recoverable and dropping a user's only row is not.
    const [kept] = gridToTables('Sheet', loneRow);
    expect(kept?.hasHeader).toBe(false);
    expect(kept?.rows).toEqual([['Region', 'Revenue']]);

    // A caller that would rather not see those raises the floor.
    expect(gridToTables('Sheet', loneRow, [], { minRows: 2 })).toEqual([]);
  });

  it('is empty for an empty sheet rather than throwing', () => {
    expect(gridToTables('Blank', [])).toEqual([]);
  });
});

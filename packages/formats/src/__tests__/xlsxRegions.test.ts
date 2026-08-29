/**
 * Tests for the pure XLSX pieces: A1 arithmetic + shared-formula translation
 * (cells.ts) and data-island segmentation (regions.ts). Both operate on literal
 * grids, so nothing here touches XML.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_CELL,
  columnLetter,
  colIndex,
  formatCellRef,
  parseCellRef,
  parseRangeRef,
  translateFormula,
  type XlsxCell,
} from '../xlsx/cells';
import { detectRegions, sliceRect } from '../xlsx/regions';

/** Build a grid from a text matrix; `''` is an empty cell. */
function grid(rows: string[][]): XlsxCell[][] {
  return rows.map((row) =>
    row.map((text): XlsxCell => (text === '' ? { ...EMPTY_CELL } : { text, kind: 'string' })),
  );
}

const texts = (cells: XlsxCell[][]): string[][] => cells.map((r) => r.map((c) => c.text));

describe('A1 arithmetic', () => {
  it('round-trips column letters past Z', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(16_383)).toBe('XFD');
    expect(colIndex('AA1')).toBe(26);
    expect(colIndex('XFD1048576')).toBe(16_383);
  });

  it('parses and formats cell refs, ignoring $ anchors', () => {
    expect(parseCellRef('B7')).toEqual({ row: 6, col: 1 });
    expect(parseCellRef('$B$7')).toEqual({ row: 6, col: 1 });
    expect(formatCellRef(6, 1)).toBe('B7');
  });

  it('rejects malformed and out-of-range refs', () => {
    expect(parseCellRef('7B')).toBeNull();
    expect(parseCellRef('B')).toBeNull();
    expect(parseCellRef('B0')).toBeNull();
    expect(parseCellRef('XFE1')).toBeNull();
    expect(parseCellRef('A1048577')).toBeNull();
    expect(parseCellRef('A1:B2')).toBeNull();
  });

  it('parses ranges and normalizes corner order', () => {
    expect(parseRangeRef('A1:D5')).toEqual({ top: 0, left: 0, bottom: 4, right: 3 });
    expect(parseRangeRef('D5:A1')).toEqual({ top: 0, left: 0, bottom: 4, right: 3 });
    expect(parseRangeRef('C3')).toEqual({ top: 2, left: 2, bottom: 2, right: 2 });
  });
});

describe('translateFormula', () => {
  it('shifts relative refs', () => {
    expect(translateFormula('B2*C2', 1, 0)).toBe('B3*C3');
    expect(translateFormula('SUM(A1:A5)', 0, 2)).toBe('SUM(C1:C5)');
  });

  it('holds $-anchored parts', () => {
    expect(translateFormula('$B$2*C2', 1, 0)).toBe('$B$2*C3');
    expect(translateFormula('$B2*B$2', 1, 1)).toBe('$B3*C$2');
  });

  it('is a no-op for a zero offset', () => {
    expect(translateFormula('B2*C2', 0, 0)).toBe('B2*C2');
  });

  it('does not mistake a function name for a reference', () => {
    expect(translateFormula('LOG10(A1)', 1, 0)).toBe('LOG10(A2)');
    expect(translateFormula('ATAN2(A1,B1)', 1, 0)).toBe('ATAN2(A2,B2)');
  });

  it('leaves string literals alone', () => {
    expect(translateFormula('IF(A1="A1","A1",B1)', 1, 0)).toBe('IF(A2="A1","A1",B2)');
    expect(translateFormula('"he said ""A1"""', 1, 0)).toBe('"he said ""A1"""');
  });

  it('leaves quoted sheet names alone but shifts what follows', () => {
    expect(translateFormula("'My Sheet'!A1", 2, 0)).toBe("'My Sheet'!A3");
    expect(translateFormula('Sheet2!A1', 2, 0)).toBe('Sheet2!A3');
  });

  it('leaves structured references alone', () => {
    expect(translateFormula('Table1[[#Headers],[A1]]+B2', 1, 0)).toBe('Table1[[#Headers],[A1]]+B3');
  });

  it('does not touch identifiers that merely contain a ref', () => {
    expect(translateFormula('my_A1+A1', 1, 0)).toBe('my_A1+A2');
  });

  it('emits #REF! when a shift leaves the sheet', () => {
    expect(translateFormula('A1', -1, 0)).toBe('#REF!');
    expect(translateFormula('SUM(A1:B1)', 0, -1)).toBe('SUM(#REF!:A1)');
  });
});

describe('detectRegions', () => {
  it('splits islands separated by a blank column', () => {
    const plan = detectRegions(
      grid([
        ['a', 'b', '', 'x', 'y'],
        ['1', '2', '', '3', '4'],
      ]),
    );
    expect(plan.regions.map((r) => r.rect)).toEqual([
      { top: 0, left: 0, bottom: 1, right: 1 },
      { top: 0, left: 3, bottom: 1, right: 4 },
    ]);
    expect(plan.strays).toEqual([]);
  });

  it('splits islands separated by a blank row', () => {
    const plan = detectRegions(
      grid([
        ['a', 'b'],
        ['1', '2'],
        ['', ''],
        ['x', 'y'],
        ['3', '4'],
      ]),
    );
    expect(plan.regions.map((r) => r.rect)).toEqual([
      { top: 0, left: 0, bottom: 1, right: 1 },
      { top: 3, left: 0, bottom: 4, right: 1 },
    ]);
  });

  it('keeps a table with an interior blank cell in one piece', () => {
    const plan = detectRegions(
      grid([
        ['a', 'b', 'c'],
        ['1', '', '3'],
        ['4', '5', '6'],
      ]),
    );
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]!.rect).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
  });

  it('rectangularizes an L-shaped island into one region', () => {
    const plan = detectRegions(
      grid([
        ['a', 'b', 'c'],
        ['1', '', ''],
        ['2', '', ''],
      ]),
    );
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]!.rect).toEqual({ top: 0, left: 0, bottom: 2, right: 2 });
  });

  it('absorbs a caption separated from its table by a blank row', () => {
    const plan = detectRegions(
      grid([
        ['Q3 Revenue', '', ''],
        ['', '', ''],
        ['Region', 'Revenue', 'Growth'],
        ['North', '1200', '12%'],
      ]),
    );
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]!.title).toBe('Q3 Revenue');
    expect(plan.regions[0]!.rect).toEqual({ top: 2, left: 0, bottom: 3, right: 2 });
  });

  it('peels a caption sitting directly on top of its table', () => {
    const plan = detectRegions(
      grid([
        ['Q3 Revenue', '', ''],
        ['Region', 'Revenue', 'Growth'],
        ['North', '1200', '12%'],
      ]),
    );
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]!.title).toBe('Q3 Revenue');
    expect(plan.regions[0]!.rect).toEqual({ top: 1, left: 0, bottom: 2, right: 2 });
  });

  it('absorbs a merged caption spanning the table width', () => {
    const cells = grid([
      ['Q3 Revenue', '', ''],
      ['', '', ''],
      ['Region', 'Revenue', 'Growth'],
      ['North', '1200', '12%'],
    ]);
    const plan = detectRegions(cells, [{ top: 0, left: 0, bottom: 0, right: 2 }]);
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]!.title).toBe('Q3 Revenue');
  });

  it('coalesces leftover single cells into strays', () => {
    const plan = detectRegions(
      grid([
        ['note', '', '', ''],
        ['', '', '', ''],
        ['', '', 'a', 'b'],
        ['', '', '1', '2'],
        ['', '', '', ''],
        ['draft', '', '', ''],
      ]),
    );
    expect(plan.regions).toHaveLength(1);
    expect(plan.strays.map((s) => [s.row, s.col, s.cell.text])).toEqual([
      [0, 0, 'note'],
      [5, 0, 'draft'],
    ]);
  });

  it('folds regions past the cap into the stray bucket and warns', () => {
    const rows: string[][] = [];
    for (let i = 0; i < 3; i++) {
      rows.push(['a', 'b'], ['1', '2'], ['', '']);
    }
    const plan = detectRegions(grid(rows), [], { maxRegionsPerSheet: 2 });
    expect(plan.regions).toHaveLength(2);
    expect(plan.strays).toHaveLength(4);
    expect(plan.warnings.join(' ')).toMatch(/3 data islands/);
  });

  it('declines and reports degraded past the candidate cap', () => {
    const rows: string[][] = [];
    for (let i = 0; i < 10; i++) rows.push(['x', '', 'y', '', 'z'], ['', '', '', '', '']);
    const plan = detectRegions(grid(rows), [], { maxRegionCandidates: 5 });
    expect(plan.degraded).toBe(true);
    expect(plan.regions).toEqual([]);
    expect(plan.warnings.join(' ')).toMatch(/single grid/);
  });

  it('returns nothing for an empty grid', () => {
    expect(detectRegions([])).toEqual({
      regions: [],
      strays: [],
      warnings: [],
      degraded: false,
    });
  });

  it('sliceRect pads short rows to the rectangle width', () => {
    const cells = grid([['a', 'b', 'c'], ['1']]);
    expect(texts(sliceRect(cells, { top: 0, left: 0, bottom: 1, right: 2 }, EMPTY_CELL))).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });
});

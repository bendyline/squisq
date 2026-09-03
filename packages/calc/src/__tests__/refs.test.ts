/**
 * A1 reference arithmetic at its own seam — the helpers every parser,
 * formatter, and graph query lean on.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_COL_INDEX,
  MAX_ROW_INDEX,
  columnIndexFromLetters,
  columnLetter,
  formatA1,
  looksLikeA1,
  parseA1,
  parseColOnly,
  parseRowOnly,
} from '../refs.js';

describe('column letters', () => {
  it('round-trips across the base-26 rollovers', () => {
    for (const [letters, index] of [
      ['A', 0],
      ['Z', 25],
      ['AA', 26],
      ['AZ', 51],
      ['BA', 52],
      ['ZZ', 701],
      ['AAA', 702],
      ['XFD', MAX_COL_INDEX],
    ] as const) {
      expect(columnIndexFromLetters(letters)).toBe(index);
      expect(columnLetter(index)).toBe(letters);
    }
  });
});

describe('parseA1 / formatA1', () => {
  it('parses plain and absolute forms', () => {
    expect(parseA1('B3')).toMatchObject({ row: 2, col: 1 });
    expect(parseA1('$B$3')).toMatchObject({ row: 2, col: 1, absCol: true, absRow: true });
    expect(parseA1('B$3')).toMatchObject({ absCol: false, absRow: true });
    expect(formatA1(2, 1)).toBe('B3');
    expect(formatA1(MAX_ROW_INDEX, MAX_COL_INDEX)).toBe(`XFD${MAX_ROW_INDEX + 1}`);
  });

  it('rejects non-references', () => {
    expect(parseA1('B')).toBeNull();
    expect(parseA1('3')).toBeNull();
    expect(parseA1('B3x')).toBeNull();
    expect(parseA1('')).toBeNull();
  });

  it('looksLikeA1 distinguishes refs from names', () => {
    expect(looksLikeA1('C10')).toBe(true);
    expect(looksLikeA1('$C$10')).toBe(true);
    expect(looksLikeA1('TAX')).toBe(false);
    expect(looksLikeA1('C10X')).toBe(false);
  });
});

describe('single-axis parsing (whole row/column ranges)', () => {
  it('parseColOnly and parseRowOnly', () => {
    expect(parseColOnly('A')).toBe(0);
    expect(parseColOnly('$AB')).toBe(27);
    expect(parseColOnly('A1')).toBeNull();
    expect(parseRowOnly('7')).toBe(6);
    expect(parseRowOnly('$12')).toBe(11);
    expect(parseRowOnly('7A')).toBeNull();
  });
});

/**
 * Value semantics: coercion, comparison ordering, criteria matching, and
 * the date-serial landmines (1900 leap bug, 1904 epoch, ISO round-trip).
 */

import { describe, expect, it } from 'vitest';
import {
  buildCriteria,
  compareValues,
  formatGeneral,
  numberFromText,
  toNumber,
  toText,
} from '../coerce.js';
import {
  datePartsFromSerial,
  isoFromSerial,
  serialFromDateParts,
  serialFromIso,
} from '../dates.js';
import { isCalcError } from '../errors.js';
import { formatNumberWithPattern } from '../numfmt.js';

describe('coercion', () => {
  it('coerces like Excel arithmetic', () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(true)).toBe(1);
    expect(toNumber('3.5')).toBe(3.5);
    expect(toNumber(' 20% ')).toBe(0.2);
    expect(isCalcError(toNumber('abc'))).toBe(true);
  });

  it('renders text like Excel concatenation', () => {
    expect(toText(null)).toBe('');
    expect(toText(true)).toBe('TRUE');
    expect(toText(0.1)).toBe('0.1');
    expect(formatGeneral(1 / 3)).toBe('0.333333333333333');
  });

  it('rejects thousand-separator text (Excel does not coerce "1,000")', () => {
    expect(numberFromText('1,000')).toBeNull();
  });
});

describe('comparison ordering', () => {
  it('orders number < text < logical', () => {
    expect(compareValues(1e9, 'a')).toBe(-1);
    expect(compareValues('zzz', false)).toBe(-1);
    expect(compareValues(false, true)).toBe(-1);
  });

  it('compares text case-insensitively', () => {
    expect(compareValues('West', 'west')).toBe(0);
  });

  it('coerces blank to the other side’s zero value', () => {
    expect(compareValues(null, 0)).toBe(0);
    expect(compareValues(null, '')).toBe(0);
    expect(compareValues(null, false)).toBe(0);
    expect(compareValues(null, 5)).toBe(-1);
  });
});

describe('criteria', () => {
  it('parses operator criteria and stays type-coherent', () => {
    const atLeastTen = buildCriteria('>=10');
    expect(atLeastTen(10)).toBe(true);
    expect(atLeastTen(9.5)).toBe(false);
    expect(atLeastTen('15')).toBe(false); // text never matches a numeric criterion
  });

  it('supports wildcards with ~ escapes', () => {
    const west = buildCriteria('West*');
    expect(west('Western')).toBe(true);
    expect(west('east')).toBe(false);
    const literalStar = buildCriteria('a~*b');
    expect(literalStar('a*b')).toBe(true);
    expect(literalStar('axb')).toBe(false);
  });

  it('handles <> with text and blanks', () => {
    const notDone = buildCriteria('<>done');
    expect(notDone('open')).toBe(true);
    expect(notDone('Done')).toBe(false);
    const nonBlank = buildCriteria('<>');
    expect(nonBlank(null)).toBe(false);
    expect(nonBlank('x')).toBe(true);
  });
});

describe('date serials', () => {
  it('reproduces the 1900 leap bug: serial 60 is the phantom Feb 29', () => {
    expect(datePartsFromSerial(60, false)).toEqual({ year: 1900, month: 2, day: 29 });
    expect(serialFromDateParts(1900, 2, 29, false)).toBe(60);
    // Real dates around it stay consistent.
    expect(serialFromDateParts(1900, 2, 28, false)).toBe(59);
    expect(serialFromDateParts(1900, 3, 1, false)).toBe(61);
  });

  it('round-trips modern dates through both epochs', () => {
    for (const date1904 of [false, true]) {
      const serial = serialFromDateParts(2026, 9, 1, date1904)!;
      expect(datePartsFromSerial(serial, date1904)).toEqual({ year: 2026, month: 9, day: 1 });
    }
    // Known anchor: 2020-01-01 is serial 43831 in the 1900 system.
    expect(serialFromDateParts(2020, 1, 1, false)).toBe(43_831);
  });

  it('round-trips ISO strings (the importer’s date-cell value shape)', () => {
    const serial = serialFromIso('2024-03-15', false)!;
    expect(isoFromSerial(serial, false)).toBe('2024-03-15');
    const withTime = serialFromIso('2024-03-15 13:30', false)!;
    expect(isoFromSerial(withTime, false)).toBe('2024-03-15 13:30');
  });
});

describe('number formatting (TEXT subset)', () => {
  it('formats digit patterns', () => {
    expect(formatNumberWithPattern(1234.5, '#,##0.00', false)).toBe('1,234.50');
    expect(formatNumberWithPattern(0.185, '0.0%', false)).toBe('18.5%');
    expect(formatNumberWithPattern(7, '000', false)).toBe('007');
  });

  it('formats date patterns', () => {
    const serial = serialFromDateParts(2024, 3, 5, false)!;
    expect(formatNumberWithPattern(serial, 'yyyy-mm-dd', false)).toBe('2024-03-05');
    expect(formatNumberWithPattern(serial, 'd mmm yyyy', false)).toBe('5 Mar 2024');
  });

  it('distinguishes month from minutes by hour adjacency', () => {
    const serial = serialFromIso('2024-03-05 09:07', false)!;
    expect(formatNumberWithPattern(serial, 'hh:mm', false)).toBe('09:07');
    expect(formatNumberWithPattern(serial, 'mm/dd', false)).toBe('03/05');
  });
});

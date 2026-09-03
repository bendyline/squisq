/**
 * `formatNumberWithPattern` — the TEXT() subset formatter, tested at its
 * own seam. Date-token parsing (am/pm, weekday/month names, m-vs-minutes
 * disambiguation), numeric patterns, multi-section handling, and the
 * honest-null contract for unsupported patterns.
 */

import { describe, expect, it } from 'vitest';
import { formatNumberWithPattern } from '../numfmt.js';
import { serialFromIso } from '../dates.js';

// 2026-03-05 14:07:09 — a Thursday.
const STAMP = serialFromIso('2026-03-05', false)! + (14 * 3600 + 7 * 60 + 9) / 86400;

const fmt = (value: number, pattern: string): string | null =>
  formatNumberWithPattern(value, pattern, false);

describe('date patterns', () => {
  it('core tokens', () => {
    expect(fmt(STAMP, 'yyyy-mm-dd')).toBe('2026-03-05');
    expect(fmt(STAMP, 'd/m/yy')).toBe('5/3/26');
    expect(fmt(STAMP, 'hh:mm:ss')).toBe('14:07:09');
  });

  it('m after an hour token means minutes', () => {
    expect(fmt(STAMP, 'h:mm')).toBe('14:07');
    expect(fmt(STAMP, 'mm')).toBe('03'); // no hour before it → month
  });

  it('am/pm switches to a 12-hour clock', () => {
    const morning = STAMP - 12 / 24; // 02:07:09
    expect(fmt(STAMP, 'h:mm AM/PM')).toMatch(/^2:07 PM$/i);
    expect(fmt(morning, 'h:mm AM/PM')).toMatch(/^2:07 AM$/i);
  });

  it('weekday and month names', () => {
    expect(fmt(STAMP, 'dddd')).toBe('Thursday');
    expect(fmt(STAMP, 'ddd')).toBe('Thu');
    expect(fmt(STAMP, 'mmmm yyyy')).toBe('March 2026');
    expect(fmt(STAMP, 'mmm')).toBe('Mar');
  });

  it('negative serials cannot be dates', () => {
    expect(fmt(-1, 'yyyy-mm-dd')).toBeNull();
  });
});

describe('numeric patterns', () => {
  it('decimals, thousands, percent', () => {
    expect(fmt(1234.5, '0.00')).toBe('1234.50');
    expect(fmt(1234567.891, '#,##0.0')).toBe('1,234,567.9');
    expect(fmt(0.125, '0.0%')).toBe('12.5%');
    expect(fmt(-42, '0')).toBe('-42');
  });

  it('quoted literals survive', () => {
    expect(fmt(5, '0" units"')).toBe('5 units');
  });

  it('multi-section formats use the first section', () => {
    expect(fmt(7, '0.0;(0.0);"zero"')).toBe('7.0');
  });

  it('General is a plain render', () => {
    expect(fmt(3.5, 'General')).toBe('3.5');
    expect(fmt(3.5, '')).toBe('3.5');
  });
});

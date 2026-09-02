/**
 * Function + operator semantics through `evaluateFormula` (values-context)
 * — the same path the cached-value oracle exercises. The seed grid is
 * small but deliberately mixed-type, because coercion boundaries are where
 * engines diverge from Excel.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createInHouseEngine } from '../engine.js';
import { isCalcError } from '../errors.js';
import type { CalcEngine, CalcValue } from '../types.js';

let engine: CalcEngine;

beforeAll(async () => {
  engine = createInHouseEngine({ now: () => new Date(2026, 8, 1, 12, 0, 0) });
  await engine.loadWorkbook({
    sheets: [
      {
        name: 'Data',
        cells: [
          // A          B            C
          [{ value: 10 }, { value: 'alpha' }, { value: -5 }],
          [{ value: 20 }, { value: 'beta' }, { value: '3' }],
          [{ value: 30 }, { value: 'gamma' }, { value: true }],
          [{ value: 40 }, { value: 'delta' }, { value: '' }],
          [{ value: 50 }, { value: 'West Region' }, null],
        ],
      },
      {
        name: 'Q3 Notes',
        cells: [[{ value: 'remote' }, { value: 99 }]],
      },
    ],
    definedNames: { TaxRate: '0.2' },
  });
});

const evalF = (formula: string, context?: { row?: number; col?: number }): CalcValue =>
  engine.evaluateFormula(formula, {
    sheet: 'Data',
    row: context?.row ?? 0,
    col: context?.col ?? 9,
  });

const errCode = (value: CalcValue): string | null => (isCalcError(value) ? value.code : null);

describe('operators + coercion', () => {
  it('coerces text and booleans in arithmetic', () => {
    expect(evalF('="3"+4')).toBe(7);
    expect(evalF('=TRUE+1')).toBe(2);
    expect(evalF('=C2*2')).toBe(6); // "3" in a cell coerces via the operator
    expect(errCode(evalF('="abc"+1'))).toBe('#VALUE!');
  });

  it('propagates and produces errors', () => {
    expect(errCode(evalF('=1/0'))).toBe('#DIV/0!');
    expect(errCode(evalF('=#REF!+1'))).toBe('#REF!');
    expect(errCode(evalF('=[1]Ext!A1'))).toBe('#REF!');
    expect(errCode(evalF('=NOSUCHFN(1)'))).toBe('#NAME?');
    expect(errCode(evalF('=UnknownName*2'))).toBe('#NAME?');
  });

  it('concatenates with General number rendering', () => {
    expect(evalF('="v"&0.5')).toBe('v0.5');
    expect(evalF('=A1&"-"&B1')).toBe('10-alpha');
  });

  it('compares with Excel type ordering and blank coercion', () => {
    expect(evalF('=1<"a"')).toBe(true); // number < text
    expect(evalF('="Z"<TRUE')).toBe(true); // text < logical
    expect(evalF('=C4=""')).toBe(true);
    expect(evalF('=C5=""')).toBe(true); // truly blank cell equals ""
    expect(evalF('="WEST region"=B5')).toBe(true); // case-insensitive
  });

  it('handles percent and the unary/^ precedence quirks', () => {
    expect(evalF('=50%')).toBe(0.5);
    expect(evalF('=-2^2')).toBe(4);
    expect(evalF('=2^-2')).toBe(0.25);
  });

  it('resolves defined names', () => {
    expect(evalF('=TaxRate*100')).toBeCloseTo(20);
  });

  it('reads across sheets, quoted names included', () => {
    expect(evalF("='Q3 Notes'!B1")).toBe(99);
  });
});

describe('implicit intersection', () => {
  it('intersects a column range with the formula’s own row', () => {
    expect(evalF('=A1:A5*2', { row: 2 })).toBe(60);
  });

  it('errors when the range does not span the formula position', () => {
    expect(errCode(evalF('=A1:A5*2', { row: 7 }))).toBe('#VALUE!');
  });
});

describe('aggregates', () => {
  it('SUM skips range text/logicals but coerces direct args', () => {
    expect(evalF('=SUM(A1:A5)')).toBe(150);
    expect(evalF('=SUM(C1:C4)')).toBe(-5); // "3", TRUE, "" don't count
    expect(evalF('=SUM("3",TRUE,4)')).toBe(8);
  });

  it('COUNT/COUNTA/COUNTBLANK follow the same range-vs-direct rules', () => {
    expect(evalF('=COUNT(A1:A5)')).toBe(5);
    expect(evalF('=COUNT(C1:C5)')).toBe(1);
    expect(evalF('=COUNT(TRUE,"7")')).toBe(2);
    expect(evalF('=COUNTA(C1:C5)')).toBe(4);
    expect(evalF('=COUNTBLANK(C1:C5)')).toBe(2); // "" counts as blank, plus the empty cell
  });

  it('COUNTIF/SUMIF with operator + wildcard criteria', () => {
    expect(evalF('=COUNTIF(A1:A5,">=30")')).toBe(3);
    expect(evalF('=COUNTIF(B1:B5,"*a")')).toBe(4); // alpha, beta, gamma, delta
    expect(evalF('=SUMIF(A1:A5,">20")')).toBe(120);
    expect(evalF('=SUMIF(B1:B5,"West*",A1:A5)')).toBe(50);
  });

  it('AVERAGE/MIN/MAX/SUBTOTAL', () => {
    expect(evalF('=AVERAGE(A1:A5)')).toBe(30);
    expect(evalF('=MIN(A1:A5)')).toBe(10);
    expect(evalF('=MAX(A1:A5)')).toBe(50);
    expect(evalF('=SUBTOTAL(9,A1:A5)')).toBe(150);
    expect(evalF('=SUBTOTAL(109,A1:A5)')).toBe(150);
    expect(evalF('=SUBTOTAL(1,A1:A5)')).toBe(30);
    expect(errCode(evalF('=SUBTOTAL(12,A1:A5)'))).toBe('#VALUE!');
  });

  it('SUBTOTAL 103/102 count by type over the range', () => {
    expect(evalF('=SUBTOTAL(103,B1:B5)')).toBe(5); // COUNTA
    expect(evalF('=SUBTOTAL(103,C1:C5)')).toBe(4);
    expect(evalF('=SUBTOTAL(2,C1:C5)')).toBe(1); // COUNT: only the -5
  });

  it('a bare reference to an empty cell yields 0 at the top level', () => {
    expect(evalF('=C5')).toBe(0);
    expect(evalF('=IF(TRUE,C5)')).toBe(0);
    // …but inner blank semantics are untouched.
    expect(evalF('=ISBLANK(C5)')).toBe(true);
    expect(evalF('=C5=""')).toBe(true);
  });

  it('rounds half away from zero', () => {
    expect(evalF('=ROUND(2.5,0)')).toBe(3);
    expect(evalF('=ROUND(-2.5,0)')).toBe(-3);
    expect(evalF('=ROUND(1.005,2)')).toBe(1.01);
    expect(evalF('=ROUNDDOWN(1.999,1)')).toBe(1.9);
    expect(evalF('=MOD(-3,2)')).toBe(1); // sign of the divisor
  });
});

describe('logical', () => {
  it('IF is lazy in the untaken branch', () => {
    expect(evalF('=IF(TRUE,1,1/0)')).toBe(1);
    expect(evalF('=IF(A1>5,"big","small")')).toBe('big');
    expect(evalF('=IF(FALSE,1)')).toBe(false);
  });

  it('IFERROR/IFNA observe errors without becoming them', () => {
    expect(evalF('=IFERROR(1/0,"fallback")')).toBe('fallback');
    expect(evalF('=IFERROR(7,"fallback")')).toBe(7);
    expect(evalF('=IFNA(#N/A,"na")')).toBe('na');
    expect(errCode(evalF('=IFNA(#REF!,"na")'))).toBe('#REF!');
  });

  it('AND/OR ignore range text but use range numbers', () => {
    expect(evalF('=AND(A1:A5)')).toBe(true);
    expect(evalF('=OR(FALSE,0,1)')).toBe(true);
    expect(errCode(evalF('=AND(B1:B4)'))).toBe('#VALUE!'); // nothing logical at all
  });
});

describe('lookup — the corpus core', () => {
  it('MATCH exact, approximate, and descending', () => {
    expect(evalF('=MATCH(30,A1:A5,0)')).toBe(3);
    expect(evalF('=MATCH(35,A1:A5,1)')).toBe(3); // last ≤ 35
    expect(evalF('=MATCH(35,A1:A5)')).toBe(3); // type defaults to 1
    expect(errCode(evalF('=MATCH(5,A1:A5,1)'))).toBe('#N/A');
    expect(evalF('=MATCH("gam*",B1:B5,0)')).toBe(3);
    expect(errCode(evalF('=MATCH("30",A1:A5,0)'))).toBe('#N/A'); // text never matches numbers
  });

  it('INDEX addresses cells, rows, and columns', () => {
    expect(evalF('=INDEX(A1:B5,2,2)')).toBe('beta');
    expect(evalF('=INDEX(A1:A5,4)')).toBe(40);
    expect(evalF('=INDEX(A1:B1,2)')).toBe('alpha'); // one-row range walks columns
    expect(evalF('=SUM(INDEX(A1:B5,0,1))')).toBe(150); // col 1 as a range
    expect(errCode(evalF('=INDEX(A1:A5,9)'))).toBe('#REF!');
    expect(evalF('=INDEX(A1:B5,5,1)')).toBe(50);
  });

  it('INDEX/MATCH over whole columns — the dominant real-world shape', () => {
    expect(evalF('=INDEX(B:B,MATCH(30,A:A,0))')).toBe('gamma');
    expect(errCode(evalF('=INDEX(B:B,MATCH(31,A:A,0))'))).toBe('#N/A');
  });

  it('VLOOKUP exact and approximate with type coherence', () => {
    expect(evalF('=VLOOKUP(20,A1:B5,2,FALSE)')).toBe('beta');
    expect(evalF('=VLOOKUP(25,A1:B5,2)')).toBe('beta'); // approximate: last ≤
    expect(evalF('=VLOOKUP(25,A1:B5,2,TRUE)')).toBe('beta');
    expect(errCode(evalF('=VLOOKUP("20",A1:B5,2,FALSE)'))).toBe('#N/A');
    expect(errCode(evalF('=VLOOKUP(20,A1:B5,3,FALSE)'))).toBe('#REF!');
    expect(errCode(evalF('=VLOOKUP(20,A1:B5,0,FALSE)'))).toBe('#VALUE!');
  });

  it('CHOOSE evaluates only the chosen branch', () => {
    expect(evalF('=CHOOSE(2,"a","b","c")')).toBe('b');
    expect(evalF('=CHOOSE(1,7,1/0)')).toBe(7);
  });

  it('OFFSET and INDIRECT produce live references', () => {
    expect(evalF('=OFFSET(A1,2,1)')).toBe('gamma');
    expect(evalF('=SUM(OFFSET(A1,0,0,3,1))')).toBe(60);
    expect(evalF('=INDIRECT("B3")')).toBe('gamma');
    expect(evalF('=INDIRECT("A"&2)')).toBe(20);
    expect(errCode(evalF('=INDIRECT("nope!!")'))).toBe('#REF!');
  });

  it('ROW/COLUMN read the argument or the formula position', () => {
    expect(evalF('=ROW(B7)')).toBe(7);
    expect(evalF('=COLUMN(C1)')).toBe(3);
    expect(evalF('=ROW()', { row: 4 })).toBe(5);
    expect(evalF('=ROWS(A1:A5)')).toBe(5);
    expect(evalF('=COLUMNS(A:C)')).toBe(3);
  });

  it('HYPERLINK yields the friendly name as the value', () => {
    expect(evalF('=HYPERLINK("https://example.com","Site")')).toBe('Site');
    expect(evalF('=HYPERLINK("https://example.com")')).toBe('https://example.com');
  });

  it('XLOOKUP exact with if_not_found', () => {
    expect(evalF('=XLOOKUP(30,A1:A5,B1:B5)')).toBe('gamma');
    expect(evalF('=XLOOKUP(31,A1:A5,B1:B5,"none")')).toBe('none');
    expect(evalF('=XLOOKUP(31,A1:A5,B1:B5,,-1)')).toBe('gamma'); // next smaller
  });
});

describe('text functions', () => {
  it('slicing + searching', () => {
    expect(evalF('=LEFT("squisq",3)')).toBe('squ');
    expect(evalF('=RIGHT("squisq",2)')).toBe('sq');
    expect(evalF('=MID("squisq",3,2)')).toBe('ui');
    expect(evalF('=LEN(B1)')).toBe(5);
    expect(evalF('=FIND("i","squisq")')).toBe(4);
    expect(errCode(evalF('=FIND("I","squisq")'))).toBe('#VALUE!'); // case-sensitive
    expect(evalF('=SEARCH("I","squisq")')).toBe(4); // case-insensitive
    expect(evalF('=SEARCH("q?i","squisq")')).toBe(2); // wildcards
  });

  it('TRIM collapses interior runs, SUBSTITUTE targets instances', () => {
    expect(evalF('=TRIM("  a   b  ")')).toBe('a b');
    expect(evalF('=SUBSTITUTE("a-b-c","-","+")')).toBe('a+b+c');
    expect(evalF('=SUBSTITUTE("a-b-c","-","+",2)')).toBe('a-b+c');
  });

  it('TEXT applies the format subset', () => {
    expect(evalF('=TEXT(1234.5,"#,##0.00")')).toBe('1,234.50');
    expect(evalF('=TEXT(0.25,"0%")')).toBe('25%');
  });
});

describe('info + dates', () => {
  it('IS* functions observe without erroring', () => {
    expect(evalF('=ISBLANK(C5)')).toBe(true);
    expect(evalF('=ISBLANK(C4)')).toBe(false); // "" is not blank
    expect(evalF('=ISNUMBER(A1)')).toBe(true);
    expect(evalF('=ISNUMBER(C2)')).toBe(false); // "3" is text
    expect(evalF('=ISERROR(1/0)')).toBe(true);
    expect(evalF('=ISNA(#N/A)')).toBe(true);
    expect(evalF('=ISNA(#REF!)')).toBe(false);
  });

  it('DATE/YEAR/MONTH/DAY with the 1900 leap bug', () => {
    expect(evalF('=DATE(2020,1,1)')).toBe(43_831);
    expect(evalF('=YEAR(DATE(2024,7,15))')).toBe(2024);
    expect(evalF('=MONTH(DATE(2024,7,15))')).toBe(7);
    expect(evalF('=DAY(DATE(2024,7,15))')).toBe(15);
    expect(evalF('=DATE(1900,2,29)')).toBe(60);
    expect(evalF('=DATE(2020,14,1)')).toBe(evalF('=DATE(2021,2,1)')); // month overflow
  });

  it('TODAY/NOW use the injected clock', () => {
    expect(evalF('=YEAR(TODAY())')).toBe(2026);
    expect(evalF('=HOUR(NOW())')).toBe(12);
  });

  it('EOMONTH/EDATE month math', () => {
    expect(evalF('=EOMONTH(DATE(2024,1,15),0)')).toBe(evalF('=DATE(2024,1,31)'));
    expect(evalF('=EDATE(DATE(2024,1,31),1)')).toBe(evalF('=DATE(2024,2,29)'));
  });
});

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

const evalF = (formula: string, context?: { row?: number; col?: number }): Promise<CalcValue> =>
  engine.evaluateFormula(formula, {
    sheet: 'Data',
    row: context?.row ?? 0,
    col: context?.col ?? 9,
  });

const errCode = (value: CalcValue): string | null => (isCalcError(value) ? value.code : null);

describe('operators + coercion', () => {
  it('coerces text and booleans in arithmetic', async () => {
    expect(await evalF('="3"+4')).toBe(7);
    expect(await evalF('=TRUE+1')).toBe(2);
    expect(await evalF('=C2*2')).toBe(6); // "3" in a cell coerces via the operator
    expect(errCode(await evalF('="abc"+1'))).toBe('#VALUE!');
  });

  it('propagates and produces errors', async () => {
    expect(errCode(await evalF('=1/0'))).toBe('#DIV/0!');
    expect(errCode(await evalF('=#REF!+1'))).toBe('#REF!');
    expect(errCode(await evalF('=[1]Ext!A1'))).toBe('#REF!');
    expect(errCode(await evalF('=NOSUCHFN(1)'))).toBe('#NAME?');
    expect(errCode(await evalF('=UnknownName*2'))).toBe('#NAME?');
  });

  it('concatenates with General number rendering', async () => {
    expect(await evalF('="v"&0.5')).toBe('v0.5');
    expect(await evalF('=A1&"-"&B1')).toBe('10-alpha');
  });

  it('compares with Excel type ordering and blank coercion', async () => {
    expect(await evalF('=1<"a"')).toBe(true); // number < text
    expect(await evalF('="Z"<TRUE')).toBe(true); // text < logical
    expect(await evalF('=C4=""')).toBe(true);
    expect(await evalF('=C5=""')).toBe(true); // truly blank cell equals ""
    expect(await evalF('="WEST region"=B5')).toBe(true); // case-insensitive
  });

  it('handles percent and the unary/^ precedence quirks', async () => {
    expect(await evalF('=50%')).toBe(0.5);
    expect(await evalF('=-2^2')).toBe(4);
    expect(await evalF('=2^-2')).toBe(0.25);
  });

  it('resolves defined names', async () => {
    expect(await evalF('=TaxRate*100')).toBeCloseTo(20);
  });

  it('reads across sheets, quoted names included', async () => {
    expect(await evalF("='Q3 Notes'!B1")).toBe(99);
  });
});

describe('implicit intersection', () => {
  it('intersects a column range with the formula’s own row', async () => {
    expect(await evalF('=A1:A5*2', { row: 2 })).toBe(60);
  });

  it('errors when the range does not span the formula position', async () => {
    expect(errCode(await evalF('=A1:A5*2', { row: 7 }))).toBe('#VALUE!');
  });
});

describe('aggregates', () => {
  it('SUM skips range text/logicals but coerces direct args', async () => {
    expect(await evalF('=SUM(A1:A5)')).toBe(150);
    expect(await evalF('=SUM(C1:C4)')).toBe(-5); // "3", TRUE, "" don't count
    expect(await evalF('=SUM("3",TRUE,4)')).toBe(8);
  });

  it('COUNT/COUNTA/COUNTBLANK follow the same range-vs-direct rules', async () => {
    expect(await evalF('=COUNT(A1:A5)')).toBe(5);
    expect(await evalF('=COUNT(C1:C5)')).toBe(1);
    expect(await evalF('=COUNT(TRUE,"7")')).toBe(2);
    expect(await evalF('=COUNTA(C1:C5)')).toBe(4);
    expect(await evalF('=COUNTBLANK(C1:C5)')).toBe(2); // "" counts as blank, plus the empty cell
  });

  it('COUNTIF/SUMIF with operator + wildcard criteria', async () => {
    expect(await evalF('=COUNTIF(A1:A5,">=30")')).toBe(3);
    expect(await evalF('=COUNTIF(B1:B5,"*a")')).toBe(4); // alpha, beta, gamma, delta
    expect(await evalF('=SUMIF(A1:A5,">20")')).toBe(120);
    expect(await evalF('=SUMIF(B1:B5,"West*",A1:A5)')).toBe(50);
  });

  it('the -IFS family: multi-criteria AND semantics', async () => {
    // Rows: A 10..50 ascending; B alpha..West Region.
    expect(await evalF('=SUMIFS(A1:A5,B1:B5,"*a",A1:A5,">15")')).toBe(90); // beta 20, gamma 30, delta 40
    expect(await evalF('=COUNTIFS(B1:B5,"*a",A1:A5,">15")')).toBe(3);
    expect(await evalF('=AVERAGEIFS(A1:A5,A1:A5,">=20",A1:A5,"<=40")')).toBe(30);
    expect(await evalF('=MAXIFS(A1:A5,B1:B5,"*a")')).toBe(40);
    expect(await evalF('=MINIFS(A1:A5,A1:A5,">10")')).toBe(20);
    // No matches: SUM → 0, AVERAGE → #DIV/0!.
    expect(await evalF('=SUMIFS(A1:A5,B1:B5,"zzz")')).toBe(0);
    expect(errCode(await evalF('=AVERAGEIFS(A1:A5,B1:B5,"zzz")'))).toBe('#DIV/0!');
    // Dimension mismatch and odd pair count refuse.
    expect(errCode(await evalF('=SUMIFS(A1:A5,B1:B4,"x")'))).toBe('#VALUE!');
    expect(errCode(await evalF('=COUNTIFS(B1:B5)'))).toBe('#VALUE!');
    expect(errCode(await evalF('=SUMIFS(A1:A5,B1:B5)'))).toBe('#VALUE!');
  });

  it('AVERAGE/MIN/MAX/SUBTOTAL', async () => {
    expect(await evalF('=AVERAGE(A1:A5)')).toBe(30);
    expect(await evalF('=MIN(A1:A5)')).toBe(10);
    expect(await evalF('=MAX(A1:A5)')).toBe(50);
    expect(await evalF('=SUBTOTAL(9,A1:A5)')).toBe(150);
    expect(await evalF('=SUBTOTAL(109,A1:A5)')).toBe(150);
    expect(await evalF('=SUBTOTAL(1,A1:A5)')).toBe(30);
    expect(errCode(await evalF('=SUBTOTAL(12,A1:A5)'))).toBe('#VALUE!');
  });

  it('SUBTOTAL 103/102 count by type over the range', async () => {
    expect(await evalF('=SUBTOTAL(103,B1:B5)')).toBe(5); // COUNTA
    expect(await evalF('=SUBTOTAL(103,C1:C5)')).toBe(4);
    expect(await evalF('=SUBTOTAL(2,C1:C5)')).toBe(1); // COUNT: only the -5
  });

  it('a bare reference to an empty cell yields 0 at the top level', async () => {
    expect(await evalF('=C5')).toBe(0);
    expect(await evalF('=IF(TRUE,C5)')).toBe(0);
    // …but inner blank semantics are untouched.
    expect(await evalF('=ISBLANK(C5)')).toBe(true);
    expect(await evalF('=C5=""')).toBe(true);
  });

  it('rounds half away from zero', async () => {
    expect(await evalF('=ROUND(2.5,0)')).toBe(3);
    expect(await evalF('=ROUND(-2.5,0)')).toBe(-3);
    expect(await evalF('=ROUND(1.005,2)')).toBe(1.01);
    expect(await evalF('=ROUNDDOWN(1.999,1)')).toBe(1.9);
    expect(await evalF('=MOD(-3,2)')).toBe(1); // sign of the divisor
  });
});

describe('logical', () => {
  it('IF is lazy in the untaken branch', async () => {
    expect(await evalF('=IF(TRUE,1,1/0)')).toBe(1);
    expect(await evalF('=IF(A1>5,"big","small")')).toBe('big');
    expect(await evalF('=IF(FALSE,1)')).toBe(false);
  });

  it('IFERROR/IFNA observe errors without becoming them', async () => {
    expect(await evalF('=IFERROR(1/0,"fallback")')).toBe('fallback');
    expect(await evalF('=IFERROR(7,"fallback")')).toBe(7);
    expect(await evalF('=IFNA(#N/A,"na")')).toBe('na');
    expect(errCode(await evalF('=IFNA(#REF!,"na")'))).toBe('#REF!');
  });

  it('AND/OR ignore range text but use range numbers', async () => {
    expect(await evalF('=AND(A1:A5)')).toBe(true);
    expect(await evalF('=OR(FALSE,0,1)')).toBe(true);
    expect(errCode(await evalF('=AND(B1:B4)'))).toBe('#VALUE!'); // nothing logical at all
  });
});

describe('lookup — the corpus core', () => {
  it('MATCH exact, approximate, and descending', async () => {
    expect(await evalF('=MATCH(30,A1:A5,0)')).toBe(3);
    expect(await evalF('=MATCH(35,A1:A5,1)')).toBe(3); // last ≤ 35
    expect(await evalF('=MATCH(35,A1:A5)')).toBe(3); // type defaults to 1
    expect(errCode(await evalF('=MATCH(5,A1:A5,1)'))).toBe('#N/A');
    expect(await evalF('=MATCH("gam*",B1:B5,0)')).toBe(3);
    expect(errCode(await evalF('=MATCH("30",A1:A5,0)'))).toBe('#N/A'); // text never matches numbers
  });

  it('INDEX addresses cells, rows, and columns', async () => {
    expect(await evalF('=INDEX(A1:B5,2,2)')).toBe('beta');
    expect(await evalF('=INDEX(A1:A5,4)')).toBe(40);
    expect(await evalF('=INDEX(A1:B1,2)')).toBe('alpha'); // one-row range walks columns
    expect(await evalF('=SUM(INDEX(A1:B5,0,1))')).toBe(150); // col 1 as a range
    expect(errCode(await evalF('=INDEX(A1:A5,9)'))).toBe('#REF!');
    expect(await evalF('=INDEX(A1:B5,5,1)')).toBe(50);
  });

  it('INDEX/MATCH over whole columns — the dominant real-world shape', async () => {
    expect(await evalF('=INDEX(B:B,MATCH(30,A:A,0))')).toBe('gamma');
    expect(errCode(await evalF('=INDEX(B:B,MATCH(31,A:A,0))'))).toBe('#N/A');
  });

  it('VLOOKUP exact and approximate with type coherence', async () => {
    expect(await evalF('=VLOOKUP(20,A1:B5,2,FALSE)')).toBe('beta');
    expect(await evalF('=VLOOKUP(25,A1:B5,2)')).toBe('beta'); // approximate: last ≤
    expect(await evalF('=VLOOKUP(25,A1:B5,2,TRUE)')).toBe('beta');
    expect(errCode(await evalF('=VLOOKUP("20",A1:B5,2,FALSE)'))).toBe('#N/A');
    expect(errCode(await evalF('=VLOOKUP(20,A1:B5,3,FALSE)'))).toBe('#REF!');
    expect(errCode(await evalF('=VLOOKUP(20,A1:B5,0,FALSE)'))).toBe('#VALUE!');
  });

  it('CHOOSE evaluates only the chosen branch', async () => {
    expect(await evalF('=CHOOSE(2,"a","b","c")')).toBe('b');
    expect(await evalF('=CHOOSE(1,7,1/0)')).toBe(7);
  });

  it('OFFSET and INDIRECT produce live references', async () => {
    expect(await evalF('=OFFSET(A1,2,1)')).toBe('gamma');
    expect(await evalF('=SUM(OFFSET(A1,0,0,3,1))')).toBe(60);
    expect(await evalF('=INDIRECT("B3")')).toBe('gamma');
    expect(await evalF('=INDIRECT("A"&2)')).toBe(20);
    expect(errCode(await evalF('=INDIRECT("nope!!")'))).toBe('#REF!');
  });

  it('ROW/COLUMN read the argument or the formula position', async () => {
    expect(await evalF('=ROW(B7)')).toBe(7);
    expect(await evalF('=COLUMN(C1)')).toBe(3);
    expect(await evalF('=ROW()', { row: 4 })).toBe(5);
    expect(await evalF('=ROWS(A1:A5)')).toBe(5);
    expect(await evalF('=COLUMNS(A:C)')).toBe(3);
  });

  it('HYPERLINK yields the friendly name as the value', async () => {
    expect(await evalF('=HYPERLINK("https://example.com","Site")')).toBe('Site');
    expect(await evalF('=HYPERLINK("https://example.com")')).toBe('https://example.com');
  });

  it('XLOOKUP exact with if_not_found', async () => {
    expect(await evalF('=XLOOKUP(30,A1:A5,B1:B5)')).toBe('gamma');
    expect(await evalF('=XLOOKUP(31,A1:A5,B1:B5,"none")')).toBe('none');
    expect(await evalF('=XLOOKUP(31,A1:A5,B1:B5,,-1)')).toBe('gamma'); // next smaller
  });
});

describe('text functions', () => {
  it('slicing + searching', async () => {
    expect(await evalF('=LEFT("squisq",3)')).toBe('squ');
    expect(await evalF('=RIGHT("squisq",2)')).toBe('sq');
    expect(await evalF('=MID("squisq",3,2)')).toBe('ui');
    expect(await evalF('=LEN(B1)')).toBe(5);
    expect(await evalF('=FIND("i","squisq")')).toBe(4);
    expect(errCode(await evalF('=FIND("I","squisq")'))).toBe('#VALUE!'); // case-sensitive
    expect(await evalF('=SEARCH("I","squisq")')).toBe(4); // case-insensitive
    expect(await evalF('=SEARCH("q?i","squisq")')).toBe(2); // wildcards
  });

  it('TRIM collapses interior runs, SUBSTITUTE targets instances', async () => {
    expect(await evalF('=TRIM("  a   b  ")')).toBe('a b');
    expect(await evalF('=SUBSTITUTE("a-b-c","-","+")')).toBe('a+b+c');
    expect(await evalF('=SUBSTITUTE("a-b-c","-","+",2)')).toBe('a-b+c');
  });

  it('TEXT applies the format subset', async () => {
    expect(await evalF('=TEXT(1234.5,"#,##0.00")')).toBe('1,234.50');
    expect(await evalF('=TEXT(0.25,"0%")')).toBe('25%');
  });
});

describe('info + dates', () => {
  it('IS* functions observe without erroring', async () => {
    expect(await evalF('=ISBLANK(C5)')).toBe(true);
    expect(await evalF('=ISBLANK(C4)')).toBe(false); // "" is not blank
    expect(await evalF('=ISNUMBER(A1)')).toBe(true);
    expect(await evalF('=ISNUMBER(C2)')).toBe(false); // "3" is text
    expect(await evalF('=ISERROR(1/0)')).toBe(true);
    expect(await evalF('=ISNA(#N/A)')).toBe(true);
    expect(await evalF('=ISNA(#REF!)')).toBe(false);
  });

  it('DATE/YEAR/MONTH/DAY with the 1900 leap bug', async () => {
    expect(await evalF('=DATE(2020,1,1)')).toBe(43_831);
    expect(await evalF('=YEAR(DATE(2024,7,15))')).toBe(2024);
    expect(await evalF('=MONTH(DATE(2024,7,15))')).toBe(7);
    expect(await evalF('=DAY(DATE(2024,7,15))')).toBe(15);
    expect(await evalF('=DATE(1900,2,29)')).toBe(60);
    expect(await evalF('=DATE(2020,14,1)')).toBe(await evalF('=DATE(2021,2,1)')); // month overflow
  });

  it('TODAY/NOW use the injected clock', async () => {
    expect(await evalF('=YEAR(TODAY())')).toBe(2026);
    expect(await evalF('=HOUR(NOW())')).toBe(12);
  });

  it('EOMONTH/EDATE month math', async () => {
    expect(await evalF('=EOMONTH(DATE(2024,1,15),0)')).toBe(await evalF('=DATE(2024,1,31)'));
    expect(await evalF('=EDATE(DATE(2024,1,31),1)')).toBe(await evalF('=DATE(2024,2,29)'));
  });
});

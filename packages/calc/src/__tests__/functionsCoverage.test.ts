/**
 * Coverage sweep across the function families the primary semantics suite
 * doesn't reach — every family's remaining functions get behavior + error
 * cases here. Driven by the coverage report (info/text/math/logical/date
 * were the thin files), not by line-count vanity: each case pins an Excel
 * behavior a regression could silently break.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { createInHouseEngine } from '../engine.js';
import { isCalcError } from '../errors.js';
import type { CalcEngine, CalcValue } from '../types.js';

let engine: CalcEngine;

beforeAll(async () => {
  engine = createInHouseEngine({ now: () => new Date(2026, 8, 2, 9, 30, 45) });
  await engine.loadWorkbook({
    sheets: [
      {
        name: 'D',
        cells: [
          // A            B             C
          [{ value: 4 }, { value: 'Ann' }, { value: 2 }, { value: 16 }],
          [{ value: 9 }, { value: 'bob' }, { value: 4 }, { value: 8 }],
          [{ value: 16 }, { value: 'Cy' }, { value: 8 }, { value: 4 }],
          [{ value: 25 }, { value: '' }, { value: 16 }],
        ],
      },
    ],
  });
});

const evalF = (formula: string): Promise<CalcValue> =>
  engine.evaluateFormula(formula, { sheet: 'D', row: 0, col: 9 });
const errCode = (value: CalcValue): string | null => (isCalcError(value) ? value.code : null);

describe('info family', () => {
  it('type observers', async () => {
    expect(await evalF('=ISTEXT(B1)')).toBe(true);
    expect(await evalF('=ISTEXT(A1)')).toBe(false);
    expect(await evalF('=ISNONTEXT(A1)')).toBe(true);
    expect(await evalF('=ISLOGICAL(TRUE)')).toBe(true);
    expect(await evalF('=ISLOGICAL(1)')).toBe(false);
  });

  it('error observers distinguish #N/A from the rest', async () => {
    expect(await evalF('=ISERR(1/0)')).toBe(true);
    expect(await evalF('=ISERR(#N/A)')).toBe(false);
    expect(await evalF('=ISERROR(#N/A)')).toBe(true);
    expect(errCode(await evalF('=NA()'))).toBe('#N/A');
  });

  it('parity checks coerce, and reject non-numbers as #VALUE!', async () => {
    expect(await evalF('=ISEVEN(4.9)')).toBe(true); // truncates first
    expect(await evalF('=ISODD(-3)')).toBe(true);
    expect(errCode(await evalF('=ISEVEN("x")'))).toBe('#VALUE!');
  });

  it('N and T convert by type', async () => {
    expect(await evalF('=N(TRUE)')).toBe(1);
    expect(await evalF('=N("text")')).toBe(0);
    expect(await evalF('=T(B1)')).toBe('Ann');
    expect(await evalF('=T(A1)')).toBe('');
  });
});

describe('text family', () => {
  it('CONCAT walks ranges where CONCATENATE takes scalars', async () => {
    expect(await evalF('=CONCAT(B1:B3)')).toBe('AnnbobCy');
    expect(await evalF('=CONCAT(B1:B3,"-",A1)')).toBe('AnnbobCy-4');
  });

  it('TEXTJOIN honors the delimiter and empty handling', async () => {
    expect(await evalF('=TEXTJOIN(",",TRUE,B1:B4)')).toBe('Ann,bob,Cy');
    expect(await evalF('=TEXTJOIN("|",FALSE,B1:B4)')).toBe('Ann|bob|Cy|');
  });

  it('PROPER, REPT, EXACT, CHAR, CODE', async () => {
    expect(await evalF('=PROPER("hello world-two")')).toBe('Hello World-Two');
    expect(await evalF('=REPT("ab",3)')).toBe('ababab');
    expect(errCode(await evalF('=REPT("x",40000)'))).toBe('#VALUE!'); // 32,767-char cap
    expect(await evalF('=EXACT("Ann",B1)')).toBe(true);
    expect(await evalF('=EXACT("ann",B1)')).toBe(false); // EXACT is the case-sensitive one
    expect(await evalF('=CHAR(65)')).toBe('A');
    expect(errCode(await evalF('=CHAR(0)'))).toBe('#VALUE!');
    expect(await evalF('=CODE("A")')).toBe(65);
    expect(errCode(await evalF('=CODE("")'))).toBe('#VALUE!');
  });

  it('REPLACE and VALUE', async () => {
    expect(await evalF('=REPLACE("squisq",3,2,"UI")')).toBe('sqUIsq');
    expect(errCode(await evalF('=REPLACE("x",0,1,"y")'))).toBe('#VALUE!');
    expect(await evalF('=VALUE(" 20% ")')).toBe(0.2);
    expect(errCode(await evalF('=VALUE("abc")'))).toBe('#VALUE!');
    expect(errCode(await evalF('=VALUE(TRUE)'))).toBe('#VALUE!');
  });

  it('slicing defaults and bounds', async () => {
    expect(await evalF('=LEFT("abc")')).toBe('a'); // count defaults to 1
    expect(await evalF('=RIGHT("abc")')).toBe('c');
    expect(await evalF('=RIGHT("abc",0)')).toBe('');
    expect(errCode(await evalF('=MID("abc",0,1)'))).toBe('#VALUE!');
    expect(errCode(await evalF('=FIND("a","abc",9)'))).toBe('#VALUE!'); // start past end
  });
});

describe('math + aggregates', () => {
  it('PRODUCT, MEDIAN, and the deviation family', async () => {
    expect(await evalF('=PRODUCT(C1:C3)')).toBe(64);
    expect(await evalF('=MEDIAN(A1:A3)')).toBe(9);
    expect(await evalF('=MEDIAN(A1:A4)')).toBe(12.5); // even count averages
    expect(await evalF('=VAR(C1:C3)')).toBeCloseTo(9.3333, 3);
    expect(await evalF('=VARP(C1:C3)')).toBeCloseTo(6.2222, 3);
    expect(await evalF('=STDEV(C1:C3)')).toBeCloseTo(Math.sqrt(9.3333), 3);
    expect(await evalF('=STDEV.P(C1:C3)')).toBeCloseTo(Math.sqrt(6.2222), 3);
    expect(errCode(await evalF('=VAR(A1)'))).toBe('#DIV/0!'); // sample needs n≥2
  });

  it('SUMPRODUCT multiplies pairwise and rejects shape mismatches', async () => {
    expect(await evalF('=SUMPRODUCT(A1:A3,C1:C3)')).toBe(4 * 2 + 9 * 4 + 16 * 8);
    expect(errCode(await evalF('=SUMPRODUCT(A1:A3,C1:C2)'))).toBe('#VALUE!');
  });

  it('CEILING/FLOOR follow the Excel sign rules', async () => {
    expect(await evalF('=CEILING(6.1,2)')).toBe(8);
    expect(await evalF('=FLOOR(6.9,2)')).toBe(6);
    expect(await evalF('=CEILING(-6.1,-2)')).toBe(-8);
    expect(errCode(await evalF('=CEILING(6.1,-2)'))).toBe('#NUM!'); // mixed signs refuse
    expect(await evalF('=CEILING(5,0)')).toBe(0);
    expect(errCode(await evalF('=FLOOR(5,0)'))).toBe('#DIV/0!');
  });

  it('log/root domain errors and friends', async () => {
    expect(await evalF('=SQRT(A3)')).toBe(4);
    expect(errCode(await evalF('=SQRT(-1)'))).toBe('#NUM!');
    expect(await evalF('=LN(EXP(2))')).toBeCloseTo(2);
    expect(errCode(await evalF('=LN(0)'))).toBe('#NUM!');
    expect(await evalF('=LOG10(1000)')).toBeCloseTo(3);
    expect(await evalF('=LOG(8,2)')).toBeCloseTo(3);
    expect(errCode(await evalF('=LOG(8,1)'))).toBe('#NUM!');
    expect(await evalF('=SIGN(-9)')).toBe(-1);
    expect(await evalF('=INT(-1.5)')).toBe(-2); // floor, not truncation
    expect(await evalF('=TRUNC(-1.57,1)')).toBe(-1.5);
    expect(errCode(await evalF('=POWER(-1,0.5)'))).toBe('#NUM!');
    expect(errCode(await evalF('=MOD(5,0)'))).toBe('#DIV/0!');
    expect(await evalF('=PI()')).toBeCloseTo(Math.PI);
  });

  it('RAND/RANDBETWEEN stay in range and are marked volatile', async () => {
    const r = await evalF('=RAND()');
    expect(typeof r === 'number' && r >= 0 && r < 1).toBe(true);
    const rb = await evalF('=RANDBETWEEN(5,7)');
    expect(typeof rb === 'number' && rb >= 5 && rb <= 7 && Number.isInteger(rb)).toBe(true);
    expect(errCode(await evalF('=RANDBETWEEN(7,5)'))).toBe('#NUM!');
    expect(engine.capabilities.volatileFunctions).toContain('RAND');
  });

  it('AVERAGEIF with a separate average range', async () => {
    expect(await evalF('=AVERAGEIF(A1:A3,">5",C1:C3)')).toBe(6); // rows 2,3 → (4+8)/2
    expect(errCode(await evalF('=AVERAGEIF(A1:A3,">99")'))).toBe('#DIV/0!');
  });

  it('SUBTOTAL codes across the table', async () => {
    expect(await evalF('=SUBTOTAL(4,A1:A4)')).toBe(25);
    expect(await evalF('=SUBTOTAL(5,A1:A4)')).toBe(4);
    expect(await evalF('=SUBTOTAL(6,C1:C3)')).toBe(64);
    expect(await evalF('=SUBTOTAL(7,C1:C3)')).toBeCloseTo(Math.sqrt(9.3333), 3);
    expect(await evalF('=SUBTOTAL(10,C1:C3)')).toBeCloseTo(9.3333, 3);
    expect(await evalF('=SUBTOTAL(111,C1:C3)')).toBeCloseTo(6.2222, 3);
    expect(errCode(await evalF('=SUBTOTAL(0,A1:A2)'))).toBe('#VALUE!');
  });

  it('MAXIFS/MINIFS with no match return 0', async () => {
    expect(await evalF('=MAXIFS(A1:A3,B1:B3,"zzz")')).toBe(0);
    expect(await evalF('=MINIFS(A1:A3,B1:B3,"zzz")')).toBe(0);
  });
});

describe('logical family', () => {
  it('IFS picks the first true branch, else #N/A', async () => {
    expect(await evalF('=IFS(FALSE,1,TRUE,2,TRUE,3)')).toBe(2);
    expect(errCode(await evalF('=IFS(FALSE,1)'))).toBe('#N/A');
  });

  it('NOT, XOR, and constant functions', async () => {
    expect(await evalF('=NOT(0)')).toBe(true);
    expect(await evalF('=XOR(TRUE,TRUE,TRUE)')).toBe(true);
    expect(await evalF('=XOR(TRUE,TRUE)')).toBe(false);
    expect(await evalF('=TRUE()')).toBe(true);
    expect(await evalF('=FALSE()')).toBe(false);
  });

  it('errors propagate through AND/OR/IF conditions', async () => {
    expect(errCode(await evalF('=AND(TRUE,1/0)'))).toBe('#DIV/0!');
    expect(errCode(await evalF('=OR(FALSE,#REF!)'))).toBe('#REF!');
    expect(errCode(await evalF('=IF(1/0,1,2)'))).toBe('#DIV/0!');
  });
});

describe('lookup extras', () => {
  it('HLOOKUP mirrors VLOOKUP along rows', async () => {
    // The FIRST ROW is the lookup vector: [4, 'Ann', 2].
    expect(await evalF('=HLOOKUP(4,A1:C2,2,FALSE)')).toBe(9);
    expect(await evalF('=HLOOKUP(3,A1:C2,2)')).toBe(4); // approx: last ≤ 3 is col C
    expect(errCode(await evalF('=HLOOKUP(9,A1:C2,2,FALSE)'))).toBe('#N/A');
    expect(errCode(await evalF('=HLOOKUP(4,A1:C2,3,FALSE)'))).toBe('#REF!');
  });

  it('LOOKUP maps through the result vector', async () => {
    expect(await evalF('=LOOKUP(9,A1:A3,B1:B3)')).toBe('bob');
    expect(await evalF('=LOOKUP(20,A1:A3)')).toBe(16);
    expect(errCode(await evalF('=LOOKUP(1,A1:A3)'))).toBe('#N/A');
  });

  it('CHOOSE bounds and OFFSET/INDIRECT failure modes', async () => {
    expect(errCode(await evalF('=CHOOSE(0,"a")'))).toBe('#VALUE!');
    expect(errCode(await evalF('=CHOOSE(5,"a","b")'))).toBe('#VALUE!');
    expect(errCode(await evalF('=OFFSET(A1,-1,0)'))).toBe('#REF!');
    expect(errCode(await evalF('=OFFSET(A1,0,0,0,1)'))).toBe('#REF!');
    expect(errCode(await evalF('=INDIRECT("B2",FALSE)'))).toBe('#REF!'); // R1C1 unsupported
    expect(errCode(await evalF('=INDIRECT("SUM(1)")'))).toBe('#REF!'); // not a reference
  });

  it('array literals are aggregate-only — range positions refuse them', async () => {
    // Aggregates walk array nodes; range-typed args (MATCH, VLOOKUP…) need
    // real references. Pinned as the CURRENT contract (zero corpus usage);
    // an ArrayView would lift it if that ever changes.
    expect(await evalF('=SUM({1,2;3,4})')).toBe(10);
    expect(errCode(await evalF('=MATCH(9,{16;8;4},-1)'))).toBe('#VALUE!');
  });

  it('MATCH -1 walks descending data', async () => {
    // D holds descending 16,8,4: the smallest value ≥ 9 is 16, position 1.
    expect(await evalF('=MATCH(9,D1:D3,-1)')).toBe(1);
    expect(await evalF('=MATCH(4,D1:D3,-1)')).toBe(3);
    expect(errCode(await evalF('=MATCH(99,D1:D3,-1)'))).toBe('#N/A');
  });

  it('XLOOKUP wildcard mode', async () => {
    expect(await evalF('=XLOOKUP("b*",B1:B3,A1:A3,,2)')).toBe(9);
  });
});

describe('date/time family', () => {
  it('TIME and the clock accessors', async () => {
    expect(await evalF('=TIME(6,0,0)')).toBeCloseTo(0.25);
    expect(await evalF('=HOUR(TIME(13,45,30))')).toBe(13);
    expect(await evalF('=MINUTE(TIME(13,45,30))')).toBe(45);
    expect(await evalF('=SECOND(TIME(13,45,30))')).toBe(30);
    expect(await evalF('=MINUTE(NOW())')).toBe(30); // injected clock
  });

  it('WEEKDAY modes', async () => {
    // 2026-09-02 is a Wednesday.
    expect(await evalF('=WEEKDAY(DATE(2026,9,2))')).toBe(4);
    expect(await evalF('=WEEKDAY(DATE(2026,9,2),2)')).toBe(3);
    expect(await evalF('=WEEKDAY(DATE(2026,9,2),3)')).toBe(2);
    expect(errCode(await evalF('=WEEKDAY(DATE(2026,9,2),9)'))).toBe('#NUM!');
  });

  it('DAYS, EDATE and EOMONTH going backwards', async () => {
    expect(await evalF('=DAYS(DATE(2026,9,10),DATE(2026,9,2))')).toBe(8);
    expect(await evalF('=EDATE(DATE(2026,3,31),-1)')).toBe(await evalF('=DATE(2026,2,28)'));
    expect(await evalF('=EOMONTH(DATE(2026,3,15),-2)')).toBe(await evalF('=DATE(2026,1,31)'));
  });

  it('DATE treats small years as 1900-relative', async () => {
    expect(await evalF('=YEAR(DATE(26,1,1))')).toBe(1926);
  });
});

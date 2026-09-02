/**
 * Formula parser: reference shapes, Excel precedence quirks, and the
 * dependency-extraction walk the engine's graph is built from.
 */

import { describe, expect, it } from 'vitest';
import type { BinaryExpr, CallExpr, RangeExpr, RefExpr, UnaryExpr } from '../ast.js';
import { CalcParseError } from '../lexer.js';
import { collectReferences, parseFormula } from '../parser.js';

describe('parseFormula — literals and operators', () => {
  it('parses numbers, strings with "" escapes, booleans, and errors', () => {
    expect(parseFormula('=1.5e3')).toEqual({ type: 'number', value: 1500 });
    expect(parseFormula('"say ""hi"""')).toEqual({ type: 'string', value: 'say "hi"' });
    expect(parseFormula('TRUE')).toEqual({ type: 'boolean', value: true });
    expect(parseFormula('#N/A')).toEqual({ type: 'error', code: '#N/A' });
    expect(parseFormula('#DIV/0!')).toEqual({ type: 'error', code: '#DIV/0!' });
  });

  it('gives unary minus tighter binding than ^ (the -2^2 = 4 quirk)', () => {
    const expr = parseFormula('-2^2') as BinaryExpr;
    expect(expr.type).toBe('binary');
    expect(expr.op).toBe('^');
    expect((expr.left as UnaryExpr).type).toBe('unary');
  });

  it('parses ^ left-associative', () => {
    const expr = parseFormula('2^3^2') as BinaryExpr;
    expect(expr.op).toBe('^');
    expect((expr.left as BinaryExpr).op).toBe('^');
    expect(expr.right).toEqual({ type: 'number', value: 2 });
  });

  it('places & between arithmetic and comparison', () => {
    // 1+2&"x"="3x"  →  ((1+2)&"x") = "3x"
    const expr = parseFormula('1+2&"x"="3x"') as BinaryExpr;
    expect(expr.op).toBe('=');
    expect((expr.left as BinaryExpr).op).toBe('&');
  });

  it('parses postfix percent', () => {
    const expr = parseFormula('50%');
    expect(expr.type).toBe('percent');
  });
});

describe('parseFormula — references', () => {
  it('parses cell refs with absolute flags', () => {
    const ref = parseFormula('$B$4') as RefExpr;
    expect(ref).toMatchObject({ type: 'ref', row: 3, col: 1, absRow: true, absCol: true });
  });

  it('parses ranges, normalizing corner order', () => {
    const range = parseFormula('B4:A2') as RangeExpr;
    expect(range).toMatchObject({ startRow: 1, endRow: 3, startCol: 0, endCol: 1 });
  });

  it('parses whole-column and whole-row ranges', () => {
    const cols = parseFormula('A:C') as RangeExpr;
    expect(cols).toMatchObject({ wholeCols: true, startCol: 0, endCol: 2, startRow: 0 });
    const rows = parseFormula('SUM(2:3)') as CallExpr;
    expect(rows.args[0]).toMatchObject({ type: 'range', wholeRows: true, startRow: 1, endRow: 2 });
  });

  it('parses quoted and unquoted sheet prefixes', () => {
    expect(parseFormula("'Q3 Notes'!A1")).toMatchObject({ type: 'ref', sheet: 'Q3 Notes' });
    expect(parseFormula('Sales!B2:C3')).toMatchObject({ type: 'range', sheet: 'Sales' });
    expect(parseFormula("'It''s'!A1")).toMatchObject({ sheet: "It's" });
  });

  it('marks external-workbook references', () => {
    expect(parseFormula('[1]Data!A1')).toMatchObject({ type: 'ref', external: true });
  });

  it('keeps unknown identifiers as defined names', () => {
    expect(parseFormula('TaxRate*2')).toMatchObject({
      type: 'binary',
      left: { type: 'name', name: 'TaxRate' },
    });
  });
});

describe('parseFormula — calls', () => {
  it('strips _xlfn. prefixes and uppercases names', () => {
    const call = parseFormula('_xlfn.xlookup(1,A:A,B:B)') as CallExpr;
    expect(call.name).toBe('XLOOKUP');
    expect(call.args).toHaveLength(3);
  });

  it('represents omitted arguments as missing', () => {
    const call = parseFormula('IF(A1,,2)') as CallExpr;
    expect(call.args[1]).toEqual({ type: 'missing' });
    const trailing = parseFormula('VLOOKUP(A1,B:C,2,)') as CallExpr;
    expect(trailing.args[3]).toEqual({ type: 'missing' });
  });

  it('parses array literals with row/column separators', () => {
    const array = parseFormula('{1,2;3,4}');
    expect(array).toMatchObject({ type: 'array' });
  });

  it('rejects unsupported syntax with CalcParseError', () => {
    expect(() => parseFormula('Table1[Sales]')).toThrow(CalcParseError);
    expect(() => parseFormula('=')).toThrow(CalcParseError);
    expect(() => parseFormula('1 2')).toThrow(CalcParseError);
  });
});

describe('collectReferences', () => {
  it('gathers refs and ranges with default-sheet resolution', () => {
    const expr = parseFormula('SUM(A1:A10)+Sales!B2*C3');
    const { ranges, names } = collectReferences(expr, 'Main');
    expect(ranges).toContainEqual({
      sheet: 'Main',
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 0,
    });
    expect(ranges).toContainEqual({
      sheet: 'Sales',
      startRow: 1,
      startCol: 1,
      endRow: 1,
      endCol: 1,
    });
    expect(ranges).toContainEqual({
      sheet: 'Main',
      startRow: 2,
      startCol: 2,
      endRow: 2,
      endCol: 2,
    });
    expect(names).toEqual([]);
  });

  it('reports defined names separately and skips external refs', () => {
    const expr = parseFormula('TaxRate+[1]Data!A1');
    const { ranges, names } = collectReferences(expr, 'Main');
    expect(names).toEqual(['TaxRate']);
    expect(ranges).toHaveLength(0);
  });
});

/**
 * Formula parser — Pratt/precedence-climbing over the token stream, with
 * Excel's documented precedence quirks baked in:
 *  - unary minus binds TIGHTER than `^` (`-2^2` is `4`, not `-4`),
 *  - `^` is LEFT-associative (`2^3^2` is `64`),
 *  - `%` is a postfix operator,
 *  - `&` sits between arithmetic and the comparisons.
 *
 * Reference disambiguation happens here, not in the lexer: an identifier is
 * a function name when `(` follows, a sheet name when `!` follows, a cell
 * ref when it matches A1 shape, a whole-column endpoint when `:` joins two
 * column letters, and a defined name otherwise. Unsupported syntax
 * (structured table refs, 3-D sheet spans, intersection) throws
 * `CalcParseError` — the engine surfaces that as `#NAME?`, which the oracle
 * classifies as a coverage gap rather than a wrong answer.
 */

import type { BinaryOp, Expr, RangeExpr, RefExpr } from './ast.js';
import { CalcParseError, tokenize, type Token } from './lexer.js';
import type { CalcErrorCode, CalcRangeAddress } from './types.js';
import { MAX_COL_INDEX, MAX_ROW_INDEX, parseA1, parseColOnly, parseRowOnly } from './refs.js';

const BINARY_BP: Readonly<Record<string, number>> = {
  '=': 10,
  '<>': 10,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '&': 20,
  '+': 30,
  '-': 30,
  '*': 40,
  '/': 40,
  '^': 50,
};
const UNARY_BP = 55;
const PERCENT_BP = 60;

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  parse(): Expr {
    const expr = this.parseExpr(0);
    this.expectEnd();
    return expr;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token = this.tokens[this.index]!;
    if (token.kind !== 'end') this.index++;
    return token;
  }

  private expectPunct(text: string): void {
    const token = this.next();
    if (token.kind !== 'punct' || token.text !== text) {
      throw new CalcParseError(`Expected "${text}"`, token.pos);
    }
  }

  private expectEnd(): void {
    const token = this.peek();
    if (token.kind !== 'end') {
      throw new CalcParseError(`Unexpected "${token.text}"`, token.pos);
    }
  }

  private parseExpr(minBp: number): Expr {
    let left = this.parsePrefix();

    for (;;) {
      const token = this.peek();
      if (token.kind === 'op' && token.text === '%' && PERCENT_BP >= minBp) {
        this.next();
        left = { type: 'percent', operand: left };
        continue;
      }
      if (token.kind !== 'op') break;
      const bp = BINARY_BP[token.text];
      if (bp === undefined || bp < minBp) break;
      this.next();
      // All Excel binary operators are left-associative.
      const right = this.parseExpr(bp + 1);
      left = { type: 'binary', op: token.text as BinaryOp, left, right };
    }
    return left;
  }

  private parsePrefix(): Expr {
    const token = this.next();

    switch (token.kind) {
      case 'number': {
        const value = Number(token.text);
        if (!Number.isFinite(value)) {
          throw new CalcParseError(`Invalid number "${token.text}"`, token.pos);
        }
        // Whole-row range: `1:3` (both sides integer row numbers).
        if (this.isPunct(':') && /^\d+$/.test(token.text)) {
          const startRow = parseRowOnly(token.text);
          const after = this.peek(1);
          if (startRow !== null && after.kind === 'number' && /^\d+$/.test(after.text)) {
            const endRow = parseRowOnly(after.text);
            if (endRow !== null) {
              this.next();
              this.next();
              return this.rangeNode(null, false, {
                startRow: Math.min(startRow, endRow),
                endRow: Math.max(startRow, endRow),
                startCol: 0,
                endCol: MAX_COL_INDEX,
                wholeRows: true,
                wholeCols: false,
              });
            }
          }
        }
        return { type: 'number', value };
      }

      case 'string':
        return { type: 'string', value: token.text };

      case 'error':
        return { type: 'error', code: token.text as CalcErrorCode };

      case 'sheet-quoted': {
        this.expectPunct('!');
        return this.parseRefAfterSheet(token.text, false, token.pos);
      }

      case 'external': {
        // `[1]Sheet!A1` or `[1]'Sheet Name'!A1`.
        const sheetToken = this.next();
        if (sheetToken.kind !== 'ident' && sheetToken.kind !== 'sheet-quoted') {
          throw new CalcParseError('Expected sheet name after external prefix', sheetToken.pos);
        }
        this.expectPunct('!');
        return this.parseRefAfterSheet(sheetToken.text, true, token.pos);
      }

      case 'ident':
        return this.parseIdent(token);

      case 'op': {
        if (token.text === '-' || token.text === '+') {
          const operand = this.parseExpr(UNARY_BP);
          return { type: 'unary', op: token.text, operand };
        }
        throw new CalcParseError(`Unexpected operator "${token.text}"`, token.pos);
      }

      case 'punct': {
        if (token.text === '(') {
          const inner = this.parseExpr(0);
          this.expectPunct(')');
          return inner;
        }
        if (token.text === '{') {
          return this.parseArray();
        }
        throw new CalcParseError(`Unexpected "${token.text}"`, token.pos);
      }

      default:
        throw new CalcParseError('Unexpected end of formula', token.pos);
    }
  }

  private isPunct(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'punct' && token.text === text;
  }

  private parseArray(): Expr {
    const rows: Expr[][] = [];
    let current: Expr[] = [];
    for (;;) {
      current.push(this.parseExpr(0));
      const token = this.next();
      if (token.kind === 'punct' && token.text === ',') continue;
      if (token.kind === 'punct' && token.text === ';') {
        rows.push(current);
        current = [];
        continue;
      }
      if (token.kind === 'punct' && token.text === '}') {
        rows.push(current);
        break;
      }
      throw new CalcParseError('Expected "," ";" or "}" in array literal', token.pos);
    }
    const width = rows[0]!.length;
    if (rows.some((row) => row.length !== width)) {
      throw new CalcParseError('Ragged array literal', 0);
    }
    return { type: 'array', rows };
  }

  private parseIdent(token: Token): Expr {
    // Function call — `_xlfn.`/`_xludf.` are Excel's markers for functions
    // newer than the file format; the real name follows the prefix.
    if (this.isPunct('(')) {
      this.next();
      const name = token.text.replace(/^_xlfn\.|^_xludf\./i, '').toUpperCase();
      const args: Expr[] = [];
      if (this.isPunct(')')) {
        this.next();
        return { type: 'call', name, args };
      }
      for (;;) {
        if (this.isPunct(',')) {
          args.push({ type: 'missing' });
          this.next();
          continue;
        }
        if (this.isPunct(')')) {
          args.push({ type: 'missing' });
          this.next();
          break;
        }
        args.push(this.parseExpr(0));
        const sep = this.next();
        if (sep.kind === 'punct' && sep.text === ',') continue;
        if (sep.kind === 'punct' && sep.text === ')') break;
        throw new CalcParseError(`Expected "," or ")" in ${name}(...)`, sep.pos);
      }
      return { type: 'call', name, args };
    }

    // Unquoted sheet prefix: `Sales!A1`.
    if (this.isPunct('!')) {
      this.next();
      return this.parseRefAfterSheet(token.text, false, token.pos);
    }

    return this.parseRefOrName(token, null, false);
  }

  /** After `Sheet!` — only refs/ranges are supported (not sheet-scoped names). */
  private parseRefAfterSheet(sheet: string, external: boolean, pos: number): Expr {
    const token = this.next();
    if (token.kind !== 'ident' && token.kind !== 'number') {
      throw new CalcParseError('Expected a cell reference after sheet name', token.pos);
    }
    if (token.kind === 'number') {
      // Sheet-qualified whole-row range `Sheet!1:3`.
      const startRow = parseRowOnly(token.text);
      if (startRow !== null && this.isPunct(':')) {
        const after = this.peek(1);
        const endRow = after.kind === 'number' ? parseRowOnly(after.text) : null;
        if (endRow !== null) {
          this.next();
          this.next();
          return this.rangeNode(sheet, external, {
            startRow: Math.min(startRow, endRow),
            endRow: Math.max(startRow, endRow),
            startCol: 0,
            endCol: MAX_COL_INDEX,
            wholeRows: true,
            wholeCols: false,
          });
        }
      }
      throw new CalcParseError('Expected a cell reference after sheet name', token.pos);
    }
    const expr = this.parseRefOrName(token, sheet, external);
    if (expr.type !== 'ref' && expr.type !== 'range') {
      throw new CalcParseError('Sheet-qualified names are not supported', pos);
    }
    return expr;
  }

  private parseRefOrName(token: Token, sheet: string | null, external: boolean): Expr {
    const a1 = parseA1(token.text);
    if (a1) {
      // `A1:B2` (either side may carry $ flags).
      if (this.isPunct(':')) {
        const after = this.peek(1);
        const endA1 = after.kind === 'ident' ? parseA1(after.text) : null;
        if (endA1) {
          this.next();
          this.next();
          return this.rangeNode(sheet, external, {
            startRow: Math.min(a1.row, endA1.row),
            endRow: Math.max(a1.row, endA1.row),
            startCol: Math.min(a1.col, endA1.col),
            endCol: Math.max(a1.col, endA1.col),
            wholeRows: false,
            wholeCols: false,
          });
        }
      }
      const ref: RefExpr = {
        type: 'ref',
        sheet,
        row: a1.row,
        col: a1.col,
        absRow: a1.absRow,
        absCol: a1.absCol,
        external,
      };
      return ref;
    }

    // Whole-column range `A:C`.
    const colOnly = parseColOnly(token.text.replace(/^\$/, ''));
    if (colOnly !== null && this.isPunct(':')) {
      const after = this.peek(1);
      const endCol = after.kind === 'ident' ? parseColOnly(after.text.replace(/^\$/, '')) : null;
      if (endCol !== null) {
        this.next();
        this.next();
        return this.rangeNode(sheet, external, {
          startRow: 0,
          endRow: MAX_ROW_INDEX,
          startCol: Math.min(colOnly, endCol),
          endCol: Math.max(colOnly, endCol),
          wholeRows: false,
          wholeCols: true,
        });
      }
    }

    if (sheet !== null) {
      throw new CalcParseError(`"${token.text}" is not a cell reference`, token.pos);
    }

    const upper = token.text.toUpperCase();
    if (upper === 'TRUE') return { type: 'boolean', value: true };
    if (upper === 'FALSE') return { type: 'boolean', value: false };

    return { type: 'name', name: token.text };
  }

  private rangeNode(
    sheet: string | null,
    external: boolean,
    rect: Pick<
      RangeExpr,
      'startRow' | 'endRow' | 'startCol' | 'endCol' | 'wholeRows' | 'wholeCols'
    >,
  ): RangeExpr {
    return { type: 'range', sheet, external, ...rect };
  }
}

/** Parse a formula (leading `=` optional). Throws `CalcParseError`. */
export function parseFormula(source: string): Expr {
  const trimmed = source.trim();
  const body = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;
  if (body.trim() === '') throw new CalcParseError('Empty formula', 0);
  return new Parser(body).parse();
}

/**
 * Every cell/range the expression references, for dependency tracking.
 * Names are returned separately — the engine resolves them against defined
 * names and merges their own references.
 */
export function collectReferences(
  expr: Expr,
  defaultSheet: string,
): { ranges: CalcRangeAddress[]; names: string[] } {
  const ranges: CalcRangeAddress[] = [];
  const names: string[] = [];

  const walk = (node: Expr): void => {
    switch (node.type) {
      case 'ref':
        if (!node.external) {
          ranges.push({
            sheet: node.sheet ?? defaultSheet,
            startRow: node.row,
            startCol: node.col,
            endRow: node.row,
            endCol: node.col,
          });
        }
        return;
      case 'range':
        if (!node.external) {
          ranges.push({
            sheet: node.sheet ?? defaultSheet,
            startRow: node.startRow,
            startCol: node.startCol,
            endRow: node.endRow,
            endCol: node.endCol,
          });
        }
        return;
      case 'name':
        names.push(node.name);
        return;
      case 'call':
        for (const arg of node.args) walk(arg);
        return;
      case 'binary':
        walk(node.left);
        walk(node.right);
        return;
      case 'unary':
      case 'percent':
        walk(node.operand);
        return;
      case 'array':
        for (const row of node.rows) for (const cell of row) walk(cell);
        return;
      default:
        return;
    }
  };

  walk(expr);
  return { ranges, names };
}

export { CalcParseError };

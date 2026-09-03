/** Formula AST. Parsed once per cell; the evaluator interprets it directly. */

import type { CalcErrorCode } from './types.js';

export type BinaryOp = '=' | '<>' | '<' | '>' | '<=' | '>=' | '&' | '+' | '-' | '*' | '/' | '^';

export interface NumberLit {
  type: 'number';
  value: number;
}
export interface StringLit {
  type: 'string';
  value: string;
}
export interface BooleanLit {
  type: 'boolean';
  value: boolean;
}
export interface ErrorLit {
  type: 'error';
  code: CalcErrorCode;
}
export interface RefExpr {
  type: 'ref';
  /** null = the formula's own sheet. */
  sheet: string | null;
  row: number;
  col: number;
  absRow: boolean;
  absCol: boolean;
  /** `[1]Sheet!A1` — resolves to #REF! in engines without external support. */
  external: boolean;
}
export interface RangeExpr {
  type: 'range';
  sheet: string | null;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  /** `A:A` — rows span the sheet; evaluator clamps to used extent. */
  wholeCols: boolean;
  /** `3:5` — cols span the sheet. */
  wholeRows: boolean;
  external: boolean;
}
export interface NameExpr {
  type: 'name';
  name: string;
}
export interface CallExpr {
  type: 'call';
  /** Uppercased, `_xlfn.`/`_xludf.` stripped. */
  name: string;
  args: Expr[];
}
export interface UnaryExpr {
  type: 'unary';
  op: '-' | '+';
  operand: Expr;
}
export interface PercentExpr {
  type: 'percent';
  operand: Expr;
}
export interface BinaryExpr {
  type: 'binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
}
export interface ArrayLit {
  type: 'array';
  /** `{1,2;3,4}` — rows of scalars. */
  rows: Expr[][];
}
/** An omitted argument: `IF(A1,,2)`. */
export interface MissingArg {
  type: 'missing';
}

export type Expr =
  | NumberLit
  | StringLit
  | BooleanLit
  | ErrorLit
  | RefExpr
  | RangeExpr
  | NameExpr
  | CallExpr
  | UnaryExpr
  | PercentExpr
  | BinaryExpr
  | ArrayLit
  | MissingArg;

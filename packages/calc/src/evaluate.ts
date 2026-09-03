/**
 * The interpreter: AST → value, against a workbook.
 *
 * Two evaluation shapes flow through it — scalars and `RangeView`s (a
 * clamped window over a sheet). A range landing where a scalar is needed
 * goes through Excel's legacy IMPLICIT INTERSECTION: a one-cell range
 * collapses; a single-column range spanning the formula's own row (or a
 * single-row range spanning its column) intersects; anything else is
 * #VALUE!. Aggregation functions instead consume ranges wholesale.
 *
 * Budgets are enforced HERE, in the hot loop: every node evaluation and
 * every range cell scanned charges the tracker, which throws
 * `BudgetExceededSignal` past the interpreter to whoever owns the batch.
 */

import type { Expr } from './ast.js';
import {
  CALC_ERROR,
  NAME_ERROR,
  REF_ERROR,
  VALUE_ERROR,
  calcError,
  isCalcError,
} from './errors.js';
import { compareValues, toNumber, toText } from './coerce.js';
import type { CalcBudgets, CalcValue } from './types.js';
import { MAX_COL_INDEX, MAX_ROW_INDEX } from './refs.js';
import type { SheetData, WorkbookData } from './workbook.js';

// ── Budget ───────────────────────────────────────────────────────────

export class BudgetExceededSignal extends Error {
  constructor() {
    super('Calculation budget exceeded');
    this.name = 'BudgetExceededSignal';
  }
}

const TIME_CHECK_INTERVAL = 2_048;

export class BudgetTracker {
  workUnits = 0;
  private readonly startedAt: number;
  private readonly maxUnits: number;
  private readonly deadline: number;
  private sinceTimeCheck = 0;

  constructor(budgets: CalcBudgets | undefined) {
    this.startedAt = Date.now();
    this.maxUnits = budgets?.maxWorkUnits ?? Number.POSITIVE_INFINITY;
    this.deadline =
      budgets?.maxEvalTimeMs !== undefined
        ? this.startedAt + budgets.maxEvalTimeMs
        : Number.POSITIVE_INFINITY;
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  charge(units: number): void {
    this.workUnits += units;
    if (this.workUnits > this.maxUnits) throw new BudgetExceededSignal();
    this.sinceTimeCheck += units;
    if (this.sinceTimeCheck >= TIME_CHECK_INTERVAL) {
      this.sinceTimeCheck = 0;
      if (Date.now() > this.deadline) throw new BudgetExceededSignal();
    }
  }
}

// ── Range views ──────────────────────────────────────────────────────

/**
 * A rectangular window over a sheet. Logical dimensions come from the
 * reference; ITERATION is clamped to the sheet's used extent so
 * whole-column refs stay proportional to actual content.
 */
export class RangeView {
  readonly sheet: SheetData;
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
  private readonly ctx: EvalContext;

  constructor(
    ctx: EvalContext,
    sheet: SheetData,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ) {
    this.ctx = ctx;
    this.sheet = sheet;
    this.startRow = startRow;
    this.startCol = startCol;
    this.endRow = Math.min(endRow, MAX_ROW_INDEX);
    this.endCol = Math.min(endCol, MAX_COL_INDEX);
  }

  /** Logical size (what INDEX bounds-checks against). */
  get rows(): number {
    return this.endRow - this.startRow + 1;
  }
  get cols(): number {
    return this.endCol - this.startCol + 1;
  }

  /** Iteration size: clamped to used extent (blank tail is implicit). */
  get effectiveRows(): number {
    return Math.max(0, Math.min(this.endRow, this.sheet.maxRow) - this.startRow + 1);
  }
  get effectiveCols(): number {
    return Math.max(0, Math.min(this.endCol, this.sheet.maxCol) - this.startCol + 1);
  }

  /** Value at range-relative coordinates (0-based); blank beyond extent. */
  get(row: number, col: number): CalcValue {
    return this.ctx.readCell(this.sheet, this.startRow + row, this.startCol + col);
  }

  /** Scan every effective cell (row-major), charging the budget. */
  forEach(visit: (value: CalcValue, row: number, col: number) => void): void {
    const rows = this.effectiveRows;
    const cols = this.effectiveCols;
    this.ctx.budget.charge(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        visit(this.get(r, c), r, c);
      }
    }
  }
}

export type EvalResult = CalcValue | RangeView;

export function isRangeView(result: EvalResult): result is RangeView {
  return result instanceof RangeView;
}

// ── Context ──────────────────────────────────────────────────────────

export interface CalcFunctionDef {
  minArgs: number;
  /** Number.POSITIVE_INFINITY for variadic. */
  maxArgs: number;
  volatile?: boolean;
  fn: (args: Expr[], ctx: EvalContext) => EvalResult;
}

export interface EvalContext {
  readonly workbook: WorkbookData;
  readonly currentSheet: string;
  readonly currentRow: number;
  readonly currentCol: number;
  readonly budget: BudgetTracker;
  readonly date1904: boolean;
  readonly now: () => Date;
  readonly functions: ReadonlyMap<string, CalcFunctionDef>;
  /**
   * Read a cell's VALUE. The engine's recalc path resolves dirty formula
   * precedents here (demand-driven DFS); the values-context path just
   * reads storage.
   */
  readCell(sheet: SheetData, row: number, col: number): CalcValue;
  /** Defined-name expression source, or undefined. */
  definedName(name: string): string | undefined;
  /** Parse cache for defined names / INDIRECT (engine-owned). */
  parseSubFormula(source: string): Expr | null;
  /** Nested-context evaluation used by names and INDIRECT. */
  evaluate(expr: Expr): EvalResult;
}

// ── Interpreter ──────────────────────────────────────────────────────

/** Collapse to a scalar via implicit intersection where necessary. */
export function toScalar(result: EvalResult, ctx: EvalContext): CalcValue {
  if (!isRangeView(result)) return result;
  const view = result;
  if (view.rows === 1 && view.cols === 1) return view.get(0, 0);
  // Legacy implicit intersection against the formula's own position.
  if (
    view.cols === 1 &&
    ctx.currentRow >= view.startRow &&
    ctx.currentRow <= view.endRow &&
    view.sheet.name.toLowerCase() === ctx.currentSheet.toLowerCase()
  ) {
    return view.get(ctx.currentRow - view.startRow, 0);
  }
  if (
    view.rows === 1 &&
    ctx.currentCol >= view.startCol &&
    ctx.currentCol <= view.endCol &&
    view.sheet.name.toLowerCase() === ctx.currentSheet.toLowerCase()
  ) {
    return view.get(0, ctx.currentCol - view.startCol);
  }
  return VALUE_ERROR;
}

export function evaluateExpr(expr: Expr, ctx: EvalContext): EvalResult {
  ctx.budget.charge(1);

  switch (expr.type) {
    case 'number':
      return expr.value;
    case 'string':
      return expr.value;
    case 'boolean':
      return expr.value;
    case 'error':
      return calcError(expr.code);
    case 'missing':
      return null;

    case 'ref': {
      if (expr.external) return REF_ERROR;
      const sheet = ctx.workbook.sheet(expr.sheet ?? ctx.currentSheet);
      if (!sheet) return REF_ERROR;
      return new RangeView(ctx, sheet, expr.row, expr.col, expr.row, expr.col);
    }

    case 'range': {
      if (expr.external) return REF_ERROR;
      const sheet = ctx.workbook.sheet(expr.sheet ?? ctx.currentSheet);
      if (!sheet) return REF_ERROR;
      return new RangeView(ctx, sheet, expr.startRow, expr.startCol, expr.endRow, expr.endCol);
    }

    case 'name': {
      const source = ctx.definedName(expr.name);
      if (source === undefined) return NAME_ERROR;
      const parsed = ctx.parseSubFormula(source);
      if (!parsed) return NAME_ERROR;
      return ctx.evaluate(parsed);
    }

    case 'unary': {
      const value = toNumber(toScalar(ctx.evaluate(expr.operand), ctx));
      if (isCalcError(value)) return value;
      return expr.op === '-' ? -value : value;
    }

    case 'percent': {
      const value = toNumber(toScalar(ctx.evaluate(expr.operand), ctx));
      if (isCalcError(value)) return value;
      return value / 100;
    }

    case 'binary':
      return evaluateBinary(expr.op, expr.left, expr.right, ctx);

    case 'array': {
      // Scalar context takes the top-left element; functions that want the
      // full array receive the raw node and handle it themselves.
      return toScalar(ctx.evaluate(expr.rows[0]![0]!), ctx);
    }

    case 'call': {
      const def = ctx.functions.get(expr.name);
      if (!def) return NAME_ERROR;
      if (expr.args.length < def.minArgs || expr.args.length > def.maxArgs) {
        return VALUE_ERROR;
      }
      try {
        return def.fn(expr.args, ctx);
      } catch (err: unknown) {
        if (err instanceof BudgetExceededSignal) throw err;
        if (err instanceof RangeError) return CALC_ERROR; // stack overflow etc.
        throw err;
      }
    }
  }
}

function evaluateBinary(op: string, leftNode: Expr, rightNode: Expr, ctx: EvalContext): CalcValue {
  const left = toScalar(ctx.evaluate(leftNode), ctx);
  if (isCalcError(left) && op !== '=') {
    // Comparisons still propagate errors; short-circuit is just an
    // optimization for the arithmetic path.
  }
  const right = toScalar(ctx.evaluate(rightNode), ctx);

  switch (op) {
    case '&': {
      const l = toText(left);
      if (isCalcError(l)) return l;
      const r = toText(right);
      if (isCalcError(r)) return r;
      return l + r;
    }
    case '=':
    case '<>':
    case '<':
    case '>':
    case '<=':
    case '>=': {
      const cmp = compareValues(left, right);
      if (isCalcError(cmp)) return cmp;
      switch (op) {
        case '=':
          return cmp === 0;
        case '<>':
          return cmp !== 0;
        case '<':
          return cmp < 0;
        case '>':
          return cmp > 0;
        case '<=':
          return cmp <= 0;
        default:
          return cmp >= 0;
      }
    }
    default: {
      const l = toNumber(left);
      if (isCalcError(l)) return l;
      const r = toNumber(right);
      if (isCalcError(r)) return r;
      switch (op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          return r === 0 ? calcError('#DIV/0!') : l / r;
        case '^': {
          const result = Math.pow(l, r);
          return Number.isFinite(result) ? result : calcError('#NUM!');
        }
        default:
          return VALUE_ERROR;
      }
    }
  }
}

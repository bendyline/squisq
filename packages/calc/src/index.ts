/**
 * @bendyline/squisq-calc — spreadsheet calculation for squisq.
 *
 * The engine adapter contract (`CalcEngine`, Formualizer vocabulary), an
 * Excel formula parser, and the pure-TS in-house evaluator tier
 * (`createInHouseEngine`). Zero runtime dependencies.
 */

// Contract
export type {
  CalcBudgets,
  CalcCellAddress,
  CalcCellSeed,
  CalcCellState,
  CalcEngine,
  CalcEngineCapabilities,
  CalcEngineConfig,
  CalcErrorCode,
  CalcErrorValue,
  CalcEvaluationResult,
  CalcRangeAddress,
  CalcScalar,
  CalcSheetSeed,
  CalcValue,
  CalcWorkbookSeed,
  SpillRole,
  Staleness,
} from './types.js';

// Errors
export { ERROR_CODES, calcError, isCalcError, parseErrorLiteral } from './errors.js';

// Formula language
export type {
  ArrayLit,
  BinaryExpr,
  BinaryOp,
  BooleanLit,
  CallExpr,
  ErrorLit,
  Expr,
  MissingArg,
  NameExpr,
  NumberLit,
  PercentExpr,
  RangeExpr,
  RefExpr,
  StringLit,
  UnaryExpr,
} from './ast.js';
export { CalcParseError } from './lexer.js';
export { collectReferences, parseFormula } from './parser.js';

// Reference helpers
export {
  MAX_COL_INDEX,
  MAX_ROW_INDEX,
  columnIndexFromLetters,
  columnLetter,
  formatA1,
  parseA1,
} from './refs.js';

// Value semantics (exposed for adapters + oracle comparison)
export {
  buildCriteria,
  compareValues,
  formatGeneral,
  numberFromText,
  toLogical,
  toNumber,
  toText,
  wildcardToRegExp,
} from './coerce.js';
export {
  datePartsFromSerial,
  isoFromSerial,
  serialFromDateParts,
  serialFromIso,
  timePartsFromSerial,
} from './dates.js';
export { formatNumberWithPattern } from './numfmt.js';

// The in-house engine tier
export { createInHouseEngine } from './engine.js';

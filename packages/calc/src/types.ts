/**
 * The calculation-engine adapter contract, written in Formualizer's
 * vocabulary — the best-documented spec of Excel semantics in the
 * permissively-licensed field. Every backend (the in-house pure-TS tier
 * here, IronCalc via the `/ironcalc` subpath) implements this one
 * interface, and hosts program against it alone.
 *
 * Design commitments the contract encodes:
 *  - **Budgets are mandatory, not advisory.** The corpus stress workbook
 *    (116k cells, 9,328 INDEX/MATCH) exceeds a 7-MINUTE evaluation in both
 *    wasm engines tested; an engine must be able to stop at
 *    `maxEvalTimeMs`/`maxWorkUnits` and report what remains dirty rather
 *    than hang a host.
 *  - **Excel landmines are declared, not assumed.** The 1900 leap-year bug,
 *    1900/1904 epochs, implicit coercion/intersection, volatile functions,
 *    spill, iterative calculation — `CalcEngineCapabilities` names what a
 *    backend actually does so hosts can degrade honestly.
 *  - **Batch evaluation with staleness**, never per-cell `evaluateCell`
 *    loops — the Phase-0 spike measured per-cell feeding at ~10× overhead.
 */

// ── Values ───────────────────────────────────────────────────────────

/** The Excel error space, plus `#CALC!` for a cycle under `cyclePolicy: 'error'`. */
export type CalcErrorCode =
  | '#DIV/0!'
  | '#N/A'
  | '#NAME?'
  | '#NULL!'
  | '#NUM!'
  | '#REF!'
  | '#VALUE!'
  | '#SPILL!'
  | '#CALC!';

/**
 * An error as a VALUE (errors flow through references and arithmetic like
 * any other value). A branded object rather than a string so `"#N/A"` typed
 * into a cell as text can never be confused with the real error.
 */
export interface CalcErrorValue {
  readonly kind: 'calc-error';
  readonly code: CalcErrorCode;
}

export type CalcScalar = number | string | boolean;

/** A cell's value; `null` is the empty cell. */
export type CalcValue = CalcScalar | CalcErrorValue | null;

// ── Addressing ───────────────────────────────────────────────────────

/** Zero-based, matching the grid/XLSX modules across the monorepo. */
export interface CalcCellAddress {
  sheet: string;
  row: number;
  col: number;
}

export interface CalcRangeAddress {
  sheet: string;
  startRow: number;
  startCol: number;
  /** Inclusive. `Number.POSITIVE_INFINITY` marks a whole-column/row axis. */
  endRow: number;
  endCol: number;
}

// ── Evaluation state ─────────────────────────────────────────────────

export type Staleness = 'current' | 'dirty' | 'neverEvaluated';

/**
 * Dynamic-array roles: the cell a spilling formula lives in (`anchor`) vs a
 * cell its result spilled into (`member`). The in-house tier does not spill
 * (capability declared false); the contract carries the vocabulary so
 * backends that do can report it.
 */
export type SpillRole = 'anchor' | 'member' | 'none';

export interface CalcBudgets {
  /** Wall-clock ceiling for one `evaluateAll` call. */
  maxEvalTimeMs?: number;
  /** Abstract work ceiling (≈ cells evaluated + range cells scanned). */
  maxWorkUnits?: number;
}

export interface CalcEngineConfig {
  /** Workbook date epoch: false = 1900 system (with its leap bug), true = 1904. */
  date1904?: boolean;
  /**
   * What to do with circular references: `'error'` marks every cell in the
   * cycle `#CALC!`; `'iterate'` runs fixed-point iteration with Excel's
   * defaults (100 iterations, 0.001 max change) unless overridden.
   */
  cyclePolicy?: 'error' | 'iterate';
  iterateMaxIterations?: number;
  iterateMaxChange?: number;
  /** Default budgets applied to every `evaluateAll` (call-site budgets win). */
  budgets?: CalcBudgets;
  /** Clock for NOW/TODAY — injectable for deterministic tests and replays. */
  now?: () => Date;
}

export interface CalcEngineCapabilities {
  /** Uppercase names of every implemented function. */
  functions: readonly string[];
  dynamicArrays: boolean;
  iterativeCalc: boolean;
  /** External-workbook references (`[1]Sheet!A1`) resolve (vs `#REF!`). */
  externalRefs: boolean;
  /** Reproduces Excel's fictitious 1900-02-29 (serial 60). */
  leapYear1900Bug: boolean;
  volatileFunctions: readonly string[];
}

// ── Workbook seed ────────────────────────────────────────────────────

/**
 * The neutral feed format. `@bendyline/squisq-formats`' `xlsxToCellGrids`
 * and the grid's `IngestTable` both map onto this without either package
 * depending on the other.
 */
export interface CalcCellSeed {
  /** Current (possibly cached) value. Omitted = empty. */
  value?: CalcScalar | null;
  /** Formula source WITHOUT the leading `=`. */
  formula?: string;
}

export interface CalcSheetSeed {
  name: string;
  /** Row-major; rows may be ragged; `null`/absent cells are empty. */
  cells: readonly (readonly (CalcCellSeed | null)[])[];
}

export interface CalcWorkbookSeed {
  sheets: readonly CalcSheetSeed[];
  date1904?: boolean;
  /** Defined names → formula text (an A1 reference or expression). */
  definedNames?: Readonly<Record<string, string>>;
}

// ── Results ──────────────────────────────────────────────────────────

export interface CalcCellState {
  value: CalcValue;
  formula?: string;
  staleness: Staleness;
  spillRole: SpillRole;
  volatile: boolean;
}

export interface CalcEvaluationResult {
  /** `complete` | stopped by a budget | halted by a cycle under 'error' policy. */
  status: 'complete' | 'budget-exceeded' | 'cycle-error';
  evaluatedCells: number;
  workUnits: number;
  elapsedMs: number;
  /** Cells still dirty when a budget stopped evaluation (empty otherwise). */
  dirtyRemaining: CalcCellAddress[];
  /** Cells participating in cycles (both policies report them). */
  cycleCells: CalcCellAddress[];
}

// ── The engine ───────────────────────────────────────────────────────

export interface CalcEngine {
  readonly capabilities: CalcEngineCapabilities;

  /** Replace the engine's workbook. Formulas load as `neverEvaluated`. */
  loadWorkbook(seed: CalcWorkbookSeed): Promise<void>;

  /** Write a literal value (clears any formula); dependents go dirty. */
  setCellValue(address: CalcCellAddress, value: CalcScalar | null): void;
  /** Write a formula (no leading `=`); the cell and dependents go dirty. */
  setCellFormula(address: CalcCellAddress, formula: string): void;
  clearCell(address: CalcCellAddress): void;

  getCell(address: CalcCellAddress): CalcCellState;

  /** Batch-evaluate everything dirty, within budgets. */
  evaluateAll(budgets?: CalcBudgets): Promise<CalcEvaluationResult>;

  /**
   * Evaluate one formula against the CURRENT cell values without touching
   * the workbook — the values-context path the cached-value oracle uses,
   * and what a host uses for a preview of an uncommitted formula edit.
   * `context` anchors relative behavior (ROW()/COLUMN(), implicit
   * intersection); it defaults to A1 of the first sheet.
   */
  evaluateFormula(formula: string, context?: CalcCellAddress): CalcValue;

  precedentsOf(address: CalcCellAddress): CalcRangeAddress[];
  dependentsOf(address: CalcCellAddress): CalcCellAddress[];

  dispose(): void;
}

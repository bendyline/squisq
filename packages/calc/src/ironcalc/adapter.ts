/**
 * The IronCalc adapter — `@ironcalc/wasm`'s `Model` behind the
 * `CalcEngine` contract (exposed via the `/ironcalc` subpath).
 *
 * Engine facts this file encodes (probed against 0.8.4):
 *  - `Model` addressing is sheet-INDEX (0-based) + 1-based row/column;
 *    the contract's 0-based rows/cols are translated at the boundary.
 *  - `setUserInput` parses like a user typing: `=…` is a formula, `123` a
 *    number, `TRUE` a boolean. Every seeded STRING is therefore
 *    apostrophe-prefixed (`'123` → the text "123") so value types survive
 *    the trip — without it a numeric-looking string silently retypes.
 *  - `getCellType` returns 1=number, 2=text, 4=logical, 16=error; an empty
 *    cell reads as type 1 with empty content, so emptiness is detected
 *    from `getCellContent() === ''` first.
 *  - Numbers are read back through `getFormattedCellValue`; every cell
 *    this adapter creates carries the General format, so the text is
 *    `Number()`-parseable. (IronCalc exposes no raw typed read.)
 *  - `evaluate()` is SYNCHRONOUS, whole-workbook, and uninterruptible —
 *    the Phase-0 spike watched it run 7+ minutes on a 9,328-INDEX/MATCH
 *    workbook. Budgets are therefore enforced as a PRE-FLIGHT check:
 *    `maxWorkUnits` caps the dirty-formula count a batch will attempt,
 *    and a measured overrun of `maxEvalTimeMs` marks the ENGINE
 *    over-budget so the next batch refuses up front. A wall clock cannot
 *    stop a wasm call already in flight; only the work-count cap can
 *    prevent one.
 *  - IronCalc has no dependency-graph API: `precedentsOf` comes from
 *    squisq-calc's own parser; `dependentsOf` scans tracked formulas; any
 *    mutation conservatively dirties every formula cell (correct, since
 *    `evaluate()` recomputes the whole workbook anyway).
 */

import { calcError, parseErrorLiteral } from '../errors.js';
import { collectReferences, parseFormula } from '../parser.js';
import type {
  CalcBudgets,
  CalcCellAddress,
  CalcCellState,
  CalcEngine,
  CalcEngineCapabilities,
  CalcEngineConfig,
  CalcErrorValue,
  CalcEvaluationResult,
  CalcRangeAddress,
  CalcScalar,
  CalcValue,
  CalcWorkbookSeed,
  Staleness,
} from '../types.js';

// ── Minimal structural types for the wasm module (never imported statically) ──

interface IronModel {
  setUserInput(sheet: number, row: number, column: number, input: string): void;
  getCellContent(sheet: number, row: number, column: number): string;
  getCellType(sheet: number, row: number, column: number): number;
  getFormattedCellValue(sheet: number, row: number, column: number): string;
  evaluate(): void;
  newSheet(): void;
  renameSheet(sheet: number, name: string): void;
  newDefinedName(name: string, scope: number | null | undefined, formula: string): void;
  rangeClearContents(
    sheet: number,
    startRow: number,
    startColumn: number,
    endRow: number,
    endColumn: number,
  ): void;
  free(): void;
}

interface IronModule {
  default(options?: { module_or_path: unknown }): Promise<unknown>;
  Model: new (name: string, locale: string, timezone: string, languageId: string) => IronModel;
}

export interface IronCalcEngineOptions extends CalcEngineConfig {
  /**
   * Wasm binary location/bytes, forwarded to wasm-bindgen's init
   * (`{ module_or_path }`). Browsers under a bundler can usually omit it
   * (the module resolves `wasm_bg.wasm` relative to itself); Node hosts
   * MUST pass the bytes — Node's fetch cannot load `file:` URLs.
   */
  wasmSource?: unknown;
  /** IronCalc locale id (default `en`). */
  locale?: string;
  /** IANA timezone (default `UTC`). */
  timezone?: string;
}

let modulePromise: Promise<IronModule | null> | null = null;
let initialized = false;

async function loadIronCalc(wasmSource: unknown): Promise<IronModule | null> {
  modulePromise ??= import('@ironcalc/wasm').then(
    (mod) => mod as unknown as IronModule,
    () => null,
  );
  const mod = await modulePromise;
  if (!mod) return null;
  if (!initialized) {
    await mod.default(wasmSource === undefined ? undefined : { module_or_path: wasmSource });
    initialized = true;
  }
  return mod;
}

/** True when the optional peer resolves (does not initialize the wasm). */
export async function isIronCalcAvailable(): Promise<boolean> {
  modulePromise ??= import('@ironcalc/wasm').then(
    (mod) => mod as unknown as IronModule,
    () => null,
  );
  return (await modulePromise) !== null;
}

// ── Value translation ────────────────────────────────────────────────

const TYPE_NUMBER = 1;
const TYPE_TEXT = 2;
const TYPE_LOGICAL = 4;
const TYPE_ERROR = 16;

/** Encode a seeded scalar as user input, preserving its type. */
function encodeScalar(value: CalcScalar): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  // Apostrophe-prefix EVERY string: `123`, `TRUE`, `=x`, and `3%` must all
  // come back as text, and IronCalc strips exactly one leading apostrophe.
  return `'${value}`;
}

function errorFromText(text: string): CalcErrorValue {
  const known = parseErrorLiteral(text.trim());
  if (known) return known;
  // IronCalc-specific spellings outside the Excel eight.
  if (/circ/i.test(text)) return calcError('#CALC!');
  return calcError('#VALUE!');
}

const cellKey = (sheetIndex: number, row: number, col: number): string =>
  `${sheetIndex}:${row}:${col}`;

interface TrackedFormula {
  address: CalcCellAddress;
  formula: string;
  staleness: Staleness;
}

class IronCalcEngine implements CalcEngine {
  readonly capabilities: CalcEngineCapabilities;

  private model: IronModel | null = null;
  private readonly mod: IronModule;
  private readonly options: IronCalcEngineOptions;
  /** Sheet name (lower) → model sheet index. */
  private sheetIndex = new Map<string, number>();
  private sheetNames: string[] = [];
  /** Tracked formula cells, keyed by model coordinates. */
  private formulas = new Map<string, TrackedFormula>();
  /** Set when a measured evaluate() overran maxEvalTimeMs. */
  private overBudget = false;
  private disposed = false;

  constructor(mod: IronModule, options: IronCalcEngineOptions) {
    this.mod = mod;
    this.options = options;
    this.capabilities = {
      // IronCalc exposes no function inventory API; an empty list here
      // means "unspecified", not "none" — the engine documents 462.
      functions: [],
      dynamicArrays: true,
      iterativeCalc: false,
      externalRefs: false,
      leapYear1900Bug: true,
      volatileFunctions: ['NOW', 'TODAY', 'RAND', 'RANDBETWEEN'],
    };
  }

  // ── Loading ────────────────────────────────────────────────────────

  async loadWorkbook(seed: CalcWorkbookSeed): Promise<void> {
    this.assertLive();
    this.model?.free();
    this.model = new this.mod.Model(
      'workbook',
      this.options.locale ?? 'en',
      this.options.timezone ?? 'UTC',
      'en',
    );
    this.sheetIndex = new Map();
    this.sheetNames = [];
    this.formulas = new Map();
    this.overBudget = false;

    seed.sheets.forEach((sheetSeed, index) => {
      if (index > 0) this.model!.newSheet();
      this.model!.renameSheet(index, sheetSeed.name);
      this.sheetIndex.set(sheetSeed.name.toLowerCase(), index);
      this.sheetNames.push(sheetSeed.name);
    });

    for (const [name, formula] of Object.entries(seed.definedNames ?? {})) {
      try {
        // IronCalc 0.8.x accepts only sheet-qualified absolute REFERENCES
        // as defined names (`Sheet1!$A$1`); constants and expressions are
        // refused and degrade to #NAME? at use sites (the in-house tier
        // supports both — a capability difference, not a bug here).
        this.model.newDefinedName(name, null, formula);
      } catch {
        // Degrades to #NAME? wherever the name is used.
      }
    }

    seed.sheets.forEach((sheetSeed, sheetIdx) => {
      for (let row = 0; row < sheetSeed.cells.length; row++) {
        const cells = sheetSeed.cells[row]!;
        for (let col = 0; col < cells.length; col++) {
          const cell = cells[col];
          if (!cell) continue;
          if (cell.formula !== undefined) {
            this.model!.setUserInput(sheetIdx, row + 1, col + 1, `=${cell.formula}`);
            this.formulas.set(cellKey(sheetIdx, row, col), {
              address: { sheet: sheetSeed.name, row, col },
              formula: cell.formula,
              staleness: 'neverEvaluated',
            });
          } else if (cell.value !== undefined && cell.value !== null) {
            this.model!.setUserInput(sheetIdx, row + 1, col + 1, encodeScalar(cell.value));
          }
        }
      }
    });
  }

  // ── Mutation ───────────────────────────────────────────────────────

  private resolveSheet(name: string): number | undefined {
    return this.sheetIndex.get(name.toLowerCase());
  }

  private requireModel(): IronModel {
    if (!this.model) throw new Error('loadWorkbook() must run before using the engine');
    return this.model;
  }

  /** Every mutation dirties every formula: evaluate() is whole-workbook. */
  private dirtyAllFormulas(): void {
    for (const tracked of this.formulas.values()) {
      if (tracked.staleness === 'current') tracked.staleness = 'dirty';
    }
  }

  setCellValue(address: CalcCellAddress, value: CalcScalar | null): void {
    this.assertLive();
    const model = this.requireModel();
    const sheetIdx = this.resolveSheet(address.sheet);
    if (sheetIdx === undefined) throw new Error(`Unknown sheet "${address.sheet}"`);
    this.formulas.delete(cellKey(sheetIdx, address.row, address.col));
    if (value === null) {
      model.rangeClearContents(
        sheetIdx,
        address.row + 1,
        address.col + 1,
        address.row + 1,
        address.col + 1,
      );
    } else {
      model.setUserInput(sheetIdx, address.row + 1, address.col + 1, encodeScalar(value));
    }
    this.dirtyAllFormulas();
  }

  setCellFormula(address: CalcCellAddress, formula: string): void {
    this.assertLive();
    const model = this.requireModel();
    const sheetIdx = this.resolveSheet(address.sheet);
    if (sheetIdx === undefined) throw new Error(`Unknown sheet "${address.sheet}"`);
    model.setUserInput(sheetIdx, address.row + 1, address.col + 1, `=${formula}`);
    this.formulas.set(cellKey(sheetIdx, address.row, address.col), {
      address,
      formula,
      staleness: 'neverEvaluated',
    });
    this.dirtyAllFormulas();
  }

  clearCell(address: CalcCellAddress): void {
    this.setCellValue(address, null);
  }

  // ── Reading ────────────────────────────────────────────────────────

  private readValue(sheetIdx: number, row: number, col: number): CalcValue {
    const model = this.requireModel();
    const content = model.getCellContent(sheetIdx, row + 1, col + 1);
    if (content === '') return null;
    const type = model.getCellType(sheetIdx, row + 1, col + 1);
    const formatted = model.getFormattedCellValue(sheetIdx, row + 1, col + 1);
    switch (type) {
      case TYPE_NUMBER: {
        if (formatted === '') return null;
        const parsed = Number(formatted);
        return Number.isFinite(parsed) ? parsed : formatted;
      }
      case TYPE_LOGICAL:
        return formatted === 'TRUE';
      case TYPE_ERROR:
        return errorFromText(formatted);
      case TYPE_TEXT:
      default:
        return formatted;
    }
  }

  async getCell(address: CalcCellAddress): Promise<CalcCellState> {
    return this.getCellSync(address);
  }

  async getCells(addresses: readonly CalcCellAddress[]): Promise<CalcCellState[]> {
    return addresses.map((address) => this.getCellSync(address));
  }

  private getCellSync(address: CalcCellAddress): CalcCellState {
    this.assertLive();
    const sheetIdx = this.resolveSheet(address.sheet);
    if (sheetIdx === undefined) {
      return { value: null, staleness: 'current', spillRole: 'none', volatile: false };
    }
    const tracked = this.formulas.get(cellKey(sheetIdx, address.row, address.col));
    const state: CalcCellState = {
      value: this.readValue(sheetIdx, address.row, address.col),
      staleness: tracked?.staleness ?? 'current',
      spillRole: 'none',
      volatile: false,
    };
    if (tracked) state.formula = tracked.formula;
    return state;
  }

  // ── Evaluation ─────────────────────────────────────────────────────

  async evaluateAll(budgets?: CalcBudgets): Promise<CalcEvaluationResult> {
    this.assertLive();
    this.requireModel();
    const merged = budgets ?? this.options.budgets;
    const dirty = [...this.formulas.values()].filter((f) => f.staleness !== 'current');

    // PRE-FLIGHT budget: a wasm evaluate() in flight cannot be stopped, so
    // the work-count cap — and the memory of a measured time overrun —
    // must refuse BEFORE the call.
    const overWorkBudget = merged?.maxWorkUnits !== undefined && dirty.length > merged.maxWorkUnits;
    if ((overWorkBudget || this.overBudget) && dirty.length > 0) {
      return {
        status: 'budget-exceeded',
        evaluatedCells: 0,
        workUnits: 0,
        elapsedMs: 0,
        dirtyRemaining: dirty.map((f) => f.address),
        cycleCells: [],
      };
    }

    const startedAt = Date.now();
    if (dirty.length > 0) this.requireModel().evaluate();
    const elapsedMs = Date.now() - startedAt;
    if (merged?.maxEvalTimeMs !== undefined && elapsedMs > merged.maxEvalTimeMs) {
      // Too late for this batch — remember, so the next one refuses early.
      this.overBudget = true;
    }

    const cycleCells: CalcCellAddress[] = [];
    for (const tracked of dirty) {
      tracked.staleness = 'current';
      const sheetIdx = this.resolveSheet(tracked.address.sheet)!;
      const value = this.readValue(sheetIdx, tracked.address.row, tracked.address.col);
      if (typeof value === 'object' && value !== null && value.code === '#CALC!') {
        cycleCells.push(tracked.address);
      }
    }

    return {
      status: cycleCells.length > 0 ? 'cycle-error' : 'complete',
      evaluatedCells: dirty.length,
      workUnits: dirty.length,
      elapsedMs,
      dirtyRemaining: [],
      cycleCells,
    };
  }

  /**
   * Values-context evaluation via a SCRATCH CELL on the context sheet
   * (row 1,048,575) — IronCalc has no side-effect-free evaluator, so this
   * writes, evaluates, reads, and clears. It costs a full workbook
   * recalculation per call: hosts doing preview/oracle workloads should
   * prefer the in-house tier for this path.
   */
  async evaluateFormula(formula: string, context?: CalcCellAddress): Promise<CalcValue> {
    this.assertLive();
    const model = this.requireModel();
    const sheetIdx = context ? (this.resolveSheet(context.sheet) ?? 0) : 0;
    const SCRATCH_ROW = 1_048_575; // 1-based max row (leave contract 0-based out of it)
    const SCRATCH_COL = 16_384;
    try {
      model.setUserInput(sheetIdx, SCRATCH_ROW, SCRATCH_COL, `=${formula}`);
    } catch {
      return calcError('#NAME?');
    }
    model.evaluate();
    const value = this.readValue(sheetIdx, SCRATCH_ROW - 1, SCRATCH_COL - 1);
    model.rangeClearContents(sheetIdx, SCRATCH_ROW, SCRATCH_COL, SCRATCH_ROW, SCRATCH_COL);
    model.evaluate();
    return value ?? 0;
  }

  // ── Graph queries (parser-derived: IronCalc exposes no graph API) ──

  async precedentsOf(address: CalcCellAddress): Promise<CalcRangeAddress[]> {
    this.assertLive();
    const sheetIdx = this.resolveSheet(address.sheet);
    if (sheetIdx === undefined) return [];
    const tracked = this.formulas.get(cellKey(sheetIdx, address.row, address.col));
    if (!tracked) return [];
    try {
      return collectReferences(parseFormula(tracked.formula), address.sheet).ranges;
    } catch {
      return [];
    }
  }

  async dependentsOf(address: CalcCellAddress): Promise<CalcCellAddress[]> {
    this.assertLive();
    const out: CalcCellAddress[] = [];
    for (const tracked of this.formulas.values()) {
      for (const range of await this.precedentsOf(tracked.address)) {
        if (
          range.sheet.toLowerCase() === address.sheet.toLowerCase() &&
          address.row >= range.startRow &&
          address.row <= range.endRow &&
          address.col >= range.startCol &&
          address.col <= range.endCol
        ) {
          out.push(tracked.address);
          break;
        }
      }
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.model?.free();
    this.model = null;
    this.formulas.clear();
    this.sheetIndex.clear();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('CalcEngine used after dispose()');
  }
}

/**
 * Create the IronCalc-backed engine. Rejects with a descriptive error when
 * the optional peer `@ironcalc/wasm` is not installed.
 */
export async function createIronCalcEngine(
  options: IronCalcEngineOptions = {},
): Promise<CalcEngine> {
  const mod = await loadIronCalc(options.wasmSource);
  if (!mod) {
    throw new Error(
      '@ironcalc/wasm is not installed. It is an optional peer of the ' +
        '@bendyline/squisq-calc/ironcalc subpath — add it to your app to ' +
        'use the IronCalc backend, or use createInHouseEngine from the ' +
        'package root instead.',
    );
  }
  return new IronCalcEngine(mod, options);
}

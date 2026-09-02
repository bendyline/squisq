/**
 * XLSX formula editing in the data card: an in-house calc-engine session
 * behind the grid's `FormulaSupport` seam.
 *
 * The engine seeds from the ENTIRE workbook (`XlsxWorkbookGrids`) — region
 * formulas routinely reference cells outside the region — with formula
 * cells seeded as formulas and value cells as values (date cells converted
 * back to serials, since the importer normalized them to ISO strings).
 *
 * Display discipline: the store keeps showing the file's CACHED values
 * until an edit actually changes something. After each committed edit the
 * session diffs the region's formula cells against its own previous engine
 * values and returns only the CHANGES as `TableCellEdit`s — and a cell
 * whose engine value is `#NAME?` (a function this tier doesn't implement)
 * never overwrites its cached display.
 *
 * `@bendyline/squisq-calc` is a regular dependency reached only via
 * dynamic `import()` (the grid-react pattern) — code-split, and a load
 * failure just means formula cells stay locked.
 */

import type { TableCellEdit, TableCellValue } from '@bendyline/squisq/table';
import type { CalcEngine, CalcValue, CalcWorkbookSeed } from '@bendyline/squisq-calc';
import type { XlsxSourceMeta } from './ingestAdapters';

type CalcModule = typeof import('@bendyline/squisq-calc');

/** Kept modest: a formula edit must feel interactive, never hang the tab. */
const SESSION_BUDGETS = { maxWorkUnits: 5_000_000, maxEvalTimeMs: 5_000 };

export interface FormulaEditRecord {
  formula: string;
  /** Engine result, when scalar — persisted as the cached `<v>`. */
  cachedValue?: number | boolean | string;
}

export interface XlsxFormulaSession {
  getFormula(bodyRow: number, col: number): string | undefined;
  /** Date cells + shared-formula masters stay locked; formulas edit. */
  isCellLocked(bodyRow: number, col: number): boolean;
  commitFormula(
    bodyRow: number,
    col: number,
    formula: string,
  ): Promise<{ ok: boolean; error?: string; updates?: TableCellEdit[] }>;
  /**
   * Mirror a plain value edit into the engine and return the recalculated
   * dependent updates (region formula cells whose values changed) — the
   * live-recalc half of "edit Units, watch Revenue follow".
   */
  noteValueEdit(bodyRow: number, col: number, value: TableCellValue): Promise<TableCellEdit[]>;
  readonly dirtyCount: number;
  /** Unsaved formula edits, keyed `"row:col"` (body coordinates). */
  formulaEdits(): ReadonlyMap<string, FormulaEditRecord>;
  /** Revert to the loaded workbook; returns the display updates to re-apply. */
  discard(): Promise<TableCellEdit[]>;
  /** Forget the edits after a successful save (values stay current). */
  markSaved(): void;
  dispose(): void;
}

function displayValue(calc: CalcModule, value: CalcValue): TableCellValue {
  if (calc.isCalcError(value)) return value.code;
  return value;
}

function buildSeed(calc: CalcModule, meta: XlsxSourceMeta): CalcWorkbookSeed {
  const { grids } = meta;
  return {
    date1904: grids.date1904,
    sheets: grids.sheets.map((sheet) => ({
      name: sheet.name,
      cells: sheet.cells.map((row) =>
        row.map((cell) => {
          if (!cell) return null;
          if (cell.formula !== undefined) return { formula: cell.formula };
          if (cell.value === undefined) return null;
          if (cell.kind === 'date' && typeof cell.value === 'string') {
            const serial = calc.serialFromIso(cell.value, grids.date1904);
            return serial === null ? { value: cell.value } : { value: serial };
          }
          return { value: cell.value };
        }),
      ),
    })),
  };
}

/**
 * Create the engine session, or null when formula editing can't be offered
 * (calc module unavailable, or the workbook blows the interactive budget —
 * the standing NHS-stress-workbook rule: degrade, never hang).
 */
export async function createXlsxFormulaSession(
  meta: XlsxSourceMeta,
): Promise<XlsxFormulaSession | null> {
  let calc: CalcModule;
  try {
    calc = await import('@bendyline/squisq-calc');
  } catch {
    return null;
  }

  const engine: CalcEngine = calc.createInHouseEngine({
    date1904: meta.grids.date1904,
    budgets: SESSION_BUDGETS,
  });
  await engine.loadWorkbook(buildSeed(calc, meta));
  const initial = await engine.evaluateAll();
  if (initial.status === 'budget-exceeded') {
    engine.dispose();
    return null;
  }

  const bodyTop = meta.anchorRow + (meta.hasHeader ? 1 : 0);
  const toAddress = (bodyRow: number, col: number) => ({
    sheet: meta.sheet,
    row: bodyTop + bodyRow,
    col: meta.anchorCol + col,
  });

  /** Live formula map (starts from the file's, tracks edits). */
  const formulas = new Map(meta.formulas);
  const edits = new Map<string, FormulaEditRecord>();
  let disposed = false;

  /** Engine values for every formula-bearing region cell, for diffing. */
  const snapshotRegion = (): Map<string, TableCellValue> => {
    const snapshot = new Map<string, TableCellValue>();
    for (const key of formulas.keys()) {
      const [row, col] = key.split(':').map(Number) as [number, number];
      snapshot.set(key, displayValue(calc, engine.getCell(toAddress(row, col)).value));
    }
    return snapshot;
  };

  const diffAgainst = (
    before: Map<string, TableCellValue>,
    keys: Iterable<string> = formulas.keys(),
  ): TableCellEdit[] => {
    const updates: TableCellEdit[] = [];
    for (const key of new Set(keys)) {
      const [row, col] = key.split(':').map(Number) as [number, number];
      const raw = engine.getCell(toAddress(row, col)).value;
      // Unsupported-function results never overwrite the cached display.
      if (calc.isCalcError(raw) && raw.code === '#NAME?') continue;
      const value = displayValue(calc, raw);
      if (before.get(key) !== value) {
        updates.push({ rowId: row, col, value });
      }
    }
    return updates;
  };

  return {
    getFormula: (bodyRow, col) => formulas.get(`${bodyRow}:${col}`),

    isCellLocked: (bodyRow, col) => {
      const key = `${bodyRow}:${col}`;
      return meta.dateLocked.has(key) || meta.masterLocked.has(key);
    },

    async commitFormula(bodyRow, col, formula) {
      if (disposed) return { ok: false, error: 'session disposed' };
      try {
        calc.parseFormula(formula);
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof calc.CalcParseError ? err.message : 'invalid formula',
        };
      }

      const key = `${bodyRow}:${col}`;
      const address = toAddress(bodyRow, col);
      const previous = engine.getCell(address);
      const before = snapshotRegion();
      // The edited cell diffs like any other region formula cell once its
      // formula is registered; seed its "before" from the store-visible value.
      if (!before.has(key)) before.set(key, displayValue(calc, previous.value));

      engine.setCellFormula(address, formula);
      const result = await engine.evaluateAll();
      if (result.status === 'budget-exceeded') {
        // Revert: an interactive edit must not leave the engine half-dirty.
        if (previous.formula !== undefined) {
          engine.setCellFormula(address, previous.formula);
        } else if (previous.value === null || calc.isCalcError(previous.value)) {
          engine.clearCell(address);
        } else {
          engine.setCellValue(address, previous.value);
        }
        await engine.evaluateAll();
        return { ok: false, error: 'formula exceeds the calculation budget' };
      }

      formulas.set(key, formula);
      const selfRaw = engine.getCell(address).value;
      if (calc.isCalcError(selfRaw) && selfRaw.code === '#NAME?') {
        // The engine can't evaluate it — honest error instead of a silent
        // wrong display; the formula itself may still be valid Excel.
        const record: FormulaEditRecord = { formula };
        edits.set(key, record);
        const updates = diffAgainst(before);
        updates.push({ rowId: bodyRow, col, value: '#NAME?' });
        return { ok: true, updates };
      }

      const record: FormulaEditRecord = { formula };
      if (!calc.isCalcError(selfRaw) && selfRaw !== null) record.cachedValue = selfRaw;
      edits.set(key, record);

      return { ok: true, updates: diffAgainst(before) };
    },

    async noteValueEdit(bodyRow, col, value) {
      if (disposed) return [];
      const key = `${bodyRow}:${col}`;
      formulas.delete(key);
      edits.delete(key);
      const before = snapshotRegion();
      engine.setCellValue(toAddress(bodyRow, col), value);
      const result = await engine.evaluateAll();
      // Over budget: the engine may be part-stale, but the store's own value
      // is already right and cached dependents simply stay put.
      if (result.status === 'budget-exceeded') return [];
      return diffAgainst(before);
    },

    get dirtyCount() {
      return edits.size;
    },

    formulaEdits: () => edits,

    async discard() {
      const before = snapshotRegion();
      const staleKeys = new Set(formulas.keys());
      formulas.clear();
      for (const [key, formula] of meta.formulas) formulas.set(key, formula);
      edits.clear();
      await engine.loadWorkbook(buildSeed(calc, meta));
      await engine.evaluateAll();
      // Union: cells that HELD an edited formula (now plain values again)
      // still need their display reverted.
      for (const key of formulas.keys()) staleKeys.add(key);
      return diffAgainst(before, staleKeys);
    },

    markSaved() {
      edits.clear();
    },

    dispose() {
      disposed = true;
      engine.dispose();
    },
  };
}

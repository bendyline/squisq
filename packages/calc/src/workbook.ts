/**
 * Sparse workbook storage. Sheets keep a Map keyed on packed (row, col)
 * plus a used-extent watermark — the watermark is what makes whole-column
 * references (`A:A`, ubiquitous in real INDEX/MATCH formulas) cheap: a
 * million-row logical range iterates only the rows that exist.
 */

import type { Expr } from './ast.js';
import type { CalcRangeAddress, CalcValue, CalcWorkbookSeed, Staleness } from './types.js';

/** MAX_COL_INDEX is 16383, so packing by 16384 stays exact in a double. */
const COL_SPAN = 16_384;

export const packKey = (row: number, col: number): number => row * COL_SPAN + col;
export const unpackRow = (key: number): number => Math.floor(key / COL_SPAN);
export const unpackCol = (key: number): number => key % COL_SPAN;

export interface CellSlot {
  value: CalcValue;
  formula?: string;
  ast?: Expr;
  /** Set when the formula failed to parse — evaluates to #NAME?. */
  parseFailed?: boolean;
  staleness: Staleness;
  volatile: boolean;
  /** Ranges this formula reads (dependency edges), own-sheet resolved. */
  refs?: CalcRangeAddress[];
}

export class SheetData {
  readonly name: string;
  readonly cells = new Map<number, CellSlot>();
  /** Used extent (inclusive); -1 when empty. */
  maxRow = -1;
  maxCol = -1;

  constructor(name: string) {
    this.name = name;
  }

  get(row: number, col: number): CellSlot | undefined {
    return this.cells.get(packKey(row, col));
  }

  set(row: number, col: number, slot: CellSlot): void {
    this.cells.set(packKey(row, col), slot);
    if (row > this.maxRow) this.maxRow = row;
    if (col > this.maxCol) this.maxCol = col;
  }

  delete(row: number, col: number): void {
    // The watermark only grows — shrinking would need a rescan, and an
    // overshoot merely iterates a few blank cells.
    this.cells.delete(packKey(row, col));
  }
}

export class WorkbookData {
  private readonly byLowerName = new Map<string, SheetData>();
  readonly sheetOrder: string[] = [];
  date1904 = false;
  definedNames = new Map<string, string>();

  sheet(name: string): SheetData | undefined {
    return this.byLowerName.get(name.toLowerCase());
  }

  ensureSheet(name: string): SheetData {
    const existing = this.byLowerName.get(name.toLowerCase());
    if (existing) return existing;
    const created = new SheetData(name);
    this.byLowerName.set(name.toLowerCase(), created);
    this.sheetOrder.push(name);
    return created;
  }

  firstSheetName(): string {
    return this.sheetOrder[0] ?? 'Sheet1';
  }

  *allCells(): IterableIterator<{ sheet: SheetData; row: number; col: number; slot: CellSlot }> {
    for (const name of this.sheetOrder) {
      const sheet = this.byLowerName.get(name.toLowerCase())!;
      for (const [key, slot] of sheet.cells) {
        yield { sheet, row: unpackRow(key), col: unpackCol(key), slot };
      }
    }
  }
}

export function workbookFromSeed(seed: CalcWorkbookSeed): WorkbookData {
  const workbook = new WorkbookData();
  workbook.date1904 = seed.date1904 ?? false;
  for (const [name, formula] of Object.entries(seed.definedNames ?? {})) {
    workbook.definedNames.set(name.toLowerCase(), formula);
  }
  for (const sheetSeed of seed.sheets) {
    const sheet = workbook.ensureSheet(sheetSeed.name);
    for (let row = 0; row < sheetSeed.cells.length; row++) {
      const rowCells = sheetSeed.cells[row]!;
      for (let col = 0; col < rowCells.length; col++) {
        const cell = rowCells[col];
        if (!cell || (cell.value === undefined && cell.formula === undefined)) continue;
        const slot: CellSlot = {
          value: cell.value ?? null,
          staleness: cell.formula !== undefined ? 'neverEvaluated' : 'current',
          volatile: false,
        };
        if (cell.formula !== undefined) slot.formula = cell.formula;
        sheet.set(row, col, slot);
      }
    }
  }
  return workbook;
}

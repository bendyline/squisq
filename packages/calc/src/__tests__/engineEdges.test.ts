/**
 * Engine lifecycle edges the base suite doesn't cover: dependency-graph
 * REWIRING (formula overwrite, value-over-formula, clearCell), defined
 * names as graph edges, cross-sheet dirtiness, used-extent growth under
 * whole-column ranges, the wall-clock budget, iteration caps, and default
 * evaluateFormula context.
 */

import { describe, expect, it } from 'vitest';
import { createInHouseEngine } from '../engine.js';
import { isCalcError } from '../errors.js';
import type { CalcCellAddress } from '../types.js';

const A = (row: number, col: number, sheet = 'S'): CalcCellAddress => ({ sheet, row, col });

describe('dependency rewiring', () => {
  it('overwriting a formula detaches its old precedents', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ value: 1 }, { value: 10 }, { formula: 'A1+B1' }]] }],
    });
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 2))).value).toBe(11);

    engine.setCellFormula(A(0, 2), 'B1*2');
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 2))).value).toBe(20);

    // A1 is no longer a precedent: editing it must not dirty C1.
    engine.setCellValue(A(0, 0), 999);
    expect((await engine.getCell(A(0, 2))).staleness).toBe('current');
    expect(await engine.precedentsOf(A(0, 2))).toEqual([
      { sheet: 'S', startRow: 0, startCol: 1, endRow: 0, endCol: 1 },
    ]);
    engine.dispose();
  });

  it('a plain value over a formula cell freezes it', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ value: 1 }, { formula: 'A1*10' }]] }],
    });
    await engine.evaluateAll();
    engine.setCellValue(A(0, 1), 7);
    engine.setCellValue(A(0, 0), 5);
    await engine.evaluateAll();
    const state = await engine.getCell(A(0, 1));
    expect(state.value).toBe(7);
    expect(state.formula).toBeUndefined();
    engine.dispose();
  });

  it('clearCell dirties dependents, which then read the blank as 0', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ value: 3 }, { formula: 'A1+1' }]] }],
    });
    await engine.evaluateAll();
    engine.clearCell(A(0, 0));
    expect((await engine.getCell(A(0, 1))).staleness).toBe('dirty');
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 1))).value).toBe(1);
    engine.dispose();
  });
});

describe('defined names and sheets', () => {
  it('a defined name participates in the dependency graph', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      definedNames: { RATE: "'S'!$A$1" },
      sheets: [{ name: 'S', cells: [[{ value: 0.25 }, { value: 100 }, { formula: 'B1*RATE' }]] }],
    });
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 2))).value).toBe(25);

    engine.setCellValue(A(0, 0), 0.5);
    expect((await engine.getCell(A(0, 2))).staleness).toBe('dirty');
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 2))).value).toBe(50);
    engine.dispose();
  });

  it('cross-sheet edits propagate', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [
        { name: 'Data', cells: [[{ value: 6 }]] },
        { name: 'View', cells: [[{ formula: "'Data'!A1*2" }]] },
      ],
    });
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 0, 'View'))).value).toBe(12);
    engine.setCellValue(A(0, 0, 'Data'), 10);
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 0, 'View'))).value).toBe(20);
    engine.dispose();
  });

  it('reading an unknown sheet yields an empty state, not a throw', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({ sheets: [{ name: 'S', cells: [[{ value: 1 }]] }] });
    const state = await engine.getCell(A(0, 0, 'Nope'));
    expect(state.value).toBeNull();
    expect(state.formula).toBeUndefined();
    engine.dispose();
  });
});

describe('used extent + whole-column ranges', () => {
  it('a value written below the watermark joins SUM(A:A)', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [
        {
          name: 'S',
          cells: [[{ value: 1 }, { formula: 'SUM(A:A)' }], [{ value: 2 }], [{ value: 3 }]],
        },
      ],
    });
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 1))).value).toBe(6);

    engine.setCellValue(A(9, 0), 10); // beyond the loaded extent
    expect((await engine.getCell(A(0, 1))).staleness).toBe('dirty');
    await engine.evaluateAll();
    expect((await engine.getCell(A(0, 1))).value).toBe(16);
    engine.dispose();
  });
});

describe('budgets + iteration', () => {
  it('stops on the wall-clock budget once enough work has run', async () => {
    const engine = createInHouseEngine();
    const rows = Array.from({ length: 4000 }, () => [{ value: 1 }]);
    rows[0] = [{ value: 1 }, { formula: 'SUM(A:A)' } as never];
    await engine.loadWorkbook({ sheets: [{ name: 'S', cells: rows }] });
    // A deadline already in the past: the first time-check (every ~2048
    // work units) trips it.
    const result = await engine.evaluateAll({ maxEvalTimeMs: -1 });
    expect(result.status).toBe('budget-exceeded');
    expect(result.dirtyRemaining.length).toBeGreaterThan(0);
    engine.dispose();
  });

  it("cyclePolicy 'iterate' caps a non-converging cycle instead of hanging", async () => {
    const engine = createInHouseEngine({ cyclePolicy: 'iterate', iterateMaxIterations: 5 });
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ formula: 'B1+1' }, { formula: 'A1+1' }]] }],
    });
    const result = await engine.evaluateAll();
    expect(result.status).toBe('complete');
    const a = (await engine.getCell(A(0, 0))).value;
    expect(typeof a === 'number' || isCalcError(a as never)).toBe(true);
    engine.dispose();
  });
});

describe('evaluateFormula context', () => {
  it('defaults to the first sheet at A1', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [
        { name: 'First', cells: [[{ value: 42 }]] },
        { name: 'Second', cells: [[{ value: 7 }]] },
      ],
    });
    await engine.evaluateAll();
    expect(await engine.evaluateFormula('=A1')).toBe(42);
    expect(await engine.evaluateFormula('=A1', A(0, 0, 'Second'))).toBe(7);
    engine.dispose();
  });
});

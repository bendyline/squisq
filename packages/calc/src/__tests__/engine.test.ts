/**
 * Engine batch behavior: staleness lifecycle, dependency-driven dirty
 * propagation (direct, range, and whole-column edges), deep chains without
 * stack overflow, volatile recompute, cycle policies, and honest budget
 * stops.
 */

import { describe, expect, it } from 'vitest';
import { createInHouseEngine } from '../engine.js';
import { isCalcError } from '../errors.js';
import type { CalcCellSeed } from '../types.js';

const addr = (row: number, col: number, sheet = 'S') => ({ sheet, row, col });

describe('engine lifecycle', () => {
  it('loads, evaluates, and tracks staleness', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [
        {
          name: 'S',
          cells: [[{ value: 2 }, { value: 3 }, { formula: 'A1*B1' }]],
        },
      ],
    });

    expect((await engine.getCell(addr(0, 2))).staleness).toBe('neverEvaluated');
    const result = await engine.evaluateAll();
    expect(result.status).toBe('complete');
    expect(result.evaluatedCells).toBe(1);
    expect(await engine.getCell(addr(0, 2))).toMatchObject({ value: 6, staleness: 'current' });

    engine.setCellValue(addr(0, 0), 10);
    expect((await engine.getCell(addr(0, 2))).staleness).toBe('dirty');
    await engine.evaluateAll();
    expect((await engine.getCell(addr(0, 2))).value).toBe(30);
    engine.dispose();
  });

  it('propagates dirtiness through chains and whole-column ranges', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [
        {
          name: 'S',
          cells: [[{ value: 1 }, { formula: 'SUM(A:A)' }, { formula: 'B1*10' }], [{ value: 2 }]],
        },
      ],
    });
    await engine.evaluateAll();
    expect((await engine.getCell(addr(0, 1))).value).toBe(3);
    expect((await engine.getCell(addr(0, 2))).value).toBe(30);

    engine.setCellValue(addr(1, 0), 9);
    expect((await engine.getCell(addr(0, 1))).staleness).toBe('dirty');
    expect((await engine.getCell(addr(0, 2))).staleness).toBe('dirty'); // transitive
    await engine.evaluateAll();
    expect((await engine.getCell(addr(0, 2))).value).toBe(100);
    engine.dispose();
  });

  it('evaluates a deep dependency chain without recursion overflow', async () => {
    const rows: CalcCellSeed[][] = [[{ value: 1 }]];
    for (let i = 1; i < 20_000; i++) {
      rows.push([{ formula: `A${i}+1` }]);
    }
    const engine = createInHouseEngine();
    await engine.loadWorkbook({ sheets: [{ name: 'S', cells: rows }] });
    const result = await engine.evaluateAll();
    expect(result.status).toBe('complete');
    expect((await engine.getCell(addr(19_999, 0))).value).toBe(20_000);
    engine.dispose();
  });

  it('recomputes volatile cells every batch', async () => {
    let tick = 0;
    const engine = createInHouseEngine({
      now: () => new Date(2026, 0, 1 + tick),
    });
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ formula: 'DAY(TODAY())' }]] }],
    });
    await engine.evaluateAll();
    expect((await engine.getCell(addr(0, 0))).value).toBe(1);
    expect((await engine.getCell(addr(0, 0))).volatile).toBe(true);
    tick = 5;
    await engine.evaluateAll();
    expect((await engine.getCell(addr(0, 0))).value).toBe(6);
    engine.dispose();
  });

  it('surfaces unparseable formulas as #NAME? instead of throwing', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ formula: 'Table1[Sales]' }]] }],
    });
    await engine.evaluateAll();
    const value = (await engine.getCell(addr(0, 0))).value;
    expect(isCalcError(value) && value.code === '#NAME?').toBe(true);
    engine.dispose();
  });
});

describe('cycles', () => {
  it("policy 'error': cycle cells become #CALC! and the batch says so", async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ formula: 'B1+1' }, { formula: 'A1+1' }]] }],
    });
    const result = await engine.evaluateAll();
    expect(result.status).toBe('cycle-error');
    expect(result.cycleCells.length).toBeGreaterThan(0);
    const value = (await engine.getCell(addr(0, 0))).value;
    expect(isCalcError(value) && value.code === '#CALC!').toBe(true);
    engine.dispose();
  });

  it("policy 'iterate': converges to the fixpoint", async () => {
    const engine = createInHouseEngine({ cyclePolicy: 'iterate' });
    // a = b + 1, b = a / 2  →  a = 2, b = 1.
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ formula: 'B1+1' }, { formula: 'A1/2' }]] }],
    });
    const result = await engine.evaluateAll();
    expect(result.status).toBe('complete');
    expect((await engine.getCell(addr(0, 0))).value as number).toBeCloseTo(2, 2);
    expect((await engine.getCell(addr(0, 1))).value as number).toBeCloseTo(1, 2);
    engine.dispose();
  });
});

describe('budgets', () => {
  it('stops at maxWorkUnits and reports what stayed dirty', async () => {
    const rows: CalcCellSeed[][] = [];
    for (let i = 0; i < 500; i++) {
      rows.push([{ value: i }, { formula: `A${i + 1}*2` }]);
    }
    const engine = createInHouseEngine();
    await engine.loadWorkbook({ sheets: [{ name: 'S', cells: rows }] });

    const limited = await engine.evaluateAll({ maxWorkUnits: 50 });
    expect(limited.status).toBe('budget-exceeded');
    expect(limited.dirtyRemaining.length).toBeGreaterThan(0);
    expect(limited.evaluatedCells).toBeLessThan(500);

    // A later, unconstrained batch finishes the job.
    const finished = await engine.evaluateAll();
    expect(finished.status).toBe('complete');
    expect((await engine.getCell(addr(499, 1))).value).toBe(998);
    engine.dispose();
  });

  it('evaluateFormula respects the config budget by degrading to #CALC!', async () => {
    const rows: CalcCellSeed[][] = [];
    for (let i = 0; i < 2_000; i++) rows.push([{ value: i }]);
    const engine = createInHouseEngine({ budgets: { maxWorkUnits: 100 } });
    await engine.loadWorkbook({ sheets: [{ name: 'S', cells: rows }] });
    const value = await engine.evaluateFormula('SUM(A:A)');
    expect(isCalcError(value) && value.code === '#CALC!').toBe(true);
    engine.dispose();
  });
});

describe('graph queries', () => {
  it('reports precedents and dependents', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [
        { name: 'S', cells: [[{ value: 1 }, { formula: 'A1*2' }, { formula: 'SUM(A1:B1)' }]] },
      ],
    });
    expect(await engine.precedentsOf(addr(0, 1))).toEqual([
      { sheet: 'S', startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
    ]);
    const dependents = await engine.dependentsOf(addr(0, 0));
    expect(dependents).toContainEqual(addr(0, 1));
    expect(dependents).toContainEqual(addr(0, 2));
    engine.dispose();
  });

  it('declares honest capabilities', () => {
    const engine = createInHouseEngine();
    expect(engine.capabilities.functions).toContain('INDEX');
    expect(engine.capabilities.functions).toContain('VLOOKUP');
    expect(engine.capabilities.functions.length).toBeGreaterThanOrEqual(80);
    expect(engine.capabilities.dynamicArrays).toBe(false);
    expect(engine.capabilities.leapYear1900Bug).toBe(true);
    expect(engine.capabilities.volatileFunctions).toContain('NOW');
    expect(engine.capabilities.volatileFunctions).toContain('OFFSET');
    engine.dispose();
  });
});

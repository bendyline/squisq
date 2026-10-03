import { describe, expect, it } from 'vitest';
import { createInHouseEngine } from '../engine.js';
import { DependencyIndex } from '../dependencyGraph.js';
const addr = (col: number) => ({ sheet: 'S', row: 0, col });
describe('review: calculation invariants', () => {
  it('settles an iterative self-cycle before its ordinary dependents', async () => {
    const engine = createInHouseEngine({ cyclePolicy: 'iterate', iterateMaxChange: 0.000001 });
    await engine.loadWorkbook({
      sheets: [{ name: 'S', cells: [[{ formula: '(A1+2)/2' }, { formula: 'A1*10' }]] }],
    });
    expect((await engine.evaluateAll()).status).toBe('complete');
    expect((await engine.getCell(addr(1))).value).toBeCloseTo(20, 4);
    engine.dispose();
  });

  it('does not mistake a diamond of dependencies for a cycle', async () => {
    const engine = createInHouseEngine();
    await engine.loadWorkbook({
      sheets: [
        {
          name: 'S',
          cells: [
            [{ formula: 'B1+C1' }, { formula: 'D1+2' }, { formula: 'D1+3' }, { formula: '7' }],
          ],
        },
      ],
    });
    const result = await engine.evaluateAll();
    expect(result.cycleCells).toEqual([]);
    expect((await engine.getCell(addr(0))).value).toBe(19);
    engine.dispose();
  });

  it('guards recursive names and follows volatility through aliases', async () => {
    let day = 1;
    const engine = createInHouseEngine({ now: () => new Date(2026, 0, day) });
    await engine.loadWorkbook({
      definedNames: { First: 'Second', Second: 'DAY(TODAY())', Loop: 'Loop' },
      sheets: [
        { name: 'S', cells: [[{ formula: 'First' }, { formula: 'A1*10' }, { formula: 'Loop' }]] },
      ],
    });
    await engine.evaluateAll();
    day = 2;
    await engine.evaluateAll();
    expect((await engine.getCell(addr(1))).value).toBe(20);
    expect((await engine.getCell(addr(2))).value).toMatchObject({ code: '#CALC!' });
    engine.dispose();
  });

  it('defers mutation work exceeding the budget without exposing fresh stale results', async () => {
    const engine = createInHouseEngine({ budgets: { maxWorkUnits: 10 } });
    await engine.loadWorkbook({
      sheets: [
        {
          name: 'S',
          cells: [
            [{ value: 1 }],
            ...Array.from({ length: 200 }, (_, i) => [{ formula: `A${i + 1}+1` }]),
          ],
        },
      ],
    });
    await engine.evaluateAll({});
    engine.setCellValue(addr(0), 2);
    expect((await engine.getCell({ sheet: 'S', row: 200, col: 0 })).staleness).toBe('dirty');
    expect((await engine.evaluateAll()).status).toBe('budget-exceeded');
    await engine.evaluateAll({});
    expect((await engine.getCell({ sheet: 'S', row: 200, col: 0 })).value).toBe(202);
    engine.dispose();
  });

  it.each([true, false])('indexes long %s-axis chains without scanning all edges', (vertical) => {
    const edges = Array.from({ length: 32_000 }, (_, i) => ({
      id: i,
      range: {
        sheet: 'S',
        startRow: vertical ? i : 0,
        endRow: vertical ? i : 0,
        startCol: vertical ? 0 : i,
        endCol: vertical ? 0 : i,
      },
    }));
    const index = new DependencyIndex(edges);
    let visited = 0;
    expect(
      [...index.at('s', vertical ? 12000 : 0, vertical ? 0 : 12000, () => visited++)].map(
        (edge) => edge.id,
      ),
    ).toEqual([12000]);
    expect(visited).toBeLessThan(100);
  });
  it('detects a direct self-reference with the default cycle policy', async () => {
    const e = createInHouseEngine();
    try {
      await e.loadWorkbook({ sheets: [{ name: 'S', cells: [[{ formula: 'A1+1' }]] }] });
      const result = await e.evaluateAll();
      expect(result.status).toBe('cycle-error');
    } finally {
      e.dispose();
    }
  });
  it('propagates volatile changes to ordinary dependent formulas', async () => {
    let day = 1;
    const e = createInHouseEngine({ now: () => new Date(2026, 0, day) });
    try {
      await e.loadWorkbook({
        sheets: [{ name: 'S', cells: [[{ formula: 'DAY(TODAY())' }, { formula: 'A1*10' }]] }],
      });
      await e.evaluateAll();
      expect((await e.getCell(addr(1))).value).toBe(10);
      day = 2;
      await e.evaluateAll();
      expect((await e.getCell(addr(0))).value).toBe(2);
      expect((await e.getCell(addr(1))).value).toBe(20);
    } finally {
      e.dispose();
    }
  });
  it('propagates circular-reference errors to formulas downstream', async () => {
    const e = createInHouseEngine();
    try {
      await e.loadWorkbook({
        sheets: [
          { name: 'S', cells: [[{ formula: 'B1+1' }, { formula: 'A1+1' }, { formula: 'A1*10' }]] },
        ],
      });
      expect((await e.evaluateAll()).status).toBe('cycle-error');
      expect((await e.getCell(addr(2))).value).toMatchObject({ code: '#CALC!' });
    } finally {
      e.dispose();
    }
  });
  it('tracks dependencies through nested defined names', async () => {
    const e = createInHouseEngine();
    try {
      await e.loadWorkbook({
        definedNames: { First: 'Second', Second: 'S!A1' },
        sheets: [{ name: 'S', cells: [[{ value: 1 }, { formula: 'First*10' }]] }],
      });
      await e.evaluateAll();
      expect((await e.getCell(addr(1))).value).toBe(10);
      e.setCellValue(addr(0), 3);
      await e.evaluateAll();
      expect((await e.getCell(addr(1))).value).toBe(30);
    } finally {
      e.dispose();
    }
  });
});

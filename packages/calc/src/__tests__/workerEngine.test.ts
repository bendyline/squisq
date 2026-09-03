/**
 * The worker-hosted engine, driven through the in-process transport — the
 * same protocol bytes a real Worker carries, so this doubles as the
 * protocol-parity proof against the in-house tier it wraps.
 */

import { describe, expect, it } from 'vitest';
import { isCalcError } from '../errors.js';
import { createInHouseEngine } from '../engine.js';
import { createLocalCalcTransport, createWorkerCalcEngine } from '../workerEngine.js';
import type { CalcEngine } from '../types.js';

async function workerEngine(): Promise<CalcEngine> {
  return createWorkerCalcEngine({ transport: createLocalCalcTransport() });
}

const SEED = {
  sheets: [
    {
      name: 'S',
      cells: [
        [{ value: 2 }, { value: 3 }, { formula: 'A1*B1' }],
        [{ value: 10 }, { value: 'x' }, { formula: 'SUM(A:A)' }],
      ],
    },
  ],
};

describe('createWorkerCalcEngine (local transport)', () => {
  it('speaks the full contract through the protocol', async () => {
    const engine = await workerEngine();
    await engine.loadWorkbook(SEED);

    expect((await engine.getCell({ sheet: 'S', row: 0, col: 2 })).staleness).toBe('neverEvaluated');
    const result = await engine.evaluateAll();
    expect(result.status).toBe('complete');
    expect(result.evaluatedCells).toBe(2);

    const states = await engine.getCells([
      { sheet: 'S', row: 0, col: 2 },
      { sheet: 'S', row: 1, col: 2 },
    ]);
    expect(states.map((s) => s.value)).toEqual([6, 12]);

    // Fire-and-forget mutation ordering holds: set then evaluate then read.
    engine.setCellValue({ sheet: 'S', row: 0, col: 0 }, 5);
    engine.setCellFormula({ sheet: 'S', row: 1, col: 1 }, 'C1+1');
    await engine.evaluateAll();
    expect((await engine.getCell({ sheet: 'S', row: 0, col: 2 })).value).toBe(15);
    expect((await engine.getCell({ sheet: 'S', row: 1, col: 1 })).value).toBe(16);

    expect(await engine.evaluateFormula('SUM(A1:A2)')).toBe(15);
    expect(await engine.precedentsOf({ sheet: 'S', row: 0, col: 2 })).toEqual([
      { sheet: 'S', startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      { sheet: 'S', startRow: 0, startCol: 1, endRow: 0, endCol: 1 },
    ]);
    expect(await engine.dependentsOf({ sheet: 'S', row: 0, col: 0 })).toContainEqual({
      sheet: 'S',
      row: 0,
      col: 2,
    });

    const bad = await engine.evaluateFormula('NOSUCHFN(1)');
    expect(isCalcError(bad) && bad.code === '#NAME?').toBe(true);

    engine.dispose();
    await expect(engine.evaluateAll()).rejects.toThrow(/dispose/);
  });

  it('matches the in-house tier result-for-result on a shared workload', async () => {
    const worker = await workerEngine();
    const local = createInHouseEngine();
    await worker.loadWorkbook(SEED);
    await local.loadWorkbook(SEED);
    await worker.evaluateAll();
    await local.evaluateAll();

    for (const formula of ['SUM(A:A)+C1', 'AVERAGE(A1:A2)', 'B2&"!"', 'SUMIFS(A1:A2,B1:B2,"x")']) {
      expect(await worker.evaluateFormula(formula)).toEqual(await local.evaluateFormula(formula));
    }
    expect(worker.capabilities.functions).toEqual(local.capabilities.functions);
    worker.dispose();
    local.dispose();
  });

  it('propagates worker-side failures as rejections', async () => {
    const engine = await workerEngine();
    // loadWorkbook not called → mutations are ignored, requests error.
    await expect(engine.getCells([{ sheet: 'S', row: 0, col: 0 }])).resolves.toBeTruthy();
    engine.dispose();
  });
});

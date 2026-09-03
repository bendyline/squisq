/**
 * IronCalc adapter behind the CalcEngine contract, against the REAL wasm
 * (a devDependency here; an optional peer for consumers). Node cannot
 * fetch `file:` URLs, so the wasm bytes are read off disk and passed
 * through the adapter's `wasmSource` option — exactly what a Node host
 * must do.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { isCalcError } from '../errors.js';
import type { CalcEngine } from '../types.js';
import { createIronCalcEngine, isIronCalcAvailable } from '../ironcalc/adapter.js';

const require = createRequire(import.meta.url);

function wasmBytes(): Uint8Array {
  const jsPath = require.resolve('@ironcalc/wasm');
  return readFileSync(jsPath.replace(/wasm\.js$/, 'wasm_bg.wasm'));
}

let engine: CalcEngine;

beforeAll(async () => {
  expect(await isIronCalcAvailable()).toBe(true);
  engine = await createIronCalcEngine({ wasmSource: wasmBytes() });
  await engine.loadWorkbook({
    sheets: [
      {
        name: 'Data',
        cells: [
          [{ value: 10 }, { value: 'alpha' }, { formula: 'A1*2' }],
          [{ value: 20 }, { value: '123' }, { formula: 'SUM(A1:A2)' }],
          [{ value: true }, { value: '=danger' }, { formula: 'B1&"!"' }],
          [null, null, { formula: '1/0' }],
        ],
      },
      {
        name: 'Q3 Notes',
        cells: [[{ formula: "Data!A1+'Q3 Notes'!B1" }, { value: 5 }]],
      },
    ],
    // IronCalc defined names must be sheet-qualified absolute REFERENCES
    // (constants/expressions are refused — see the adapter's note).
    definedNames: { FirstAmount: 'Data!$A$1' },
  });
});

describe('IronCalc adapter', () => {
  it('loads, evaluates, and reads typed values back', async () => {
    const cellC1 = { sheet: 'Data', row: 0, col: 2 };
    expect((await engine.getCell(cellC1)).staleness).toBe('neverEvaluated');
    const result = await engine.evaluateAll();
    expect(result.status).toBe('complete');
    expect(result.evaluatedCells).toBe(5);

    expect(await engine.getCell(cellC1)).toMatchObject({
      value: 20,
      staleness: 'current',
      formula: 'A1*2',
    });
    expect((await engine.getCell({ sheet: 'Data', row: 1, col: 2 })).value).toBe(30);
    expect((await engine.getCell({ sheet: 'Data', row: 2, col: 2 })).value).toBe('alpha!');
    expect((await engine.getCell({ sheet: 'Q3 Notes', row: 0, col: 0 })).value).toBe(15);
  });

  it('preserves seeded value types: numeric strings and =text stay text', async () => {
    expect((await engine.getCell({ sheet: 'Data', row: 1, col: 1 })).value).toBe('123');
    expect((await engine.getCell({ sheet: 'Data', row: 2, col: 1 })).value).toBe('=danger');
    expect((await engine.getCell({ sheet: 'Data', row: 2, col: 0 })).value).toBe(true);
    expect((await engine.getCell({ sheet: 'Data', row: 3, col: 0 })).value).toBeNull();
  });

  it('maps engine errors into the branded error space', async () => {
    const value = (await engine.getCell({ sheet: 'Data', row: 3, col: 2 })).value;
    expect(isCalcError(value) && value.code === '#DIV/0!').toBe(true);
  });

  it('recomputes after edits, with staleness tracked adapter-side', async () => {
    engine.setCellValue({ sheet: 'Data', row: 0, col: 0 }, 100);
    expect((await engine.getCell({ sheet: 'Data', row: 0, col: 2 })).staleness).toBe('dirty');
    const result = await engine.evaluateAll();
    expect(result.status).toBe('complete');
    expect((await engine.getCell({ sheet: 'Data', row: 0, col: 2 })).value).toBe(200);
    expect((await engine.getCell({ sheet: 'Data', row: 1, col: 2 })).value).toBe(120);
    // Restore for the other tests.
    engine.setCellValue({ sheet: 'Data', row: 0, col: 0 }, 10);
    await engine.evaluateAll();
  });

  it('supports formula edits and reference-shaped defined names', async () => {
    engine.setCellFormula({ sheet: 'Data', row: 3, col: 0 }, 'FirstAmount*0.25');
    await engine.evaluateAll();
    expect((await engine.getCell({ sheet: 'Data', row: 3, col: 0 })).value).toBeCloseTo(2.5);
    engine.clearCell({ sheet: 'Data', row: 3, col: 0 });
    await engine.evaluateAll();
    expect((await engine.getCell({ sheet: 'Data', row: 3, col: 0 })).value).toBeNull();
  });

  it('enforces the pre-flight work budget without starting the wasm call', async () => {
    engine.setCellValue({ sheet: 'Data', row: 0, col: 0 }, 11);
    const refused = await engine.evaluateAll({ maxWorkUnits: 1 });
    expect(refused.status).toBe('budget-exceeded');
    expect(refused.evaluatedCells).toBe(0);
    expect(refused.dirtyRemaining.length).toBeGreaterThan(1);
    // Dirty cells are still dirty; a real budget then completes the batch.
    const finished = await engine.evaluateAll();
    expect(finished.status).toBe('complete');
    expect((await engine.getCell({ sheet: 'Data', row: 0, col: 2 })).value).toBe(22);
    engine.setCellValue({ sheet: 'Data', row: 0, col: 0 }, 10);
    await engine.evaluateAll();
  });

  it('evaluates one-off formulas via the scratch cell', async () => {
    expect(await engine.evaluateFormula('SUM(Data!A1:A2)+1')).toBe(31);
    expect(await engine.evaluateFormula('Data!B1&"?"')).toBe('alpha?');
    const bad = await engine.evaluateFormula('NOSUCHFN(1)');
    expect(isCalcError(bad) && bad.code === '#NAME?').toBe(true);
  });

  it('answers graph queries from the parser (IronCalc has no graph API)', async () => {
    const precedents = await engine.precedentsOf({ sheet: 'Data', row: 1, col: 2 });
    expect(precedents).toEqual([{ sheet: 'Data', startRow: 0, startCol: 0, endRow: 1, endCol: 0 }]);
    const dependents = await engine.dependentsOf({ sheet: 'Data', row: 0, col: 0 });
    expect(dependents).toContainEqual({ sheet: 'Data', row: 0, col: 2 });
    expect(dependents).toContainEqual({ sheet: 'Data', row: 1, col: 2 });
    expect(dependents).toContainEqual({ sheet: 'Q3 Notes', row: 0, col: 0 });
  });

  it('declares honest capabilities', async () => {
    expect(engine.capabilities.dynamicArrays).toBe(true);
    expect(engine.capabilities.iterativeCalc).toBe(false);
    expect(engine.capabilities.leapYear1900Bug).toBe(true);
  });
});

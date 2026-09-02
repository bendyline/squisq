/**
 * The Phase-3 release gate: the in-house calc engine vs the cached-value
 * oracle. Every eligible formula (same filters as oracleExtract.test.ts)
 * is evaluated in VALUES CONTEXT — the workbook is seeded with cached
 * values only, so each formula's references resolve to its neighbors'
 * cached results — and compared against the cell's own cached value with
 * IronCalc compare.rs rules (relative ε 5e-8; date serials normalized to
 * the importer's ISO strings).
 *
 * Classification is honest about correctness vs coverage:
 *  - `#NAME?` results are UNSUPPORTED (unknown function, defined name, or
 *    syntax) — a coverage gap, never counted as a wrong answer;
 *  - budget stops count separately;
 *  - everything else is pass/fail, and the floor applies to the pass rate
 *    over SUPPORTED pairs.
 *
 * Report: `.corpus/report/calc-oracle.json` (per-function stats + a
 * sample of mismatches for debugging).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_DIR, corpusAvailable, entryBytes, presentEntries } from './corpusFiles';

const VOLATILE = new Set([
  'NOW',
  'TODAY',
  'RAND',
  'RANDBETWEEN',
  'RANDARRAY',
  'OFFSET',
  'INDIRECT',
  'CELL',
  'INFO',
]);

const FUNCTION_NAME_RE = /(?:_xlfn\.)?([A-Z][A-Z0-9._]*)\s*\(/gi;

function functionsIn(formula: string): string[] {
  const names: string[] = [];
  for (const match of formula.matchAll(FUNCTION_NAME_RE)) {
    names.push(match[1]!.toUpperCase());
  }
  return names;
}

/** IronCalc compare.rs: relative epsilon against max(1, |expected|). */
const EPSILON = 5e-8;

function numbersMatch(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= EPSILON * Math.max(1, Math.abs(expected));
}

const MIN_SUPPORTED_PAIRS = 50;
const SUPPORTED_PASS_FLOOR = 0.99;

interface Mismatch {
  file: string;
  sheet: string;
  ref: string;
  formula: string;
  expected: unknown;
  actual: unknown;
}

describe('calc engine vs cached-value oracle', () => {
  // The INDEX/MATCH stress workbook alone is minutes of honest work.
  it(
    'evaluates eligible pairs in values context and meets the pass floor',
    { timeout: 900_000 },
    async () => {
      if (!corpusAvailable()) return;
      const entries = presentEntries('xlsx');
      if (entries.length === 0) return;

      const { xlsxToCellGrids, formatCellRef } = await import('@bendyline/squisq-formats/xlsx');
      const { createInHouseEngine, isCalcError, isoFromSerial, serialFromIso } =
        await import('@bendyline/squisq-calc');

      let supported = 0;
      let passed = 0;
      let unsupported = 0;
      let budgetStopped = 0;
      const perFunction = new Map<string, { supported: number; passed: number }>();
      const mismatches: Mismatch[] = [];

      for (const entry of entries) {
        let grids;
        try {
          grids = await xlsxToCellGrids(entryBytes(entry));
        } catch {
          continue; // the sweep test owns import-failure reporting
        }

        // Seed with VALUES only — cached results stand in for precedents.
        // Date cells seed as serials: a formula referencing a date cell
        // expects a number, and the importer normalized the value to ISO.
        const engine = createInHouseEngine({
          date1904: grids.date1904,
          budgets: { maxWorkUnits: 5_000_000, maxEvalTimeMs: 20_000 },
        });
        await engine.loadWorkbook({
          sheets: grids.sheets.map((sheet) => ({
            name: sheet.name,
            cells: sheet.cells.map((row) =>
              row.map((cell) => {
                if (!cell || cell.value === undefined) return null;
                if (cell.kind === 'date' && typeof cell.value === 'string') {
                  const serial = serialFromIso(cell.value, grids.date1904);
                  return serial === null ? { value: cell.value } : { value: serial };
                }
                return { value: cell.value };
              }),
            ),
          })),
          date1904: grids.date1904,
        });

        for (let sheetIndex = 0; sheetIndex < grids.sheets.length; sheetIndex++) {
          const sheet = grids.sheets[sheetIndex]!;
          for (let row = 0; row < sheet.cells.length; row++) {
            const cells = sheet.cells[row]!;
            for (let col = 0; col < cells.length; col++) {
              const cell = cells[col];
              if (!cell?.formula) continue;
              if (grids.fullCalcOnLoad) continue;
              if (cell.value === undefined) continue;
              if (cell.kind === 'error') continue;
              const names = functionsIn(cell.formula);
              if (names.some((name) => VOLATILE.has(name))) continue;
              if (/\[\d+\]/.test(cell.formula)) continue;
              if (names.includes('HYPERLINK')) continue;

              const actual = engine.evaluateFormula(cell.formula, {
                sheet: sheet.name,
                row,
                col,
              });

              if (isCalcError(actual) && actual.code === '#NAME?') {
                unsupported++;
                continue;
              }
              if (isCalcError(actual) && actual.code === '#CALC!') {
                budgetStopped++;
                continue;
              }

              supported++;
              const topFunctions = names.length > 0 ? names : ['<no-function>'];

              let match = false;
              const expected = cell.value;
              if (isCalcError(actual)) {
                match = false;
              } else if (typeof expected === 'number' && typeof actual === 'number') {
                match = numbersMatch(actual, expected);
              } else if (typeof expected === 'boolean') {
                match = actual === expected;
              } else if (typeof expected === 'string') {
                if (typeof actual === 'string') {
                  match = actual === expected;
                } else if (typeof actual === 'number' && cell.kind === 'date') {
                  // The importer normalized the cached serial to ISO.
                  match = isoFromSerial(actual, grids.date1904) === expected;
                } else {
                  match = false;
                }
              } else if (typeof actual === 'number' && typeof expected !== 'number') {
                match = false;
              }

              if (match) {
                passed++;
              } else if (mismatches.length < 100) {
                mismatches.push({
                  file: entry.id,
                  sheet: sheet.name,
                  ref: formatCellRef(row, col),
                  formula: cell.formula,
                  expected,
                  actual: isCalcError(actual) ? actual.code : actual,
                });
              }
              for (const name of topFunctions) {
                const stat = perFunction.get(name) ?? { supported: 0, passed: 0 };
                stat.supported++;
                if (match) stat.passed++;
                perFunction.set(name, stat);
              }
            }
          }
        }
        engine.dispose();
      }

      const passRate = supported === 0 ? 0 : passed / supported;
      const byFunction = [...perFunction.entries()]
        .sort((a, b) => b[1].supported - a[1].supported)
        .map(([name, stat]) => ({
          name,
          supported: stat.supported,
          passed: stat.passed,
          rate: stat.supported === 0 ? 0 : Number((stat.passed / stat.supported).toFixed(4)),
        }));

      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(
        resolve(REPORT_DIR, 'calc-oracle.json'),
        `${JSON.stringify(
          {
            workbooks: entries.length,
            supported,
            passed,
            passRate: Number(passRate.toFixed(4)),
            unsupported,
            budgetStopped,
            byFunction,
            mismatchSample: mismatches,
          },
          null,
          2,
        )}\n`,
      );

      console.log(
        `[corpus] calc oracle: ${passed}/${supported} supported pairs pass ` +
          `(${(passRate * 100).toFixed(2)}%), ${unsupported} unsupported, ` +
          `${budgetStopped} budget-stopped.`,
      );
      console.log(
        `[corpus] by function: ${byFunction
          .slice(0, 10)
          .map((f) => `${f.name} ${f.passed}/${f.supported}`)
          .join(', ')}`,
      );

      expect(supported).toBeGreaterThanOrEqual(MIN_SUPPORTED_PAIRS);
      expect(passRate).toBeGreaterThanOrEqual(SUPPORTED_PASS_FLOOR);
    },
  );
});

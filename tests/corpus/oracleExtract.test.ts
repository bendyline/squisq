/**
 * Cached-value oracle extraction: real XLSX files store each formula's
 * last-computed value, so formula+value pairs are free correctness
 * assertions for a calculation engine. This test walks every corpus
 * workbook's raw cell grids (`xlsxToCellGrids` keeps `formula` and cached
 * `value` colocated on each `XlsxCell`) and writes the oracle dataset to
 * `.corpus/report/oracle-pairs.json` — the input the engine gap-analysis
 * spike evaluates IronCalc/Formualizer against.
 *
 * Eligibility (the filters IronCalc's own compare.rs prior art uses):
 *  - workbook not flagged `<calcPr fullCalcOnLoad>` (producer disowned cache)
 *  - cell has BOTH a formula and a cached value (`import.ts` leaves `value`
 *    undefined for never-evaluated cells — the free skip predicate)
 *  - formula mentions no volatile/clock function
 *  - cell is not an error (`kind === 'error'` carries no comparable value)
 *  - formula has no external-workbook reference (`'[1]Sheet'!A1` caches
 *    values from a file no engine has) and is not HYPERLINK (caches display
 *    text, not a calculation result) — the spike's first run showed these
 *    two categories account for essentially all false "mismatches"
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_DIR, corpusAvailable, entryBytes, presentEntries } from './corpusFiles';

/** IronCalc's oracle skip list plus the RAND family. */
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

const MIN_ELIGIBLE_PAIRS = 50;

describe('cached-value oracle extraction', () => {
  it('extracts formula/value pairs and writes the oracle dataset', async () => {
    if (!corpusAvailable()) return;
    const entries = presentEntries('xlsx');
    if (entries.length === 0) return;

    const { xlsxToCellGrids } = await import('@bendyline/squisq-formats/xlsx');

    const perFile: unknown[] = [];
    const functionHistogram = new Map<string, number>();
    let totalFormulaCells = 0;
    let totalEligible = 0;
    let fullCalcExcluded = 0;

    for (const entry of entries) {
      let grids;
      try {
        grids = await xlsxToCellGrids(entryBytes(entry));
      } catch {
        continue; // sweep test owns import-failure reporting
      }

      let formulaCells = 0;
      let eligible = 0;
      const fileFunctions = new Map<string, number>();

      for (const sheet of grids.sheets) {
        for (const row of sheet.cells) {
          for (const cell of row) {
            if (!cell?.formula) continue;
            formulaCells++;
            if (grids.fullCalcOnLoad) continue;
            if (cell.value === undefined) continue; // never-evaluated
            if (cell.kind === 'error') continue;
            const names = functionsIn(cell.formula);
            if (names.some((name) => VOLATILE.has(name))) continue;
            // External-workbook refs cache values from a file the engine
            // doesn't have; HYPERLINK caches display text, not a result.
            if (/\[\d+\]/.test(cell.formula)) continue;
            if (names.includes('HYPERLINK')) continue;
            eligible++;
            for (const name of names) {
              fileFunctions.set(name, (fileFunctions.get(name) ?? 0) + 1);
              functionHistogram.set(name, (functionHistogram.get(name) ?? 0) + 1);
            }
          }
        }
      }

      totalFormulaCells += formulaCells;
      totalEligible += eligible;
      if (grids.fullCalcOnLoad && formulaCells > 0) fullCalcExcluded++;

      perFile.push({
        id: entry.id,
        fullCalcOnLoad: grids.fullCalcOnLoad,
        date1904: grids.date1904,
        sheets: grids.sheets.length,
        formulaCells,
        eligibleCells: eligible,
        functions: Object.fromEntries([...fileFunctions.entries()].sort((a, b) => b[1] - a[1])),
      });
    }

    const histogram = [...functionHistogram.entries()].sort((a, b) => b[1] - a[1]);
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(
      resolve(REPORT_DIR, 'oracle-pairs.json'),
      `${JSON.stringify(
        {
          generatedFrom: entries.length,
          totalFormulaCells,
          totalEligible,
          fullCalcExcludedFiles: fullCalcExcluded,
          functionHistogram: Object.fromEntries(histogram),
          files: perFile,
        },
        null,
        2,
      )}\n`,
    );

    console.log(
      `[corpus] oracle: ${totalEligible} eligible pairs from ${totalFormulaCells} formula cells ` +
        `across ${entries.length} workbooks (${fullCalcExcluded} excluded by fullCalcOnLoad).`,
    );
    console.log(
      `[corpus] top functions: ${histogram
        .slice(0, 15)
        .map(([name, count]) => `${name}×${count}`)
        .join(', ')}`,
    );

    // The tier is self-checking: a corpus that yields almost no oracle pairs
    // can't validate an engine and needs different sources.
    expect(totalEligible).toBeGreaterThanOrEqual(MIN_ELIGIBLE_PAIRS);
  });
});

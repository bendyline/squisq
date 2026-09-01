/**
 * Corpus import sweep: every fetched real-world file through the importers,
 * outcomes classified against the manifest's `expected` field.
 *
 * A `ZipSafetyError` (or any structured refusal) on a file the manifest
 * expects to import is a REPORTED deviation, and the suite asserts an
 * aggregate floor rather than per-file perfection — real-world files include
 * mislabeled formats and producer quirks, and the interesting signal is the
 * failure taxonomy, not a binary pass.
 */

import { describe, expect, it } from 'vitest';
import { corpusAvailable, entryBytes, presentEntries } from './corpusFiles';

const IMPORT_FLOOR = 0.8;

describe('corpus import sweep', () => {
  it('imports the XLSX corpus at or above the floor', async () => {
    if (!corpusAvailable()) return;
    const entries = presentEntries('xlsx');
    if (entries.length === 0) return;

    const { xlsxToMarkdownDoc, xlsxToTables } = await import('@bendyline/squisq-formats/xlsx');
    const failures: string[] = [];
    let ok = 0;

    for (const entry of entries) {
      try {
        const bytes = entryBytes(entry);
        const markdownDoc = await xlsxToMarkdownDoc(bytes);
        expect(Array.isArray(markdownDoc.children)).toBe(true);
        await xlsxToTables(bytes);
        ok++;
      } catch (err: unknown) {
        const code = (err as { code?: unknown })?.code;
        failures.push(
          `${entry.id}: ${typeof code === 'string' ? code : ''} ${
            err instanceof Error ? err.message.slice(0, 120) : String(err)
          }`,
        );
      }
    }

    console.log(`[corpus] xlsx sweep: ${ok}/${entries.length} imported cleanly.`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    expect(ok / entries.length).toBeGreaterThanOrEqual(IMPORT_FLOOR);
  });

  it('imports the CSV corpus at or above the floor', async () => {
    if (!corpusAvailable()) return;
    const entries = presentEntries('csv');
    if (entries.length === 0) return;

    const { csvToMarkdownDoc } = await import('@bendyline/squisq-formats/csv');
    const { csvDataReader } = await import('@bendyline/squisq-formats/data');
    const failures: string[] = [];
    let ok = 0;

    for (const entry of entries) {
      try {
        const bytes = entryBytes(entry);
        const markdownDoc = await csvToMarkdownDoc(bytes);
        expect(Array.isArray(markdownDoc.children)).toBe(true);
        const table = await csvDataReader.read(bytes, { maxRows: 25 });
        expect(table.totalCols).toBeGreaterThan(0);
        ok++;
      } catch (err: unknown) {
        failures.push(
          `${entry.id}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
        );
      }
    }

    console.log(`[corpus] csv sweep: ${ok}/${entries.length} imported cleanly.`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    expect(ok / entries.length).toBeGreaterThanOrEqual(IMPORT_FLOOR);
  });
});

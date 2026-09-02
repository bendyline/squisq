/**
 * XLSX formula editing end-to-end at the data-card layer: ingest a
 * workbook carrying a formula, boot the calc-engine session, edit formulas
 * (recalc updates, validation errors, budget discipline), and save through
 * the in-place patcher — then re-ingest and see the new formula.
 */

import { describe, expect, it } from 'vitest';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { markdownDocToXlsx, patchXlsxCellValues } from '@bendyline/squisq-formats/xlsx';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { EditJournal } from '@bendyline/squisq-grid-react';
import { ingestSidecarBytes } from '../dataCard/ingestAdapters';
import { createXlsxFormulaSession } from '../dataCard/formulaSupport';
import { saveXlsxEdits } from '../dataCard/gridSave';

/** Values workbook + one real formula cell (B4 = B2+B3, cached 350). */
async function workbookBytes(): Promise<ArrayBuffer> {
  const markdown = [
    '## Sales {[dataTable sheet=Sales anchor=A1]}',
    '',
    '| Region | Revenue |',
    '| --- | --- |',
    '| West | 100 |',
    '| East | 250 |',
    '| Total | 0 |',
  ].join('\n');
  const values = await markdownDocToXlsx(parseMarkdown(markdown));
  return patchXlsxCellValues(values, [
    { sheet: 'Sales', ref: 'B4', formula: 'B2+B3', cachedValue: 350 },
  ]);
}

function makeProvider(): MediaProvider & { saved: ArrayBuffer[] } {
  const saved: ArrayBuffer[] = [];
  return {
    saved,
    async resolveUrl(p: string) {
      return p;
    },
    async listMedia(): Promise<MediaEntry[]> {
      return [];
    },
    async addMedia(name: string, data: ArrayBuffer | Blob | Uint8Array) {
      const bytes: ArrayBuffer = ArrayBuffer.isView(data)
        ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
        : 'byteLength' in data
          ? (data as ArrayBuffer)
          : await (data as Blob).arrayBuffer();
      saved.push(bytes);
      return name;
    },
    async removeMedia() {},
    dispose() {},
  };
}

describe('XLSX formula session', () => {
  it('ingests formulas, edits with live recalc, and saves through the patcher', async () => {
    const bytes = await workbookBytes();
    const ingested = await ingestSidecarBytes(bytes, 'xlsx', {});
    expect(ingested.xlsx).toBeDefined();
    // The imported formula rides the metadata (body row 2 = sheet row 4).
    expect(ingested.xlsx!.formulas.get('2:1')).toBe('B2+B3');

    const session = (await createXlsxFormulaSession(ingested.xlsx!))!;
    expect(session).not.toBeNull();
    expect(session.getFormula(2, 1)).toBe('B2+B3');
    expect(session.isCellLocked(2, 1)).toBe(false); // formulas edit now
    expect(session.dirtyCount).toBe(0);

    // Edit the formula: the update for the edited cell comes back.
    const commit = await session.commitFormula(2, 1, 'B2*B3');
    expect(commit.ok).toBe(true);
    expect(commit.updates).toContainEqual({ rowId: 2, col: 1, value: 25_000 });
    expect(session.getFormula(2, 1)).toBe('B2*B3');
    expect(session.dirtyCount).toBe(1);

    // A value edit feeds the engine AND returns the live dependent updates.
    const liveUpdates = await session.noteValueEdit(0, 1, 200);
    expect(liveUpdates).toContainEqual({ rowId: 2, col: 1, value: 200 * 250 });
    const recommit = await session.commitFormula(2, 1, 'SUM(B2:B3)');
    expect(recommit.ok).toBe(true);
    expect(recommit.updates).toContainEqual({ rowId: 2, col: 1, value: 450 });

    // Validation: a broken formula reports instead of committing.
    const bad = await session.commitFormula(2, 1, 'SUM(');
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
    expect(session.getFormula(2, 1)).toBe('SUM(B2:B3)');

    // Save: value edit via the journal, formula via the session.
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 100, next: 200 }]);
    const provider = makeProvider();
    const result = await saveXlsxEdits({
      path: 'r_files/data/book.xlsx',
      originalBytes: bytes,
      xlsx: ingested.xlsx!,
      journal,
      formulaEdits: session.formulaEdits(),
      mediaProvider: provider,
      container: null,
    });
    expect(result.ok).toBe(true);

    const reingested = await ingestSidecarBytes(provider.saved[0]!, 'xlsx', {});
    expect(reingested.xlsx!.formulas.get('2:1')).toBe('SUM(B2:B3)');
    expect(reingested.ingest.cells[0]![1]).toBe(200);
    expect(reingested.ingest.cells[2]![1]).toBe(450); // the saved cachedValue

    session.dispose();
  });

  it('discard reverts formulas and reports the display updates to undo', async () => {
    const bytes = await workbookBytes();
    const ingested = await ingestSidecarBytes(bytes, 'xlsx', {});
    const session = (await createXlsxFormulaSession(ingested.xlsx!))!;

    const commit = await session.commitFormula(2, 1, 'B2*B3');
    expect(commit.ok).toBe(true);
    expect(session.dirtyCount).toBe(1);

    const updates = await session.discard();
    expect(session.dirtyCount).toBe(0);
    expect(session.getFormula(2, 1)).toBe('B2+B3');
    expect(updates).toContainEqual({ rowId: 2, col: 1, value: 350 });
    session.dispose();
  });

  it('adding a formula to a plain value cell works and records for save', async () => {
    const bytes = await workbookBytes();
    const ingested = await ingestSidecarBytes(bytes, 'xlsx', {});
    const session = (await createXlsxFormulaSession(ingested.xlsx!))!;

    // "West"'s revenue becomes a formula.
    const commit = await session.commitFormula(0, 1, '40*5');
    expect(commit.ok).toBe(true);
    expect(commit.updates).toContainEqual({ rowId: 0, col: 1, value: 200 });
    expect(session.getFormula(0, 1)).toBe('40*5');
    // The dependent total recalculates too.
    expect(commit.updates).toContainEqual({ rowId: 2, col: 1, value: 450 });
    const record = session.formulaEdits().get('0:1')!;
    expect(record).toMatchObject({ formula: '40*5', cachedValue: 200 });
    session.dispose();
  });
});

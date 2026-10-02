import { describe, expect, it } from 'vitest';
import { createInHouseEngine } from '@bendyline/squisq-calc';
import { EditJournal, journalFor, discardJournal } from '@bendyline/squisq-grid-react';
import { ingestSidecarBytes } from '../dataCard/ingestAdapters';
import { saveCsvEdits, saveXlsxEdits } from '../dataCard/gridSave';
import { createXlsxFormulaSession } from '../dataCard/formulaSupport';
import {
  markdownDocToXlsx,
  patchXlsxCellValues,
  xlsxToCellGrids,
} from '@bendyline/squisq-formats/xlsx';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MediaProvider } from '@bendyline/squisq/schemas';

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const factory = async (config: Parameters<typeof createInHouseEngine>[0]) =>
  createInHouseEngine(config);
function provider() {
  const saved: ArrayBuffer[] = [];
  const media: MediaProvider = {
    resolveUrl: async (p) => p,
    listMedia: async () => [],
    removeMedia: async () => {},
    dispose() {},
    addMedia: async (name, data) => {
      const bytes = ArrayBuffer.isView(data)
        ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
        : 'byteLength' in data
          ? (data as ArrayBuffer)
          : await data.arrayBuffer();
      saved.push(bytes);
      return name;
    },
  };
  return { media, saved };
}
async function workbook(twoSheets = false) {
  const text =
    '## Sales {[dataTable sheet=Sales anchor=A1]}\n\n| Item | Value |\n| --- | --- |\n| Input | 100 |\n| Total | 0 |\n' +
    (twoSheets
      ? '\n## Rates {[dataTable sheet=Rates anchor=A1]}\n\n| Item | Value |\n| --- | --- |\n| Rate | 2 |\n'
      : '');
  const bytes = await markdownDocToXlsx(parseMarkdown(text));
  return patchXlsxCellValues(bytes, [
    { sheet: 'Sales', ref: 'B3', formula: twoSheets ? 'B2*Rates!B2' : 'B2*2', cachedValue: 200 },
  ]);
}

describe('review: data card persistence', () => {
  it('discards to the most recent saved workbook without requiring a remount', async () => {
    const bytes = await workbook();
    const ingested = await ingestSidecarBytes(bytes, 'xlsx', {});
    const session = (await createXlsxFormulaSession(ingested.xlsx!, { engineFactory: factory }))!;
    try {
      await session.commitFormula(1, 1, 'B2*3');
      const snapshot = session.formulaEdits();
      const p = provider();
      const saved = await saveXlsxEdits({
        path: 'book.xlsx',
        originalBytes: bytes,
        xlsx: ingested.xlsx!,
        journal: new EditJournal(),
        formulaEdits: snapshot,
        mediaProvider: p.media,
        container: null,
      });
      expect(saved.ok).toBe(true);
      const baseline = await ingestSidecarBytes(saved.bytes!, 'xlsx', {});
      session.markSaved(snapshot, baseline.xlsx);
      await session.commitFormula(1, 1, 'B2*4');
      expect(await session.discard()).toContainEqual({ rowId: 1, col: 1, value: 300 });
      expect(session.getFormula(1, 1)).toBe('B2*3');
      expect(session.dirtyCount).toBe(0);
    } finally {
      session.dispose();
    }
  });
  it('serializes saves from different regions without reverting either edit', async () => {
    const bytes = await workbook(true);
    const sales = await ingestSidecarBytes(bytes, 'xlsx', { sheet: 'Sales' });
    const rates = await ingestSidecarBytes(bytes, 'xlsx', { sheet: 'Rates' });
    const p = provider();
    const a = new EditJournal();
    const b = new EditJournal();
    a.commit([{ rowId: 0, col: 1, prev: 100, next: 999 }]);
    b.commit([{ rowId: 0, col: 1, prev: 2, next: 3 }]);
    const shared = {
      path: 'book.xlsx',
      originalBytes: bytes,
      mediaProvider: p.media,
      container: null,
    };
    const saved = await Promise.all([
      saveXlsxEdits({ ...shared, journal: a, xlsx: sales.xlsx! }),
      saveXlsxEdits({ ...shared, journal: b, xlsx: rates.xlsx! }),
    ]);
    expect(saved.every((result) => result.ok)).toBe(true);
    const reloaded = await xlsxToCellGrids(p.saved[1]!);
    expect(reloaded.sheets.find((sheet) => sheet.name === 'Sales')!.cells[1]![1]!.value).toBe(999);
    expect(reloaded.sheets.find((sheet) => sheet.name === 'Rates')!.cells[1]![1]!.value).toBe(3);
  });

  it('keeps a formula edited again while its previous version was saving', async () => {
    const ingested = await ingestSidecarBytes(await workbook(), 'xlsx', {});
    const session = (await createXlsxFormulaSession(ingested.xlsx!, { engineFactory: factory }))!;
    try {
      await session.commitFormula(1, 1, 'B2*3');
      const snapshot = session.formulaEdits();
      await session.commitFormula(1, 1, 'B2*4');
      session.markSaved(snapshot);
      expect(session.formulaEdits().get('1:1')).toMatchObject({
        formula: 'B2*4',
        cachedValue: 400,
      });
    } finally {
      session.dispose();
    }
  });

  it('honors a region header override in its edit addresses', async () => {
    const ingested = await ingestSidecarBytes(await workbook(), 'xlsx', {
      sheet: 'Sales',
      headerRow: false,
    });
    expect(ingested.xlsx?.hasHeader).toBe(false);
    expect(ingested.ingest.cells[0]).toEqual(['Item', 'Value']);
    expect(ingested.xlsx?.formulas.get('2:1')).toBe('B2*2');
  });
  it('retains edits committed while the provider is saving', async () => {
    const bytes = encode('Name,Value\na,1\nb,2\n');
    const ingested = await ingestSidecarBytes(bytes, 'csv', {});
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 1, next: 5 }]);
    const p = provider();
    const write = p.media.addMedia;
    p.media.addMedia = async (...args) => {
      journal.commit([{ rowId: 1, col: 1, prev: 2, next: 7 }]);
      return write(...args);
    };
    const result = await saveCsvEdits({
      path: 'data.csv',
      originalBytes: bytes,
      csv: ingested.csv!,
      journal,
      mediaProvider: p.media,
      container: null,
    });
    expect(result.ok).toBe(true);
    expect(new TextDecoder().decode(p.saved[0])).toContain('b,2');
    expect(journal.entries()).toContainEqual({ rowId: 1, col: 1, prev: 2, next: 7 });
  });
  it('preserves other sheets for cross-sheet formulas when selecting a sheet', async () => {
    const ingested = await ingestSidecarBytes(await workbook(true), 'xlsx', {
      sheet: 'Sales',
      anchor: 'A1',
    });
    const session = (await createXlsxFormulaSession(ingested.xlsx!, { engineFactory: factory }))!;
    try {
      const edit = await session.commitFormula(1, 1, 'B2*Rates!B2');
      expect(edit.ok).toBe(true);
      expect(session.formulaEdits().get('1:1')?.cachedValue).toBe(200);
    } finally {
      session.dispose();
    }
  });
  it('saves the current cached value after an edited formula recalculates', async () => {
    const bytes = await workbook();
    const ingested = await ingestSidecarBytes(bytes, 'xlsx', {});
    const session = (await createXlsxFormulaSession(ingested.xlsx!, { engineFactory: factory }))!;
    try {
      await session.commitFormula(1, 1, 'B2*3');
      expect(await session.noteValueEdit(0, 1, 200)).toContainEqual({
        rowId: 1,
        col: 1,
        value: 600,
      });
      const journal = new EditJournal();
      journal.commit([{ rowId: 0, col: 1, prev: 100, next: 200 }]);
      const p = provider();
      const result = await saveXlsxEdits({
        path: 'book.xlsx',
        originalBytes: bytes,
        xlsx: ingested.xlsx!,
        journal,
        formulaEdits: session.formulaEdits(),
        mediaProvider: p.media,
        container: null,
      });
      expect(result.ok).toBe(true);
      const reloaded = await xlsxToCellGrids(p.saved[0]!);
      expect(reloaded.sheets[0]!.cells[2]![1]!.value).toBe(600);
    } finally {
      session.dispose();
    }
  });
  it('can save replacing an editable formula with a plain number', async () => {
    const bytes = await workbook();
    const ingested = await ingestSidecarBytes(bytes, 'xlsx', {});
    const session = (await createXlsxFormulaSession(ingested.xlsx!, { engineFactory: factory }))!;
    try {
      expect(session.isCellLocked(1, 1)).toBe(false);
      await session.noteValueEdit(1, 1, 999);
      const journal = new EditJournal();
      journal.commit([{ rowId: 1, col: 1, prev: 200, next: 999 }]);
      const p = provider();
      const result = await saveXlsxEdits({
        path: 'book.xlsx',
        originalBytes: bytes,
        xlsx: ingested.xlsx!,
        journal,
        formulaEdits: session.formulaEdits(),
        mediaProvider: p.media,
        container: null,
      });
      expect(result.ok, result.error).toBe(true);
    } finally {
      session.dispose();
    }
  });
  it("does not apply one sheet's journal to a different sheet in the same file", async () => {
    const path = 'shared-workbook.xlsx';
    discardJournal(path);
    const bytes = await workbook(true);
    const owner = {};
    const salesScope = { owner, region: 'Sales!A1:header' };
    const ratesScope = { owner, region: 'Rates!A1:header' };
    const salesJournal = journalFor(path, 0, salesScope);
    salesJournal.commit([{ rowId: 0, col: 1, prev: 100, next: 999 }]);
    const rates = await ingestSidecarBytes(bytes, 'xlsx', { sheet: 'Rates', anchor: 'A1' });
    const ratesJournal = journalFor(path, 0, ratesScope);
    const p = provider();
    await saveXlsxEdits({
      path,
      originalBytes: bytes,
      xlsx: rates.xlsx!,
      journal: ratesJournal,
      mediaProvider: p.media,
      container: null,
    });
    const reloaded = await xlsxToCellGrids(p.saved[0]!);
    discardJournal(path, salesScope);
    discardJournal(path, ratesScope);
    expect(reloaded.sheets.find((s) => s.name === 'Rates')!.cells[1]![1]!.value).toBe(2);
  });
});

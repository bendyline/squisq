/**
 * saveCsvEdits — the CSV/TSV in-place save flow: `.versions/data/` backup
 * first, journal edits splatted onto the PARSE baseline (unedited cells
 * byte-faithful — the `-5` regression), formula neutralization ONLY on
 * edited non-numeric cells, source conventions (delimiter/newline/trailing/
 * BOM) reproduced, fork detection when the host renames on save.
 */

import { describe, expect, it } from 'vitest';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { DATA_BACKUP_PREFIX, buildDataBackupPath } from '@bendyline/squisq/versions';
import { EditJournal } from '@bendyline/squisq-grid-react';
import { ingestSidecarBytes } from '../dataCard/ingestAdapters';
import { saveCsvEdits } from '../dataCard/gridSave';

const PATH = 'report_files/data/q3.csv';

interface FakeProvider extends MediaProvider {
  saved: { path: string; bytes: ArrayBuffer; mimeType: string }[];
}

function makeProvider(returnPath?: (requested: string) => string): FakeProvider {
  const saved: FakeProvider['saved'] = [];
  return {
    saved,
    async resolveUrl(relativePath: string) {
      return relativePath;
    },
    async listMedia(): Promise<MediaEntry[]> {
      return [];
    },
    async addMedia(name: string, data: ArrayBuffer | Blob | Uint8Array, mimeType: string) {
      // instanceof is realm-sensitive under vitest's VM pool — duck-type.
      const bytes: ArrayBuffer = ArrayBuffer.isView(data)
        ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
        : 'byteLength' in data
          ? (data as ArrayBuffer)
          : await (data as Blob).arrayBuffer();
      const path = returnPath ? returnPath(name) : name;
      saved.push({ path, bytes, mimeType });
      return path;
    },
    async removeMedia() {},
    dispose() {},
  };
}

function encode(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function decode(bytes: ArrayBuffer): string {
  // ignoreBOM keeps a leading U+FEFF visible — the default silently strips
  // it, which would hide a BOM regression from the assertions below.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

async function ingestCsv(text: string, ext = 'csv') {
  const bytes = encode(text);
  const ingested = await ingestSidecarBytes(bytes, ext, {});
  if (!ingested.csv) throw new Error('expected csv meta');
  return { bytes, csv: ingested.csv, ingested };
}

describe('saveCsvEdits', () => {
  it('splats journal edits and leaves negative numbers alone', async () => {
    const source = 'Item,Delta\nwidget,-5\ngadget,3\n';
    const { bytes, csv } = await ingestCsv(source);
    const journal = new EditJournal();
    // Edit body row 1 (gadget), col 1: 3 → 7. Row 0 (widget,-5) untouched.
    journal.commit([{ rowId: 1, col: 1, prev: 3, next: 7 }]);

    const provider = makeProvider();
    const result = await saveCsvEdits({
      path: PATH,
      originalBytes: bytes,
      csv,
      journal,
      mediaProvider: provider,
      container: null,
    });

    expect(result.ok).toBe(true);
    expect(decode(provider.saved[0]!.bytes)).toBe('Item,Delta\nwidget,-5\ngadget,7\n');
    expect(journal.dirtyCount).toBe(0);
    expect(result.notices.join(' ')).toContain('without a backup');
  });

  it('neutralizes an edited formula-looking cell but not an edited number', async () => {
    const source = 'A,B\nx,1\ny,2\n';
    const { bytes, csv } = await ingestCsv(source);
    const journal = new EditJournal();
    journal.commit([
      { rowId: 0, col: 1, prev: 1, next: '=SUM(A1)' },
      { rowId: 1, col: 1, prev: 2, next: -5 },
    ]);

    const provider = makeProvider();
    const result = await saveCsvEdits({
      path: PATH,
      originalBytes: bytes,
      csv,
      journal,
      mediaProvider: provider,
      container: null,
    });

    expect(result.ok).toBe(true);
    expect(decode(provider.saved[0]!.bytes)).toBe("A,B\nx,'=SUM(A1)\ny,-5\n");
  });

  it('preserves BOM, CRLF newlines, and a missing trailing newline', async () => {
    const source = '\uFEFFA,B\r\nx,1\r\ny,2';
    const { bytes, csv } = await ingestCsv(source);
    expect(csv.bom).toBe(true);
    expect(csv.newline).toBe('\r\n');
    expect(csv.trailingNewline).toBe(false);

    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 1, next: 9 }]);
    const provider = makeProvider();
    const result = await saveCsvEdits({
      path: PATH,
      originalBytes: bytes,
      csv,
      journal,
      mediaProvider: provider,
      container: null,
    });

    expect(result.ok).toBe(true);
    expect(decode(provider.saved[0]!.bytes)).toBe('\uFEFFA,B\r\nx,9\r\ny,2');
  });

  it('preserves the TSV delimiter', async () => {
    const source = 'A\tB\nx\t1\n';
    const { bytes, csv } = await ingestCsv(source, 'tsv');
    expect(csv.delimiter).toBe('\t');
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 0, prev: 'x', next: 'z' }]);
    const provider = makeProvider();
    const result = await saveCsvEdits({
      path: 'report_files/data/q3.tsv',
      originalBytes: bytes,
      csv,
      journal,
      mediaProvider: provider,
      container: null,
    });
    expect(result.ok).toBe(true);
    expect(decode(provider.saved[0]!.bytes)).toBe('A\tB\nz\t1\n');
    expect(provider.saved[0]!.mimeType).toBe('text/tab-separated-values');
  });

  it('writes a pre-save backup into .versions/data/ and prunes to 3', async () => {
    const source = 'A,B\nx,1\n';
    const { bytes, csv } = await ingestCsv(source);
    const container = new MemoryContentContainer();
    // Pre-seed three older backups for the same sidecar (sortable stamps).
    for (const year of [2020, 2021, 2022]) {
      await container.writeFile(
        buildDataBackupPath(PATH, new Date(Date.UTC(year, 0, 1))),
        encode('old'),
        'text/csv',
      );
    }

    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 1, next: 2 }]);
    const provider = makeProvider();
    const result = await saveCsvEdits({
      path: PATH,
      originalBytes: bytes,
      csv,
      journal,
      mediaProvider: provider,
      container,
    });

    expect(result.ok).toBe(true);
    const backups = (await container.listFiles(DATA_BACKUP_PREFIX)).map((entry) => entry.path);
    expect(backups).toHaveLength(3);
    // The oldest was pruned; the newest holds the ORIGINAL bytes.
    expect(backups.some((path) => path.includes('2020'))).toBe(false);
    const newest = [...backups].sort().pop()!;
    expect(decode((await container.readFile(newest))!)).toBe(source);
    // Backup names flatten the sidecar path.
    expect(newest.startsWith(`${DATA_BACKUP_PREFIX}report_files__data__q3.`)).toBe(true);
  });

  it('reports a fork when the host saves to a different path', async () => {
    const source = 'A,B\nx,1\n';
    const { bytes, csv } = await ingestCsv(source);
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 1, next: 2 }]);
    const provider = makeProvider(() => 'report_files/data/q3-1.csv');

    const result = await saveCsvEdits({
      path: PATH,
      originalBytes: bytes,
      csv,
      journal,
      mediaProvider: provider,
      container: null,
    });

    expect(result.ok).toBe(false);
    expect(result.savedPath).toBe('report_files/data/q3-1.csv');
    expect(result.error).toContain('q3-1.csv');
    // The journal survives — the document still references the original.
    expect(journal.dirtyCount).toBe(1);
  });

  it('surfaces provider failures as an error result', async () => {
    const source = 'A,B\nx,1\n';
    const { bytes, csv } = await ingestCsv(source);
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 1, next: 2 }]);
    const provider = makeProvider();
    provider.addMedia = async () => {
      throw new Error('quota exceeded');
    };

    const result = await saveCsvEdits({
      path: PATH,
      originalBytes: bytes,
      csv,
      journal,
      mediaProvider: provider,
      container: null,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('quota exceeded');
    expect(journal.dirtyCount).toBe(1);
  });
});

describe('saveXlsxEdits', () => {
  async function workbookBytes(): Promise<ArrayBuffer> {
    const { markdownDocToXlsx } = await import('@bendyline/squisq-formats/xlsx');
    const { parseMarkdown } = await import('@bendyline/squisq/markdown');
    // Anchored → the exporter writes numeric cells as real numbers.
    const markdown = [
      '## Sales {[dataTable sheet=Sales anchor=A1]}',
      '',
      '| Region | Revenue |',
      '| --- | --- |',
      '| West | 100 |',
      '| East | 250 |',
    ].join('\n');
    return markdownDocToXlsx(parseMarkdown(markdown));
  }

  it('patches edited cells in place and re-ingests the new values', async () => {
    const { ingestSidecarBytes: ingest } = await import('../dataCard/ingestAdapters');
    const { saveXlsxEdits } = await import('../dataCard/gridSave');
    const bytes = await workbookBytes();
    const first = await ingest(bytes, 'xlsx', {});
    expect(first.xlsx).toBeDefined();

    const journal = new EditJournal();
    journal.commit([
      { rowId: 0, col: 1, prev: 100, next: 175 },
      { rowId: 1, col: 0, prev: 'East', next: 'Northeast' },
    ]);
    const provider = makeProvider();
    const result = await saveXlsxEdits({
      path: 'report_files/data/book.xlsx',
      originalBytes: bytes,
      xlsx: first.xlsx!,
      journal,
      mediaProvider: provider,
      container: null,
    });
    expect(result.ok).toBe(true);
    expect(journal.dirtyCount).toBe(0);
    expect(provider.saved[0]!.mimeType).toContain('spreadsheetml');

    const reingested = await ingest(provider.saved[0]!.bytes, 'xlsx', {});
    expect(reingested.ingest.cells).toEqual([
      ['West', 175],
      ['Northeast', 250],
    ]);
  });

  it('writes a backup before patching', async () => {
    const { ingestSidecarBytes: ingest } = await import('../dataCard/ingestAdapters');
    const { saveXlsxEdits } = await import('../dataCard/gridSave');
    const bytes = await workbookBytes();
    const first = await ingest(bytes, 'xlsx', {});
    const container = new MemoryContentContainer();
    const journal = new EditJournal();
    journal.commit([{ rowId: 0, col: 1, prev: 100, next: 5 }]);

    const result = await saveXlsxEdits({
      path: 'report_files/data/book.xlsx',
      originalBytes: bytes,
      xlsx: first.xlsx!,
      journal,
      mediaProvider: makeProvider(),
      container,
    });
    expect(result.ok).toBe(true);
    const backups = await container.listFiles(DATA_BACKUP_PREFIX);
    expect(backups).toHaveLength(1);
    expect(backups[0]!.path.endsWith('.xlsx')).toBe(true);
    expect((await container.readFile(backups[0]!.path))!.byteLength).toBe(bytes.byteLength);
  });
});

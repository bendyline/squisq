import { describe, it, expect } from 'vitest';
import {
  DATA_FILE_EXTENSIONS,
  isDataFilePath,
  dataSidecarPrefix,
  resolveDataReferences,
  type DataSourceReader,
  type DataSourceStats,
} from '../doc/dataReferences';
import { MemoryContentContainer } from '../storage/ContentContainer';
import type { Block, Doc } from '../schemas/Doc';
import { parseMarkdown, stringifyMarkdown } from '../markdown';
import { markdownToDoc } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';

function dataBlock(id: string, overrides: Record<string, string>, extra?: Partial<Block>): Block {
  return {
    id,
    title: id,
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [],
    template: 'dataTable',
    templateOverrides: overrides,
    ...extra,
  };
}

function docWith(blocks: Block[]): Doc {
  return {
    articleId: 'data-references-test',
    duration: 0,
    blocks,
    audio: { segments: [] },
  };
}

/** Reader that returns a deterministic window over a fake 120-row source. */
function fakeCsvReader(): DataSourceReader {
  return {
    extensions: ['csv', 'tsv'],
    async read(_data, opts) {
      const total = 120;
      const count = Math.min(opts.maxRows, total);
      return {
        headers: ['Region', 'Revenue'],
        rows: Array.from({ length: count }, (_, i) => [`R${i}`, String(i * 10)]),
        totalRows: total,
        totalCols: 2,
      };
    },
  };
}

async function containerWithCsv(
  path = 'report_files/data/q3.csv',
): Promise<MemoryContentContainer> {
  const container = new MemoryContentContainer();
  await container.writeFile(path, new TextEncoder().encode('Region,Revenue\nA,1\n'));
  return container;
}

describe('path helpers', () => {
  it('recognizes relative data-file paths only', () => {
    expect(isDataFilePath('report_files/data/q3.csv')).toBe(true);
    expect(isDataFilePath('data/x.tsv')).toBe(true);
    expect(isDataFilePath('a.xlsx')).toBe(true);
    expect(isDataFilePath('metrics.parquet')).toBe(true);
    expect(isDataFilePath('https://example.com/q3.csv')).toBe(false);
    expect(isDataFilePath('/abs/q3.csv')).toBe(false);
    expect(isDataFilePath('notes.md')).toBe(false);
    expect(isDataFilePath('')).toBe(false);
    expect(isDataFilePath('.csv')).toBe(false);
  });

  it('builds the sidecar prefix from a doc basename', () => {
    expect(dataSidecarPrefix('report')).toBe('report_files/data/');
  });

  it('covers exactly the four planned extensions', () => {
    expect([...DATA_FILE_EXTENSIONS]).toEqual(['csv', 'tsv', 'xlsx', 'parquet']);
  });
});

describe('resolveDataReferences', () => {
  it('fills a bounded preview and srcStats from the reader', async () => {
    const container = await containerWithCsv();
    const doc = docWith([dataBlock('q3', { src: 'report_files/data/q3.csv' })]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect(result.diagnostics).toEqual([]);
    const block = result.doc.blocks[0];
    expect(block.templateData?.headers).toEqual(['Region', 'Revenue']);
    expect((block.templateData?.rows as string[][]).length).toBe(50);
    const stats = block.templateData?.srcStats as DataSourceStats;
    expect(stats).toEqual({ totalRows: 120, totalCols: 2, previewRows: 50, truncated: true });
  });

  it('honors a previewRows param over the default window', async () => {
    const container = await containerWithCsv();
    const doc = docWith([dataBlock('q3', { src: 'report_files/data/q3.csv', previewRows: '5' })]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect((result.doc.blocks[0].templateData?.rows as string[][]).length).toBe(5);
  });

  it('leaves authored data untouched (author data wins)', async () => {
    const container = await containerWithCsv();
    const authored = dataBlock(
      'q3',
      { src: 'report_files/data/q3.csv' },
      {
        templateData: { headers: ['H'], rows: [['authored']] },
      },
    );
    const doc = docWith([authored]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect(result.doc).toBe(doc);
    expect(result.doc.blocks[0].templateData?.rows).toEqual([['authored']]);
  });

  it('returns the same doc object when nothing resolves', async () => {
    const container = new MemoryContentContainer();
    const doc = docWith([dataBlock('plain', {})]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect(result.doc).toBe(doc);
    expect(result.diagnostics).toEqual([]);
  });

  it('memoizes reader reads through a caller-owned tableCache', async () => {
    const container = await containerWithCsv();
    let reads = 0;
    const reader: DataSourceReader = {
      extensions: ['csv'],
      async read(_data, opts) {
        reads++;
        return {
          headers: ['Region'],
          rows: Array.from({ length: Math.min(opts.maxRows, 3) }, (_, i) => [`R${i}`]),
          totalRows: 3,
          totalCols: 1,
        };
      },
    };
    const doc = docWith([dataBlock('b1', { src: 'report_files/data/q3.csv' })]);
    const tableCache = new Map();

    await resolveDataReferences(doc, container, { readers: [reader], tableCache });
    await resolveDataReferences(doc, container, { readers: [reader], tableCache });
    expect(reads).toBe(1); // second pass rode the cache

    // A view change is a different key — never a stale hit.
    const sorted = docWith([
      dataBlock('b1', { src: 'report_files/data/q3.csv', sort: 'Region:desc' }),
    ]);
    await resolveDataReferences(sorted, container, { readers: [reader], tableCache });
    expect(reads).toBe(2);

    // A fresh map (the caller's revision-bump invalidation) re-reads.
    await resolveDataReferences(doc, container, { readers: [reader], tableCache: new Map() });
    expect(reads).toBe(3);
    // No cache passed → no memoization, unchanged behavior.
    await resolveDataReferences(doc, container, { readers: [reader] });
    expect(reads).toBe(4);
  });

  it('a cached FAILED read still reports its diagnostic on every pass', async () => {
    const container = await containerWithCsv();
    let reads = 0;
    const reader: DataSourceReader = {
      extensions: ['csv'],
      async read() {
        reads++;
        throw new Error('CSV exceeds the safety limit');
      },
    };
    const doc = docWith([dataBlock('b1', { src: 'report_files/data/q3.csv' })]);
    const tableCache = new Map();
    const first = await resolveDataReferences(doc, container, { readers: [reader], tableCache });
    const second = await resolveDataReferences(doc, container, { readers: [reader], tableCache });
    expect(reads).toBe(1); // the failure is cached — parsed once, not per pass
    expect(first.diagnostics.map((d) => d.code)).toEqual(['data-src-parse']);
    expect(second.diagnostics.map((d) => d.code)).toEqual(['data-src-parse']);
  });

  it('reports a missing file and leaves the block untouched', async () => {
    const container = new MemoryContentContainer();
    const doc = docWith([dataBlock('q3', { src: 'report_files/data/q3.csv' })]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect(result.doc).toBe(doc);
    expect(result.diagnostics).toMatchObject([
      { severity: 'warning', code: 'data-src-missing', blockId: 'q3' },
    ]);
  });

  it('reports an unknown extension / non-data src as no-reader', async () => {
    const container = await containerWithCsv();
    const doc = docWith([
      dataBlock('bad-ext', { src: 'report_files/data/q3.json' }),
      dataBlock('abs', { src: 'https://example.com/q3.csv' }),
    ]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect(result.doc).toBe(doc);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'data-src-no-reader',
      'data-src-no-reader',
    ]);
  });

  it('reports a reader with no registration for the extension', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile('report_files/data/m.parquet', new Uint8Array([1]));
    const doc = docWith([dataBlock('m', { src: 'report_files/data/m.parquet' })]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect(result.diagnostics).toMatchObject([{ code: 'data-src-no-reader', blockId: 'm' }]);
  });

  it('turns a reader failure into data-src-parse', async () => {
    const container = await containerWithCsv();
    const failing: DataSourceReader = {
      extensions: ['csv'],
      async read() {
        throw new Error('malformed quoting at row 3');
      },
    };
    const doc = docWith([dataBlock('q3', { src: 'report_files/data/q3.csv' })]);

    const result = await resolveDataReferences(doc, container, { readers: [failing] });

    expect(result.doc).toBe(doc);
    expect(result.diagnostics).toMatchObject([
      { severity: 'error', code: 'data-src-parse', blockId: 'q3' },
    ]);
  });

  it('classifies sheet-miss failures on workbook sources as data-src-sheet-missing', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile('report_files/data/book.xlsx', new Uint8Array([1]));
    const sheetMissing: DataSourceReader = {
      extensions: ['xlsx'],
      async read() {
        throw new Error('worksheet "Sales" not found (available: Summary)');
      },
    };
    const doc = docWith([
      dataBlock('q3', { src: 'report_files/data/book.xlsx', sheet: 'Sales', anchor: 'B7' }),
    ]);

    const result = await resolveDataReferences(doc, container, { readers: [sheetMissing] });

    expect(result.diagnostics).toMatchObject([
      { severity: 'warning', code: 'data-src-sheet-missing', blockId: 'q3' },
    ]);
  });

  it('notes ignored sheet/anchor params on non-workbook sources', async () => {
    const container = await containerWithCsv();
    const doc = docWith([dataBlock('q3', { src: 'report_files/data/q3.csv', sheet: 'Sales' })]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect(result.diagnostics).toMatchObject([
      { severity: 'info', code: 'data-src-param-ignored', blockId: 'q3' },
    ]);
    expect(result.doc.blocks[0].templateData?.headers).toEqual(['Region', 'Revenue']);
  });

  it('forwards sort/filter params and reports view issues + filtered stats', async () => {
    const container = await containerWithCsv();
    let seen: unknown;
    const reader: DataSourceReader = {
      extensions: ['csv'],
      async read(_data, opts) {
        seen = { sort: opts.sort, filter: opts.filter };
        return {
          headers: ['Region'],
          rows: [['West']],
          totalRows: 1,
          totalCols: 1,
          unfilteredTotalRows: 4,
          viewIssues: [{ code: 'data-view-unknown-column', message: 'sort column "Nope"…' }],
        };
      },
    };
    const doc = docWith([
      dataBlock('q3', {
        src: 'report_files/data/q3.csv',
        sort: 'Nope:desc',
        filter: 'Region=West',
      }),
    ]);

    const result = await resolveDataReferences(doc, container, { readers: [reader] });

    expect(seen).toEqual({ sort: 'Nope:desc', filter: 'Region=West' });
    expect(result.diagnostics).toMatchObject([
      { severity: 'info', code: 'data-view-unknown-column', blockId: 'q3' },
    ]);
    expect(result.doc.blocks[0].templateData?.srcStats).toMatchObject({
      totalRows: 1,
      unfilteredTotalRows: 4,
    });
  });

  it('passes sheet/anchor/headerRow through to the reader for workbooks', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile('report_files/data/book.xlsx', new Uint8Array([1]));
    let seen: unknown;
    const reader: DataSourceReader = {
      extensions: ['xlsx'],
      async read(_data, opts) {
        seen = opts;
        return { headers: ['A'], rows: [['1']], totalRows: 1, totalCols: 1 };
      },
    };
    const doc = docWith([
      dataBlock('q3', {
        src: 'report_files/data/book.xlsx',
        sheet: 'Sales',
        anchor: 'B7',
        headerRow: 'false',
      }),
    ]);

    await resolveDataReferences(doc, container, { readers: [reader] });

    expect(seen).toEqual({ sheet: 'Sales', anchor: 'B7', headerRow: false, maxRows: 50 });
  });

  it('resolves nested child blocks and reads each distinct file once', async () => {
    const container = await containerWithCsv();
    let reads = 0;
    const originalRead = container.readFile.bind(container);
    container.readFile = (path: string) => {
      reads++;
      return originalRead(path);
    };
    const parent = dataBlock(
      'parent',
      {},
      {
        children: [
          dataBlock('a', { src: 'report_files/data/q3.csv' }),
          dataBlock('b', { src: 'report_files/data/q3.csv' }),
        ],
      },
    );
    const doc = docWith([parent]);

    const result = await resolveDataReferences(doc, container, { readers: [fakeCsvReader()] });

    expect(reads).toBe(1);
    const children = result.doc.blocks[0].children ?? [];
    expect(children.every((c) => Array.isArray(c.templateData?.rows))).toBe(true);
  });
});

describe('src annotation round-trip', () => {
  it('parses the src param and is byte-stable after one normalization cycle', () => {
    // `_` inside a heading annotation stays backslash-escaped in emitted
    // markdown (see UNESCAPE_PUNCT_RE in markdown/stringify.ts — unescaping
    // emphasis openers could split the heading text run on reparse). The
    // authored form normalizes once, then the emit is a fixpoint; the param
    // VALUE round-trips exactly. The body link is a resource URL and is
    // never escaped.
    const authored = [
      '## Q3 Transactions {[dataTable src=report_files/data/q3.csv sheet=Sales anchor=B7]}',
      '',
      '[q3.csv](report_files/data/q3.csv)',
      '',
    ].join('\n');

    const doc = markdownToDoc(parseMarkdown(authored));
    const block = doc.blocks[0];
    expect(block.template).toBe('dataTable');
    expect(block.templateOverrides?.src).toBe('report_files/data/q3.csv');
    expect(block.templateOverrides?.sheet).toBe('Sales');
    expect(block.templateOverrides?.anchor).toBe('B7');

    const once = stringifyMarkdown(docToMarkdown(doc));
    expect(once).toContain('[q3.csv](report_files/data/q3.csv)');

    const reparsed = markdownToDoc(parseMarkdown(once));
    expect(reparsed.blocks[0].templateOverrides?.src).toBe('report_files/data/q3.csv');

    const twice = stringifyMarkdown(docToMarkdown(reparsed));
    expect(twice).toBe(once);
  });

  it('is byte-identical for annotations without underscore-bearing paths', () => {
    const source = [
      '## Metrics {[dataTable src=data/q3.csv anchor=B7]}',
      '',
      '[q3.csv](data/q3.csv)',
      '',
    ].join('\n');

    const emitted = stringifyMarkdown(docToMarkdown(markdownToDoc(parseMarkdown(source))));
    expect(emitted).toBe(source);
  });
});

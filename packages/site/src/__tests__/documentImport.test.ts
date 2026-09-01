import { describe, expect, it } from 'vitest';

import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToDocx } from '@bendyline/squisq-formats/docx';
import { markdownDocToXlsx } from '@bendyline/squisq-formats/xlsx';
import { ConversionError, defaultRegistry } from '@bendyline/squisq-formats/registry';

import {
  IMPORTABLE_DOCUMENT_EXTENSIONS,
  describeImportError,
  extensionOf,
  importDocumentFile,
  isImportableDocument,
  type DocumentImportProgress,
} from '../documentImport.js';

describe('extensionOf', () => {
  it('lowercases the extension and ignores directories', () => {
    expect(extensionOf('C:/Users/me/Quarterly Report.DOCX')).toBe('docx');
    expect(extensionOf('deck.pptx')).toBe('pptx');
  });

  it('returns empty for names with no extension', () => {
    expect(extensionOf('notes')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('the advertised extension list', () => {
  // The list is a literal so the file input can build its `accept` attribute
  // without loading the formats package. This is what keeps it honest.
  it('names only formats the registry can actually import', () => {
    const registry = defaultRegistry();
    // Two entries are special-cased in importDocumentFile rather than
    // registry-resolved: `.tsv` rides the CSV importer with a tab delimiter,
    // and `.parquet` synthesizes a sidecar container directly.
    const SPECIAL_CASED: Record<string, string | null> = { tsv: 'csv', parquet: null };
    for (const ext of IMPORTABLE_DOCUMENT_EXTENSIONS) {
      const resolved = SPECIAL_CASED[ext] === undefined ? ext : SPECIAL_CASED[ext];
      if (resolved === null) continue;
      const definition = registry.byExtension(resolved);
      expect(definition, ext).toBeDefined();
      expect(Boolean(definition?.importContainer ?? definition?.importDoc), ext).toBe(true);
    }
  });

  it('leaves markdown and images to their own upload paths', () => {
    expect(isImportableDocument('notes.md')).toBe(false);
    expect(isImportableDocument('photo.png')).toBe(false);
    expect(isImportableDocument('deck.pptx')).toBe(true);
    expect(isImportableDocument('Report.XLSX')).toBe(true);
  });
});

describe('importDocumentFile', () => {
  const tableSource = [
    '# Sales',
    '',
    '| Region | Total |',
    '| --- | --- |',
    '| North | 120 |',
    '| South | 95 |',
    '',
  ].join('\n');

  it('converts a spreadsheet to markdown and reports every stage in order', async () => {
    const bytes = await markdownDocToXlsx(parseMarkdown(tableSource));
    const stages: DocumentImportProgress[] = [];

    const result = await importDocumentFile(new File([bytes], 'sales.xlsx'), (progress) =>
      stages.push(progress),
    );

    expect(result.markdown).toContain('North');
    expect(result.markdown).toContain('120');
    expect(result.formatLabel).toBe('Excel (XLSX)');
    // XLSX imports container-first now (data sidecars); a small workbook's
    // container holds just the converted doc — no sidecar spilled.
    expect(result.container).not.toBeNull();
    expect(await result.container!.getDocumentPath()).toBe('sales.md');
    expect((await result.container!.listFiles()).map((f) => f.path)).toEqual(['sales.md']);
    expect(stages.map((stage) => stage.stage)).toEqual(['reading', 'converting', 'finishing']);
    const last = stages[stages.length - 1];
    expect(last?.fileName).toBe('sales.xlsx');
    expect(last?.formatLabel).toBe('Excel (XLSX)');
  });

  it('always sidecars an opened CSV (the file is the content)', async () => {
    const csv = 'Region,Total\nNorth,120\nSouth,95\n';

    const result = await importDocumentFile(new File([csv], 'Q3 Sales.csv'));

    expect(result.container).not.toBeNull();
    expect(result.markdown).toContain('{[dataTable src=');
    expect(result.markdown).toContain('q3-sales\\_files/data/Q3 Sales.csv');
    const sidecar = await result.container!.readFile('q3-sales_files/data/Q3 Sales.csv');
    expect(new TextDecoder().decode(sidecar!)).toBe(csv);
  });

  it('routes .tsv through the CSV importer with a tab delimiter', async () => {
    const tsv = 'Region\tTotal\nNorth\t120\n';

    const result = await importDocumentFile(new File([tsv], 'sales.tsv'));

    expect(result.formatLabel).toBe('CSV');
    expect(result.container).not.toBeNull();
    expect(await result.container!.exists('sales_files/data/sales.tsv')).toBe(true);
  });

  it('synthesizes a sidecar container for parquet (no registry importer)', async () => {
    const bytes = new Uint8Array([80, 65, 82, 49]); // not a real file; synthesis never parses

    const result = await importDocumentFile(new File([bytes], 'metrics.parquet'));

    expect(result.formatLabel).toBe('Parquet');
    expect(result.markdown).toContain('{[dataTable src=');
    expect(await result.container!.exists('metrics_files/data/metrics.parquet')).toBe(true);
    expect(await result.container!.getDocumentPath()).toBe('metrics.md');
  });

  it('keeps the container for formats that extract media', async () => {
    const bytes = await markdownDocToDocx(parseMarkdown('# Notes\n\nHello there.\n'));

    const result = await importDocumentFile(new File([bytes], 'notes.docx'));

    expect(result.container).not.toBeNull();
    expect(result.markdown).toContain('Hello there.');
  });

  it('refuses an export-only format rather than importing nothing', async () => {
    await expect(importDocumentFile(new File([new Uint8Array()], 'book.epub'))).rejects.toThrow(
      /no importer/i,
    );
  });
});

describe('describeImportError', () => {
  it('explains a registry failure from its code, not its message', () => {
    const message = describeImportError(
      new ConversionError('invalid-input', 'Input is not a readable ZIP archive.'),
      'broken.docx',
    );
    expect(message).toContain('broken.docx');
    expect(message).toContain('corrupt');
  });

  it('falls back to the raw message for unknown failures', () => {
    expect(describeImportError(new Error('worker went missing'), 'notes.pdf')).toContain(
      'worker went missing',
    );
  });
});

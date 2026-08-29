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
    for (const ext of IMPORTABLE_DOCUMENT_EXTENSIONS) {
      const definition = registry.byExtension(ext);
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
    // XLSX has no embedded media to extract, so there is no container to
    // adopt as the editor's workspace.
    expect(result.container).toBeNull();
    expect(stages.map((stage) => stage.stage)).toEqual(['reading', 'converting', 'finishing']);
    const last = stages[stages.length - 1];
    expect(last?.fileName).toBe('sales.xlsx');
    expect(last?.formatLabel).toBe('Excel (XLSX)');
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

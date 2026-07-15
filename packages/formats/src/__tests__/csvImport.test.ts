/**
 * Tests for CSV import/export: csvToMarkdownDoc, markdownDocToCsv, parseCsv.
 */

import { describe, expect, it } from 'vitest';
import type { MarkdownDocument, MarkdownTable, MarkdownText } from '@bendyline/squisq/markdown';
import { csvToMarkdownDoc, markdownDocToCsv, parseCsv } from '../csv/index';

function cellValue(table: MarkdownTable, row: number, col: number): string {
  const cell = table.children[row]?.children[col];
  const first = cell?.children[0] as MarkdownText | undefined;
  return first?.value ?? '';
}

describe('parseCsv', () => {
  it('enforces row, cell, and field limits', () => {
    expect(() => parseCsv('a,b\n1,2', ',', { maxCells: 3 })).toThrow('3-cell');
    expect(() => parseCsv('a\nb', ',', { maxRows: 1 })).toThrow('1-row');
    expect(() => parseCsv('abcd', ',', { maxFieldChars: 3 })).toThrow('3-character');
  });

  it('parses quoted fields, escaped quotes, and embedded delimiters', () => {
    const rows = parseCsv('a,b,c\n"x,y","he said ""hi""",z\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x,y', 'he said "hi"', 'z'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('rejects empty, multi-character, line-break, and BOM delimiters', () => {
    for (const delimiter of ['', '||', '"', '\n', '\uFEFF']) {
      expect(() => parseCsv('a,b', delimiter)).toThrow('exactly one character');
    }
  });

  it('accepts a single Unicode code point as a delimiter', () => {
    expect(parseCsv('a\u{1F9F1}b', '\u{1F9F1}')).toEqual([['a', 'b']]);
  });
});

describe('csvToMarkdownDoc', () => {
  it('builds a table with a header row by default', async () => {
    const doc = await csvToMarkdownDoc('Name,Age\nAlice,30\n"Bob, Jr.",40\n');
    expect(doc.type).toBe('document');
    const table = doc.children[0] as MarkdownTable;
    expect(table.type).toBe('table');
    expect(table.children).toHaveLength(3);
    expect(table.children[0]!.children[0]!.isHeader).toBe(true);
    expect(cellValue(table, 0, 0)).toBe('Name');
    expect(cellValue(table, 0, 1)).toBe('Age');
    expect(cellValue(table, 2, 0)).toBe('Bob, Jr.');
    expect(cellValue(table, 2, 1)).toBe('40');
  });

  it('round-trips through markdownDocToCsv', async () => {
    const csv = 'Name,Age\r\nAlice,30\r\n"Bob, Jr.",40';
    const doc = await csvToMarkdownDoc(csv);
    expect(markdownDocToCsv(doc)).toBe(csv);
  });

  it('strips one UTF-8 BOM from the first imported header', async () => {
    const doc = await csvToMarkdownDoc('\uFEFFName,Age\r\nAlice,30');
    const table = doc.children[0] as MarkdownTable;
    expect(cellValue(table, 0, 0)).toBe('Name');
  });
});

describe('markdownDocToCsv tableIndex', () => {
  async function docWithTwoTables(): Promise<MarkdownDocument> {
    const first = await csvToMarkdownDoc('a,b\r\n1,2');
    const second = await csvToMarkdownDoc('c,d\r\n3,4');
    return { type: 'document', children: [...first.children, ...second.children] };
  }

  it('exports the first table by default', async () => {
    const doc = await docWithTwoTables();
    expect(markdownDocToCsv(doc)).toBe('a,b\r\n1,2');
  });

  it('picks the Nth table via tableIndex', async () => {
    const doc = await docWithTwoTables();
    expect(markdownDocToCsv(doc, { tableIndex: 0 })).toBe('a,b\r\n1,2');
    expect(markdownDocToCsv(doc, { tableIndex: 1 })).toBe('c,d\r\n3,4');
  });

  it('throws a clear error for an out-of-range tableIndex', async () => {
    const doc = await docWithTwoTables();
    expect(() => markdownDocToCsv(doc, { tableIndex: 2 })).toThrow(
      'CSV export: tableIndex 2 is out of range — the document contains 2 table(s).',
    );
    expect(() => markdownDocToCsv(doc, { tableIndex: -1 })).toThrow('out of range');
  });

  it('returns an empty string for a table-less document with the implicit default', () => {
    const doc: MarkdownDocument = { type: 'document', children: [] };
    expect(markdownDocToCsv(doc)).toBe('');
    expect(() => markdownDocToCsv(doc, { tableIndex: 0 })).toThrow('out of range');
  });
});

describe('markdownDocToCsv spreadsheet safety', () => {
  it('neutralizes formula-like cells by default', async () => {
    const doc = await csvToMarkdownDoc(
      'Value\r\n=HYPERLINK("https://example.test","Click")\r\n+1\r\n-2\r\n@SUM(A1:A2)',
    );
    const csv = markdownDocToCsv(doc);

    expect(csv).toContain(`'=HYPERLINK(https://example.test,Click)`);
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@SUM(A1:A2)");
  });

  it('allows an explicit raw-data opt-out', async () => {
    const doc = await csvToMarkdownDoc('Value\r\n=1+1');
    expect(markdownDocToCsv(doc, { formulaHandling: 'preserve' })).toBe('Value\r\n=1+1');
  });
});

describe('markdownDocToCsv delimiter validation', () => {
  it('rejects invalid delimiters on export', async () => {
    const doc = await csvToMarkdownDoc('a,b');
    expect(() => markdownDocToCsv(doc, { delimiter: '' })).toThrow('exactly one character');
    expect(() => markdownDocToCsv(doc, { delimiter: '||' })).toThrow('exactly one character');
  });
});

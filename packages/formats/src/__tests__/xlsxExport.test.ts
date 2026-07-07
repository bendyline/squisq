import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMarkdown, type MarkdownDocument } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';

import { markdownDocToXlsx, docToXlsx } from '../xlsx/export';
import { xlsxToMarkdownDoc } from '../xlsx/import';

/** Read the workbook.xml + all worksheet XML out of an exported .xlsx buffer. */
async function unzip(buffer: ArrayBuffer): Promise<{
  workbook: string;
  sheets: string[];
  paths: string[];
}> {
  const zip = await JSZip.loadAsync(buffer);
  const paths = Object.keys(zip.files).sort();
  const workbook = (await zip.file('xl/workbook.xml')?.async('string')) ?? '';
  const sheetPaths = paths.filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
  const sheets = await Promise.all(sheetPaths.map((p) => zip.file(p)!.async('string')));
  return { workbook, sheets, paths };
}

/** Extract sheet names (in order) from a workbook.xml string. */
function sheetNames(workbook: string): string[] {
  return [...workbook.matchAll(/<sheet\s+name="([^"]*)"/g)].map((m) => m[1]!);
}

/** Build a single-heading + single-table document without touching the parser. */
function docWithHeading(headingText: string): MarkdownDocument {
  return {
    type: 'document',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: headingText }] },
      {
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', isHeader: true, children: [{ type: 'text', value: 'A' }] },
            ],
          },
          {
            type: 'tableRow',
            children: [{ type: 'tableCell', children: [{ type: 'text', value: 'x' }] }],
          },
        ],
      },
    ],
  };
}

describe('markdownDocToXlsx', () => {
  it('produces a structurally valid package (content types + rels + workbook)', async () => {
    const md = parseMarkdown('# Data\n\n| A | B |\n| - | - |\n| 1 | 2 |\n');
    const buffer = await markdownDocToXlsx(md);
    const { paths } = await unzip(buffer);

    expect(paths).toContain('[Content_Types].xml');
    expect(paths).toContain('_rels/.rels');
    expect(paths).toContain('xl/workbook.xml');
    expect(paths).toContain('xl/_rels/workbook.xml.rels');
    expect(paths).toContain('xl/worksheets/sheet1.xml');
    expect(paths).toContain('xl/styles.xml');
  });

  it('names each sheet from the nearest preceding heading', async () => {
    const md = parseMarkdown('# Sales\n\n| A |\n| - |\n| x |\n');
    const { workbook } = await unzip(await markdownDocToXlsx(md));
    expect(sheetNames(workbook)).toEqual(['Sales']);
  });

  it('sanitizes invalid Excel characters and caps names at 31 chars', async () => {
    const { workbook } = await unzip(await markdownDocToXlsx(docWithHeading('a:b/c\\d[e]f?g*h')));
    expect(sheetNames(workbook)).toEqual(['abcdefgh']);

    const { workbook: wb2 } = await unzip(await markdownDocToXlsx(docWithHeading('X'.repeat(50))));
    expect(sheetNames(wb2)[0]!.length).toBe(31);
  });

  it('de-duplicates repeated sheet names (Name, Name2, Name3, …)', async () => {
    const md = parseMarkdown(
      '# Report\n\n| A |\n| - |\n| 1 |\n\n# Report\n\n| B |\n| - |\n| 2 |\n\n# Report\n\n| C |\n| - |\n| 3 |\n',
    );
    const { workbook } = await unzip(await markdownDocToXlsx(md));
    expect(sheetNames(workbook)).toEqual(['Report', 'Report2', 'Report3']);
  });

  it('falls back to Sheet1, Sheet2 when a table has no preceding heading', async () => {
    const md = parseMarkdown('| A |\n| - |\n| 1 |\n\n| B |\n| - |\n| 2 |\n');
    const { workbook } = await unzip(await markdownDocToXlsx(md));
    expect(sheetNames(workbook)).toEqual(['Sheet1', 'Sheet2']);
  });

  it('emits plain numbers as numeric cells and everything else as inline strings', async () => {
    const md = parseMarkdown(
      '# T\n\n| Label | N |\n| - | - |\n| Alpha | 42 |\n| Neg | -3.5 |\n| Mixed | 120 req/s |\n',
    );
    const { sheets } = await unzip(await markdownDocToXlsx(md));
    const xml = sheets[0]!;

    // Numeric cells: <v>…</v> without t="inlineStr"
    expect(xml).toContain('<v>42</v>');
    expect(xml).toContain('<v>-3.5</v>');
    // String cells: inlineStr
    expect(xml).toContain('t="inlineStr"');
    expect(xml).toContain('>Alpha<');
    expect(xml).toContain('>120 req/s<');
    // "120 req/s" must NOT be numeric
    expect(xml).not.toContain('<v>120 req/s</v>');
  });

  it('maps multiple tables to multiple worksheets', async () => {
    const md = parseMarkdown('# First\n\n| A |\n| - |\n| 1 |\n\n# Second\n\n| B |\n| - |\n| 2 |\n');
    const { sheets, workbook } = await unzip(await markdownDocToXlsx(md));
    expect(sheets.length).toBe(2);
    expect(sheetNames(workbook)).toEqual(['First', 'Second']);
  });

  it('produces a valid empty file (single sheet) when there are no tables', async () => {
    const md = parseMarkdown('# Just prose\n\nNo tables here at all.\n');
    const buffer = await markdownDocToXlsx(md);
    const { sheets, workbook } = await unzip(buffer);
    expect(sheets.length).toBe(1);
    expect(sheetNames(workbook)).toEqual(['Sheet1']);

    // Still round-trips without throwing.
    const roundTrip = await xlsxToMarkdownDoc(buffer);
    expect(roundTrip.type).toBe('document');
  });

  it('honors a custom sheetNamePrefix for auto-named sheets', async () => {
    const md = parseMarkdown('| A |\n| - |\n| 1 |\n');
    const { workbook } = await unzip(await markdownDocToXlsx(md, { sheetNamePrefix: 'Tab' }));
    expect(sheetNames(workbook)).toEqual(['Tab1']);
  });

  it('survives a full round-trip (cell text preserved through import)', async () => {
    const md = parseMarkdown(
      '# Metrics\n\n| Metric | Value |\n| - | - |\n| Throughput | 120 |\n| Errors | 0.2% |\n',
    );
    const roundTrip = await xlsxToMarkdownDoc(await markdownDocToXlsx(md));
    const table = roundTrip.children.find((n) => n.type === 'table');
    expect(table).toBeDefined();

    const flat = JSON.stringify(roundTrip);
    for (const cell of ['Metric', 'Value', 'Throughput', '120', 'Errors', '0.2%']) {
      expect(flat).toContain(cell);
    }
  });

  it('docToXlsx converts a Doc via the markdown table model', async () => {
    const doc = markdownToDoc(parseMarkdown('# Report\n\n| K | V |\n| - | - |\n| Users | 99 |\n'));
    const buffer = await docToXlsx(doc);
    const { sheets, workbook } = await unzip(buffer);
    expect(sheets.length).toBeGreaterThanOrEqual(1);
    expect(sheetNames(workbook).length).toBeGreaterThanOrEqual(1);

    const roundTrip = await xlsxToMarkdownDoc(buffer);
    const flat = JSON.stringify(roundTrip);
    expect(flat).toContain('Users');
    expect(flat).toContain('99');
  });
});

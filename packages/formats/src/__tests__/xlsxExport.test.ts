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

  it('de-duplicates sheet names case-insensitively and removes edge apostrophes', async () => {
    const md = parseMarkdown("# 'Data'\n\n| A |\n| - |\n| 1 |\n\n# data\n\n| B |\n| - |\n| 2 |\n");
    const { workbook } = await unzip(await markdownDocToXlsx(md));
    expect(sheetNames(workbook)).toEqual(['Data', 'data2']);
  });

  it('falls back to Sheet1, Sheet2 when a table has no preceding heading', async () => {
    const md = parseMarkdown('| A |\n| - |\n| 1 |\n\n| B |\n| - |\n| 2 |\n');
    const { workbook } = await unzip(await markdownDocToXlsx(md));
    expect(sheetNames(workbook)).toEqual(['Sheet1', 'Sheet2']);
  });

  it('preserves numeric-looking text as strings by default', async () => {
    const md = parseMarkdown(
      '# T\n\n| Zip | Account | Number |\n| - | - | - |\n| 00123 | 1234567890123456 | 42 |\n',
    );
    const { sheets } = await unzip(await markdownDocToXlsx(md));
    const xml = sheets[0]!;

    expect(xml).toContain('>00123<');
    expect(xml).toContain('>1234567890123456<');
    expect(xml).toContain('>42<');
    expect(xml).not.toContain('<v>00123</v>');
    expect(xml).not.toContain('<v>1234567890123456</v>');
  });

  it('conservatively infers numeric cells only when explicitly requested', async () => {
    const md = parseMarkdown(
      '# T\n\n| Safe | Zip | Long | Mixed |\n| - | - | - | - |\n| -3.5 | 00123 | 1234567890123456 | 120 req/s |\n',
    );
    const { sheets } = await unzip(await markdownDocToXlsx(md, { inferNumericCells: true }));
    const xml = sheets[0]!;

    expect(xml).toContain('<v>-3.5</v>');
    expect(xml).toContain('>00123<');
    expect(xml).toContain('>1234567890123456<');
    expect(xml).toContain('>120 req/s<');
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

  it('sanitizes custom prefixes even for an empty workbook', async () => {
    const md = parseMarkdown('# No tables');
    const { workbook } = await unzip(
      await markdownDocToXlsx(md, { sheetNamePrefix: "'Bad:/Prefix'" }),
    );
    expect(sheetNames(workbook)).toEqual(['BadPrefix1']);
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

describe('markdownDocToXlsx — anchored placement', () => {
  /** Cell refs in document order, per worksheet. */
  const refsOf = (sheet: string) => [...sheet.matchAll(/<c r="([^"]+)"/g)].map((m) => m[1]!);

  it('places anchored tables on one worksheet at their own addresses', async () => {
    const md = parseMarkdown(
      [
        '# Sales',
        '',
        '## Q3 Revenue {[dataTable sheet=Sales anchor=B4]}',
        '',
        '| Region | Revenue |',
        '| ------ | ------- |',
        '| North  | 1200    |',
        '',
        '## Side table {[dataTable sheet=Sales anchor=F4]}',
        '',
        '| Item   | Qty |',
        '| ------ | --- |',
        '| Widget | 3   |',
        '',
      ].join('\n'),
    );
    const { workbook, sheets } = await unzip(await markdownDocToXlsx(md));

    expect(sheetNames(workbook)).toEqual(['Sales']);
    expect(refsOf(sheets[0]!)).toEqual(['B4', 'C4', 'F4', 'G4', 'B5', 'C5', 'F5', 'G5']);
    expect(sheets[0]).toContain('<dimension ref="A1:G5"/>');
  });

  it('writes an absorbed heading back to its title cell', async () => {
    const md = parseMarkdown(
      [
        '## Q3 Revenue {[dataTable sheet=Sales anchor=B4 titleAnchor=B3]}',
        '',
        '| Region |',
        '| ------ |',
        '| North  |',
        '',
      ].join('\n'),
    );
    const { sheets } = await unzip(await markdownDocToXlsx(md));
    expect(sheets[0]).toContain('<t xml:space="preserve">Q3 Revenue</t>');
    expect(refsOf(sheets[0]!)).toEqual(['B3', 'B4', 'B5']);
  });

  it('overlays a formulas companion onto its region, keyed by column letter', async () => {
    const md = parseMarkdown(
      [
        '## Totals {[dataTable sheet=S anchor=B2]}',
        '',
        '| Qty | Total |',
        '| --- | ----- |',
        '| 3   | 12    |',
        '',
        '## Totals — formulas {[dataTable sheet=S anchor=B2 role=formulas]}',
        '',
        '| B | C |',
        '| - | - |',
        '|   |   |',
        '|   | =B3\\*4 |',
        '',
      ].join('\n'),
    );
    const { workbook, sheets } = await unzip(await markdownDocToXlsx(md));

    expect(sheets[0]).toContain('<c r="C3"><f>B3*4</f><v>12</v></c>');
    // A cached value may be stale or missing, so Excel is told to recalculate.
    expect(workbook).toContain('fullCalcOnLoad="1"');
  });

  it('expands a loose-cells table one address at a time', async () => {
    const md = parseMarkdown(
      [
        '## Loose {[dataTable sheet=S role=loose]}',
        '',
        '| Cell | Value | Formula |',
        '| ---- | ----- | ------- |',
        '| A1   | note  |         |',
        '| H9   | 7     | =1+1    |',
        '| zz   | bad   |         |',
        '',
      ].join('\n'),
    );
    const { sheets } = await unzip(await markdownDocToXlsx(md));
    expect(refsOf(sheets[0]!)).toEqual(['A1', 'H9']);
    expect(sheets[0]).toContain('<c r="H9"><f>1+1</f><v>7</v></c>');
  });

  it('demotes a malformed anchor to A1 and warns instead of throwing', async () => {
    const warnings: string[] = [];
    const md = parseMarkdown(
      ['## Bad {[dataTable sheet=S anchor=NOPE]}', '', '| A |', '| - |', '| x |', ''].join('\n'),
    );
    const { sheets } = await unzip(
      await markdownDocToXlsx(md, { onWarning: (m) => warnings.push(m) }),
    );

    expect(refsOf(sheets[0]!)).toEqual(['A1', 'A2']);
    expect(warnings.join(' ')).toMatch(/not a valid cell reference/);
  });

  it('reports overlapping regions once per sheet', async () => {
    const warnings: string[] = [];
    const md = parseMarkdown(
      [
        '## One {[dataTable sheet=S anchor=A1]}',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '## Two {[dataTable sheet=S anchor=B2]}',
        '',
        '| C |',
        '| - |',
        '| 3 |',
        '',
      ].join('\n'),
    );
    await markdownDocToXlsx(md, { onWarning: (m) => warnings.push(m) });
    expect(warnings.filter((w) => w.includes('overlapping'))).toHaveLength(1);
    expect(warnings.join(' ')).toContain('B2');
  });

  it('restores numbers as numbers for anchored tables only', async () => {
    const anchored = parseMarkdown(
      ['## N {[dataTable sheet=S anchor=A1]}', '', '| A |', '| - |', '| 1200 |', ''].join('\n'),
    );
    const plain = parseMarkdown(['# N', '', '| A |', '| - |', '| 1200 |', ''].join('\n'));

    expect((await unzip(await markdownDocToXlsx(anchored))).sheets[0]).toContain(
      '<c r="A2"><v>1200</v></c>',
    );
    // A hand-authored table has no column schema, so its text stays text.
    expect((await unzip(await markdownDocToXlsx(plain))).sheets[0]).toContain('t="inlineStr"');
  });

  it('keeps sheet groups distinct when their names sanitize alike', async () => {
    const md = parseMarkdown(
      [
        '## A {[dataTable sheet=Data anchor=A1]}',
        '',
        '| a |',
        '| - |',
        '| 1 |',
        '',
        '## B {[dataTable sheet=data anchor=A1]}',
        '',
        '| b |',
        '| - |',
        '| 2 |',
        '',
      ].join('\n'),
    );
    const { workbook } = await unzip(await markdownDocToXlsx(md));
    expect(sheetNames(workbook)).toEqual(['Data', 'data2']);
  });
});

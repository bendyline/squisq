/**
 * Tests for XLSX import: xlsxToMarkdownDoc. Builds a minimal .xlsx fixture
 * with the shared OOXML writer (dogfooding), then imports it.
 */

import { describe, expect, it } from 'vitest';
import type {
  MarkdownBlockNode,
  MarkdownHeading,
  MarkdownTable,
  MarkdownText,
} from '@bendyline/squisq/markdown';
import {
  CONTENT_TYPE_XLSX_STYLES,
  NS_R,
  NS_SML,
  REL_OFFICE_DOCUMENT,
  REL_STYLES,
} from '../ooxml/namespaces';
import { createPackage } from '../ooxml/writer';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { xlsxToMarkdownDoc } from '../xlsx/import';

const REL_WORKSHEET =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const REL_SHARED_STRINGS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';

async function buildTestXlsx(): Promise<ArrayBuffer> {
  const pkg = createPackage();

  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
      `<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/sharedStrings.xml',
    `${xmlDeclaration()}<sst xmlns="${NS_SML}">` +
      `<si><t>Name</t></si><si><t>Age</t></si><si><t>Alice</t></si>` +
      `<si><t>Start</t></si><si><t>Zip</t></si></sst>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/styles.xml',
    `${xmlDeclaration()}<styleSheet xmlns="${NS_SML}">` +
      `<numFmts count="1"><numFmt numFmtId="164" formatCode="00000"/></numFmts>` +
      `<cellXfs count="3">` +
      `<xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/>` +
      `<xf numFmtId="164" applyNumberFormat="1"/>` +
      `</cellXfs></styleSheet>`,
    CONTENT_TYPE_XLSX_STYLES,
  );
  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>` +
      `<c r="C1" t="s"><v>3</v></c><c r="D1" t="s"><v>4</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>30</v></c>` +
      `<c r="C2" s="1"><v>45292</v></c><c r="D2" s="2"><v>123</v></c></row>` +
      `</sheetData></worksheet>`,
    'application/xml',
  );

  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId1',
    type: REL_WORKSHEET,
    target: 'worksheets/sheet1.xml',
  });
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId2',
    type: REL_SHARED_STRINGS,
    target: 'sharedStrings.xml',
  });
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId3',
    type: REL_STYLES,
    target: 'styles.xml',
  });

  return pkg.toArrayBuffer();
}

describe('xlsxToMarkdownDoc', () => {
  it('imports a sheet as a heading + table, resolving shared strings', async () => {
    const doc = await xlsxToMarkdownDoc(await buildTestXlsx(), { regions: false });
    expect(doc.type).toBe('document');

    const heading = doc.children[0] as MarkdownHeading;
    expect(heading.type).toBe('heading');
    expect((heading.children[0] as MarkdownText).value).toBe('Data');

    const table = doc.children[1] as MarkdownTable;
    expect(table.type).toBe('table');
    expect(table.children).toHaveLength(2);
    const headerCell = table.children[0]!.children[0]!;
    expect(headerCell.isHeader).toBe(true);
    expect((headerCell.children[0] as MarkdownText).value).toBe('Name');
    expect((table.children[1]!.children[0]!.children[0] as MarkdownText).value).toBe('Alice');
    expect((table.children[1]!.children[1]!.children[0] as MarkdownText).value).toBe('30');
    expect((table.children[1]!.children[2]!.children[0] as MarkdownText).value).toBe('2024-01-01');
    expect((table.children[1]!.children[3]!.children[0] as MarkdownText).value).toBe('00123');
  });

  it('selects a single sheet by name without a heading', async () => {
    const doc = await xlsxToMarkdownDoc(await buildTestXlsx(), { sheet: 'Data', regions: false });
    expect(doc.children[0]!.type).toBe('table');
  });
});

// ============================================
// Rich Text & Phonetic Runs (regression)
// ============================================

/**
 * A workbook exercising the two string paths that silently lost data:
 * multi-run `inlineStr` cells and `<si>` entries carrying `<rPh>` furigana.
 */
async function buildRichTextXlsx(): Promise<ArrayBuffer> {
  const pkg = createPackage();

  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
      `<sheets><sheet name="Rich" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'application/xml',
  );

  pkg.addPart(
    'xl/sharedStrings.xml',
    `${xmlDeclaration()}<sst xmlns="${NS_SML}">` +
      // 0: rich text split across runs
      `<si><r><t>Shared </t></r><r><rPr><b/></rPr><t>bold</t></r><r><t> tail</t></r></si>` +
      // 1: kanji with a phonetic (furigana) guide — the guide is an annotation,
      //    not part of the cell's value.
      `<si><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh><phoneticPr fontId="1"/></si>` +
      // 2: rich runs each carrying their own phonetic guide
      `<si>` +
      `<r><t>東京</t></r><rPh sb="0" eb="2"><t>とうきょう</t></rPh>` +
      `<r><t>都</t></r><rPh sb="2" eb="3"><t>と</t></rPh>` +
      `<phoneticPr fontId="1"/></si>` +
      `</sst>`,
    'application/xml',
  );

  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="1">` +
      // Multi-run inline string — the reported truncation.
      `<c r="A1" t="inlineStr"><is><r><t>Hello </t></r><r><t>world</t></r></is></c>` +
      // Single-run inline string still works.
      `<c r="B1" t="inlineStr"><is><t>Plain</t></is></c>` +
      // Inline string with a phonetic guide.
      `<c r="C1" t="inlineStr"><is><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh></is></c>` +
      `</row>` +
      `<row r="2">` +
      `<c r="A2" t="s"><v>0</v></c>` +
      `<c r="B2" t="s"><v>1</v></c>` +
      `<c r="C2" t="s"><v>2</v></c>` +
      `</row>` +
      `</sheetData></worksheet>`,
    'application/xml',
  );

  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId1',
    type: REL_WORKSHEET,
    target: 'worksheets/sheet1.xml',
  });
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId2',
    type: REL_SHARED_STRINGS,
    target: 'sharedStrings.xml',
  });

  return pkg.toArrayBuffer();
}

describe('xlsxToMarkdownDoc rich text', () => {
  async function cells(): Promise<string[][]> {
    const doc = await xlsxToMarkdownDoc(await buildRichTextXlsx(), {
      sheet: 'Rich',
      regions: false,
    });
    const table = doc.children[0] as MarkdownTable;
    return table.children.map((row) =>
      row.children.map((cell) => (cell.children[0] as MarkdownText | undefined)?.value ?? ''),
    );
  }

  it('concatenates every run of a multi-run inlineStr', async () => {
    // The bug: only `is[0]` was read, so this imported as "Hello ".
    expect((await cells())[0]![0]).toBe('Hello world');
  });

  it('still reads a single-run inlineStr', async () => {
    expect((await cells())[0]![1]).toBe('Plain');
  });

  it('excludes rPh phonetic runs from an inlineStr', async () => {
    expect((await cells())[0]![2]).toBe('漢字');
  });

  it('concatenates every run of a rich shared string', async () => {
    expect((await cells())[1]![0]).toBe('Shared bold tail');
  });

  it('excludes rPh phonetic runs from a shared string', async () => {
    // The bug: `si.textContent` swallowed the furigana, giving "漢字かんじ".
    expect((await cells())[1]![1]).toBe('漢字');
  });

  it('excludes interleaved rPh guides from rich shared-string runs', async () => {
    expect((await cells())[1]![2]).toBe('東京都');
  });
});

// ============================================
// Sparse Rows (regression)
// ============================================

/**
 * SpreadsheetML OMITS empty rows entirely, so a sheet whose data starts at
 * row 3 simply has no `<row r="1">` / `<row r="2">`. Reading rows in document
 * order collapses those gaps and silently promotes the first DATA row to the
 * markdown table's header.
 *
 * @param rowsXml - raw `<row>` elements for the single worksheet
 */
async function buildSparseXlsx(rowsXml: string): Promise<ArrayBuffer> {
  const pkg = createPackage();

  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
      `<sheets><sheet name="Sparse" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>${rowsXml}</sheetData></worksheet>`,
    'application/xml',
  );
  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId1',
    type: REL_WORKSHEET,
    target: 'worksheets/sheet1.xml',
  });
  return pkg.toArrayBuffer();
}

/** The plain-text grid of the imported sheet's table. */
async function importedGrid(rowsXml: string): Promise<string[][]> {
  const doc = await xlsxToMarkdownDoc(await buildSparseXlsx(rowsXml), {
    sheet: 'Sparse',
    regions: false,
  });
  const table = doc.children[0] as MarkdownTable;
  expect(table.type).toBe('table');
  return table.children.map((row) =>
    row.children.map((cell) => (cell.children[0] as MarkdownText | undefined)?.value ?? ''),
  );
}

describe('xlsxToMarkdownDoc — sparse rows', () => {
  it('preserves leading blank rows so data does not become the header', async () => {
    // Data starts at row 3; rows 1-2 are absent from the XML.
    const grid = await importedGrid(
      `<row r="3"><c r="A3" t="inlineStr"><is><t>Name</t></is></c></row>` +
        `<row r="4"><c r="A4" t="inlineStr"><is><t>Alice</t></is></c></row>`,
    );

    expect(grid).toHaveLength(4);
    expect(grid[0]).toEqual(['']);
    expect(grid[1]).toEqual(['']);
    expect(grid[2]).toEqual(['Name']);
    expect(grid[3]).toEqual(['Alice']);
  });

  it('preserves an interior blank row', async () => {
    const grid = await importedGrid(
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>` +
        `<row r="3"><c r="A3" t="inlineStr"><is><t>Alice</t></is></c></row>`,
    );

    expect(grid).toHaveLength(3);
    expect(grid[0]).toEqual(['Name']);
    expect(grid[1]).toEqual(['']);
    expect(grid[2]).toEqual(['Alice']);
  });

  it('does not materialize trailing style-only rows far below the data', async () => {
    // Excel writes formatting-only rows with no cells; they must not become
    // thousands of blank table rows.
    const grid = await importedGrid(
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row>` +
        `<row r="2"><c r="A2" t="inlineStr"><is><t>Alice</t></is></c></row>` +
        `<row r="5000" s="1"/>`,
    );

    expect(grid).toHaveLength(2);
    expect(grid[1]).toEqual(['Alice']);
  });

  it('still imports rows that carry no r attribute', async () => {
    const grid = await importedGrid(
      `<row><c t="inlineStr"><is><t>Name</t></is></c></row>` +
        `<row><c t="inlineStr"><is><t>Alice</t></is></c></row>`,
    );

    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual(['Name']);
    expect(grid[1]).toEqual(['Alice']);
  });
});

// ── Region splitting (the default) ───────────────────────────────────────
//
// The `regions: false` pins above are deliberate: those suites assert the
// historical one-table-per-sheet shape, which is now the opt-out.

/**
 * A sheet laid out the way real sheets are: a stray note in the corner, a
 * captioned table with a shared formula down its last column, and a second
 * unrelated table off to the right.
 *
 *        A               B         C         D      E   F        G
 *   1    FY26 Planning
 *   2
 *   3                    Q3 Revenue
 *   4                    Region    Revenue   Total      Item     Qty
 *   5                    North     1200      =C5*2      Widget   3
 *   6                    South     980       =C6*2
 */
async function buildRegionXlsx(): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
      `<sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'application/xml',
  );
  const str = (ref: string, text: string) =>
    `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="1">${str('A1', 'FY26 Planning')}</row>` +
      `<row r="3">${str('B3', 'Q3 Revenue')}</row>` +
      `<row r="4">${str('B4', 'Region')}${str('C4', 'Revenue')}${str('D4', 'Total')}` +
      `${str('F4', 'Item')}${str('G4', 'Qty')}</row>` +
      `<row r="5">${str('B5', 'North')}<c r="C5"><v>1200</v></c>` +
      `<c r="D5"><f t="shared" si="0" ref="D5:D6">C5*2</f><v>2400</v></c>` +
      `${str('F5', 'Widget')}<c r="G5"><v>3</v></c></row>` +
      `<row r="6">${str('B6', 'South')}<c r="C6"><v>980</v></c>` +
      `<c r="D6"><f t="shared" si="0"/><v>1960</v></c></row>` +
      `</sheetData></worksheet>`,
    'application/xml',
  );
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId1',
    type: REL_WORKSHEET,
    target: 'worksheets/sheet1.xml',
  });
  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });
  return pkg.toArrayBuffer();
}

/** `[headingText, annotationParams]` for each heading in the document. */
function headings(doc: { children: MarkdownBlockNode[] }): [string, Record<string, string>][] {
  return doc.children
    .filter((n): n is MarkdownHeading => n.type === 'heading')
    .map((h) => [
      h.children.map((c) => (c as MarkdownText).value ?? '').join(''),
      h.templateAnnotation?.params ?? {},
    ]);
}

function tableTexts(node: MarkdownBlockNode): string[][] {
  const table = node as MarkdownTable;
  return table.children.map((row) =>
    row.children.map((cell) => (cell.children[0] as MarkdownText | undefined)?.value ?? ''),
  );
}

describe('xlsxToMarkdownDoc — regions', () => {
  it('splits a sheet into anchored blocks, a formulas companion and loose cells', async () => {
    const doc = await xlsxToMarkdownDoc(await buildRegionXlsx());

    expect(headings(doc)).toEqual([
      ['Sales', {}],
      ['Q3 Revenue', { sheet: 'Sales', anchor: 'B4', titleAnchor: 'B3' }],
      ['Q3 Revenue — formulas', { sheet: 'Sales', anchor: 'B4', role: 'formulas' }],
      ['Sales — F4', { sheet: 'Sales', anchor: 'F4' }],
      ['Sales — loose cells', { sheet: 'Sales', role: 'loose' }],
    ]);
  });

  it('emits each region at its own size, not the whole used range', async () => {
    const doc = await xlsxToMarkdownDoc(await buildRegionXlsx());
    const tables = doc.children.filter((n) => n.type === 'table');

    expect(tableTexts(tables[0]!)).toEqual([
      ['Region', 'Revenue', 'Total'],
      ['North', '1200', '2400'],
      ['South', '980', '1960'],
    ]);
    expect(tableTexts(tables[2]!)).toEqual([
      ['Item', 'Qty'],
      ['Widget', '3'],
    ]);
  });

  it('expands a shared formula onto its followers, keyed by source column', async () => {
    const doc = await xlsxToMarkdownDoc(await buildRegionXlsx());
    const tables = doc.children.filter((n) => n.type === 'table');

    expect(tableTexts(tables[1]!)).toEqual([
      ['B', 'C', 'D'],
      ['', '', ''],
      ['', '', '=C5*2'],
      ['', '', '=C6*2'],
    ]);
  });

  it('coalesces the stray note into an address-keyed loose table', async () => {
    const doc = await xlsxToMarkdownDoc(await buildRegionXlsx());
    const tables = doc.children.filter((n) => n.type === 'table');

    expect(tableTexts(tables[3]!)).toEqual([
      ['Cell', 'Value'],
      ['A1', 'FY26 Planning'],
    ]);
  });

  it('suppresses the formulas companion when asked', async () => {
    const doc = await xlsxToMarkdownDoc(await buildRegionXlsx(), { formulas: false });
    expect(headings(doc).map(([text]) => text)).not.toContain('Q3 Revenue — formulas');
  });

  it('falls back to one table per sheet with regions: false', async () => {
    const doc = await xlsxToMarkdownDoc(await buildRegionXlsx(), { regions: false });
    expect(doc.children.filter((n) => n.type === 'table')).toHaveLength(1);
    expect(headings(doc)).toEqual([['Sales', {}]]);
  });
});

describe('xlsxToMarkdownDoc — empty cells', () => {
  /** A sheet whose only styled cell carries a date format but no value. */
  async function buildStyledEmptyXlsx(): Promise<ArrayBuffer> {
    const pkg = createPackage();
    pkg.addPart(
      'xl/workbook.xml',
      `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
        `<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'application/xml',
    );
    pkg.addPart(
      'xl/styles.xml',
      `${xmlDeclaration()}<styleSheet xmlns="${NS_SML}"><cellXfs count="2">` +
        `<xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/>` +
        `</cellXfs></styleSheet>`,
      CONTENT_TYPE_XLSX_STYLES,
    );
    pkg.addPart(
      'xl/worksheets/sheet1.xml',
      `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
        `<row r="1"><c r="A1" s="1"/><c r="B1" t="b"/>` +
        `<c r="C1" t="inlineStr"><is><t>real</t></is></c></row>` +
        `</sheetData></worksheet>`,
      'application/xml',
    );
    pkg.addRelationship('xl/workbook.xml', {
      id: 'rId1',
      type: REL_WORKSHEET,
      target: 'worksheets/sheet1.xml',
    });
    pkg.addRelationship('xl/workbook.xml', {
      id: 'rId2',
      type: REL_STYLES,
      target: 'styles.xml',
    });
    pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });
    return pkg.toArrayBuffer();
  }

  // Excel writes `<c r="A1" s="1"/>` across whole formatted-but-blank ranges.
  // Decoding those through the number format yielded `1899-12-31` for a date
  // column and `FALSE` for a boolean one — phantom content that, under region
  // splitting, would fuse every island on the sheet into one.
  it('treats a styled cell with no value as empty, not as the epoch', async () => {
    const doc = await xlsxToMarkdownDoc(await buildStyledEmptyXlsx(), { regions: false });
    const table = doc.children.find((n) => n.type === 'table')!;
    expect(tableTexts(table)).toEqual([['', '', 'real']]);
  });

  it('keeps a formula cell with no cached value occupied', async () => {
    const pkg = createPackage();
    pkg.addPart(
      'xl/workbook.xml',
      `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
        `<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'application/xml',
    );
    pkg.addPart(
      'xl/worksheets/sheet1.xml',
      `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c>` +
        `<c r="B1" t="inlineStr"><is><t>b</t></is></c></row>` +
        `<row r="2"><c r="A2"><v>1</v></c><c r="B2"><f>A2*2</f></c></row>` +
        `</sheetData></worksheet>`,
      'application/xml',
    );
    pkg.addRelationship('xl/workbook.xml', {
      id: 'rId1',
      type: REL_WORKSHEET,
      target: 'worksheets/sheet1.xml',
    });
    pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });

    const doc = await xlsxToMarkdownDoc(await pkg.toArrayBuffer());
    const tables = doc.children.filter((n) => n.type === 'table');
    expect(tableTexts(tables[0]!)).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
    expect(tableTexts(tables[1]!)).toEqual([
      ['A', 'B'],
      ['', ''],
      ['', '=A2*2'],
    ]);
  });
});

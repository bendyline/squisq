/**
 * Tests for XLSX import: xlsxToMarkdownDoc. Builds a minimal .xlsx fixture
 * with the shared OOXML writer (dogfooding), then imports it.
 */

import { describe, expect, it } from 'vitest';
import type { MarkdownHeading, MarkdownTable, MarkdownText } from '@bendyline/squisq/markdown';
import { NS_R, NS_SML, REL_OFFICE_DOCUMENT } from '../ooxml/namespaces';
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
      `<si><t>Name</t></si><si><t>Age</t></si><si><t>Alice</t></si></sst>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>30</v></c></row>` +
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

describe('xlsxToMarkdownDoc', () => {
  it('imports a sheet as a heading + table, resolving shared strings', async () => {
    const doc = await xlsxToMarkdownDoc(await buildTestXlsx());
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
  });

  it('selects a single sheet by name without a heading', async () => {
    const doc = await xlsxToMarkdownDoc(await buildTestXlsx(), { sheet: 'Data' });
    expect(doc.children[0]!.type).toBe('table');
  });
});

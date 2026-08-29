/**
 * Rich-text runs on XLSX import and export.
 *
 * A spreadsheet records a footnote marker as a `vertAlign` RUN PROPERTY on an
 * otherwise ordinary cell — the `1` in `Fresh¹` is just a character with a
 * property. The importer used to concatenate every `<t>` and throw the runs
 * away, welding the marker onto the word as a literal digit ("Fresh1"), which
 * is wrong on the page and wrong for anything that later parses the value.
 */

import { describe, expect, it } from 'vitest';
import { stringifyMarkdown, parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownTable } from '@bendyline/squisq/markdown';
import { NS_R, NS_SML, REL_OFFICE_DOCUMENT } from '../ooxml/namespaces';
import JSZip from 'jszip';
import { createPackage } from '../ooxml/writer';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { xlsxToMarkdownDoc } from '../xlsx/import';
import { markdownDocToXlsx } from '../xlsx/export';

const REL_WORKSHEET =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const REL_SHARED_STRINGS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';

/** A workbook shaped like the USDA price sheets: superscript footnote marks. */
async function buildRichTextXlsx(): Promise<ArrayBuffer> {
  const pkg = createPackage();
  const sup = `<rPr><vertAlign val="superscript"/></rPr>`;
  const sub = `<rPr><vertAlign val="subscript"/></rPr>`;

  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
      `<sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/sharedStrings.xml',
    `${xmlDeclaration()}<sst xmlns="${NS_SML}">` +
      `<si><t>Form</t></si>` +
      `<si><t>Price</t></si>` +
      // Trailing superscript marker, split across runs the way Excel writes it.
      `<si><r><t>Fresh</t></r><r>${sup}<t>1</t></r></si>` +
      // Several unformatted runs before the marker — they must merge.
      `<si><r><t>Juice, ready</t></r><r><t> to drink</t></r><r>${sup}<t>2</t></r></si>` +
      // LEADING marker: the footnote line itself.
      `<si><r>${sup}<t>1</t></r><r><t>USDA, ARS.</t></r></si>` +
      // Subscript, mid-string.
      `<si><r><t>H</t></r><r>${sub}<t>2</t></r><r><t>O content</t></r></si>` +
      `</sst>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1.4</v></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>1.22</v></c></row>` +
      `<row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4"><v>0.9</v></c></row>` +
      // A stray cell well clear of the table above — the footnote line.
      `<row r="7"><c r="A7" t="s"><v>4</v></c></row>` +
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

async function importToMarkdown(): Promise<string> {
  return stringifyMarkdown(await xlsxToMarkdownDoc(await buildRichTextXlsx()));
}

describe('XLSX import — vertical alignment', () => {
  it('keeps a trailing superscript footnote marker', async () => {
    expect(await importToMarkdown()).toContain('Fresh<sup>1</sup>');
  });

  it('merges the unformatted runs Excel splits a string into', async () => {
    // Not "Juice, ready to drink" in three pieces — one text run, one marker.
    expect(await importToMarkdown()).toContain('Juice, ready to drink<sup>2</sup>');
  });

  it('keeps a LEADING superscript on a stray footnote cell', async () => {
    expect(await importToMarkdown()).toContain('<sup>1</sup>USDA, ARS.');
  });

  it('keeps a mid-string subscript', async () => {
    expect(await importToMarkdown()).toContain('H<sub>2</sub>O content');
  });

  it('leaves the cell text itself flattened for non-markdown consumers', async () => {
    // `richText` is additive: header sniffing, region detection and numeric
    // inference all still see the plain string.
    const doc = await xlsxToMarkdownDoc(await buildRichTextXlsx(), { regions: false });
    const table = doc.children.find((n): n is MarkdownTable => n.type === 'table')!;
    const headerCell = table.children[0]!.children[0]!;
    expect(headerCell.isHeader).toBe(true);
  });
});

describe('XLSX export — vertical alignment', () => {
  async function reexportedSheet(): Promise<string> {
    const md = await importToMarkdown();
    const out = await markdownDocToXlsx(parseMarkdown(md));
    const zip = await JSZip.loadAsync(out);
    return (await zip.file('xl/worksheets/sheet1.xml')?.async('string')) ?? '';
  }

  it('writes superscript runs back as SpreadsheetML rich text', async () => {
    const xml = await reexportedSheet();
    expect(xml).toContain(
      '<is><r><t xml:space="preserve">Fresh</t></r>' +
        '<r><rPr><vertAlign val="superscript"/></rPr><t xml:space="preserve">1</t></r></is>',
    );
  });

  it('writes a subscript run', async () => {
    expect(await reexportedSheet()).toContain('<vertAlign val="subscript"/>');
  });

  it('leaves an unformatted cell as a single plain <t>', async () => {
    // Only cells that actually carry alignment become rich text; everything
    // else keeps the flat form it has always had.
    const xml = await reexportedSheet();
    expect(xml).toContain('<is><t xml:space="preserve">Form</t></is>');
  });
});

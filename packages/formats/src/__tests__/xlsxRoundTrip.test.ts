/**
 * The XLSX round-trip contract.
 *
 * Region splitting only earns its keep if the addresses it records survive the
 * trip back. So this goes the whole way — workbook → markdown → **markdown
 * source text** → workbook → markdown — and asserts the two markdown renderings
 * are identical. Going through the serialized string rather than the AST is the
 * point: annotation quoting, table escaping and heading round-tripping are
 * exactly where a contract like this breaks.
 */

import { describe, expect, it } from 'vitest';
import type { MarkdownBlockNode } from '@bendyline/squisq/markdown';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { extractPlainText } from '../shared/text';
import { validateMarkdownSource } from '@bendyline/squisq/doc';
import { NS_R, NS_SML, REL_OFFICE_DOCUMENT } from '../ooxml/namespaces';
import { createPackage } from '../ooxml/writer';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { xlsxToMarkdownDoc } from '../xlsx/import';
import { markdownDocToXlsx } from '../xlsx/export';

const REL_WORKSHEET =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

const str = (ref: string, text: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

/**
 * Two sheets covering the cases that matter: a captioned table with a
 * shared-formula column, a second island on the same sheet, a merged banner, a
 * stray note, and a sheet whose data does not start at A1.
 */
async function buildFixture(): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}"><sheets>` +
      `<sheet name="Sales" sheetId="1" r:id="rId1"/>` +
      `<sheet name="Q3 Notes" sheetId="2" r:id="rId2"/>` +
      `</sheets></workbook>`,
    'application/xml',
  );
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
  pkg.addPart(
    'xl/worksheets/sheet2.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="2">${str('C2', 'Quarterly Notes')}</row>` +
      `<row r="4">${str('C4', 'Topic')}${str('D4', 'Owner')}</row>` +
      `<row r="5">${str('C5', 'Pricing')}${str('D5', 'Dana')}</row>` +
      `</sheetData>` +
      `<mergeCells count="1"><mergeCell ref="C2:D2"/></mergeCells>` +
      `</worksheet>`,
    'application/xml',
  );
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId1',
    type: REL_WORKSHEET,
    target: 'worksheets/sheet1.xml',
  });
  pkg.addRelationship('xl/workbook.xml', {
    id: 'rId2',
    type: REL_WORKSHEET,
    target: 'worksheets/sheet2.xml',
  });
  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });
  return pkg.toArrayBuffer();
}

describe('XLSX round trip', () => {
  it('reproduces the workbook through markdown source text', async () => {
    const first = stringifyMarkdown(await xlsxToMarkdownDoc(await buildFixture()));
    const rebuilt = await markdownDocToXlsx(parseMarkdown(first));
    const second = stringifyMarkdown(await xlsxToMarkdownDoc(rebuilt));

    expect(second).toBe(first);
  });

  it('places every region back at its own address', async () => {
    const first = stringifyMarkdown(await xlsxToMarkdownDoc(await buildFixture()));

    // Anchors, not A1 for everything — the whole point of the feature.
    expect(first).toContain('{[dataTable sheet=Sales anchor=B4 titleAnchor=B3]}');
    expect(first).toContain('{[dataTable sheet=Sales anchor=F4]}');
    expect(first).toContain('{[dataTable sheet=Sales role=loose]}');
    expect(first).toContain('{[dataTable sheet=Sales anchor=B4 role=formulas]}');
    // A sheet name with a space has to survive annotation quoting.
    expect(first).toContain('sheet="Q3 Notes"');
  });

  it('keeps formulas alive across the trip', async () => {
    // Read the formula cells back out of the AST rather than the source text:
    // `*` is an emphasis character, so the serializer writes `=C5\*2`. That
    // escaping round-trips (the first test proves it), but it means the raw
    // string is the wrong thing to assert on.
    const formulasOf = (doc: { children: MarkdownBlockNode[] }): string[] => {
      const out: string[] = [];
      doc.children.forEach((node, i) => {
        const heading = doc.children[i - 1];
        if (
          node.type !== 'table' ||
          heading?.type !== 'heading' ||
          heading.templateAnnotation?.params?.role !== 'formulas'
        ) {
          return;
        }
        for (const row of node.children) {
          for (const cell of row.children) {
            const text = extractPlainText(cell.children);
            if (text !== '') out.push(text);
          }
        }
      });
      return out;
    };

    const firstDoc = await xlsxToMarkdownDoc(await buildFixture());
    expect(formulasOf(firstDoc)).toEqual(['B', 'C', 'D', '=C5*2', '=C6*2']);

    const rebuilt = await markdownDocToXlsx(parseMarkdown(stringifyMarkdown(firstDoc)));
    expect(formulasOf(await xlsxToMarkdownDoc(rebuilt))).toEqual(['B', 'C', 'D', '=C5*2', '=C6*2']);
  });

  it('emits annotations the document validator accepts', async () => {
    const source = stringifyMarkdown(await xlsxToMarkdownDoc(await buildFixture()));
    const { diagnostics } = validateMarkdownSource(source);

    expect(
      diagnostics.filter((d) => d.code === 'unknown-input' || d.code === 'invalid-input-value'),
    ).toEqual([]);
  });
});

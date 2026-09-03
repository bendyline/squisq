/**
 * `xlsxToCellGrids` — the raw-grid public view: every parsed cell with
 * formula AND cached value colocated, plus the workbook-level calc facts
 * (`fullCalcOnLoad`, `date1904`) the cached-value oracle filters on.
 */

import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { NS_R, NS_SML, REL_OFFICE_DOCUMENT } from '../ooxml/namespaces';
import { createPackage } from '../ooxml/writer';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { xlsxToCellGrids } from '../xlsx/import';
import { markdownDocToXlsx } from '../xlsx/export';

const REL_WORKSHEET =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

const str = (ref: string, text: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

/** One sheet: a header, a literal, a formula with a cached value. */
async function buildFixture(calcPrAttr: string): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}"><sheets>` +
      `<sheet name="Sales" sheetId="1" r:id="rId1"/>` +
      `</sheets>${calcPrAttr}</workbook>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="1">${str('A1', 'Amount')}${str('B1', 'Doubled')}</row>` +
      `<row r="2"><c r="A2"><v>21</v></c>` +
      `<c r="B2"><f>A2*2</f><v>42</v></c></row>` +
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

describe('xlsxToCellGrids', () => {
  it('hands over formulas and cached values colocated on each cell', async () => {
    const grids = await xlsxToCellGrids(await buildFixture(''));

    expect(grids.fullCalcOnLoad).toBe(false);
    expect(grids.date1904).toBe(false);
    expect(grids.sheets.map((s) => s.name)).toEqual(['Sales']);

    const cells = grids.sheets[0].cells;
    expect(cells[0]?.[0]?.text).toBe('Amount');
    expect(cells[1]?.[0]?.value).toBe(21);
    // The oracle's two operands, on one record.
    expect(cells[1]?.[1]?.formula).toBe('A2*2');
    expect(cells[1]?.[1]?.value).toBe(42);
  });

  it('reads calcPr fullCalcOnLoad — the "do not trust my cache" flag', async () => {
    const flagged = await xlsxToCellGrids(await buildFixture('<calcPr fullCalcOnLoad="1"/>'));
    expect(flagged.fullCalcOnLoad).toBe(true);

    const unflagged = await xlsxToCellGrids(await buildFixture('<calcPr calcId="0"/>'));
    expect(unflagged.fullCalcOnLoad).toBe(false);
  });

  it('flags squisq-exported formula workbooks as fullCalcOnLoad (self-exclusion)', async () => {
    // The exporter sets fullCalcOnLoad="1" unconditionally on formula
    // workbooks and writes cached values from display text — so squisq's own
    // output must be excluded by the same filter the oracle already applies.
    const markdown = [
      '## Data {[dataTable sheet=Data anchor=A1]}',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '## Data — formulas {[dataTable sheet=Data anchor=A1 role=formulas]}',
      '',
      '| A | B |',
      '| - | - |',
      '|   | =A2\\*2 |',
      '',
    ].join('\n');
    const bytes = await markdownDocToXlsx(parseMarkdown(markdown));

    const grids = await xlsxToCellGrids(bytes);
    expect(grids.fullCalcOnLoad).toBe(true);
  });

  it('respects sheet selection', async () => {
    const grids = await xlsxToCellGrids(await buildFixture(''), { sheet: 'Nope' });
    expect(grids.sheets).toEqual([]);
  });
});

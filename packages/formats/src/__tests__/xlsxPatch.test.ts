/**
 * patchXlsxCellValues guardrails.
 *
 * The patcher's whole promise is surgical scope: only the touched worksheet
 * parts (plus the workbook calc flag) change, everything else in the archive
 * survives byte-for-byte, and any cell it cannot patch honestly refuses the
 * WHOLE batch. These tests hold each clause:
 *  - zero-patch round-trip re-imports identically,
 *  - untouched members keep byte-identical uncompressed content,
 *  - a patched file re-imports equal except the target cells,
 *  - formula / shared-follower / date-styled / missing-sheet refusals,
 *  - `<calcPr fullCalcOnLoad="1"/>` is set after a real patch.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import { NS_R, NS_SML, REL_OFFICE_DOCUMENT } from '../ooxml/namespaces';
import { createPackage } from '../ooxml/writer';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { xlsxToMarkdownDoc, xlsxToCellGrids } from '../xlsx/import';
import { patchXlsxCellValues, XlsxPatchRefusal } from '../xlsx/patch';

const REL_WORKSHEET =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';

const str = (ref: string, text: string) =>
  `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;

/**
 * Two sheets + styles + shared strings: a shared-formula column (master D5,
 * follower D6), a date-styled cell (E5, style 1 = builtin numFmt 14), a
 * shared-string cell (A6, t="s"), and a second sheet the patches never touch.
 */
async function buildFixture(): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    'xl/workbook.xml',
    `${xmlDeclaration()}<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}"><sheets>` +
      `<sheet name="Sales" sheetId="1" r:id="rId1"/>` +
      `<sheet name="Notes" sheetId="2" r:id="rId2"/>` +
      `</sheets></workbook>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/styles.xml',
    `${xmlDeclaration()}<styleSheet xmlns="${NS_SML}">` +
      `<cellXfs count="2">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>` +
      `<xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>` +
      `</cellXfs></styleSheet>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/sharedStrings.xml',
    `${xmlDeclaration()}<sst xmlns="${NS_SML}" count="1" uniqueCount="1">` +
      `<si><t>Pooled</t></si></sst>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="4">${str('A4', 'Region')}${str('B4', 'Qty')}${str('C4', 'Price')}` +
      `${str('D4', 'Total')}${str('E4', 'Date')}</row>` +
      `<row r="5">${str('A5', 'North')}<c r="B5"><v>3</v></c><c r="C5"><v>10</v></c>` +
      `<c r="D5"><f t="shared" si="0" ref="D5:D6">B5*C5</f><v>30</v></c>` +
      `<c r="E5" s="1"><v>45000</v></c></row>` +
      `<row r="6"><c r="A6" t="s"><v>0</v></c><c r="B6"><v>2</v></c><c r="C6"><v>8</v></c>` +
      `<c r="D6"><f t="shared" si="0"/><v>16</v></c></row>` +
      `</sheetData></worksheet>`,
    'application/xml',
  );
  pkg.addPart(
    'xl/worksheets/sheet2.xml',
    `${xmlDeclaration()}<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="1">${str('A1', 'Topic')}${str('B1', 'Owner')}</row>` +
      `<row r="2">${str('A2', 'Pricing')}${str('B2', 'Dana')}</row>` +
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
    type: REL_WORKSHEET,
    target: 'worksheets/sheet2.xml',
  });
  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/workbook.xml' });
  return pkg.toArrayBuffer();
}

async function memberText(bytes: ArrayBuffer, path: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file(path);
  return file ? file.async('text') : null;
}

function cellAt(grids: Awaited<ReturnType<typeof xlsxToCellGrids>>, row: number, col: number) {
  return grids.sheets[0]!.cells[row]?.[col];
}

describe('patchXlsxCellValues', () => {
  it('zero-patch output re-imports identically', async () => {
    const original = await buildFixture();
    const patched = await patchXlsxCellValues(original, []);
    expect(stringifyMarkdown(await xlsxToMarkdownDoc(patched))).toBe(
      stringifyMarkdown(await xlsxToMarkdownDoc(original)),
    );
    // No patches → no calc-flag rewrite either.
    expect(await memberText(patched, 'xl/workbook.xml')).toBe(
      await memberText(original, 'xl/workbook.xml'),
    );
  });

  it('rewrites only the touched worksheet; every other member is byte-identical', async () => {
    const original = await buildFixture();
    const patched = await patchXlsxCellValues(original, [{ sheet: 'Sales', ref: 'B5', value: 7 }]);

    const zipBefore = await JSZip.loadAsync(original);
    const zipAfter = await JSZip.loadAsync(patched);
    const pathsBefore = Object.keys(zipBefore.files).sort();
    expect(Object.keys(zipAfter.files).sort()).toEqual(pathsBefore);

    for (const path of pathsBefore) {
      if (zipBefore.files[path]!.dir) continue;
      if (path === 'xl/worksheets/sheet1.xml' || path === 'xl/workbook.xml') continue;
      const before = await zipBefore.file(path)!.async('uint8array');
      const after = await zipAfter.file(path)!.async('uint8array');
      expect(after, path).toEqual(before);
    }
  });

  it('patched values re-import with everything else unchanged', async () => {
    const original = await buildFixture();
    const patched = await patchXlsxCellValues(original, [
      { sheet: 'Sales', ref: 'B5', value: 7 },
      { sheet: 'Sales', ref: 'A5', value: 'Northwest' },
    ]);
    const grids = await xlsxToCellGrids(patched);

    expect(cellAt(grids, 4, 1)?.value).toBe(7);
    expect(cellAt(grids, 4, 1)?.kind).toBe('number');
    expect(cellAt(grids, 4, 0)?.value).toBe('Northwest');
    // Neighbors untouched: the formula column still carries master + follower.
    expect(cellAt(grids, 4, 3)?.formula).toBe('B5*C5');
    expect(cellAt(grids, 5, 3)?.formula).toBe('B6*C6');
    expect(cellAt(grids, 5, 0)?.value).toBe('Pooled');
  });

  it('writes booleans, clears with null, and creates missing rows/cells', async () => {
    const original = await buildFixture();
    const patched = await patchXlsxCellValues(original, [
      { sheet: 'Sales', ref: 'C6', value: true },
      { sheet: 'Sales', ref: 'B6', value: null },
      // F5 has no <c>; row 9 has no <row> — both must be created in place.
      { sheet: 'Sales', ref: 'F5', value: 42 },
      { sheet: 'Sales', ref: 'A9', value: 'appended' },
    ]);
    const grids = await xlsxToCellGrids(patched);

    expect(cellAt(grids, 5, 2)?.kind).toBe('bool');
    expect(cellAt(grids, 5, 2)?.value).toBe(true);
    expect(cellAt(grids, 5, 1)?.kind).toBe('empty');
    expect(cellAt(grids, 4, 5)?.value).toBe(42);
    expect(cellAt(grids, 8, 0)?.value).toBe('appended');
    // Created rows keep the sheet sorted: re-import saw no ordering trouble,
    // and the sheet XML lists rows in ascending `r` order.
    const sheetXml = (await memberText(patched, 'xl/worksheets/sheet1.xml'))!;
    const rowOrder = [...sheetXml.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
    expect(rowOrder).toEqual([...rowOrder].sort((a, b) => a - b));
  });

  it('replaces a shared-string cell with an inline string, leaving the sst alone', async () => {
    const original = await buildFixture();
    const patched = await patchXlsxCellValues(original, [
      { sheet: 'Sales', ref: 'A6', value: 'Rewritten' },
    ]);
    const grids = await xlsxToCellGrids(patched);
    expect(cellAt(grids, 5, 0)?.value).toBe('Rewritten');
    // sst member untouched (orphaned entries are legal).
    expect(await memberText(patched, 'xl/sharedStrings.xml')).toBe(
      await memberText(original, 'xl/sharedStrings.xml'),
    );
  });

  it('sets fullCalcOnLoad after a real patch, in CT_Workbook sequence', async () => {
    const original = await buildFixture();
    const patched = await patchXlsxCellValues(original, [{ sheet: 'Sales', ref: 'B5', value: 9 }]);
    const grids = await xlsxToCellGrids(patched);
    expect(grids.fullCalcOnLoad).toBe(true);
    const wb = (await memberText(patched, 'xl/workbook.xml'))!;
    expect(wb.indexOf('<calcPr')).toBeGreaterThan(wb.indexOf('</sheets>'));
  });

  it('refuses formula cells, shared followers, date-styled cells, and bad addresses', async () => {
    const original = await buildFixture();
    const refuse = async (patch: Parameters<typeof patchXlsxCellValues>[1][number]) => {
      try {
        await patchXlsxCellValues(original, [patch]);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(XlsxPatchRefusal);
        return (err as XlsxPatchRefusal).code;
      }
      throw new Error('expected a refusal');
    };

    expect(await refuse({ sheet: 'Sales', ref: 'D5', value: 1 })).toBe('formula-cell');
    expect(await refuse({ sheet: 'Sales', ref: 'D6', value: 1 })).toBe('shared-formula-follower');
    expect(await refuse({ sheet: 'Sales', ref: 'E5', value: 45001 })).toBe(
      'date-value-unsupported',
    );
    expect(await refuse({ sheet: 'Missing', ref: 'A1', value: 1 })).toBe('sheet-missing');
    expect(await refuse({ sheet: 'Sales', ref: 'not-a-ref', value: 1 })).toBe('cell-ref-invalid');
    expect(await refuse({ sheet: 'Sales', ref: 'B5', value: Number.NaN })).toBe(
      'number-not-finite',
    );
  });

  it('is all-or-nothing: one refused patch blocks the valid ones beside it', async () => {
    const original = await buildFixture();
    await expect(
      patchXlsxCellValues(original, [
        { sheet: 'Sales', ref: 'B5', value: 7 },
        { sheet: 'Sales', ref: 'D5', value: 1 },
      ]),
    ).rejects.toBeInstanceOf(XlsxPatchRefusal);
  });

  it('writes formulas with cached values — the grid formula-edit save path', async () => {
    const original = await buildFixture();
    const patched = await patchXlsxCellValues(original, [
      { sheet: 'Sales', ref: 'B6', formula: 'B5*10', cachedValue: 30 },
      { sheet: 'Sales', ref: 'C6', formula: 'A5&"!"', cachedValue: 'North!' },
    ]);
    const grids = await xlsxToCellGrids(patched);
    expect(cellAt(grids, 5, 1)?.formula).toBe('B5*10');
    expect(cellAt(grids, 5, 1)?.value).toBe(30);
    expect(cellAt(grids, 5, 2)?.formula).toBe('A5&"!"');
    expect(cellAt(grids, 5, 2)?.value).toBe('North!');
    // The calc flag tells Excel not to trust those caches.
    expect((await memberText(patched, 'xl/workbook.xml'))!).toContain('fullCalcOnLoad');
  });

  it('replaces a plain formula and a shared FOLLOWER, refusing the shared MASTER', async () => {
    const original = await buildFixture();
    // Follower D6 leaves its share group; master D5 keeps its own formula.
    const patched = await patchXlsxCellValues(original, [
      { sheet: 'Sales', ref: 'D6', formula: 'B6*C6*2', cachedValue: 32 },
    ]);
    const grids = await xlsxToCellGrids(patched);
    expect(cellAt(grids, 5, 3)?.formula).toBe('B6*C6*2');
    expect(cellAt(grids, 4, 3)?.formula).toBe('B5*C5'); // master untouched

    const refusal = await patchXlsxCellValues(original, [
      { sheet: 'Sales', ref: 'D5', formula: 'B5*C5*2' },
    ]).then(
      () => null,
      (err: unknown) => err,
    );
    expect(refusal).toBeInstanceOf(XlsxPatchRefusal);
    expect((refusal as XlsxPatchRefusal).code).toBe('shared-formula-master');
  });

  it('refuses a patch carrying both value and formula, or neither', async () => {
    const original = await buildFixture();
    for (const bad of [
      { sheet: 'Sales', ref: 'B5' },
      { sheet: 'Sales', ref: 'B5', value: 1, formula: 'A1' },
      { sheet: 'Sales', ref: 'B5', formula: '   ' },
    ]) {
      const refusal = await patchXlsxCellValues(original, [bad]).then(
        () => null,
        (err: unknown) => err,
      );
      expect(refusal).toBeInstanceOf(XlsxPatchRefusal);
      expect((refusal as XlsxPatchRefusal).code).toBe('patch-invalid');
    }
  });

  it('clearing a date-styled cell is allowed and keeps the style', async () => {
    const original = await buildFixture();
    const patched = await patchXlsxCellValues(original, [
      { sheet: 'Sales', ref: 'E5', value: null },
    ]);
    const grids = await xlsxToCellGrids(patched);
    expect(cellAt(grids, 4, 4)?.kind).toBe('empty');
    expect(await memberText(patched, 'xl/worksheets/sheet1.xml')).toContain('r="E5" s="1"');
  });
});

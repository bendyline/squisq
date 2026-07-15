/**
 * OOXML main-part resolution.
 *
 * Per OPC (ECMA-376 Part 2), a package's main part is whatever the **root**
 * `officeDocument` relationship targets. `word/document.xml`, `xl/workbook.xml`
 * and `ppt/presentation.xml` are conventions, not requirements — real
 * generators emit e.g. `word/document2.xml`.
 *
 * Reading the conventional path literally made such packages import as an
 * EMPTY document with no error and no warning: silent, total data loss. These
 * tests build spec-valid packages with relocated main parts and assert the
 * content survives, plus that a package with NO main part fails loudly.
 */

import { describe, it, expect } from 'vitest';
import { createPackage } from '../ooxml/writer';
import {
  NS_DRAWINGML,
  NS_PML,
  NS_R,
  NS_SML,
  NS_WML,
  REL_OFFICE_DOCUMENT,
  REL_SLIDE,
  REL_STYLES,
  REL_WORKSHEET,
  CONTENT_TYPE_DOCX_DOCUMENT,
  CONTENT_TYPE_DOCX_STYLES,
  CONTENT_TYPE_XLSX_WORKBOOK,
  CONTENT_TYPE_XLSX_WORKSHEET,
  CONTENT_TYPE_PPTX_PRESENTATION,
  CONTENT_TYPE_PPTX_SLIDE,
} from '../ooxml/namespaces';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { docxToMarkdownDoc, docxToContainer } from '../docx/import';
import { xlsxToMarkdownDoc } from '../xlsx/import';
import { pptxToMarkdownDoc } from '../pptx/import';

// ============================================
// Fixtures — main part path is parameterized
// ============================================

/** A spec-valid .docx whose main part lives at `mainPart`. */
async function buildDocx(mainPart: string, opts: { rootRel?: boolean } = {}): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    mainPart,
    xmlDeclaration() +
      `<w:document xmlns:w="${NS_WML}" xmlns:r="${NS_R}"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Relocated Heading</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Relocated body text</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
    CONTENT_TYPE_DOCX_DOCUMENT,
  );
  pkg.addPart(
    'word/styles.xml',
    xmlDeclaration() +
      `<w:styles xmlns:w="${NS_WML}">` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
      `</w:styles>`,
    CONTENT_TYPE_DOCX_STYLES,
  );
  if (opts.rootRel !== false) {
    pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: mainPart });
  }
  pkg.addRelationship(mainPart, { id: 'rIdStyles', type: REL_STYLES, target: 'styles.xml' });
  return pkg.toArrayBuffer();
}

/** A spec-valid .xlsx whose workbook lives at `mainPart`. */
async function buildXlsx(mainPart: string): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    mainPart,
    xmlDeclaration() +
      `<workbook xmlns="${NS_SML}" xmlns:r="${NS_R}">` +
      `<sheets><sheet name="Data" sheetId="1" r:id="rIdS1"/></sheets></workbook>`,
    CONTENT_TYPE_XLSX_WORKBOOK,
  );
  pkg.addPart(
    'xl/worksheets/sheet1.xml',
    xmlDeclaration() +
      `<worksheet xmlns="${NS_SML}"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row>` +
      `<row r="2"><c r="A2" t="inlineStr"><is><t>RelocatedCell</t></is></c></row>` +
      `</sheetData></worksheet>`,
    CONTENT_TYPE_XLSX_WORKSHEET,
  );
  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: mainPart });
  pkg.addRelationship(mainPart, {
    id: 'rIdS1',
    type: REL_WORKSHEET,
    target: 'worksheets/sheet1.xml',
  });
  return pkg.toArrayBuffer();
}

/** A spec-valid .pptx whose presentation lives at `mainPart`. */
async function buildPptx(mainPart: string): Promise<ArrayBuffer> {
  const pkg = createPackage();
  pkg.addPart(
    mainPart,
    xmlDeclaration() +
      `<p:presentation xmlns:p="${NS_PML}" xmlns:r="${NS_R}">` +
      `<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    CONTENT_TYPE_PPTX_PRESENTATION,
  );
  pkg.addPart(
    'ppt/slides/slide1.xml',
    xmlDeclaration() +
      `<p:sld xmlns:p="${NS_PML}" xmlns:a="${NS_DRAWINGML}"><p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>Relocated Slide</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`,
    CONTENT_TYPE_PPTX_SLIDE,
  );
  pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: mainPart });
  pkg.addRelationship(mainPart, { id: 'rId1', type: REL_SLIDE, target: 'slides/slide1.xml' });
  return pkg.toArrayBuffer();
}

// ============================================
// DOCX
// ============================================

describe('DOCX main-part resolution', () => {
  it('imports content from the conventional path (control)', async () => {
    const doc = await docxToMarkdownDoc(await buildDocx('word/document.xml'));
    expect(JSON.stringify(doc)).toContain('Relocated body text');
  });

  it('follows the root officeDocument relationship to a non-conventional path', async () => {
    const doc = await docxToMarkdownDoc(await buildDocx('word/document2.xml'));
    expect(JSON.stringify(doc)).toContain('Relocated Heading');
    expect(JSON.stringify(doc)).toContain('Relocated body text');
  });

  it('resolves styles via the relocated part’s own relationships', async () => {
    const doc = await docxToMarkdownDoc(await buildDocx('word/document2.xml'));
    // Heading1 style resolves only if the main part's rels were read from the
    // relocated path — otherwise this degrades to a plain paragraph.
    const heading = doc.children.find((c) => c.type === 'heading');
    expect(heading).toBeDefined();
  });

  it('handles a main part in a completely different directory', async () => {
    const doc = await docxToMarkdownDoc(await buildDocx('parts/main.xml'));
    expect(JSON.stringify(doc)).toContain('Relocated body text');
  });

  it('docxToContainer also follows the root relationship', async () => {
    const container = await docxToContainer(await buildDocx('word/document2.xml'));
    expect(await container.readDocument()).toContain('Relocated body text');
  });

  it('falls back to the conventional path when the root relationship is missing', async () => {
    const doc = await docxToMarkdownDoc(await buildDocx('word/document.xml', { rootRel: false }));
    expect(JSON.stringify(doc)).toContain('Relocated body text');
  });

  it('fails loudly when no main part exists', async () => {
    const pkg = createPackage();
    pkg.addPart(
      'word/styles.xml',
      xmlDeclaration() + `<w:styles xmlns:w="${NS_WML}"/>`,
      CONTENT_TYPE_DOCX_STYLES,
    );
    pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'word/missing.xml' });

    await expect(docxToMarkdownDoc(await pkg.toArrayBuffer())).rejects.toThrow(
      /no main document part found/i,
    );
  });
});

// ============================================
// XLSX
// ============================================

describe('XLSX main-part resolution', () => {
  it('imports the workbook from the conventional path (control)', async () => {
    const doc = await xlsxToMarkdownDoc(await buildXlsx('xl/workbook.xml'));
    expect(JSON.stringify(doc)).toContain('RelocatedCell');
  });

  it('follows the root officeDocument relationship to a non-conventional path', async () => {
    const doc = await xlsxToMarkdownDoc(await buildXlsx('xl/workbook2.xml'));
    expect(JSON.stringify(doc)).toContain('RelocatedCell');
  });

  it('fails loudly when no workbook part exists', async () => {
    const pkg = createPackage();
    pkg.addPart(
      'xl/worksheets/sheet1.xml',
      xmlDeclaration() + `<worksheet xmlns="${NS_SML}"><sheetData/></worksheet>`,
      CONTENT_TYPE_XLSX_WORKSHEET,
    );
    pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'xl/missing.xml' });

    await expect(xlsxToMarkdownDoc(await pkg.toArrayBuffer())).rejects.toThrow(
      /no main document part found/i,
    );
  });
});

// ============================================
// PPTX
// ============================================

describe('PPTX main-part resolution', () => {
  it('imports slides from the conventional path (control)', async () => {
    const doc = await pptxToMarkdownDoc(await buildPptx('ppt/presentation.xml'), {
      inferTheme: false,
      inferLayouts: false,
    });
    expect(JSON.stringify(doc)).toContain('Relocated Slide');
  });

  it('follows the root officeDocument relationship to a non-conventional path', async () => {
    const doc = await pptxToMarkdownDoc(await buildPptx('ppt/presentation2.xml'), {
      inferTheme: false,
      inferLayouts: false,
    });
    expect(JSON.stringify(doc)).toContain('Relocated Slide');
  });

  it('fails loudly when no presentation part exists', async () => {
    const pkg = createPackage();
    pkg.addPart(
      'ppt/slides/slide1.xml',
      xmlDeclaration() + `<p:sld xmlns:p="${NS_PML}"/>`,
      CONTENT_TYPE_PPTX_SLIDE,
    );
    pkg.addRelationship('', { id: 'rId1', type: REL_OFFICE_DOCUMENT, target: 'ppt/missing.xml' });

    await expect(
      pptxToMarkdownDoc(await pkg.toArrayBuffer(), { inferTheme: false, inferLayouts: false }),
    ).rejects.toThrow(/no main document part found/i);
  });
});

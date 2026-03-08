/**
 * Tests for DOCX import: docxToMarkdownDoc, docxToDoc.
 *
 * Builds minimal .docx test fixtures programmatically using our own
 * OOXML writer (dogfooding the shared layer), then imports them.
 */

import { describe, it, expect } from 'vitest';
import { createPackage } from '../ooxml/writer';
import {
  NS_WML,
  NS_R,
  REL_OFFICE_DOCUMENT,
  REL_STYLES,
  REL_NUMBERING,
  REL_HYPERLINK,
  CONTENT_TYPE_DOCX_DOCUMENT,
  CONTENT_TYPE_DOCX_STYLES,
  CONTENT_TYPE_DOCX_NUMBERING,
} from '../ooxml/namespaces';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { docxToMarkdownDoc, docxToDoc } from '../docx/import';

// ============================================
// Test Fixture Builder
// ============================================

interface DocxFixtureOptions {
  bodyXml: string;
  stylesXml?: string;
  numberingXml?: string;
  documentRels?: Array<{
    id: string;
    type: string;
    target: string;
    targetMode?: 'External';
  }>;
}

async function buildTestDocx(options: DocxFixtureOptions): Promise<ArrayBuffer> {
  const pkg = createPackage();

  // document.xml
  const documentXml =
    xmlDeclaration() +
    `<w:document xmlns:w="${NS_WML}" xmlns:r="${NS_R}">` +
    `<w:body>${options.bodyXml}</w:body>` +
    `</w:document>`;
  pkg.addPart('word/document.xml', documentXml, CONTENT_TYPE_DOCX_DOCUMENT);

  // styles.xml
  if (options.stylesXml) {
    pkg.addPart('word/styles.xml', options.stylesXml, CONTENT_TYPE_DOCX_STYLES);
  } else {
    // Minimal default styles
    const defaultStyles =
      xmlDeclaration() +
      `<w:styles xmlns:w="${NS_WML}">` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style>` +
      `</w:styles>`;
    pkg.addPart('word/styles.xml', defaultStyles, CONTENT_TYPE_DOCX_STYLES);
  }

  // numbering.xml
  if (options.numberingXml) {
    pkg.addPart('word/numbering.xml', options.numberingXml, CONTENT_TYPE_DOCX_NUMBERING);
  }

  // Root relationship
  pkg.addRelationship('', {
    id: 'rId1',
    type: REL_OFFICE_DOCUMENT,
    target: 'word/document.xml',
  });

  // Document relationships
  pkg.addRelationship('word/document.xml', {
    id: 'rIdStyles',
    type: REL_STYLES,
    target: 'styles.xml',
  });

  if (options.numberingXml) {
    pkg.addRelationship('word/document.xml', {
      id: 'rIdNumbering',
      type: REL_NUMBERING,
      target: 'numbering.xml',
    });
  }

  if (options.documentRels) {
    for (const rel of options.documentRels) {
      pkg.addRelationship('word/document.xml', {
        id: rel.id,
        type: rel.type,
        target: rel.target,
        ...(rel.targetMode ? { targetMode: rel.targetMode } : {}),
      });
    }
  }

  return pkg.toArrayBuffer();
}

// ============================================
// Headings
// ============================================

describe('docxToMarkdownDoc', () => {
  it('imports headings based on paragraph style', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Subtitle</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    expect(doc.type).toBe('document');
    expect(doc.children.length).toBe(2);

    expect(doc.children[0].type).toBe('heading');
    const h1 = doc.children[0] as any;
    expect(h1.depth).toBe(1);
    expect(h1.children[0].type).toBe('text');
    expect(h1.children[0].value).toBe('Title');

    expect(doc.children[1].type).toBe('heading');
    const h2 = doc.children[1] as any;
    expect(h2.depth).toBe(2);
    expect(h2.children[0].value).toBe('Subtitle');
  });

  // ============================================
  // Paragraphs
  // ============================================

  it('imports plain paragraphs', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    expect(doc.children.length).toBe(2);
    expect(doc.children[0].type).toBe('paragraph');
    expect((doc.children[0] as any).children[0].value).toBe('Hello world');
  });

  it('skips empty paragraphs', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:pPr/></w:p><w:p><w:r><w:t>Text</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    expect(doc.children.length).toBe(1);
    expect((doc.children[0] as any).children[0].value).toBe('Text');
  });

  // ============================================
  // Inline Formatting
  // ============================================

  it('imports bold text', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as any;
    expect(para.children[0].type).toBe('strong');
    expect(para.children[0].children[0].type).toBe('text');
    expect(para.children[0].children[0].value).toBe('bold');
  });

  it('imports italic text', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as any;
    expect(para.children[0].type).toBe('emphasis');
    expect(para.children[0].children[0].value).toBe('italic');
  });

  it('imports strikethrough text', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:rPr><w:strike/></w:rPr><w:t>struck</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as any;
    // Strikethrough wraps in delete, which may also wrap in emphasis depending on nesting
    // Let's check: strike wraps first, then italic, then bold
    expect(para.children[0].type).toBe('delete');
    expect(para.children[0].children[0].value).toBe('struck');
  });

  it('imports bold+italic combined formatting', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>bold italic</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as any;
    // Should be strong > emphasis > text (bold wraps italic wraps text)
    expect(para.children[0].type).toBe('strong');
    expect(para.children[0].children[0].type).toBe('emphasis');
    expect(para.children[0].children[0].children[0].value).toBe('bold italic');
  });

  it('merges adjacent plain text runs', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:p>` +
        `<w:r><w:t>Hello </w:t></w:r>` +
        `<w:r><w:t>world</w:t></w:r>` +
        `</w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as any;
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe('text');
    expect(para.children[0].value).toBe('Hello world');
  });

  // ============================================
  // Hyperlinks
  // ============================================

  it('imports hyperlinks', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:p>` +
        `<w:hyperlink r:id="rId10">` +
        `<w:r><w:t>click me</w:t></w:r>` +
        `</w:hyperlink>` +
        `</w:p>`,
      documentRels: [
        {
          id: 'rId10',
          type: REL_HYPERLINK,
          target: 'https://example.com',
          targetMode: 'External',
        },
      ],
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as any;
    expect(para.children[0].type).toBe('link');
    expect(para.children[0].url).toBe('https://example.com');
    expect(para.children[0].children[0].type).toBe('text');
    expect(para.children[0].children[0].value).toBe('click me');
  });

  // ============================================
  // Lists
  // ============================================

  it('imports bullet lists', async () => {
    const numberingXml =
      xmlDeclaration() +
      `<w:numbering xmlns:w="${NS_WML}">` +
      `<w:abstractNum w:abstractNumId="1">` +
      `<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>` +
      `</w:numbering>`;

    const data = await buildTestDocx({
      bodyXml:
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t>Item A</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
        `<w:r><w:t>Item B</w:t></w:r></w:p>`,
      numberingXml,
    });

    const doc = await docxToMarkdownDoc(data);
    expect(doc.children[0].type).toBe('list');
    const list = doc.children[0] as any;
    expect(list.ordered).toBe(false);
    expect(list.children.length).toBe(2);
    expect(list.children[0].type).toBe('listItem');
    expect(list.children[0].children[0].children[0].value).toBe('Item A');
  });

  it('imports ordered lists', async () => {
    const numberingXml =
      xmlDeclaration() +
      `<w:numbering xmlns:w="${NS_WML}">` +
      `<w:abstractNum w:abstractNumId="2">` +
      `<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>` +
      `</w:numbering>`;

    const data = await buildTestDocx({
      bodyXml:
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>` +
        `<w:r><w:t>First</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>` +
        `<w:r><w:t>Second</w:t></w:r></w:p>`,
      numberingXml,
    });

    const doc = await docxToMarkdownDoc(data);
    const list = doc.children[0] as any;
    expect(list.type).toBe('list');
    expect(list.ordered).toBe(true);
  });

  // ============================================
  // Tables
  // ============================================

  it('imports tables', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:tbl>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `<w:tr>` +
        `<w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc>` +
        `</w:tr>` +
        `</w:tbl>`,
    });

    const doc = await docxToMarkdownDoc(data);
    expect(doc.children[0].type).toBe('table');
    const table = doc.children[0] as any;
    expect(table.children.length).toBe(2);
    expect(table.children[0].children.length).toBe(2);
    expect(table.children[0].children[0].children[0].value).toBe('A');
    expect(table.children[0].children[1].children[0].value).toBe('B');
    expect(table.children[1].children[0].children[0].value).toBe('1');
  });

  // ============================================
  // Empty Document
  // ============================================

  it('handles empty document', async () => {
    const data = await buildTestDocx({ bodyXml: '' });
    const doc = await docxToMarkdownDoc(data);
    expect(doc.type).toBe('document');
    expect(doc.children.length).toBe(0);
  });

  // ============================================
  // Line Breaks
  // ============================================

  it('imports line breaks', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:p><w:r><w:t>Before</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>After</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as any;
    expect(para.children.some((c: any) => c.type === 'break')).toBe(true);
  });
});

// ============================================
// docxToDoc convenience wrapper
// ============================================

describe('docxToDoc', () => {
  it('converts docx to a prodcore Doc', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Main Title</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Some content here.</w:t></w:r></w:p>`,
    });

    const doc = await docxToDoc(data);
    expect(doc.articleId).toBeDefined();
    expect(doc.blocks.length).toBeGreaterThan(0);
    // The first block should have the heading
    expect(doc.blocks[0].sourceHeading).toBeDefined();
  });
});

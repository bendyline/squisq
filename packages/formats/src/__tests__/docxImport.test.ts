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
  REL_HEADER,
  REL_FOOTER,
  CONTENT_TYPE_DOCX_DOCUMENT,
  CONTENT_TYPE_DOCX_STYLES,
  CONTENT_TYPE_DOCX_NUMBERING,
  CONTENT_TYPE_DOCX_HEADER,
  CONTENT_TYPE_DOCX_FOOTER,
} from '../ooxml/namespaces';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { docxToMarkdownDoc, docxToDoc } from '../docx/import';
import type {
  MarkdownHeading,
  MarkdownParagraph,
  MarkdownList,
  MarkdownTable,
  MarkdownText,
  MarkdownStrong,
  MarkdownEmphasis,
  MarkdownStrikethrough,
  MarkdownLink,
  MarkdownInlineNode,
  MarkdownContainerDirective,
} from '@bendyline/squisq/markdown';

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
  extraParts?: Array<{ path: string; content: string; contentType: string }>;
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

  for (const part of options.extraParts ?? []) {
    pkg.addPart(part.path, part.content, part.contentType);
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
    const h1 = doc.children[0] as MarkdownHeading;
    expect(h1.depth).toBe(1);
    expect(h1.children[0].type).toBe('text');
    expect((h1.children[0] as MarkdownText).value).toBe('Title');

    expect(doc.children[1].type).toBe('heading');
    const h2 = doc.children[1] as MarkdownHeading;
    expect(h2.depth).toBe(2);
    expect((h2.children[0] as MarkdownText).value).toBe('Subtitle');
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
    expect(((doc.children[0] as MarkdownParagraph).children[0] as MarkdownText).value).toBe(
      'Hello world',
    );
  });

  it('imports visible content inside controls, revisions, and text boxes once', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:p>` +
        `<w:r><w:t>Body </w:t></w:r>` +
        `<w:sdt><w:sdtContent><w:r><w:t>controlled </w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:ins><w:r><w:t>inserted </w:t></w:r></w:ins>` +
        `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
        `<mc:Choice><w:drawing><w:txbxContent><w:p><w:r><w:t>text box</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice>` +
        `<mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>fallback duplicate</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback>` +
        `</mc:AlternateContent>` +
        `</w:p>`,
    });

    const paragraph = docText(await docxToMarkdownDoc(data));
    expect(paragraph).toContain('Body controlled inserted text box');
    expect(paragraph).not.toContain('fallback duplicate');
  });

  it('skips empty paragraphs', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:pPr/></w:p><w:p><w:r><w:t>Text</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    expect(doc.children.length).toBe(1);
    expect(((doc.children[0] as MarkdownParagraph).children[0] as MarkdownText).value).toBe('Text');
  });

  // ============================================
  // Inline Formatting
  // ============================================

  it('imports bold text', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as MarkdownParagraph;
    expect(para.children[0].type).toBe('strong');
    const strong = para.children[0] as MarkdownStrong;
    expect(strong.children[0].type).toBe('text');
    expect((strong.children[0] as MarkdownText).value).toBe('bold');
  });

  it('imports italic text', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as MarkdownParagraph;
    expect(para.children[0].type).toBe('emphasis');
    const em = para.children[0] as MarkdownEmphasis;
    expect((em.children[0] as MarkdownText).value).toBe('italic');
  });

  it('imports strikethrough text', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:rPr><w:strike/></w:rPr><w:t>struck</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as MarkdownParagraph;
    const del = para.children[0] as MarkdownStrikethrough;
    expect(del.type).toBe('delete');
    expect((del.children[0] as MarkdownText).value).toBe('struck');
  });

  it('imports bold+italic combined formatting', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>bold italic</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as MarkdownParagraph;
    // Should be strong > emphasis > text (bold wraps italic wraps text)
    const strong = para.children[0] as MarkdownStrong;
    expect(strong.type).toBe('strong');
    const em = strong.children[0] as MarkdownEmphasis;
    expect(em.type).toBe('emphasis');
    expect((em.children[0] as MarkdownText).value).toBe('bold italic');
  });

  it('merges adjacent plain text runs', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p>` + `<w:r><w:t>Hello </w:t></w:r>` + `<w:r><w:t>world</w:t></w:r>` + `</w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as MarkdownParagraph;
    expect(para.children.length).toBe(1);
    expect(para.children[0].type).toBe('text');
    expect((para.children[0] as MarkdownText).value).toBe('Hello world');
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
    const para = doc.children[0] as MarkdownParagraph;
    const link = para.children[0] as MarkdownLink;
    expect(link.type).toBe('link');
    expect(link.url).toBe('https://example.com');
    expect(link.children[0].type).toBe('text');
    expect((link.children[0] as MarkdownText).value).toBe('click me');
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
    const list = doc.children[0] as MarkdownList;
    expect(list.ordered).toBe(false);
    expect(list.children.length).toBe(2);
    expect(list.children[0].type).toBe('listItem');
    const listPara = list.children[0].children[0] as MarkdownParagraph;
    expect((listPara.children[0] as MarkdownText).value).toBe('Item A');
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
    const list = doc.children[0] as MarkdownList;
    expect(list.type).toBe('list');
    expect(list.ordered).toBe(true);
  });

  it('retains nested list text after an empty parent numbering paragraph', async () => {
    const numberingXml =
      xmlDeclaration() +
      `<w:numbering xmlns:w="${NS_WML}">` +
      `<w:abstractNum w:abstractNumId="3">` +
      `<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>` +
      `<w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl>` +
      `</w:abstractNum>` +
      `<w:num w:numId="3"><w:abstractNumId w:val="3"/></w:num>` +
      `</w:numbering>`;
    const data = await buildTestDocx({
      bodyXml:
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr></w:p>` +
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr></w:pPr>` +
        `<w:r><w:t>Nested content survives</w:t></w:r></w:p>`,
      numberingXml,
    });

    expect(docText(await docxToMarkdownDoc(data))).toContain('Nested content survives');
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
    const table = doc.children[0] as MarkdownTable;
    expect(table.children.length).toBe(2);
    expect(table.children[0].children.length).toBe(2);
    const cell00 = table.children[0].children[0];
    const cell01 = table.children[0].children[1];
    const cell10 = table.children[1].children[0];
    expect((cell00.children[0] as MarkdownText).value).toBe('A');
    expect((cell01.children[0] as MarkdownText).value).toBe('B');
    expect((cell10.children[0] as MarkdownText).value).toBe('1');
  });

  it('flattens nested table contents without losing their text', async () => {
    const data = await buildTestDocx({
      bodyXml:
        `<w:tbl><w:tr><w:tc>` +
        `<w:p><w:r><w:t>Outer</w:t></w:r></w:p>` +
        `<w:tbl><w:tr>` +
        `<w:tc><w:p><w:r><w:t>Nested A</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>Nested B</w:t></w:r></w:p></w:tc>` +
        `</w:tr></w:tbl>` +
        `</w:tc></w:tr></w:tbl>`,
    });

    expect(docText(await docxToMarkdownDoc(data))).toContain('Outer Nested A Nested B');
  });

  it('imports headers and footers as explicit DOCX story directives', async () => {
    const headerXml =
      xmlDeclaration() +
      `<w:hdr xmlns:w="${NS_WML}"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>`;
    const footerXml =
      xmlDeclaration() +
      `<w:ftr xmlns:w="${NS_WML}"><w:p><w:r><w:t>Footer text</w:t></w:r></w:p></w:ftr>`;
    const data = await buildTestDocx({
      bodyXml:
        `<w:p><w:r><w:t>Body text</w:t></w:r></w:p>` +
        `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/>` +
        `<w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>`,
      documentRels: [
        { id: 'rIdHeader', type: REL_HEADER, target: 'header1.xml' },
        { id: 'rIdFooter', type: REL_FOOTER, target: 'footer1.xml' },
      ],
      extraParts: [
        { path: 'word/header1.xml', content: headerXml, contentType: CONTENT_TYPE_DOCX_HEADER },
        { path: 'word/footer1.xml', content: footerXml, contentType: CONTENT_TYPE_DOCX_FOOTER },
      ],
    });

    const doc = await docxToMarkdownDoc(data);
    const header = doc.children.find(
      (node): node is MarkdownContainerDirective =>
        node.type === 'containerDirective' && node.name === 'docx-header',
    );
    const footer = doc.children.find(
      (node): node is MarkdownContainerDirective =>
        node.type === 'containerDirective' && node.name === 'docx-footer',
    );
    expect(header?.attributes?.type).toBe('default');
    expect(footer?.attributes?.type).toBe('default');
    expect(docText(doc)).toContain('Body text Header text Footer text');
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
      bodyXml: `<w:p><w:r><w:t>Before</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>After</w:t></w:r></w:p>`,
    });

    const doc = await docxToMarkdownDoc(data);
    const para = doc.children[0] as MarkdownParagraph;
    expect(para.children.some((c: MarkdownInlineNode) => c.type === 'break')).toBe(true);
  });

  it('retains tabs as visible word boundaries', async () => {
    const data = await buildTestDocx({
      bodyXml: `<w:p><w:r><w:t>Before</w:t><w:tab/><w:t>After</w:t></w:r></w:p>`,
    });

    expect(docText(await docxToMarkdownDoc(data))).toBe('Before After');
  });
});

function docText(doc: Awaited<ReturnType<typeof docxToMarkdownDoc>>): string {
  const text: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const value = node as { type?: string; value?: string; children?: unknown[] };
    if ((value.type === 'text' || value.type === 'code') && value.value) text.push(value.value);
    value.children?.forEach(visit);
  };
  visit(doc);
  return text.join(' ').replace(/\s+/g, ' ').trim();
}

// ============================================
// docxToDoc convenience wrapper
// ============================================

describe('docxToDoc', () => {
  it('converts docx to a squisq Doc', async () => {
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

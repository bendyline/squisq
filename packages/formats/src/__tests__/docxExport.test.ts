/**
 * Tests for DOCX export: markdownDocToDocx, docToDocx.
 *
 * Exports a MarkdownDocument to .docx, then unzips and inspects
 * the OOXML structure to verify correctness.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type {
  MarkdownDocument,
  MarkdownHeading,
  MarkdownParagraph,
  MarkdownList,
  MarkdownListItem,
  MarkdownTable,
  MarkdownTableRow,
  MarkdownTableCell,
  MarkdownCodeBlock,
  MarkdownBlockquote,
  MarkdownThematicBreak,
  MarkdownText,
  MarkdownStrong,
  MarkdownEmphasis,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownBreak,
} from '@bendyline/squisq/markdown';

import { markdownDocToDocx, docToDocx } from '../docx/export';

// ============================================
// Helpers
// ============================================

async function exportAndParse(doc: MarkdownDocument, options?: Parameters<typeof markdownDocToDocx>[1]) {
  const buffer = await markdownDocToDocx(doc, options);
  expect(buffer).toBeInstanceOf(ArrayBuffer);
  expect(buffer.byteLength).toBeGreaterThan(0);

  const zip = await JSZip.loadAsync(buffer);
  return zip;
}

async function getDocumentXml(zip: JSZip): Promise<Document> {
  const text = await zip.file('word/document.xml')!.async('text');
  return new DOMParser().parseFromString(text, 'application/xml');
}

function getBodyParagraphs(doc: Document): Element[] {
  const body = doc.getElementsByTagName('w:body')[0];
  return Array.from(body.children).filter((el) => el.localName === 'p');
}

// ============================================
// Basic Structure
// ============================================

describe('markdownDocToDocx', () => {
  it('produces a valid zip with required parts', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Hello' }] },
      ],
    };

    const zip = await exportAndParse(doc);

    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('_rels/.rels')).not.toBeNull();
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(zip.file('word/styles.xml')).not.toBeNull();
    expect(zip.file('word/settings.xml')).not.toBeNull();
    expect(zip.file('word/fontTable.xml')).not.toBeNull();
  });

  it('exports an empty document', async () => {
    const doc: MarkdownDocument = { type: 'document', children: [] };
    const zip = await exportAndParse(doc);
    const xmlDoc = await getDocumentXml(zip);
    const body = xmlDoc.getElementsByTagName('w:body')[0];
    expect(body).toBeDefined();
  });

  // ============================================
  // Headings
  // ============================================

  it('exports headings with correct styles', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: 'Title' }],
        } satisfies MarkdownHeading,
        {
          type: 'heading',
          depth: 2,
          children: [{ type: 'text', value: 'Subtitle' }],
        } satisfies MarkdownHeading,
        {
          type: 'heading',
          depth: 3,
          children: [{ type: 'text', value: 'Section' }],
        } satisfies MarkdownHeading,
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');

    // Verify heading styles are present
    expect(xmlText).toContain('w:val="Heading1"');
    expect(xmlText).toContain('w:val="Heading2"');
    expect(xmlText).toContain('w:val="Heading3"');

    // Verify heading text
    expect(xmlText).toContain('Title');
    expect(xmlText).toContain('Subtitle');
    expect(xmlText).toContain('Section');
  });

  // ============================================
  // Inline Formatting
  // ============================================

  it('exports bold text with w:b element', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'strong',
              children: [{ type: 'text', value: 'bold text' }],
            } satisfies MarkdownStrong,
          ],
        },
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('<w:b/>');
    expect(xmlText).toContain('bold text');
  });

  it('exports italic text with w:i element', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'emphasis',
              children: [{ type: 'text', value: 'italic text' }],
            } satisfies MarkdownEmphasis,
          ],
        },
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('<w:i/>');
    expect(xmlText).toContain('italic text');
  });

  it('exports inline code with monospace font', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'inlineCode', value: 'console.log()' } satisfies MarkdownInlineCode,
          ],
        },
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('Consolas');
    expect(xmlText).toContain('console.log()');
  });

  // ============================================
  // Lists
  // ============================================

  it('exports unordered list with numbering', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'list',
          ordered: false,
          children: [
            {
              type: 'listItem',
              children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'Item 1' }] },
              ],
            } satisfies MarkdownListItem,
            {
              type: 'listItem',
              children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'Item 2' }] },
              ],
            } satisfies MarkdownListItem,
          ],
        } satisfies MarkdownList,
      ],
    };

    const zip = await exportAndParse(doc);

    // Should have numbering.xml
    expect(zip.file('word/numbering.xml')).not.toBeNull();

    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('Item 1');
    expect(xmlText).toContain('Item 2');
    expect(xmlText).toContain('w:numId');

    // Numbering should be bullet type
    const numXml = await zip.file('word/numbering.xml')!.async('text');
    expect(numXml).toContain('w:val="bullet"');
  });

  it('exports ordered list with decimal numbering', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'list',
          ordered: true,
          children: [
            {
              type: 'listItem',
              children: [
                { type: 'paragraph', children: [{ type: 'text', value: 'First' }] },
              ],
            } satisfies MarkdownListItem,
          ],
        } satisfies MarkdownList,
      ],
    };

    const zip = await exportAndParse(doc);
    const numXml = await zip.file('word/numbering.xml')!.async('text');
    expect(numXml).toContain('w:val="decimal"');
  });

  // ============================================
  // Tables
  // ============================================

  it('exports tables with rows and cells', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'table',
          children: [
            {
              type: 'tableRow',
              children: [
                { type: 'tableCell', isHeader: true, children: [{ type: 'text', value: 'Name' }] } satisfies MarkdownTableCell,
                { type: 'tableCell', isHeader: true, children: [{ type: 'text', value: 'Value' }] } satisfies MarkdownTableCell,
              ],
            } satisfies MarkdownTableRow,
            {
              type: 'tableRow',
              children: [
                { type: 'tableCell', children: [{ type: 'text', value: 'A' }] } satisfies MarkdownTableCell,
                { type: 'tableCell', children: [{ type: 'text', value: '1' }] } satisfies MarkdownTableCell,
              ],
            } satisfies MarkdownTableRow,
          ],
        } satisfies MarkdownTable,
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('<w:tbl>');
    expect(xmlText).toContain('<w:tr>');
    expect(xmlText).toContain('<w:tc>');
    expect(xmlText).toContain('Name');
    expect(xmlText).toContain('Value');
  });

  // ============================================
  // Code Blocks
  // ============================================

  it('exports code blocks with code styling', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'code',
          value: 'const x = 1;\nconst y = 2;',
        } satisfies MarkdownCodeBlock,
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('const x = 1;');
    expect(xmlText).toContain('const y = 2;');
    expect(xmlText).toContain('Consolas');
  });

  // ============================================
  // Blockquotes
  // ============================================

  it('exports blockquotes with quote style', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'blockquote',
          children: [
            { type: 'paragraph', children: [{ type: 'text', value: 'A wise quote' }] },
          ],
        } satisfies MarkdownBlockquote,
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('Quote');
    expect(xmlText).toContain('A wise quote');
  });

  // ============================================
  // Hyperlinks
  // ============================================

  it('exports hyperlinks with relationship', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'https://example.com',
              children: [{ type: 'text', value: 'click here' }],
            } satisfies MarkdownLink,
          ],
        },
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('<w:hyperlink');
    expect(xmlText).toContain('click here');

    // Check relationships
    const relsText = await zip.file('word/_rels/document.xml.rels')!.async('text');
    expect(relsText).toContain('https://example.com');
    expect(relsText).toContain('TargetMode="External"');
  });

  // ============================================
  // Thematic Break
  // ============================================

  it('exports thematic breaks', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        { type: 'thematicBreak' } satisfies MarkdownThematicBreak,
      ],
    };

    const zip = await exportAndParse(doc);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('w:pBdr');
    expect(xmlText).toContain('w:bottom');
  });

  // ============================================
  // Core Properties
  // ============================================

  it('includes core properties when options are provided', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'test' }] },
      ],
    };

    const zip = await exportAndParse(doc, {
      title: 'My Document',
      author: 'Test Author',
    });

    const coreXml = await zip.file('docProps/core.xml')?.async('text');
    expect(coreXml).toBeDefined();
    expect(coreXml).toContain('My Document');
    expect(coreXml).toContain('Test Author');
  });
});

// ============================================
// docToDocx convenience wrapper
// ============================================

describe('docToDocx', () => {
  it('converts a Doc to docx', async () => {
    const doc = {
      articleId: 'test',
      duration: 10,
      blocks: [
        {
          id: 'block-1',
          startTime: 0,
          duration: 5,
          audioSegment: 0,
          sourceHeading: {
            type: 'heading' as const,
            depth: 1 as const,
            children: [{ type: 'text' as const, value: 'Test Heading' }],
          },
          contents: [
            {
              type: 'paragraph' as const,
              children: [{ type: 'text' as const, value: 'Body text' }],
            },
          ],
        },
      ],
      audio: { segments: [] },
    };

    const buffer = await docToDocx(doc);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(buffer);
    const xmlText = await zip.file('word/document.xml')!.async('text');
    expect(xmlText).toContain('Test Heading');
    expect(xmlText).toContain('Body text');
  });
});

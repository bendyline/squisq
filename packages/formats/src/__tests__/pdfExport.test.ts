/**
 * Tests for PDF export: markdownDocToPdf, docToPdf.
 *
 * Exports various MarkdownDocuments to PDF, then re-opens the
 * resulting ArrayBuffers with pdf-lib to verify structure/metadata.
 */

import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
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
} from '@bendyline/squisq/markdown';

import { markdownDocToPdf, docToPdf } from '../pdf/export';

// ============================================
// Helpers
// ============================================

async function exportAndLoad(
  doc: MarkdownDocument,
  options?: Parameters<typeof markdownDocToPdf>[1],
) {
  const buffer = await markdownDocToPdf(doc, options);
  expect(buffer).toBeInstanceOf(ArrayBuffer);
  expect(buffer.byteLength).toBeGreaterThan(0);
  return PDFDocument.load(buffer);
}

function text(value: string): MarkdownText {
  return { type: 'text', value };
}

// ============================================
// Basic Structure
// ============================================

describe('markdownDocToPdf', () => {
  it('produces a valid PDF for an empty document', async () => {
    const doc: MarkdownDocument = { type: 'document', children: [] };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('sets title and author metadata', async () => {
    const doc: MarkdownDocument = { type: 'document', children: [] };
    const pdf = await exportAndLoad(doc, { title: 'Test Title', author: 'Test Author' });
    expect(pdf.getTitle()).toBe('Test Title');
    expect(pdf.getAuthor()).toBe('Test Author');
  });

  it('renders a single paragraph', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [text('Hello, World!')],
        } as MarkdownParagraph,
      ],
    };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('renders headings at various depths', async () => {
    const children: MarkdownHeading[] = [1, 2, 3, 4, 5, 6].map((d) => ({
      type: 'heading',
      depth: d as 1 | 2 | 3 | 4 | 5 | 6,
      children: [text(`Heading Level ${d}`)],
    }));
    const doc: MarkdownDocument = { type: 'document', children };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders inline formatting (bold, italic, code)', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            text('Normal '),
            { type: 'strong', children: [text('bold')] } as MarkdownStrong,
            text(' '),
            { type: 'emphasis', children: [text('italic')] } as MarkdownEmphasis,
            text(' '),
            { type: 'inlineCode', value: 'code' } as MarkdownInlineCode,
          ],
        } as MarkdownParagraph,
      ],
    };
    // Should not throw
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('renders a link', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            text('See '),
            {
              type: 'link',
              url: 'https://example.com',
              children: [text('Example')],
            } as MarkdownLink,
          ],
        } as MarkdownParagraph,
      ],
    };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('renders unordered and ordered lists', async () => {
    const unordered: MarkdownList = {
      type: 'list',
      ordered: false,
      children: [
        { type: 'listItem', children: [{ type: 'paragraph', children: [text('Apple')] } as MarkdownParagraph] } as MarkdownListItem,
        { type: 'listItem', children: [{ type: 'paragraph', children: [text('Banana')] } as MarkdownParagraph] } as MarkdownListItem,
      ],
    };
    const ordered: MarkdownList = {
      type: 'list',
      ordered: true,
      children: [
        { type: 'listItem', children: [{ type: 'paragraph', children: [text('First')] } as MarkdownParagraph] } as MarkdownListItem,
        { type: 'listItem', children: [{ type: 'paragraph', children: [text('Second')] } as MarkdownParagraph] } as MarkdownListItem,
      ],
    };
    const doc: MarkdownDocument = { type: 'document', children: [unordered, ordered] };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders a code block', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'code',
          value: 'function hello() {\n  return "world";\n}',
        } as MarkdownCodeBlock,
      ],
    };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('renders a blockquote', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'blockquote',
          children: [
            { type: 'paragraph', children: [text('Quoted text')] } as MarkdownParagraph,
          ],
        } as MarkdownBlockquote,
      ],
    };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('renders a table', async () => {
    const row = (cells: string[], isHeader: boolean): MarkdownTableRow => ({
      type: 'tableRow',
      children: cells.map((c) => ({
        type: 'tableCell',
        isHeader,
        children: [text(c)],
      } as MarkdownTableCell)),
    });

    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'table',
          children: [
            row(['Name', 'Age', 'City'], true),
            row(['Alice', '30', 'NYC'], false),
            row(['Bob', '25', 'LA'], false),
          ],
        } as MarkdownTable,
      ],
    };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders a thematic break', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        { type: 'paragraph', children: [text('Before')] } as MarkdownParagraph,
        { type: 'thematicBreak' } as MarkdownThematicBreak,
        { type: 'paragraph', children: [text('After')] } as MarkdownParagraph,
      ],
    };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBe(1);
  });

  it('uses A4 page size when specified', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [{ type: 'paragraph', children: [text('A4 page')] } as MarkdownParagraph],
    };
    const pdf = await exportAndLoad(doc, { pageSize: 'a4' });
    const page = pdf.getPage(0);
    const { width, height } = page.getSize();
    // A4 is approximately 595 × 842
    expect(width).toBeCloseTo(595.28, 0);
    expect(height).toBeCloseTo(841.89, 0);
  });

  it('paginates long documents', async () => {
    const children: MarkdownParagraph[] = [];
    // Each paragraph is a few lines — 100 paragraphs should overflow a page
    for (let i = 0; i < 100; i++) {
      children.push({
        type: 'paragraph',
        children: [text(`Paragraph number ${i + 1}. This is some body text to fill the page.`)],
      });
    }
    const doc: MarkdownDocument = { type: 'document', children };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });

  it('handles nested lists', async () => {
    const inner: MarkdownList = {
      type: 'list',
      ordered: false,
      children: [
        { type: 'listItem', children: [{ type: 'paragraph', children: [text('Nested item')] } as MarkdownParagraph] } as MarkdownListItem,
      ],
    };
    const outer: MarkdownList = {
      type: 'list',
      ordered: false,
      children: [
        {
          type: 'listItem',
          children: [
            { type: 'paragraph', children: [text('Outer item')] } as MarkdownParagraph,
            inner,
          ],
        } as MarkdownListItem,
      ],
    };
    const doc: MarkdownDocument = { type: 'document', children: [outer] };
    const pdf = await exportAndLoad(doc);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});

// ============================================
// docToPdf convenience wrapper
// ============================================

describe('docToPdf', () => {
  it('converts a Doc object to PDF', async () => {
    const doc = {
      id: 'test-doc',
      name: 'Test',
      description: 'A test document',
      blocks: [
        {
          id: 'block-1',
          template: 'titleBlock',
          data: { title: 'Hello' },
          durationMs: 3000,
        },
      ],
    } as any;
    const buffer = await docToPdf(doc);
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});

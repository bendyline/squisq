/**
 * Tests for PDF import: pdfToMarkdownDoc, pdfToDoc.
 *
 * Builds PDFs with pdf-lib (adding known text), then imports them
 * via pdfToMarkdownDoc and inspects the resulting MarkdownDocument.
 *
 * NOTE: pdfjs-dist text extraction quality depends on the environment.
 * Standard fonts embedded by pdf-lib should produce readable text items.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { pdfToContainer, pdfToMarkdownDoc, pdfToDoc, insertImageBlocks } from '../pdf/import';
import type { ExtractedImage } from '../pdf/import';
import type {
  MarkdownHeading,
  MarkdownBlockNode,
  MarkdownCodeBlock,
  MarkdownParagraph,
} from '@bendyline/squisq/markdown';

/** Structural shape shared by all markdown node types, for recursive walkers. */
type TreeNode = { type: string; value?: string; children?: TreeNode[] };

afterEach(() => vi.unstubAllGlobals());

// ============================================
// Helpers
// ============================================

/**
 * Create a simple PDF buffer with text drawn at specified sizes/positions.
 */
async function buildSimplePdf(
  lines: Array<{ text: string; x: number; y: number; fontSize: number; fontName?: string }>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Letter

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const mono = await doc.embedFont(StandardFonts.Courier);

  for (const line of lines) {
    let font = regular;
    const fName = line.fontName?.toLowerCase() ?? '';
    if (fName.includes('bold')) font = bold;
    else if (fName.includes('italic') || fName.includes('oblique')) font = italic;
    else if (fName.includes('courier') || fName.includes('mono')) font = mono;

    page.drawText(line.text, {
      x: line.x,
      y: line.y,
      size: line.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return doc.save();
}

function flatText(node: MarkdownBlockNode): string {
  const parts: string[] = [];
  function walk(n: TreeNode) {
    if (n.type === 'text' && n.value) parts.push(n.value);
    if (n.value && n.type === 'code') parts.push(n.value);
    if (n.value && n.type === 'inlineCode') parts.push(n.value);
    if (n.children) for (const c of n.children) walk(c);
  }
  walk(node);
  return parts.join('');
}

// ============================================
// Basic Import
// ============================================

describe('pdfToMarkdownDoc', () => {
  // PDF.js cold-loading and fake-worker startup can exceed Vitest's 5s default
  // when the Windows CI runner is saturated by the full parallel test suite.
  it('returns an empty document for a blank PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const buffer = await doc.save();

    const md = await pdfToMarkdownDoc(buffer);
    expect(md.type).toBe('document');
    expect(md.children.length).toBe(0);
  }, 30_000);

  it('imports a single paragraph', async () => {
    const buffer = await buildSimplePdf([{ text: 'Hello World', x: 72, y: 700, fontSize: 11 }]);
    const md = await pdfToMarkdownDoc(buffer);
    expect(md.children.length).toBeGreaterThanOrEqual(1);

    // The first block should contain "Hello World"
    const allText = md.children.map(flatText).join(' ');
    expect(allText).toContain('Hello');
    expect(allText).toContain('World');
  });

  it('detects a heading by font size', async () => {
    const buffer = await buildSimplePdf([
      { text: 'Big Title', x: 72, y: 700, fontSize: 24 },
      { text: 'Body text here.', x: 72, y: 660, fontSize: 11 },
    ]);
    // Provide explicit bodyFontSize — with only 2 lines auto-detection
    // picks the first seen size (24) which masks the heading.
    const md = await pdfToMarkdownDoc(buffer, { bodyFontSize: 11 });

    // Find heading block
    const headings = md.children.filter((c) => c.type === 'heading');
    expect(headings.length).toBeGreaterThanOrEqual(1);
    if (headings.length > 0) {
      const h = headings[0] as MarkdownHeading;
      expect(h.depth).toBeLessThanOrEqual(2);
      expect(flatText(h)).toContain('Title');
    }
  });

  it('renders bold text as plain text (standard font limitation)', async () => {
    // pdfjs-dist returns opaque font IDs ("g_d0_f2") for standard PDF fonts,
    // not the actual font name. Bold/italic detection only works with
    // embedded fonts whose names contain "Bold"/"Italic" — a known heuristic
    // limitation. Here we verify the text is still extracted.
    const buffer = await buildSimplePdf([
      { text: 'Bold text', x: 72, y: 700, fontSize: 11, fontName: 'Helvetica-Bold' },
    ]);
    const md = await pdfToMarkdownDoc(buffer);
    expect(md.children.length).toBeGreaterThanOrEqual(1);
    const allText = md.children.map(flatText).join(' ');
    expect(allText).toContain('Bold text');
  });

  it('renders italic text as plain text (standard font limitation)', async () => {
    // Same as bold — standard PDF font names are not exposed by pdfjs-dist.
    const buffer = await buildSimplePdf([
      { text: 'Italic text', x: 72, y: 700, fontSize: 11, fontName: 'Helvetica-Oblique' },
    ]);
    const md = await pdfToMarkdownDoc(buffer);
    expect(md.children.length).toBeGreaterThanOrEqual(1);
    const allText = md.children.map(flatText).join(' ');
    expect(allText).toContain('Italic text');
  });

  it('detects monospace text as inline code', async () => {
    const buffer = await buildSimplePdf([
      { text: 'const x = 1;', x: 72, y: 700, fontSize: 10, fontName: 'Courier' },
    ]);
    const md = await pdfToMarkdownDoc(buffer);
    expect(md.children.length).toBeGreaterThanOrEqual(1);

    // Monospace lines should become code blocks or inline code
    function hasCode(node: TreeNode): boolean {
      if (node.type === 'code' || node.type === 'inlineCode') return true;
      if (node.children) return node.children.some(hasCode);
      return false;
    }
    expect(md.children.some(hasCode)).toBe(true);
  });

  it('detects consecutive monospace lines as a code block', async () => {
    const buffer = await buildSimplePdf([
      { text: 'function hello() {', x: 72, y: 700, fontSize: 10, fontName: 'Courier' },
      { text: '  return 42;', x: 72, y: 686, fontSize: 10, fontName: 'Courier' },
      { text: '}', x: 72, y: 672, fontSize: 10, fontName: 'Courier' },
    ]);
    const md = await pdfToMarkdownDoc(buffer);

    const codeBlocks = md.children.filter((c) => c.type === 'code');
    expect(codeBlocks.length).toBeGreaterThanOrEqual(1);
    if (codeBlocks.length > 0) {
      const cb = codeBlocks[0] as MarkdownCodeBlock;
      expect(cb.value).toContain('function');
      expect(cb.value).toContain('return');
    }
  });

  it('detects bullet list items', async () => {
    const buffer = await buildSimplePdf([
      { text: '\u2022 First item', x: 72, y: 700, fontSize: 11 },
      { text: '\u2022 Second item', x: 72, y: 684, fontSize: 11 },
    ]);
    const md = await pdfToMarkdownDoc(buffer);

    const lists = md.children.filter((c) => c.type === 'list');
    expect(lists.length).toBeGreaterThanOrEqual(1);
  });

  it('detects ordered list items', async () => {
    const buffer = await buildSimplePdf([
      { text: '1. First step', x: 72, y: 700, fontSize: 11 },
      { text: '2. Second step', x: 72, y: 684, fontSize: 11 },
    ]);
    const md = await pdfToMarkdownDoc(buffer);

    const lists = md.children.filter((c) => c.type === 'list');
    expect(lists.length).toBeGreaterThanOrEqual(1);
  });

  it('detects indented text as blockquote', async () => {
    const buffer = await buildSimplePdf([
      { text: 'Normal paragraph.', x: 72, y: 720, fontSize: 11 },
      { text: 'This is a quote.', x: 110, y: 700, fontSize: 11 },
    ]);
    const md = await pdfToMarkdownDoc(buffer, { detectBlockquotes: true });

    const quotes = md.children.filter((c) => c.type === 'blockquote');
    expect(quotes.length).toBeGreaterThanOrEqual(1);
  });

  it('detects URLs in text as links', async () => {
    const buffer = await buildSimplePdf([
      { text: 'Visit https://example.com for more.', x: 72, y: 700, fontSize: 11 },
    ]);
    const md = await pdfToMarkdownDoc(buffer, { detectLinks: true });

    function hasLink(node: TreeNode): boolean {
      if (node.type === 'link') return true;
      if (node.children) return node.children.some(hasLink);
      return false;
    }
    expect(md.children.some(hasLink)).toBe(true);
  });

  it('handles multi-page documents', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let p = 0; p < 3; p++) {
      const page = doc.addPage([612, 792]);
      page.drawText(`Page ${p + 1} content`, {
        x: 72,
        y: 700,
        size: 11,
        font,
      });
    }
    const buffer = await doc.save();

    const md = await pdfToMarkdownDoc(buffer);
    expect(md.children.length).toBeGreaterThanOrEqual(3);
  });

  it('respects bodyFontSize option', async () => {
    // If we say body is 14pt, then a 16pt line should still be heading
    // but borderline 13pt would not be
    const buffer = await buildSimplePdf([
      { text: 'Medium heading', x: 72, y: 700, fontSize: 16 },
      { text: 'Body text at 14pt', x: 72, y: 670, fontSize: 14 },
    ]);
    const md = await pdfToMarkdownDoc(buffer, { bodyFontSize: 14 });

    const headings = md.children.filter((c) => c.type === 'heading');
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('accepts Uint8Array input', async () => {
    const buffer = await buildSimplePdf([{ text: 'Uint8Array test', x: 72, y: 700, fontSize: 11 }]);
    const uint8 = new Uint8Array(buffer);
    const md = await pdfToMarkdownDoc(uint8);
    expect(md.children.length).toBeGreaterThanOrEqual(1);
  });

  it('can disable table detection', async () => {
    const buffer = await buildSimplePdf([
      { text: 'Col A', x: 72, y: 700, fontSize: 11 },
      { text: 'Col B', x: 250, y: 700, fontSize: 11 },
      { text: 'Val 1', x: 72, y: 684, fontSize: 11 },
      { text: 'Val 2', x: 250, y: 684, fontSize: 11 },
    ]);
    const md = await pdfToMarkdownDoc(buffer, { detectTables: false });
    const tables = md.children.filter((c) => c.type === 'table');
    expect(tables.length).toBe(0);
  });
});

// ============================================
// pdfToDoc convenience wrapper
// ============================================

// ============================================
// insertImageBlocks — page-level image placement (pure)
// ============================================

describe('insertImageBlocks', () => {
  /** Build a synthetic paragraph block carrying a marker text value. */
  function para(label: string): MarkdownParagraph {
    return { type: 'paragraph', children: [{ type: 'text', value: label }] };
  }

  /** Build a synthetic extracted image on a given page (data/y are irrelevant here). */
  function img(index: number, page: number): ExtractedImage {
    return { path: `images/image${index}.png`, data: new ArrayBuffer(0), page, y: 0 };
  }

  /** Extract a flat list of block descriptors: paragraph label or image url. */
  function describeBlocks(blocks: MarkdownBlockNode[]): string[] {
    return blocks.map((b) => {
      if (b.type === 'paragraph') {
        const child = (b as MarkdownParagraph).children[0];
        if (child && child.type === 'image') return `img:${child.url}`;
        if (child && child.type === 'text') return `p:${child.value}`;
      }
      return b.type;
    });
  }

  it('is a no-op when there are no images', () => {
    const blocks = [para('A'), para('B')];
    const pages = [0, 0];
    const result = insertImageBlocks(blocks, pages, []);
    expect(result).toBe(blocks);
  });

  it('places an image after the last block of its page', () => {
    // Page 0: A, B   Page 1: C
    const blocks = [para('A'), para('B'), para('C')];
    const pages = [0, 0, 1];
    const result = insertImageBlocks(blocks, pages, [img(1, 0)]);
    expect(describeBlocks(result)).toEqual(['p:A', 'p:B', 'img:images/image1.png', 'p:C']);
  });

  it('places images on the correct page in a multi-page document', () => {
    // Page 0: A   Page 1: B   Page 2: C
    const blocks = [para('A'), para('B'), para('C')];
    const pages = [0, 1, 2];
    const result = insertImageBlocks(blocks, pages, [img(1, 2), img(2, 0)]);
    // image2 → after A (page 0), image1 → after C (page 2)
    expect(describeBlocks(result)).toEqual([
      'p:A',
      'img:images/image2.png',
      'p:B',
      'p:C',
      'img:images/image1.png',
    ]);
  });

  it('preserves image order within the same page', () => {
    const blocks = [para('A'), para('B')];
    const pages = [0, 0];
    const result = insertImageBlocks(blocks, pages, [img(1, 0), img(2, 0)]);
    expect(describeBlocks(result)).toEqual([
      'p:A',
      'p:B',
      'img:images/image1.png',
      'img:images/image2.png',
    ]);
  });

  it('falls back to the nearest preceding page for an image-only page', () => {
    // Page 0: A   Page 1: (no blocks)   image on page 1 → after A
    const blocks = [para('A'), para('B')];
    const pages = [0, 2];
    // Image on page 1 has no blocks; nearest preceding page with blocks is 0 → after A.
    const result = insertImageBlocks(blocks, pages, [img(1, 1)]);
    expect(describeBlocks(result)).toEqual(['p:A', 'img:images/image1.png', 'p:B']);
  });

  it('appends at the end when no preceding page has blocks', () => {
    // Only page 5 has blocks; image on page 2 has no preceding page → append at end.
    const blocks = [para('A'), para('B')];
    const pages = [5, 5];
    const result = insertImageBlocks(blocks, pages, [img(1, 2)]);
    expect(describeBlocks(result)).toEqual(['p:A', 'p:B', 'img:images/image1.png']);
  });

  it('appends all images when there are no text blocks', () => {
    const result = insertImageBlocks([], [], [img(1, 0), img(2, 3)]);
    expect(describeBlocks(result)).toEqual(['img:images/image1.png', 'img:images/image2.png']);
  });
});

describe('pdfToDoc', () => {
  it('converts PDF to a Doc object', async () => {
    const buffer = await buildSimplePdf([
      { text: 'Test Title', x: 72, y: 700, fontSize: 24 },
      { text: 'Some body text.', x: 72, y: 660, fontSize: 11 },
    ]);
    const doc = await pdfToDoc(buffer);
    expect(doc).toBeDefined();
    expect(doc.blocks).toBeDefined();
    expect(doc.blocks.length).toBeGreaterThan(0);
  });
});

describe('pdfToContainer image extraction', () => {
  it('extracts an image-only PDF under Node without a DOM canvas', async () => {
    const encoded = atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
    );
    const png = Uint8Array.from(encoded, (char) => char.charCodeAt(0));
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(png);
    const page = pdf.addPage([72, 72]);
    page.drawImage(image, { x: 0, y: 0, width: 72, height: 72 });
    const bytes = await pdf.save();

    vi.stubGlobal('document', undefined);
    const container = await pdfToContainer(bytes);

    expect(await container.exists('images/image1.png')).toBe(true);
    const extracted = new Uint8Array((await container.readFile('images/image1.png'))!);
    expect([...extracted.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await container.readDocument()).toContain('images/image1.png');
  });
});

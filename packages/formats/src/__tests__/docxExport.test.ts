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
  MarkdownList,
  MarkdownListItem,
  MarkdownTable,
  MarkdownTableRow,
  MarkdownTableCell,
  MarkdownCodeBlock,
  MarkdownBlockquote,
  MarkdownThematicBreak,
  MarkdownStrong,
  MarkdownEmphasis,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownContainerDirective,
} from '@bendyline/squisq/markdown';

import { markdownDocToDocx, docToDocx } from '../docx/export';

// ============================================
// Helpers
// ============================================

async function exportAndParse(
  doc: MarkdownDocument,
  options?: Parameters<typeof markdownDocToDocx>[1],
) {
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

function _getBodyParagraphs(doc: Document): Element[] {
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
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hello' }] }],
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

  it('exports DOCX story directives to header and footer parts', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Body' }] },
        {
          type: 'containerDirective',
          name: 'docx-header',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Header' }] }],
        } satisfies MarkdownContainerDirective,
        {
          type: 'containerDirective',
          name: 'docx-footer',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Footer' }] }],
        } satisfies MarkdownContainerDirective,
      ],
    };

    const zip = await exportAndParse(doc);
    const documentXml = await zip.file('word/document.xml')!.async('text');
    const headerXml = await zip.file('word/header1.xml')!.async('text');
    const footerXml = await zip.file('word/footer1.xml')!.async('text');
    const relationships = await zip.file('word/_rels/document.xml.rels')!.async('text');

    expect(documentXml).toContain('<w:headerReference');
    expect(documentXml).toContain('<w:footerReference');
    expect(documentXml).not.toContain('Header');
    expect(headerXml).toContain('Header');
    expect(footerXml).toContain('Footer');
    expect(relationships).toContain('/relationships/header');
    expect(relationships).toContain('/relationships/footer');
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
          children: [{ type: 'inlineCode', value: 'console.log()' } satisfies MarkdownInlineCode],
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
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Item 1' }] }],
            } satisfies MarkdownListItem,
            {
              type: 'listItem',
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Item 2' }] }],
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
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'First' }] }],
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
                {
                  type: 'tableCell',
                  isHeader: true,
                  children: [{ type: 'text', value: 'Name' }],
                } satisfies MarkdownTableCell,
                {
                  type: 'tableCell',
                  isHeader: true,
                  children: [{ type: 'text', value: 'Value' }],
                } satisfies MarkdownTableCell,
              ],
            } satisfies MarkdownTableRow,
            {
              type: 'tableRow',
              children: [
                {
                  type: 'tableCell',
                  children: [{ type: 'text', value: 'A' }],
                } satisfies MarkdownTableCell,
                {
                  type: 'tableCell',
                  children: [{ type: 'text', value: '1' }],
                } satisfies MarkdownTableCell,
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
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'A wise quote' }] }],
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
      children: [{ type: 'thematicBreak' } satisfies MarkdownThematicBreak],
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
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'test' }] }],
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

// ============================================
// Relationship ID Allocation (regression)
// ============================================

/**
 * A 24-byte PNG header — enough for `readImageDimensions` to read a 1x1 size.
 * The pixel data is irrelevant; these tests only inspect the OOXML wiring.
 */
const TINY_PNG = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // signature
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52, // IHDR chunk header
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01, // width = 1, height = 1
]);

async function getRelationships(zip: JSZip, path: string): Promise<Element[]> {
  const file = zip.file(path);
  expect(file, `expected ${path} to exist`).toBeTruthy();
  const xml = new DOMParser().parseFromString(await file!.async('text'), 'application/xml');
  return Array.from(xml.getElementsByTagName('Relationship'));
}

const REL_TYPE_STYLES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const REL_TYPE_NUMBERING =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const REL_TYPE_HYPERLINK =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const REL_TYPE_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

describe('DOCX relationship ID allocation', () => {
  const COUNT = 120;

  /** 120 paragraphs, each carrying one hyperlink and one image, plus a list. */
  function bigDoc(): {
    doc: MarkdownDocument;
    images: Map<string, { data: Uint8Array; contentType: string }>;
  } {
    const images = new Map<string, { data: Uint8Array; contentType: string }>();
    const children: MarkdownDocument['children'] = [];

    for (let i = 0; i < COUNT; i++) {
      const url = `assets/img${i}.png`;
      images.set(url, { data: TINY_PNG, contentType: 'image/png' });
      children.push({
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: `https://example.com/page-${i}`,
            children: [{ type: 'text', value: `link ${i}` }],
          } as MarkdownLink,
          { type: 'image', url, alt: `image ${i}` },
        ],
      });
    }

    // A list forces numbering.xml + its relationship into the package.
    children.push({
      type: 'list',
      ordered: true,
      children: [
        {
          type: 'listItem',
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'item' }] }],
        } as MarkdownListItem,
      ],
    } as MarkdownList);

    return { doc: { type: 'document', children }, images };
  }

  it('emits unique relationship Ids with 120 hyperlinks and 120 images', async () => {
    const { doc, images } = bigDoc();
    const zip = await exportAndParse(doc, { images });
    const rels = await getRelationships(zip, 'word/_rels/document.xml.rels');

    const ids = rels.map((r) => r.getAttribute('Id')!);
    // The real bug: fixed rels started at a hardcoded rId100 while dynamic
    // rels counted up from rId1, so the 99th hyperlink duplicated the styles
    // rel and Word refused (or silently "repaired") the file.
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);

    // Sanity: we really did generate enough rels to cross the old cliff.
    expect(rels.filter((r) => r.getAttribute('Type') === REL_TYPE_HYPERLINK)).toHaveLength(COUNT);
    expect(rels.filter((r) => r.getAttribute('Type') === REL_TYPE_IMAGE)).toHaveLength(COUNT);
    expect(ids.length).toBeGreaterThan(100);
  });

  it('keeps the styles and numbering relationships intact alongside 120+ dynamic rels', async () => {
    const { doc, images } = bigDoc();
    const zip = await exportAndParse(doc, { images });
    const rels = await getRelationships(zip, 'word/_rels/document.xml.rels');

    const byType = (type: string) => rels.filter((r) => r.getAttribute('Type') === type);

    const styles = byType(REL_TYPE_STYLES);
    expect(styles).toHaveLength(1);
    expect(styles[0]!.getAttribute('Target')).toBe('styles.xml');
    expect(zip.file('word/styles.xml')).toBeTruthy();

    const numbering = byType(REL_TYPE_NUMBERING);
    expect(numbering).toHaveLength(1);
    expect(numbering[0]!.getAttribute('Target')).toBe('numbering.xml');
    expect(zip.file('word/numbering.xml')).toBeTruthy();

    // The styles rel must not have been shadowed by a hyperlink/image rel.
    const stylesId = styles[0]!.getAttribute('Id');
    expect(rels.filter((r) => r.getAttribute('Id') === stylesId)).toHaveLength(1);
  });

  it('resolves every r:id referenced by document.xml to a declared relationship', async () => {
    const { doc, images } = bigDoc();
    const zip = await exportAndParse(doc, { images });
    const rels = await getRelationships(zip, 'word/_rels/document.xml.rels');
    const declared = new Set(rels.map((r) => r.getAttribute('Id')!));

    const xmlText = await zip.file('word/document.xml')!.async('text');
    const referenced = [...xmlText.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map((m) => m[1]!);

    expect(referenced.length).toBe(COUNT * 2); // one hyperlink + one blip each
    const dangling = [...new Set(referenced)].filter((id) => !declared.has(id));
    expect(dangling).toEqual([]);
  });

  it('gives header and footer stories their own independent rels parts', async () => {
    const doc: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'https://example.com/body',
              children: [{ type: 'text', value: 'body' }],
            } as MarkdownLink,
          ],
        },
        {
          type: 'containerDirective',
          name: 'docx-header',
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'link',
                  url: 'https://example.com/head',
                  children: [{ type: 'text', value: 'head' }],
                } as MarkdownLink,
              ],
            },
          ],
        } as MarkdownContainerDirective,
      ],
    };

    const zip = await exportAndParse(doc);
    for (const path of ['word/_rels/document.xml.rels', 'word/_rels/header1.xml.rels']) {
      const ids = (await getRelationships(zip, path)).map((r) => r.getAttribute('Id')!);
      expect(new Set(ids).size).toBe(ids.length);
    }

    // The header's hyperlink must be declared on the header's own rels part.
    const headerRels = await getRelationships(zip, 'word/_rels/header1.xml.rels');
    expect(headerRels.filter((r) => r.getAttribute('Type') === REL_TYPE_HYPERLINK)).toHaveLength(1);
  });
});

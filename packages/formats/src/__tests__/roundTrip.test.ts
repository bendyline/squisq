/**
 * Round-trip tests: MarkdownDocument → DOCX → MarkdownDocument.
 *
 * Verifies that core document structures survive the export → import cycle.
 */

import { describe, it, expect } from 'vitest';
import type {
  MarkdownDocument,
  MarkdownHeading,
  MarkdownParagraph,
  MarkdownStrong,
  MarkdownEmphasis,
} from '@bendyline/prodcore/markdown';

import { markdownDocToDocx } from '../docx/export';
import { docxToMarkdownDoc } from '../docx/import';

// ============================================
// Helpers
// ============================================

async function roundTrip(doc: MarkdownDocument): Promise<MarkdownDocument> {
  const buffer = await markdownDocToDocx(doc);
  return docxToMarkdownDoc(buffer);
}

/**
 * Extract plain text from an inline node tree.
 */
function extractText(node: any): string {
  if (node.type === 'text') return node.value;
  if (node.children) return node.children.map(extractText).join('');
  if (node.value) return node.value;
  return '';
}

function extractBlockText(block: any): string {
  if (block.children) return block.children.map(extractText).join('');
  if (block.value) return block.value;
  return '';
}

// ============================================
// Round-trip Tests
// ============================================

describe('DOCX round-trip', () => {
  it('round-trips headings', async () => {
    const original: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: 'Main Title' }],
        } satisfies MarkdownHeading,
        {
          type: 'heading',
          depth: 2,
          children: [{ type: 'text', value: 'Section' }],
        } satisfies MarkdownHeading,
      ],
    };

    const result = await roundTrip(original);

    expect(result.children.length).toBeGreaterThanOrEqual(2);
    expect(result.children[0].type).toBe('heading');
    expect((result.children[0] as any).depth).toBe(1);
    expect(extractBlockText(result.children[0])).toBe('Main Title');

    expect(result.children[1].type).toBe('heading');
    expect((result.children[1] as any).depth).toBe(2);
    expect(extractBlockText(result.children[1])).toBe('Section');
  });

  it('round-trips paragraphs', async () => {
    const original: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Hello world' }],
        } satisfies MarkdownParagraph,
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'Second paragraph' }],
        } satisfies MarkdownParagraph,
      ],
    };

    const result = await roundTrip(original);

    expect(result.children.length).toBe(2);
    expect(extractBlockText(result.children[0])).toBe('Hello world');
    expect(extractBlockText(result.children[1])).toBe('Second paragraph');
  });

  it('round-trips bold text', async () => {
    const original: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Normal ' },
            {
              type: 'strong',
              children: [{ type: 'text', value: 'bold' }],
            } satisfies MarkdownStrong,
            { type: 'text', value: ' text' },
          ],
        },
      ],
    };

    const result = await roundTrip(original);
    const para = result.children[0] as any;
    expect(para.type).toBe('paragraph');

    // Find the bold node
    const boldNode = para.children.find((c: any) => c.type === 'strong');
    expect(boldNode).toBeDefined();
    expect(extractText(boldNode)).toBe('bold');
  });

  it('round-trips italic text', async () => {
    const original: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'paragraph',
          children: [
            {
              type: 'emphasis',
              children: [{ type: 'text', value: 'italic' }],
            } satisfies MarkdownEmphasis,
          ],
        },
      ],
    };

    const result = await roundTrip(original);
    const para = result.children[0] as any;
    const italicNode = para.children.find((c: any) => c.type === 'emphasis');
    expect(italicNode).toBeDefined();
    expect(extractText(italicNode)).toBe('italic');
  });

  it('round-trips mixed content document', async () => {
    const original: MarkdownDocument = {
      type: 'document',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: 'Document Title' }],
        } satisfies MarkdownHeading,
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'This is ' },
            {
              type: 'strong',
              children: [{ type: 'text', value: 'important' }],
            },
            { type: 'text', value: ' content.' },
          ],
        },
        {
          type: 'heading',
          depth: 2,
          children: [{ type: 'text', value: 'Details' }],
        } satisfies MarkdownHeading,
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'More info here.' }],
        },
      ],
    };

    const result = await roundTrip(original);

    // Should have at least 4 blocks
    expect(result.children.length).toBeGreaterThanOrEqual(4);

    // First should be heading
    expect(result.children[0].type).toBe('heading');
    expect(extractBlockText(result.children[0])).toBe('Document Title');

    // Then paragraph with mixed content
    expect(result.children[1].type).toBe('paragraph');
    const fullText = (result.children[1] as any).children.map(extractText).join('');
    expect(fullText).toContain('important');
    expect(fullText).toContain('content');
  });
});

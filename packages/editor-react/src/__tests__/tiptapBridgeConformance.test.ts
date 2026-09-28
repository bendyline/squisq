import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

/**
 * tiptapBridge maintains a SECOND, regex-based markdown parser/serializer that
 * must agree with core's `parseMarkdown` (see the "must stay in sync" note in
 * tiptapBridge.ts). Comment-enforced parallel parsers drift silently; this test
 * makes the agreement mechanical.
 *
 * The comparable artifact across the two representations (ProseMirror HTML vs.
 * mdast) is the block-type sequence core's parser sees. If a bridge round-trip
 * drops or mangles a construct core understands, the sequence changes and this
 * test fails — surfacing drift in CI instead of in the editor.
 */

const blockSeq = (md: string): string[] => parseMarkdown(md).children.map((n) => n.type);
const bridgeRoundTrip = (md: string): string => tiptapToMarkdown(markdownToTiptap(md));

const CORPUS: Record<string, string> = {
  heading: '# Title\n\n## Subtitle',
  paragraph: 'Just a paragraph of text.',
  bulletList: '- one\n- two\n- three',
  orderedList: '1. first\n2. second\n3. third',
  blockquote: '> a quote',
  codeBlock: '```js\nconst x = 1;\n```',
  table: '| a | b |\n| --- | --- |\n| 1 | 2 |',
  inlineEmphasis: 'Some **bold** and *italic* and `code` text.',
  link: 'A [link](https://example.com) inline.',
  thematicBreak: 'before\n\n---\n\nafter',
  mixed: '# Heading\n\nA paragraph.\n\n- a\n- b\n\n> quote\n\n```\ncode\n```',
  multiParagraphQuote: '> first\n>\n> second\n\nafter',
  hardBreak: '**Date:** May 20  \n**Event:** Friday\n\nafter',
  backslashHardBreak: 'line one\\\nline two\n\nafter',
  escapedHashtag: '\\#RiseAndCrumb #BakeryLife\n\n\\# Not a heading',
  escapedPrices: 'Croissants are \\$3.50 and muffins \\$4.00.',
};

/** Every inline node type core's parser sees, depth first. */
const inlineTypes = (md: string): string[] => {
  const out: string[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    out.push(node.type);
    for (const child of node.children ?? []) walk(child as { type: string; children?: unknown[] });
  };
  for (const block of parseMarkdown(md).children) walk(block as never);
  return out;
};

describe('tiptapBridge ↔ core markdown parser conformance', () => {
  for (const [name, md] of Object.entries(CORPUS)) {
    it(`preserves the block-type sequence for: ${name}`, () => {
      expect(blockSeq(bridgeRoundTrip(md))).toEqual(blockSeq(md));
    });
  }

  // Unescaped, `$3.50 and muffins $` is inline math to core's parser.
  it('never turns escaped prices into math', () => {
    const md = CORPUS.escapedPrices!;
    expect(inlineTypes(md)).not.toContain('inlineMath');
    expect(inlineTypes(bridgeRoundTrip(md))).toEqual(inlineTypes(md));
  });

  it('round-trip is idempotent (a second pass changes nothing)', () => {
    for (const md of Object.values(CORPUS)) {
      const once = bridgeRoundTrip(md);
      expect(bridgeRoundTrip(once)).toBe(once);
    }
  });
});

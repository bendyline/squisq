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
};

describe('tiptapBridge ↔ core markdown parser conformance', () => {
  for (const [name, md] of Object.entries(CORPUS)) {
    it(`preserves the block-type sequence for: ${name}`, () => {
      expect(blockSeq(bridgeRoundTrip(md))).toEqual(blockSeq(md));
    });
  }

  it('round-trip is idempotent (a second pass changes nothing)', () => {
    for (const md of Object.values(CORPUS)) {
      const once = bridgeRoundTrip(md);
      expect(bridgeRoundTrip(once)).toBe(once);
    }
  });
});

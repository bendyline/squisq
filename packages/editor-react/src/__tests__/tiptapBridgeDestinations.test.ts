import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

/**
 * Link and image destinations with spaces. CommonMark only reads
 * `[a](<Q3 Report.zip>)` as one destination in its angle-bracket form; the
 * bridge used to keep the brackets IN the href on the way in, and to write
 * the invalid bare form `[a](Q3 Report.zip)` on the way out — which core's
 * parser (preview, exports) does not read as a link at all.
 */

function firstInline(markdown: string) {
  const paragraph = parseMarkdown(markdown).children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');
  return paragraph.children[0];
}

describe('link destinations', () => {
  it('reads an angle-bracket destination without its brackets', () => {
    expect(markdownToTiptap('[Q3 Report.zip](<Q3 Report.zip>)')).toContain('href="Q3 Report.zip"');
    const titled = markdownToTiptap('[spec](<my spec.pdf> "The spec")');
    expect(titled).toContain('href="my spec.pdf"');
    expect(titled).toContain('title="The spec"');
  });

  it('writes a destination with spaces in angle brackets, which core reads as one link', () => {
    const md = tiptapToMarkdown('<p><a href="Q3 Report.zip">Q3 Report.zip</a></p>');
    expect(md.trim()).toBe('[Q3 Report.zip](<Q3 Report.zip>)');
    expect(firstInline(md)).toMatchObject({ type: 'link', url: 'Q3 Report.zip' });
  });

  it('decodes entities once and brackets unbalanced parentheses', () => {
    expect(tiptapToMarkdown('<p><a href="a&amp;b c.pdf">x</a></p>').trim()).toBe(
      '[x](<a&b c.pdf>)',
    );
    expect(tiptapToMarkdown('<p><a href="a(1.zip">x</a></p>').trim()).toBe('[x](<a(1.zip>)');
  });

  it('leaves ordinary destinations byte-identical', () => {
    for (const md of ['[a](docs/a.md)', '[b](https://example.com/x_(y))', '[c](v(2).zip)']) {
      expect(tiptapToMarkdown(markdownToTiptap(md)).trim()).toBe(md);
    }
  });

  it('round-trips an angle-bracket link unchanged', () => {
    const md = '[Q3 Report.zip](<attachments/Q3 Report.zip>)';
    expect(tiptapToMarkdown(markdownToTiptap(md)).trim()).toBe(md);
  });
});

describe('image destinations', () => {
  it('reads and writes an image path with spaces', () => {
    expect(markdownToTiptap('![shot](<Screen Shot.png>)')).toContain('src="Screen Shot.png"');
    const md = tiptapToMarkdown('<img src="media/Screen Shot.png" alt="shot">');
    expect(md.trim()).toBe('![shot](<media/Screen Shot.png>)');
    expect(firstInline(md)).toMatchObject({ type: 'image', url: 'media/Screen Shot.png' });
  });

  it('round-trips an image whose alt or path holds an ampersand', () => {
    // A standalone image used to come back entity-encoded (`Tom &amp; Jerry`).
    for (const md of ['![Tom & Jerry](cartoons/t&j.png)', '![shot](<Screen Shot.png>)']) {
      expect(tiptapToMarkdown(markdownToTiptap(md)).trim()).toBe(md);
    }
  });
});

/**
 * Superscript / subscript through the WYSIWYG bridge.
 *
 * The Write view previously escaped `<sup>` into visible `&lt;sup&gt;` text:
 * the markup round-tripped, but the author saw literal tags. The bridge now
 * passes the tags through as HTML for the Superscript / Subscript marks to
 * claim, and re-emits them on the way back out — which requires shielding them
 * from the trailing tag-stripper in `htmlToInline`.
 */

import { describe, expect, it } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

describe('markdownToTiptap — vertical alignment', () => {
  it('emits real sup/sub tags rather than escaped text', () => {
    expect(markdownToTiptap('Fresh<sup>1</sup> and H<sub>2</sub>O')).toBe(
      '<p>Fresh<sup>1</sup> and H<sub>2</sub>O</p>',
    );
  });

  it('keeps formatting nested inside the tags', () => {
    expect(markdownToTiptap('<sup>[a](b)</sup>')).toBe('<p><sup><a href="b">a</a></sup></p>');
  });

  it('leaves tags inside a code span literal', () => {
    expect(markdownToTiptap('`<sup>x</sup>`')).toBe('<p><code>&lt;sup&gt;x&lt;/sup&gt;</code></p>');
  });
});

describe('tiptapToMarkdown — vertical alignment', () => {
  const cases: [string, string][] = [
    ['Fresh<sup>1</sup> and H<sub>2</sub>O', 'plain'],
    ['**bold <sup>1</sup>** mix', 'inside strong'],
    ['link <sup>[a](b)</sup> inside', 'wrapping a link'],
    ['| F | P |\n| --- | --- |\n| Fresh<sup>1</sup> | 1.40 |', 'in a table cell'],
    ['code `<sup>x</sup>` stays literal', 'inside code'],
  ];

  it.each(cases)('round-trips %j (%s)', (markdown) => {
    expect(tiptapToMarkdown(markdownToTiptap(markdown)).trim()).toBe(markdown);
  });

  it('does not let the tag-stripper eat the tags', () => {
    expect(tiptapToMarkdown('<p>x<sup>2</sup></p>').trim()).toBe('x<sup>2</sup>');
  });
});

describe('tiptapToMarkdown — sized images', () => {
  it('keeps a raw <img> that carries dimensions', () => {
    // Same tag-stripper hazard: `serializeImage` emits raw HTML for a sized
    // image, which the strip pass used to delete outright — losing the image.
    expect(tiptapToMarkdown('<p><img src="a.png" alt="A" width="100"></p>').trim()).toBe(
      '<img alt="A" src="a.png" width="100">',
    );
  });
});

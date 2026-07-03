import { describe, it, expect } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

describe('Template annotation round-trip', () => {
  it('extracts {[template]} into data-template on markdownToTiptap', () => {
    const html = markdownToTiptap('## Getting Started {[comparisonBar]}');
    expect(html).toContain('data-template="comparisonBar"');
    expect(html).toContain('Getting Started');
    expect(html).not.toContain('{[comparisonBar]}'); // raw text stripped
  });

  it('round-trips markdown → HTML → markdown losslessly', () => {
    const original = '## Getting Started {[comparisonBar]}';
    const html = markdownToTiptap(original);
    const back = tiptapToMarkdown(html);
    expect(back.trim()).toBe(original);
  });

  it('preserves template annotation through Tiptap-rendered HTML (with badge spans)', () => {
    // Simulates HTML that Tiptap actually renders after parse: includes the
    // squisq-heading-content + squisq-template-badge wrapper spans.
    const tiptapRendered =
      '<h2 data-template="comparisonBar">' +
      '<span class="squisq-heading-content">Getting Started</span>' +
      '<span class="squisq-template-badge" contenteditable="false" data-template="comparisonBar" data-template-label="Comparison Bar"></span>' +
      '</h2>';
    const md = tiptapToMarkdown(tiptapRendered);
    expect(md).toContain('## Getting Started');
    expect(md).toContain('{[comparisonBar]}');
    // No literal badge spans should leak into markdown
    expect(md).not.toContain('squisq-template-badge');
    expect(md).not.toContain('Comparison Bar'); // CSS-rendered label shouldn't bleed
  });

  it('does not leak the block-properties badge into markdown', () => {
    // The props badge is an empty CSS-painted span rendered alongside the
    // template badge (and on plain headings, the empty template badge). It
    // must serialize to nothing — no stray `*`/`**` from an `<i>`, no span.
    const tiptapRendered =
      '<h2 data-block-attrs="transition=fade">' +
      '<span class="squisq-heading-content">Intro</span>' +
      '<span class="squisq-template-badge squisq-template-badge--empty" contenteditable="false"></span>' +
      '<span class="squisq-props-badge" contenteditable="false" data-props-summary="Fade · 1:30 start"></span>' +
      '</h2>';
    const md = tiptapToMarkdown(tiptapRendered).trim();
    expect(md).toBe('## Intro {transition=fade}');
    expect(md).not.toContain('squisq-props-badge');
    expect(md).not.toContain('*');
    // The CSS-painted summary lives in a data attribute; it must not bleed.
    expect(md).not.toContain('start');
  });
});

/**
 * Drawing shape headings round-trip through the markdown ↔ Tiptap bridge.
 *
 * The drawing editor writes shapes as `### label {#id} {[shape …]}` child
 * headings; these tests pin the editor's serialization seam — the same
 * `data-template` / `data-template-params` / `data-block-attrs` attributes
 * the DrawingAdapter reads back — without standing up a full editor.
 */

import { describe, it, expect } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

const DRAWING = [
  '## Org chart {[drawing]}',
  '',
  '### CEO {#ceo} {[rectangle x=21 y=25 width=100 height=100]}',
  '',
  '### reports to {[arrow from=ceo to=dev]}',
  '',
  '### Developer {#dev} {[rectangle x=21 y=190 width=100 height=100]}',
].join('\n');

describe('Drawing shape heading round-trip', () => {
  it('extracts a shape annotation into the template + block-attr data attributes', () => {
    const html = markdownToTiptap('### CEO {#ceo} {[rectangle x=21 y=25 width=100 height=100]}');
    expect(html).toContain('data-template="rectangle"');
    expect(html).toContain('data-template-params="x=21 y=25 width=100 height=100"');
    expect(html).toContain('data-block-attrs="#ceo"');
    expect(html).not.toContain('{[rectangle'); // raw annotation text stripped
  });

  it('extracts a connector annotation (from/to) into data-template-params', () => {
    const html = markdownToTiptap('### reports to {[arrow from=ceo to=dev]}');
    expect(html).toContain('data-template="arrow"');
    expect(html).toContain('data-template-params="from=ceo to=dev"');
  });

  it('round-trips a full drawing (shapes + connector) losslessly and idempotently', () => {
    const back = tiptapToMarkdown(markdownToTiptap(DRAWING));
    expect(back).toContain('## Org chart {[drawing]}');
    expect(back).toContain('### CEO {#ceo} {[rectangle x=21 y=25 width=100 height=100]}');
    expect(back).toContain('### reports to {[arrow from=ceo to=dev]}');
    expect(back).toContain('### Developer {#dev} {[rectangle x=21 y=190 width=100 height=100]}');
    // No base64 layers blob anywhere.
    expect(back).not.toContain('layers=');
    // Stable: a second pass reproduces the first exactly.
    expect(tiptapToMarkdown(markdownToTiptap(back))).toBe(back);
  });
});

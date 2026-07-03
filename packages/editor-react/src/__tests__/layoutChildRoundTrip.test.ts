/**
 * Layout child sub-blocks round-trip through the markdown ↔ Tiptap bridge.
 *
 * Layouts now persist each layer as a readable `### {#id} {[type …]}` child
 * heading (no base64 `layers=` blob); a text layer's content is the child's
 * markdown body. These tests pin that serialization seam — the same
 * `data-template` / `data-template-params` / `data-block-attrs` attributes the
 * LayoutAdapter reads back — without standing up a full editor.
 */

import { describe, it, expect } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

// Parent title "Pricing" (not "Layout") avoids the bridge's template-label
// de-dup heuristic, which would strip a title equal to the template's label.
const LAYOUT = [
  '## Pricing {[layout]}',
  '',
  '### {#text-1} {[text x=360 y=380 width=1200 height=320 align=center]}',
  '',
  'Welcome to the **bold** layout',
  '',
  '- first point',
  '- second point',
  '',
  '### {#box-1} {[rectangle x=760 y=390 width=400 height=300 fill="#e0e7ff"]}',
  '',
  '### {#pic-1} {[image x=40 y=40 width=320 height=240 src=cover.png alt="Cover"]}',
].join('\n');

describe('Layout child sub-block round-trip', () => {
  it('extracts a text layer annotation into the template + block-attr attributes', () => {
    const html = markdownToTiptap('### {#text-1} {[text x=360 y=380 width=1200 height=320]}');
    expect(html).toContain('data-template="text"');
    expect(html).toContain('data-template-params="x=360 y=380 width=1200 height=320"');
    expect(html).toContain('data-block-attrs="#text-1"');
    expect(html).not.toContain('{[text'); // raw annotation text stripped
  });

  it('keeps a text layer body (marks + list) as sibling blocks, not in the heading', () => {
    const html = markdownToTiptap(
      ['### {#text-1} {[text x=0 y=0]}', '', 'Hello **world**', '', '- a', '- b'].join('\n'),
    );
    // Heading is empty; the body is its own paragraph + list.
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
  });

  it('round-trips a full layout (text + box + image) losslessly and idempotently', () => {
    const back = tiptapToMarkdown(markdownToTiptap(LAYOUT));
    expect(back).toContain('## Pricing {[layout]}');
    // Child sub-blocks keep their id + annotation (empty-text headings get an
    // extra space after `###`, which re-parses identically — assert spacing-free).
    expect(back).toContain('{#text-1} {[text x=360 y=380 width=1200 height=320 align=center]}');
    expect(back).toContain(
      '{#box-1} {[rectangle x=760 y=390 width=400 height=300 fill="#e0e7ff"]}',
    );
    expect(back).toContain(
      '{#pic-1} {[image x=40 y=40 width=320 height=240 src=cover.png alt="Cover"]}',
    );
    // The text layer's body markdown survives as readable content.
    expect(back).toContain('Welcome to the **bold** layout');
    expect(back).toContain('- first point');
    expect(back).toContain('- second point');
    // No base64 layers blob anywhere — the whole point of the change.
    expect(back).not.toContain('layers=');
    // Stable: a second pass reproduces the first exactly.
    expect(tiptapToMarkdown(markdownToTiptap(back))).toBe(back);
  });
});

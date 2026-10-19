import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/index.js';
import { markdownToDoc } from '../doc/index.js';
import { extractDocImages } from '../transform/index.js';

/**
 * The WYSIWYG editor writes a pasted or resized image as raw HTML
 * (`<img src width height>`), because `![alt](url)` has no size syntax.
 * Transforms and dynamic slides must see those images like any other.
 */
describe('transform image discovery', () => {
  it('finds markdown and raw HTML images in document order, once each', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        [
          '# Gallery',
          '![Logo](images/logo.png)',
          '<img alt="Pasted screenshot" src="Notes_files/pasted-1.png" width="246" height="280">',
          '## More',
          'An inline <img src="images/inline.png" alt="Inline"> picture, and the logo again: ![Logo](images/logo.png)',
          '![A clip](media/demo.mp4)',
        ].join('\n\n'),
      ),
    );
    expect(extractDocImages(doc.blocks)).toEqual([
      { src: 'images/logo.png', alt: 'Logo' },
      { src: 'Notes_files/pasted-1.png', alt: 'Pasted screenshot' },
      { src: 'images/inline.png', alt: 'Inline' },
    ]);
  });
});

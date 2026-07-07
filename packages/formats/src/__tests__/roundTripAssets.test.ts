/**
 * Asset-fidelity guard: an embedded image must survive a full export → import
 * round-trip for every container-producing format. We author a markdown doc
 * with an image, export it (supplying the image bytes), re-import via the
 * format's `*ToContainer`, and assert the bytes + reference come back intact.
 */

import { describe, expect, it } from 'vitest';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { markdownDocToPptx } from '../pptx/export';
import { pptxToContainer } from '../pptx/import';
import { markdownDocToDocx } from '../docx/export';
import { docxToContainer } from '../docx/import';

/** PNG-signature-prefixed payload with a distinctive tail for byte comparison. */
const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6]);

const doc: MarkdownDocument = {
  type: 'document',
  children: [
    { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Assets' }] },
    { type: 'paragraph', children: [{ type: 'image', url: 'hero.png', alt: 'Hero' }] },
  ],
};

describe('embedded image round-trips through container formats', () => {
  it('survives markdown → pptx → pptxToContainer', async () => {
    const pptx = await markdownDocToPptx(doc, {
      images: new Map([['hero.png', IMAGE_BYTES.buffer]]),
    });
    const container = await pptxToContainer(pptx);

    expect(await container.exists('images/image1.png')).toBe(true);
    const bytes = await container.readFile('images/image1.png');
    expect(new Uint8Array(bytes!)).toEqual(IMAGE_BYTES);
    expect(await container.readDocument()).toContain('images/image1.png');
  });

  it('survives markdown → docx → docxToContainer', async () => {
    const docx = await markdownDocToDocx(doc, {
      images: new Map([['hero.png', { data: IMAGE_BYTES.buffer, contentType: 'image/png' }]]),
    });
    const container = await docxToContainer(docx);

    expect(await container.exists('images/image1.png')).toBe(true);
    const bytes = await container.readFile('images/image1.png');
    expect(new Uint8Array(bytes!)).toEqual(IMAGE_BYTES);
    expect(await container.readDocument()).toContain('images/image1.png');
  });
});

/**
 * Tests for PPTX import: pptxToMarkdownDoc. Builds a minimal .pptx fixture with
 * the shared OOXML writer, then imports it.
 */

import { describe, expect, it } from 'vitest';
import type {
  MarkdownDocument,
  MarkdownHeading,
  MarkdownList,
  MarkdownParagraph,
  MarkdownText,
} from '@bendyline/squisq/markdown';
import { NS_DRAWINGML, NS_PML, NS_R, REL_OFFICE_DOCUMENT, REL_SLIDE } from '../ooxml/namespaces';
import { createPackage } from '../ooxml/writer';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { markdownDocToPptx } from '../pptx/export';
import { pptxToContainer, pptxToMarkdownDoc } from '../pptx/import';

/** Distinctive PNG-signature-prefixed payload so round-trip fidelity is checkable. */
const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

async function buildTestPptx(): Promise<ArrayBuffer> {
  const pkg = createPackage();

  pkg.addPart(
    'ppt/presentation.xml',
    `${xmlDeclaration()}<p:presentation xmlns:p="${NS_PML}" xmlns:r="${NS_R}">` +
      `<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    'application/xml',
  );
  pkg.addPart(
    'ppt/slides/slide1.xml',
    `${xmlDeclaration()}<p:sld xmlns:p="${NS_PML}" xmlns:a="${NS_DRAWINGML}"><p:cSld><p:spTree>` +
      `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
      `<p:txBody><a:p><a:r><a:t>My Title</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:txBody>` +
      `<a:p><a:r><a:t>First bullet</a:t></a:r></a:p>` +
      `<a:p><a:r><a:t>Second bullet</a:t></a:r></a:p>` +
      `</p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`,
    'application/xml',
  );

  pkg.addRelationship('', {
    id: 'rId1',
    type: REL_OFFICE_DOCUMENT,
    target: 'ppt/presentation.xml',
  });
  pkg.addRelationship('ppt/presentation.xml', {
    id: 'rId1',
    type: REL_SLIDE,
    target: 'slides/slide1.xml',
  });

  return pkg.toArrayBuffer();
}

describe('pptxToMarkdownDoc', () => {
  it('imports a slide as a heading + bullet list', async () => {
    const doc = await pptxToMarkdownDoc(await buildTestPptx());
    expect(doc.type).toBe('document');

    const heading = doc.children[0] as MarkdownHeading;
    expect(heading.type).toBe('heading');
    expect(heading.depth).toBe(2);
    expect((heading.children[0] as MarkdownText).value).toBe('My Title');

    const list = doc.children[1] as MarkdownList;
    expect(list.type).toBe('list');
    expect(list.children).toHaveLength(2);
    const firstItemPara = list.children[0]!.children[0] as MarkdownParagraph;
    expect((firstItemPara.children[0] as MarkdownText).value).toBe('First bullet');
  });
});

describe('pptxToContainer (embedded image import)', () => {
  const deckWithImage: MarkdownDocument = {
    type: 'document',
    children: [
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Picture Slide' }] },
      { type: 'paragraph', children: [{ type: 'image', url: 'photo.png', alt: 'A photo' }] },
    ],
  };

  async function buildDeck(): Promise<ArrayBuffer> {
    return markdownDocToPptx(deckWithImage, {
      images: new Map([['photo.png', IMAGE_BYTES.buffer]]),
    });
  }

  it('extracts embedded images into the container and references them', async () => {
    const container = await pptxToContainer(await buildDeck());

    // The extracted image exists at the docx-style images/imageN.ext path.
    expect(await container.exists('images/image1.png')).toBe(true);

    // The bytes survived the round-trip verbatim.
    const bytes = await container.readFile('images/image1.png');
    expect(bytes).not.toBeNull();
    expect(new Uint8Array(bytes!)).toEqual(IMAGE_BYTES);

    // The markdown references the extracted image (no dangling ref).
    const markdown = await container.readDocument();
    expect(markdown).toContain('images/image1.png');
  });

  it('does not emit dangling image refs without extractImages', async () => {
    const doc = await pptxToMarkdownDoc(await buildDeck());
    const hasImage = doc.children.some(
      (b) => b.type === 'paragraph' && b.children.some((c) => c.type === 'image'),
    );
    expect(hasImage).toBe(false);
  });
});

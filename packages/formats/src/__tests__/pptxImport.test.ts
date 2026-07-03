/**
 * Tests for PPTX import: pptxToMarkdownDoc. Builds a minimal .pptx fixture with
 * the shared OOXML writer, then imports it.
 */

import { describe, expect, it } from 'vitest';
import type {
  MarkdownHeading,
  MarkdownList,
  MarkdownParagraph,
  MarkdownText,
} from '@bendyline/squisq/markdown';
import { NS_DRAWINGML, NS_PML, NS_R, REL_OFFICE_DOCUMENT, REL_SLIDE } from '../ooxml/namespaces';
import { createPackage } from '../ooxml/writer';
import { xmlDeclaration } from '../ooxml/xmlUtils';
import { pptxToMarkdownDoc } from '../pptx/import';

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

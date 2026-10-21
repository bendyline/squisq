import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { resolveTheme } from '@bendyline/squisq/schemas';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { docToPptx } from '../pptx/export';
import { openPackage, getPartXml } from '../ooxml/reader';
import { NS_DRAWINGML, NS_PML } from '../ooxml/namespaces';

const MARKDOWN = '# Opening {[title]}\n\n## Details {[content]}\n\nVisible slide content.';

describe('PPTX grain overlays', () => {
  for (const themeId of ['gezellig', 'cinematic', 'morning-light']) {
    it(`keeps ${themeId} slides visible without exporting the grain filter's opaque base`, async () => {
      const doc = markdownToDoc(parseMarkdown(MARKDOWN));
      const pkg = await openPackage(await docToPptx(doc, { themeId, includeCoverSlide: false }));
      const presentation = await getPartXml(pkg, 'ppt/presentation.xml');
      expect(presentation!.getElementsByTagNameNS(NS_PML, 'sldId')).toHaveLength(2);

      for (let index = 1; index <= 2; index++) {
        const slide = await getPartXml(pkg, `ppt/slides/slide${index}.xml`);
        const names = Array.from(slide!.getElementsByTagNameNS(NS_PML, 'cNvPr')).map((node) =>
          node.getAttribute('name'),
        );
        expect(names).not.toContain('persistent-grain');
        // The template's full-slide background is the deck's native
        // background now, not a shape on the slide in the way of its content.
        expect(names).not.toContain('bg');
        const text = Array.from(slide!.getElementsByTagNameNS(NS_DRAWINGML, 't'))
          .map((node) => node.textContent)
          .join(' ');
        expect(text).toContain(index === 1 ? 'Opening' : 'Visible slide content.');
      }

      const master = await getPartXml(pkg, 'ppt/slideMasters/slideMaster1.xml');
      const background = master!.getElementsByTagNameNS(NS_PML, 'bg')[0];
      expect(
        background?.getElementsByTagNameNS(NS_DRAWINGML, 'srgbClr')[0]?.getAttribute('val'),
      ).toBe(resolveTheme(themeId).colors.background.replace('#', '').toUpperCase());
    });
  }

  it('identifies grain by its filter while preserving ordinary black shapes', async () => {
    const doc = markdownToDoc(parseMarkdown(MARKDOWN));
    doc.persistentLayers = {
      topLayers: [
        {
          type: 'shape',
          id: 'custom-noise',
          position: { x: 0, y: 0, width: '100%', height: '100%' },
          content: { shape: 'rect', fill: '#000000', filter: { type: 'noise', opacity: 0.04 } },
        },
        {
          type: 'shape',
          id: 'black-accent',
          position: { x: 0, y: 0, width: '10%', height: '1%' },
          content: { shape: 'rect', fill: '#000000', fillOpacity: 0.25 },
        },
      ],
    };
    const pkg = await openPackage(await docToPptx(doc, { includeCoverSlide: false }));
    const slide = await getPartXml(pkg, 'ppt/slides/slide1.xml');
    const shapes = Array.from(slide!.getElementsByTagNameNS(NS_PML, 'sp'));
    const nameOf = (shape: Element) =>
      shape.getElementsByTagNameNS(NS_PML, 'cNvPr')[0]?.getAttribute('name');
    expect(shapes.map(nameOf)).not.toContain('custom-noise');
    const accent = shapes.find((shape) => nameOf(shape) === 'black-accent');
    expect(accent).toBeDefined();
    expect(accent!.getElementsByTagNameNS(NS_DRAWINGML, 'srgbClr')[0]?.getAttribute('val')).toBe(
      '000000',
    );
    expect(accent!.getElementsByTagNameNS(NS_DRAWINGML, 'alpha')[0]?.getAttribute('val')).toBe(
      '25000',
    );
  });
});

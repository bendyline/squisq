import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import type {
  MarkdownDocument,
  MarkdownInlineIcon,
  MarkdownInlineNode,
} from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';
import { iconMarker } from '@bendyline/squisq/icon-marker';

import { markdownDocToDocx } from '../docx/export.js';
import { markdownDocToPdf } from '../pdf/export.js';
import { docToPptx, markdownDocToPptx } from '../pptx/export.js';
import { markdownDocToEpub } from '../epub/export.js';

const ICONS: MarkdownInlineNode[] = [
  { type: 'text', value: 'GitHub ' },
  {
    type: 'inlineIcon',
    token: 'github',
    family: 'brands',
    name: 'github',
  } satisfies MarkdownInlineIcon,
  { type: 'text', value: ' Email ' },
  {
    type: 'inlineIcon',
    token: 'fa-solid:envelope',
    family: 'solid',
    name: 'envelope',
  } satisfies MarkdownInlineIcon,
  { type: 'text', value: ' Favorite ' },
  {
    type: 'inlineIcon',
    token: 'fa-regular:star',
    family: 'regular',
    name: 'star',
  } satisfies MarkdownInlineIcon,
];

function iconDoc(): MarkdownDocument {
  return {
    type: 'document',
    children: [{ type: 'paragraph', children: ICONS }],
  };
}

const EXPECTED = [
  { typeface: 'Font Awesome 7 Brands', glyph: '\uf09b', stem: 'fontAwesomeBrands' },
  { typeface: 'Font Awesome 7 Free', glyph: '\uf005', stem: 'fontAwesomeRegular' },
  { typeface: 'Font Awesome 7 Free Solid', glyph: '\uf0e0', stem: 'fontAwesomeSolid' },
];

describe('portable inline Font Awesome exports', () => {
  it('embeds obfuscated OpenType faces and glyph runs in DOCX', async () => {
    const zip = await JSZip.loadAsync(await markdownDocToDocx(iconDoc()));
    const documentXml = await zip.file('word/document.xml')!.async('text');
    const fontTableXml = await zip.file('word/fontTable.xml')!.async('text');
    const fontRelationships = await zip.file('word/_rels/fontTable.xml.rels')!.async('text');

    for (const { typeface, glyph, stem } of EXPECTED) {
      expect(documentXml).toContain(typeface);
      expect(documentXml).toContain(glyph);
      expect(fontTableXml).toContain(`w:name="${typeface}"`);
      expect(fontTableXml).toContain('<w:embedRegular');
      expect(fontRelationships).toContain(`fonts/${stem}.odttf`);

      const bytes = await zip.file(`word/fonts/${stem}.odttf`)!.async('uint8array');
      expect(new TextDecoder().decode(bytes.slice(0, 4))).not.toBe('OTTO');
    }
  });

  it('embeds OpenType faces and glyph runs in PPTX', async () => {
    const zip = await JSZip.loadAsync(await markdownDocToPptx(iconDoc()));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    const presentationXml = await zip.file('ppt/presentation.xml')!.async('text');
    const relationships = await zip.file('ppt/_rels/presentation.xml.rels')!.async('text');

    for (const { typeface, glyph, stem } of EXPECTED) {
      expect(slideXml).toContain(typeface);
      expect(slideXml).toContain(glyph);
      expect(presentationXml).toContain(`typeface="${typeface}"`);
      expect(relationships).toContain(`fonts/${stem}.fntdata`);

      const bytes = await zip.file(`ppt/fonts/${stem}.fntdata`)!.async('uint8array');
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('OTTO');
    }
  });

  it('subsets the used faces into PDF without WinAnsi substitutions', async () => {
    const warnings: string[] = [];
    const bytes = await markdownDocToPdf(iconDoc(), {
      onWarning: (message) => warnings.push(message),
    });
    const pdf = await PDFDocument.load(bytes);
    const objects = pdf.context
      .enumerateIndirectObjects()
      .map(([, object]) => object.toString())
      .join('\n');

    expect(warnings).toEqual([]);
    expect(objects).toContain('/FontAwesome7Brands-Regular-');
    expect(objects).toContain('/FontAwesome7Free-Regular-');
    expect(objects).toContain('/FontAwesome7Free-Solid-');
  });

  it('preserves icon markers in materialized PPTX text layers', async () => {
    const doc = {
      articleId: 'icon-layer',
      duration: 5,
      audio: { segments: [{ src: '', name: 'preview', duration: 5, startTime: 0 }] },
      blocks: [
        {
          id: 'title',
          template: 'title',
          title: `Repository ${iconMarker('brands', 'github')}`,
          startTime: 0,
          duration: 5,
          audioSegment: 0,
        },
      ],
    } as unknown as Doc;
    const zip = await JSZip.loadAsync(
      await docToPptx(doc, { includeCoverSlide: false, themeId: 'documentary' }),
    );
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');

    expect(slideXml).toContain('Repository ');
    expect(slideXml).toContain('\uf09b');
    expect(slideXml).toContain('Font Awesome 7 Brands');
    expect(zip.file('ppt/fonts/fontAwesomeBrands.fntdata')).not.toBeNull();
  });

  it('preserves inline icons in semantic PPTX slide titles', async () => {
    const titleDoc: MarkdownDocument = {
      type: 'document',
      children: [{ type: 'heading', depth: 1, children: ICONS }],
    };
    const zip = await JSZip.loadAsync(await markdownDocToPptx(titleDoc));
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');

    for (const { typeface, glyph, stem } of EXPECTED) {
      expect(slideXml).toContain(typeface);
      expect(slideXml).toContain(glyph);
      expect(zip.file(`ppt/fonts/${stem}.fntdata`)).not.toBeNull();
    }
  });

  it('embeds used Font Awesome faces and glyph spans in EPUB', async () => {
    const zip = await JSZip.loadAsync(await markdownDocToEpub(iconDoc(), { title: 'Icons' }));
    const chapter = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('text');
    const css = await zip.file('OEBPS/styles.css')!.async('text');
    const opf = await zip.file('OEBPS/content.opf')!.async('text');

    for (const { typeface, glyph, stem } of EXPECTED) {
      expect(chapter).toContain(glyph);
      expect(css).toContain(`font-family: '${typeface}'`);
      expect(opf).toContain(`fonts/${stem}.otf`);
      const bytes = await zip.file(`OEBPS/fonts/${stem}.otf`)!.async('uint8array');
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('OTTO');
    }
  });

  it('does not add icon font parts to icon-free Office documents', async () => {
    const plain: MarkdownDocument = {
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Plain text' }] }],
    };
    const [docx, pptx] = await Promise.all([
      JSZip.loadAsync(await markdownDocToDocx(plain)),
      JSZip.loadAsync(await markdownDocToPptx(plain)),
    ]);

    expect(Object.keys(docx.files).some((path) => path.startsWith('word/fonts/'))).toBe(false);
    expect(Object.keys(pptx.files).some((path) => path.startsWith('ppt/fonts/'))).toBe(false);
  });
});

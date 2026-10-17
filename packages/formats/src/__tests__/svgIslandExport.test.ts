/**
 * SVG islands (```svg fences) in document exports. Every exporter writes
 * core's sanitized re-serialization — never the author's markup — as an
 * image: a data URL in plain HTML, an `.svg` file in EPUB.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMarkdown, parseSvgIsland } from '@bendyline/squisq/markdown';
import { findDiagrams, rasterizeDiagrams, type DiagramPicture } from '../diagrams/index';
import { markdownDocToPlainHtml } from '../html/plainHtml';
import { markdownDocToEpub } from '../epub/export';
import { docHasSvgIslands, svgIslandImage, svgIslandsAsImages } from '../shared/svgIslands';

const ICON = '<svg viewBox="0 0 24 12"><title>Badge</title><rect width="24" height="12" fill="currentColor"/></svg>';
const HOSTILE =
  '<svg onload="alert(1)"><script>alert(1)</script><rect width="4" height="4" fill="url(https://evil/x)"/><circle r="2"/></svg>';

const SOURCE = [
  '# Report',
  '',
  'Intro.',
  '',
  '```svg',
  ICON,
  '```',
  '',
  '- Nested:',
  '',
  '  ```svg',
  `  ${HOSTILE}`,
  '  ```',
  '',
  '```svg',
  '<div>not an island</div>',
  '```',
  '',
  '```xml',
  ICON,
  '```',
  '',
].join('\n');

/** A valid 1×1 PNG. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
);
const picture = async (): Promise<DiagramPicture> => ({ data: PNG, width: 240, height: 120 });

function decodeDataUrl(url: string): string {
  const base64 = url.slice(url.indexOf(',') + 1);
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

describe('svgIslandImage', () => {
  it('writes the sanitized markup with currentColor resolved', () => {
    const image = svgIslandImage(ICON, { color: '#123456' });
    expect(image).not.toBeNull();
    const markup = new TextDecoder().decode(image!.data);
    expect(markup).toContain('fill="#123456"');
    expect(markup).not.toMatch(/currentcolor/i);
    expect(image).toMatchObject({ contentType: 'image/svg+xml', width: 24, height: 12, alt: 'Badge' });
  });

  it('returns null for a fence that is not an island', () => {
    expect(svgIslandImage('<div/>')).toBeNull();
  });
});

describe('svgIslandsAsImages', () => {
  it('replaces usable islands at any depth and leaves the rest as code', () => {
    const doc = parseMarkdown(SOURCE);
    const { doc: replaced, images } = svgIslandsAsImages(doc);
    expect([...images.keys()]).toEqual(['squisq-svg-island-1.svg', 'squisq-svg-island-2.svg']);
    const json = JSON.stringify(replaced);
    expect(json).toContain('"url":"squisq-svg-island-1.svg"');
    expect(json).toContain('"url":"squisq-svg-island-2.svg"');
    expect(json).toContain('not an island');
    expect(json).toContain('"lang":"xml"');
    // The input is untouched.
    expect(JSON.stringify(doc)).not.toContain('squisq-svg-island');
    expect(docHasSvgIslands(doc)).toBe(true);
    expect(docHasSvgIslands(replaced)).toBe(true); // the invalid fence remains
  });

  it('returns the same document when there is nothing to replace', () => {
    const doc = parseMarkdown('# Plain\n\nNo pictures.');
    expect(svgIslandsAsImages(doc).doc).toBe(doc);
  });
});

describe('rasterizeDiagrams', () => {
  it('leaves islands alone by default (Office embeds them natively)', async () => {
    const doc = parseMarkdown(SOURCE);
    const result = await rasterizeDiagrams(doc, picture);
    expect(result.markdownDoc).toBe(doc);
    expect(result.svg.size).toBe(0);
  });

  it('pictures usable islands when asked, keyed by source for fallbacks', async () => {
    const doc = parseMarkdown(SOURCE);
    const found = findDiagrams(doc).filter((diagram) => diagram.kind === 'svg');
    expect(found.map((diagram) => diagram.alt)).toEqual(['Badge', 'Illustration']);
    const result = await rasterizeDiagrams(doc, picture, { kinds: ['svg'] });
    expect(result.images.size).toBe(2);
    expect(result.svg.has(ICON)).toBe(true);
    expect(JSON.stringify(result.markdownDoc)).toContain('not an island');
  });
});

describe('plain HTML', () => {
  it('shows each island as an image of the sanitized markup, never inline SVG', () => {
    const html = markdownDocToPlainHtml(parseMarkdown(SOURCE));
    const images = [...html.matchAll(/<figure class="squisq-svg-island"><img src="([^"]+)"/g)];
    expect(images).toHaveLength(2);
    expect(html).toContain('alt="Badge"');
    expect(html).toContain('alt="Illustration"');
    expect(html).not.toContain('<svg');
    const hostile = decodeDataUrl(images[1]![1]!.replace(/&amp;/g, '&'));
    expect(hostile).toContain('<circle r="2"/>');
    expect(hostile).not.toContain('script');
    expect(hostile).not.toContain('onload');
    expect(hostile).not.toContain('evil');
    // An unusable svg fence and the xml fence stay code.
    expect(html).toContain('&lt;div&gt;not an island&lt;/div&gt;');
    expect(html).toContain('class="language-xml"');
    expect(html).toContain('.squisq-svg-island img');
  });

  it('colors currentColor with the theme text', () => {
    const html = markdownDocToPlainHtml(parseMarkdown(`\`\`\`svg\n${ICON}\n\`\`\``), {
      themeId: 'tech-dark',
    });
    const src = /<img src="([^"]+)"/.exec(html)![1]!;
    expect(decodeDataUrl(src)).toMatch(/ color="#[0-9a-f]{3,8}"/i);
  });

  it('ships no island CSS without islands', () => {
    expect(markdownDocToPlainHtml(parseMarkdown('# Plain'))).not.toContain('squisq-svg-island');
  });
});

describe('EPUB', () => {
  it('packages each island as an SVG image file in the manifest', async () => {
    const buffer = await markdownDocToEpub(parseMarkdown(SOURCE), { title: 'Islands' });
    const zip = await JSZip.loadAsync(buffer);
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toMatch(/href="images\/squisq-svg-island-1\.svg" media-type="image\/svg\+xml"/);
    const file = await zip.file('OEBPS/images/squisq-svg-island-2.svg')!.async('string');
    const expected = parseSvgIsland(HOSTILE);
    expect(expected.ok).toBe(true);
    if (expected.ok) expect(file).toBe(expected.island.markup);
    const chapters = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => name.endsWith('.xhtml'))
        .map((name) => zip.file(name)!.async('string')),
    );
    const text = chapters.join('\n');
    expect(text).toContain('src="../images/squisq-svg-island-1.svg"');
    expect(text).not.toContain('onload');
  });
});

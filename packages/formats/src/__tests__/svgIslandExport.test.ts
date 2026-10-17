/**
 * SVG islands (```svg fences) in document exports. Every exporter writes
 * core's sanitized re-serialization — never the author's markup — as an
 * image: a data URL in plain HTML, an `.svg` file in EPUB.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseMarkdown, parseSvgIsland } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { findDiagrams, rasterizeDiagrams, type DiagramPicture } from '../diagrams/index';
import { markdownDocToPlainHtml } from '../html/plainHtml';
import { markdownDocToEpub } from '../epub/export';
import { markdownDocToDocx } from '../docx/export';
import { docToPptx } from '../pptx/export';
import { SVG_BLIP_EXT_URI } from '../shared/officeSvgBlip';
import { docHasSvgIslands, svgIslandImage, svgIslandsAsImages } from '../shared/svgIslands';

const ICON =
  '<svg viewBox="0 0 24 12"><title>Badge</title><rect width="24" height="12" fill="currentColor"/></svg>';
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
    expect(image).toMatchObject({
      contentType: 'image/svg+xml',
      width: 24,
      height: 12,
      alt: 'Badge',
    });
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

/** Every part under `prefix` and its bytes. */
async function parts(zip: JSZip, prefix: string): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith(prefix))) {
    if (!zip.files[name]!.dir) out.set(name, await zip.file(name)!.async('uint8array'));
  }
  return out;
}

/** The target a relationship id points at in a rels part. */
function relTarget(rels: string, id: string): string | undefined {
  return new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
}

describe('DOCX', () => {
  async function exportDocx(markdown: string, fallbacks?: Map<string, DiagramPicture>) {
    const zip = await JSZip.loadAsync(
      await markdownDocToDocx(parseMarkdown(markdown), {
        themeId: 'standard',
        ...(fallbacks ? { svgIslandFallbacks: fallbacks } : {}),
      }),
    );
    const xml = await zip.file('word/document.xml')!.async('string');
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const types = await zip.file('[Content_Types].xml')!.async('string');
    return { zip, xml, rels, types };
  }

  it('embeds an island as vector SVG with a PNG fallback', async () => {
    const { zip, xml, rels, types } = await exportDocx(`\`\`\`svg\n${ICON}\n\`\`\``);
    const blip =
      /<a:blip r:embed="(rId\d+)"><a:extLst><a:ext uri="([^"]+)"><asvg:svgBlip [^>]*r:embed="(rId\d+)"/.exec(
        xml,
      );
    expect(blip).not.toBeNull();
    expect(blip![2]).toBe(SVG_BLIP_EXT_URI);
    expect(relTarget(rels, blip![1]!)).toMatch(/\.png$/);
    const svgTarget = relTarget(rels, blip![3]!)!;
    expect(svgTarget).toMatch(/\.svg$/);
    expect(types).toContain('Extension="svg" ContentType="image/svg+xml"');
    expect(xml).toContain('descr="Badge"');
    expect(xml).not.toContain('&lt;rect');

    // The SVG part is core's sanitized output, colored with the theme text.
    const svg = new TextDecoder().decode(
      (await parts(zip, 'word/media/')).get(`word/${svgTarget}`),
    );
    const color = /^<svg [^>]*\bcolor="([^"]+)"/.exec(svg)?.[1];
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(svg).toBe(new TextDecoder().decode(svgIslandImage(ICON, { color })!.data));
    expect(svg).not.toMatch(/currentcolor/i);
  });

  it('never writes hostile markup into the package', async () => {
    const { zip } = await exportDocx(`\`\`\`svg\n${HOSTILE}\n\`\`\``);
    for (const [name, bytes] of await parts(zip, 'word/')) {
      if (!name.endsWith('.svg') && !name.endsWith('.xml')) continue;
      const text = new TextDecoder().decode(bytes);
      expect(text).not.toContain('onload');
      expect(text).not.toContain('<script');
    }
  });

  it('uses the host rasterization as the fallback when given', async () => {
    const fallbacks = new Map([[ICON, { data: PNG, width: 240, height: 120 }]]);
    const { zip, xml, rels } = await exportDocx(`\`\`\`svg\n${ICON}\n\`\`\``, fallbacks);
    const pngRel = /<a:blip r:embed="(rId\d+)">/.exec(xml)![1]!;
    const png = (await parts(zip, 'word/media/')).get(`word/${relTarget(rels, pngRel)}`);
    expect(png).toEqual(PNG);
  });

  it('keeps a fence that is not an island as code', async () => {
    const { xml } = await exportDocx('```svg\n<div>not an island</div>\n```');
    expect(xml).not.toContain('svgBlip');
    expect(xml).toContain('&lt;div&gt;not an island&lt;/div&gt;');
  });
});

describe('PPTX', () => {
  async function exportPptx(markdown: string, diagramImages?: Map<string, DiagramPicture>) {
    const zip = await JSZip.loadAsync(
      await docToPptx(
        markdownToDoc(parseMarkdown(markdown)),
        diagramImages ? { diagramImages } : {},
      ),
    );
    const slideNames = Object.keys(zip.files).filter((n) =>
      /^ppt\/slides\/slide\d+\.xml$/u.test(n),
    );
    const slides = await Promise.all(slideNames.map((n) => zip.file(n)!.async('string')));
    return { zip, slides: slides.join('\n') };
  }

  it('draws an island as vector SVG with a PNG fallback', async () => {
    const { zip, slides } = await exportPptx(`## Logo\n\n\`\`\`svg\n${ICON}\n\`\`\``);
    expect(slides).toContain(`<a:ext uri="${SVG_BLIP_EXT_URI}"><asvg:svgBlip`);
    expect(slides).toContain('descr="Badge"');
    expect(slides).not.toContain('viewBox');
    const media = [...(await parts(zip, 'ppt/media/')).keys()];
    expect(media.filter((name) => name.endsWith('.svg'))).toHaveLength(1);
    expect(media.filter((name) => name.endsWith('.png'))).toHaveLength(1);
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(types).toContain('Extension="svg" ContentType="image/svg+xml"');
  });

  it('uses the host rasterization as the fallback when given', async () => {
    const { zip } = await exportPptx(
      `## Logo\n\n\`\`\`svg\n${ICON}\n\`\`\``,
      new Map([[ICON, { data: PNG, width: 240, height: 120 }]]),
    );
    const png = [...(await parts(zip, 'ppt/media/')).entries()].find(([n]) => n.endsWith('.png'));
    expect(png?.[1]).toEqual(PNG);
  });
});

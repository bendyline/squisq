/**
 * Attached SVG images (`![logo](logo.svg)`) in document exports. Like an SVG
 * island, an attached file is never written as authored: every exporter
 * writes core's sanitized re-serialization, or leaves the image out (its alt
 * text) when the file is not a usable SVG.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { parseMarkdown, parseSvgIsland } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { markdownDocToPlainHtml } from '../html/plainHtml';
import { docToHtml, docToHtmlZip } from '../html/index';
import { markdownDocToEpub } from '../epub/export';
import { markdownDocToDocx } from '../docx/export';
import { markdownDocToPdf } from '../pdf/export';
import { docToPptx, markdownDocToPptx } from '../pptx/export';
import { SVG_BLIP_EXT_URI } from '../shared/officeSvgBlip';
import { exportImageBytes, isSvgImageEntry } from '../shared/svgIslands';

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" onload="alert(1)"><script>alert(2)</script><image href="https://evil.example/t.png"/><rect width="120" height="60" fill="#2a7"/></svg>';
const SANITIZED = (() => {
  const result = parseSvgIsland(LOGO);
  if (!result.ok) throw new Error('fixture must parse');
  return result.island.markup;
})();
const MARKDOWN = '# Brand\n\n![Logo](images/logo.svg)\n';

/** A valid 1×1 PNG. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
);

function bytes(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const out = new Uint8Array(encoded.length);
  out.set(encoded);
  return out.buffer;
}

function text(data: ArrayBuffer | Uint8Array | undefined): string {
  return new TextDecoder().decode(data);
}

/** A Blob's bytes (jsdom's Blob has no `arrayBuffer()`). */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function dataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(svg)))}`;
}

function decodeDataUrl(url: string): string {
  const base64 = url.slice(url.indexOf(',') + 1);
  return text(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

function expectInert(markup: string): void {
  for (const needle of ['onload', '<script', 'evil.example']) expect(markup).not.toContain(needle);
}

describe('shared helpers', () => {
  it('recognize SVG entries by path or content type', () => {
    expect(isSvgImageEntry('a/logo.svg')).toBe(true);
    expect(isSvgImageEntry('blob-123', 'image/svg+xml')).toBe(true);
    expect(isSvgImageEntry('photo.png', 'image/png')).toBe(false);
  });

  it('write core’s markup for SVG and leave other bytes alone', () => {
    expect(text(exportImageBytes('logo.svg', bytes(LOGO))!)).toBe(SANITIZED);
    expect(exportImageBytes('bad.svg', bytes('<div/>'))).toBeNull();
    const png = PNG.buffer as ArrayBuffer;
    expect(exportImageBytes('photo.png', png)).toBe(png);
  });
});

describe('HTML', () => {
  it('plain single-file HTML shows the sanitized SVG instead of dropping it', () => {
    const html = markdownDocToPlainHtml(parseMarkdown(MARKDOWN), {
      images: new Map([['images/logo.svg', dataUrl(LOGO)]]),
    });
    const src = /<img src="([^"]+)" alt="Logo"/.exec(html)?.[1];
    expect(src).toBeDefined();
    expect(decodeDataUrl(src!)).toBe(SANITIZED);
  });

  it('plain HTML shows alt text for a file that is not a usable SVG', () => {
    const html = markdownDocToPlainHtml(parseMarkdown(MARKDOWN), {
      images: new Map([['images/logo.svg', dataUrl('<div>nope</div>')]]),
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('Logo');
  });

  it('the single-file player inlines the sanitized SVG', () => {
    const html = docToHtml(markdownToDoc(parseMarkdown(MARKDOWN)), {
      playerScript: '/* player */',
      images: new Map([['images/logo.svg', bytes(LOGO)]]),
    });
    const inlined = /data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/.exec(html)?.[0];
    expect(inlined).toBeDefined();
    expect(decodeDataUrl(inlined!)).toBe(SANITIZED);
  });

  it('the HTML zip carries the sanitized file at its path', async () => {
    const blob = await docToHtmlZip(markdownToDoc(parseMarkdown(MARKDOWN)), {
      playerScript: '/* player */',
      images: new Map([['images/logo.svg', bytes(LOGO)]]),
    });
    const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
    expect(await zip.file('images/logo.svg')!.async('string')).toBe(SANITIZED);
  });
});

describe('EPUB', () => {
  it('packages the sanitized file', async () => {
    const epub = await JSZip.loadAsync(
      await markdownDocToEpub(parseMarkdown(MARKDOWN), {
        images: new Map([['images/logo.svg', bytes(LOGO)]]),
      }),
    );
    const name = Object.keys(epub.files).find((file) => file.endsWith('logo.svg'))!;
    expect(await epub.file(name)!.async('string')).toBe(SANITIZED);
  });

  it('leaves out a file that is not a usable SVG', async () => {
    const epub = await JSZip.loadAsync(
      await markdownDocToEpub(parseMarkdown(MARKDOWN), {
        images: new Map([['images/logo.svg', bytes('<div>nope</div>')]]),
      }),
    );
    expect(Object.keys(epub.files).some((file) => file.endsWith('.svg'))).toBe(false);
  });
});

describe('DOCX', () => {
  async function exportDocx(
    svg: string,
    fallbacks?: Map<string, { data: Uint8Array; width: number; height: number }>,
  ) {
    const zip = await JSZip.loadAsync(
      await markdownDocToDocx(parseMarkdown(MARKDOWN), {
        images: new Map([['images/logo.svg', { data: bytes(svg), contentType: 'image/svg+xml' }]]),
        ...(fallbacks ? { svgIslandFallbacks: fallbacks } : {}),
      }),
    );
    return { zip, xml: await zip.file('word/document.xml')!.async('string') };
  }

  it('embeds the sanitized SVG as vector art over a PNG', async () => {
    const { zip, xml } = await exportDocx(LOGO);
    expect(xml).toContain(`<a:ext uri="${SVG_BLIP_EXT_URI}"><asvg:svgBlip`);
    expect(xml).toContain('descr="Logo"');
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('word/media/') && !zip.files[name]!.dir,
    );
    expect(media.filter((name) => name.endsWith('.png'))).toHaveLength(1);
    const svgPart = media.find((name) => name.endsWith('.svg'))!;
    expect(await zip.file(svgPart)!.async('string')).toBe(SANITIZED);
    expect(media.some((name) => name.endsWith('.svg+xml'))).toBe(false);
    // Sized from the viewBox: 120 × 60 CSS px.
    expect(xml).toContain(
      `cx="${Math.round((120 / 96) * 914400)}" cy="${Math.round((60 / 96) * 914400)}"`,
    );
  });

  it('uses the host’s rendering of the file as the fallback', async () => {
    const { zip } = await exportDocx(
      LOGO,
      new Map([[LOGO, { data: PNG, width: 120, height: 60 }]]),
    );
    const png = Object.keys(zip.files).find(
      (name) => name.startsWith('word/media/') && name.endsWith('.png'),
    )!;
    expect(new Uint8Array(await zip.file(png)!.async('uint8array'))).toEqual(PNG);
  });

  it('prints a placeholder for a file that is not a usable SVG', async () => {
    const { xml } = await exportDocx('<div>nope</div>');
    expect(xml).not.toContain('svgBlip');
    expect(xml).toContain('[Image: Logo]');
  });
});

describe('PPTX', () => {
  async function slidesOf(buffer: ArrayBuffer) {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/u.test(n));
    return {
      zip,
      xml: (await Promise.all(names.map((n) => zip.file(n)!.async('string')))).join('\n'),
    };
  }

  it('draws an image layer showing an SVG as vector art over a PNG', async () => {
    const { zip, xml } = await slidesOf(
      await docToPptx(markdownToDoc(parseMarkdown(MARKDOWN)), {
        images: new Map([['images/logo.svg', bytes(LOGO)]]),
      }),
    );
    expect(xml).toContain('svgBlip');
    const svgParts = Object.keys(zip.files).filter(
      (n) => n.startsWith('ppt/media/') && n.endsWith('.svg'),
    );
    expect(svgParts.length).toBeGreaterThan(0);
    for (const part of svgParts) expectInert(await zip.file(part)!.async('string'));
  });

  it('never embeds the file as written on the markdown path', async () => {
    const { zip, xml } = await slidesOf(
      await markdownDocToPptx(parseMarkdown(MARKDOWN), {
        images: new Map([['images/logo.svg', bytes(LOGO)]]),
      }),
    );
    expect(Object.keys(zip.files).some((n) => n.endsWith('.svg'))).toBe(false);
    expect(xml).toContain('Logo');
  });
});

describe('PDF', () => {
  async function imageCount(images: NonNullable<Parameters<typeof markdownDocToPdf>[1]>['images']) {
    const pdf = await PDFDocument.load(await markdownDocToPdf(parseMarkdown(MARKDOWN), { images }));
    const objects = pdf
      .getPages()[0]!
      .node.Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    return objects?.keys().length ?? 0;
  }

  it('never embeds an SVG file (it has no vector picture; it prints the note)', async () => {
    expect(await imageCount(new Map([['images/logo.svg', { data: bytes(LOGO) }]]))).toBe(0);
  });

  it('embeds the PNG a host supplies in its place', async () => {
    const images = new Map([
      ['images/logo.svg', { data: PNG, contentType: 'image/png', width: 120, height: 60 }],
    ]);
    expect(await imageCount(images)).toBe(1);
  });
});

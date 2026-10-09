/**
 * Hosted videos (YouTube, Vimeo, …) in Office files. DOCX: a top-level video
 * paragraph exports as a Word online video — a poster picture whose blip
 * carries `wp15:webVideoPr` embed code and a click link to the page — plus a
 * linked caption, and imports back to the same paragraph. PPTX: a slide's
 * player exports as a poster that opens the video when clicked.
 */

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToDocx } from '../docx/export';
import { docxToContainer, docxToMarkdownDoc } from '../docx/import';
import { WEB_VIDEO_EXT_URI } from '../docx/videoEmbed';
import { docToPptx } from '../pptx/export';
import { officeVideoEmbedHtml, videoPosterPng } from '../shared/videoPoster';
import { parseVideoEmbedUrl } from '@bendyline/squisq/markdown';

const YT = 'dQw4w9WgXcQ';
const WATCH = `https://www.youtube.com/watch?v=${YT}`;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const DOC = `# Talks

Intro.

[Launch keynote](${WATCH}&t=42s)

https://vimeo.com/76979871

https://www.youtube.com/shorts/${YT}

Outro with [a link](https://youtu.be/${YT}).

- https://youtu.be/${YT}
`;

async function exportDocx(markdown: string): Promise<ArrayBuffer> {
  return markdownDocToDocx(parseMarkdown(markdown));
}

async function part(bytes: ArrayBuffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file(path)!.async('string');
}

function roundTrip(markdown: string): Promise<string> {
  return exportDocx(markdown)
    .then((bytes) => docxToMarkdownDoc(bytes))
    .then((doc) => stringifyMarkdown(doc));
}

describe('video poster and Office embed code', () => {
  it('generates a landscape and a portrait PNG poster', () => {
    const landscape = videoPosterPng(false)!;
    const portrait = videoPosterPng(true)!;
    expect([...new Uint8Array(landscape.data).slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect([landscape.width, landscape.height]).toEqual([640, 360]);
    expect([portrait.width, portrait.height]).toEqual([360, 640]);
    expect(videoPosterPng(false)).toBe(landscape);
  });

  it('gives Office the standard YouTube embed host and the canonical attributes', () => {
    const html = officeVideoEmbedHtml(parseVideoEmbedUrl(`${WATCH}&t=42`)!, 'Demo "1"', 560, 315);
    expect(html).toBe(
      `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?start=42" title="Demo &quot;1&quot;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" frameborder="0"></iframe>`,
    );
  });
});

describe('DOCX export of hosted videos', () => {
  it('writes a Word online video: poster blip, webVideoPr embed code, click link', async () => {
    const bytes = await exportDocx(DOC);
    const xml = await part(bytes, 'word/document.xml');
    const rels = await part(bytes, 'word/_rels/document.xml.rels');

    expect(xml.match(/<wp15:webVideoPr /g)).toHaveLength(3);
    expect(xml).toContain(`<a:ext uri="${WEB_VIDEO_EXT_URI}">`);
    expect(xml).toContain(
      `embeddedHtml="&lt;iframe width=&quot;560&quot; height=&quot;315&quot; src=&quot;https://www.youtube.com/embed/${YT}?start=42&quot;`,
    );
    expect(xml).toContain('descr="Launch keynote"');
    // Shorts are portrait.
    expect(xml).toContain('h="560" w="315"');

    // The click link is an external hyperlink to the page, not the player.
    const linkId = /<wp:docPr [^>]*><a:hlinkClick [^>]*r:id="(rId\d+)"/.exec(xml)![1];
    expect(rels).toMatch(
      new RegExp(`Id="${linkId}"[^>]*Target="https://www.youtube.com/watch\\?v=${YT}&amp;t=42s"`),
    );

    // Each poster is a real PNG part.
    const zip = await JSZip.loadAsync(bytes);
    const posters = Object.keys(zip.files).filter((name) =>
      /^word\/media\/video\d+\.png$/.test(name),
    );
    expect(posters).toHaveLength(3);
    const poster = await zip.file(posters[0]!)!.async('uint8array');
    expect([...poster.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it('keeps a printable caption that links to the video', async () => {
    const xml = await part(await exportDocx(`[Launch keynote](${WATCH})`), 'word/document.xml');
    expect(xml).toMatch(/<w:p><w:pPr><w:keepNext\/><\/w:pPr><w:r><w:drawing>/);
    expect(xml).toMatch(/<w:hyperlink r:id="rId\d+">.*Launch keynote<\/w:t>/);
  });

  it('leaves video links in prose and lists as hyperlinks', async () => {
    const xml = await part(
      await exportDocx(`See [it](https://youtu.be/${YT}).\n\n- https://youtu.be/${YT}`),
      'word/document.xml',
    );
    expect(xml).not.toContain('webVideoPr');
  });
});

describe('DOCX import of online videos', () => {
  it('round-trips every video paragraph exactly once, and other links untouched', async () => {
    expect(await roundTrip(DOC)).toBe(`# Talks

Intro.

[Launch keynote](https://www.youtube.com/watch?v=${YT}\\&t=42s)

<https://vimeo.com/76979871>

<https://www.youtube.com/shorts/${YT}>

Outro with [a link](https://youtu.be/${YT}).

- <https://youtu.be/${YT}>
`);
  });

  it('does not extract the poster as a document image', async () => {
    const container = await docxToContainer(await exportDocx(`[Launch keynote](${WATCH})`));
    const files = (await container.listFiles()).map((file) => file.path);
    expect(files.filter((path) => path.startsWith('images/'))).toEqual([]);
  });

  async function withEmbeddedHtml(embeddedHtml: string, link: string | null): Promise<string> {
    const bytes = await exportDocx(`[Launch keynote](${WATCH})`);
    const zip = await JSZip.loadAsync(bytes);
    let xml = await zip.file('word/document.xml')!.async('string');
    xml = xml.replace(/embeddedHtml="[^"]*"/, `embeddedHtml="${embeddedHtml}"`);
    // Drop the export's own caption so only the drawing speaks.
    xml = xml.replace(/<w:p><w:hyperlink[\s\S]*?<\/w:hyperlink><\/w:p>/, '');
    zip.file('word/document.xml', xml);
    if (link !== null) {
      let rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
      rels = rels.replace(/Target="https:\/\/www\.youtube\.com\/watch[^"]*"/, `Target="${link}"`);
      zip.file('word/_rels/document.xml.rels', rels);
    }
    const doc = await docxToMarkdownDoc(await zip.generateAsync({ type: 'arraybuffer' }));
    return stringifyMarkdown(doc).trim();
  }

  it('reads embed code the way Word writes it', async () => {
    const wordHtml = `&lt;iframe width=&quot;480&quot; height=&quot;270&quot; src=&quot;https://www.youtube.com/embed/${YT}?feature=oembed&quot; frameborder=&quot;0&quot; allowfullscreen=&quot;&quot;&gt;&lt;/iframe&gt;`;
    expect(await withEmbeddedHtml(wordHtml, WATCH)).toBe(`[Launch keynote](${WATCH})`);
  });

  it('falls back to the click link when the embed code is not a supported player', async () => {
    const hostile = '&lt;iframe src=&quot;https://evil.example/frame&quot;&gt;&lt;/iframe&gt;';
    expect(await withEmbeddedHtml(hostile, 'https://vimeo.com/76979871')).toBe(
      '[Launch keynote](https://vimeo.com/76979871)',
    );
  });

  it('never lets the click link swap in a different video', async () => {
    const wordHtml = `&lt;iframe src=&quot;https://www.youtube.com/embed/${YT}&quot;&gt;&lt;/iframe&gt;`;
    expect(await withEmbeddedHtml(wordHtml, 'https://vimeo.com/76979871')).toBe(
      `[Launch keynote](${WATCH})`,
    );
  });
});

describe('PPTX export of hosted videos', () => {
  it('exports a slide player as a poster that opens the video page', async () => {
    const doc = markdownToDoc(parseMarkdown(`## Launch keynote\n\n[The keynote](${WATCH})`), {
      articleId: 'video-deck',
      generateCoverBlock: false,
    });
    const bytes = await docToPptx(doc, { includeCoverSlide: false });
    const zip = await JSZip.loadAsync(bytes);
    const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
    const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');

    const pic = /<p:pic>[\s\S]*?<\/p:pic>/.exec(slide)![0];
    expect(pic).toContain('descr="The keynote"');
    const linkId = /<a:hlinkClick r:id="(rId\d+)"\/>/.exec(pic)![1];
    expect(rels).toMatch(
      new RegExp(`Id="${linkId}"[^>]*Target="https://www.youtube.com/watch\\?v=${YT}"`),
    );
    expect(slide).not.toContain('[Video:');
    const media = Object.keys(zip.files).filter((name) => name.startsWith('ppt/media/'));
    expect(media.some((name) => name.endsWith('.png'))).toBe(true);
  });
});

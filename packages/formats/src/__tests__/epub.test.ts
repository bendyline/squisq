/**
 * Tests for EPUB export: markdownDocToEpub, docToEpub.
 *
 * Verifies EPUB 3 structure, chapter splitting, XHTML content,
 * image embedding, metadata, and stylesheet generation.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { MarkdownDocument, MarkdownBlockNode } from '@bendyline/squisq/markdown';
import { markdownDocToEpub } from '../epub/export';
import type { EpubExportOptions } from '../epub/export';

// ============================================
// Helpers
// ============================================

function makeDoc(
  children: MarkdownBlockNode[],
  frontmatter?: Record<string, unknown>,
): MarkdownDocument {
  return { type: 'document', children, frontmatter };
}

function heading(depth: 1 | 2 | 3, text: string): MarkdownBlockNode {
  return { type: 'heading', depth, children: [{ type: 'text', value: text }] };
}

function paragraph(text: string): MarkdownBlockNode {
  return { type: 'paragraph', children: [{ type: 'text', value: text }] };
}

function boldParagraph(text: string): MarkdownBlockNode {
  return {
    type: 'paragraph',
    children: [{ type: 'strong', children: [{ type: 'text', value: text }] }],
  };
}

function linkParagraph(text: string, url: string): MarkdownBlockNode {
  return {
    type: 'paragraph',
    children: [{ type: 'link', url, children: [{ type: 'text', value: text }] }],
  };
}

function imageParagraph(alt: string, url: string): MarkdownBlockNode {
  return {
    type: 'paragraph',
    children: [{ type: 'image', url, alt }],
  };
}

function codeBlock(code: string, lang?: string): MarkdownBlockNode {
  return { type: 'code', value: code, lang: lang ?? null };
}

async function exportAndUnzip(doc: MarkdownDocument, options?: EpubExportOptions): Promise<JSZip> {
  const buffer = await markdownDocToEpub(doc, options);
  return JSZip.loadAsync(buffer);
}

// ============================================
// Tests
// ============================================

describe('markdownDocToEpub', () => {
  describe('EPUB structure', () => {
    it('produces a valid ZIP with required EPUB files', async () => {
      const doc = makeDoc([heading(1, 'Title'), paragraph('Content')]);
      const zip = await exportAndUnzip(doc);

      expect(zip.file('mimetype')).toBeTruthy();
      expect(zip.file('META-INF/container.xml')).toBeTruthy();
      expect(zip.file('OEBPS/content.opf')).toBeTruthy();
      expect(zip.file('OEBPS/toc.xhtml')).toBeTruthy();
      expect(zip.file('OEBPS/styles.css')).toBeTruthy();
    });

    it('mimetype contains "application/epub+zip"', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc);
      const mimetype = await zip.file('mimetype')!.async('string');
      expect(mimetype).toBe('application/epub+zip');
    });

    it('container.xml points to content.opf', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc);
      const containerXml = await zip.file('META-INF/container.xml')!.async('string');
      expect(containerXml).toContain('OEBPS/content.opf');
    });
  });

  describe('chapter splitting', () => {
    it('splits at H1 boundaries', async () => {
      const doc = makeDoc([
        heading(1, 'Chapter One'),
        paragraph('First chapter content'),
        heading(1, 'Chapter Two'),
        paragraph('Second chapter content'),
      ]);
      const zip = await exportAndUnzip(doc);

      expect(zip.file('OEBPS/chapters/chapter-001.xhtml')).toBeTruthy();
      expect(zip.file('OEBPS/chapters/chapter-002.xhtml')).toBeTruthy();

      const ch1 = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      const ch2 = await zip.file('OEBPS/chapters/chapter-002.xhtml')!.async('string');
      expect(ch1).toContain('Chapter One');
      expect(ch1).toContain('First chapter content');
      expect(ch2).toContain('Chapter Two');
      expect(ch2).toContain('Second chapter content');
    });

    it('splits at H2 boundaries', async () => {
      const doc = makeDoc([
        heading(2, 'Section A'),
        paragraph('A content'),
        heading(2, 'Section B'),
        paragraph('B content'),
      ]);
      const zip = await exportAndUnzip(doc);

      expect(zip.file('OEBPS/chapters/chapter-001.xhtml')).toBeTruthy();
      expect(zip.file('OEBPS/chapters/chapter-002.xhtml')).toBeTruthy();
    });

    it('keeps content before first heading in a single chapter', async () => {
      const doc = makeDoc([
        paragraph('Intro text'),
        heading(1, 'Chapter One'),
        paragraph('Chapter content'),
      ]);
      const zip = await exportAndUnzip(doc);

      // Should have 2 chapters: intro + chapter one
      expect(zip.file('OEBPS/chapters/chapter-001.xhtml')).toBeTruthy();
      expect(zip.file('OEBPS/chapters/chapter-002.xhtml')).toBeTruthy();

      const ch1 = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch1).toContain('Intro text');
    });

    it('handles a document with no headings', async () => {
      const doc = makeDoc([paragraph('Just a paragraph')]);
      const zip = await exportAndUnzip(doc);

      expect(zip.file('OEBPS/chapters/chapter-001.xhtml')).toBeTruthy();
      const ch1 = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch1).toContain('Just a paragraph');
    });
  });

  describe('XHTML content', () => {
    it('renders headings with correct tags', async () => {
      const doc = makeDoc([heading(1, 'H1'), heading(3, 'H3'), paragraph('text')]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('<h1>H1</h1>');
      expect(ch).toContain('<h3>H3</h3>');
    });

    it('renders bold text as <strong>', async () => {
      const doc = makeDoc([heading(1, 'Test'), boldParagraph('important')]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('<strong>important</strong>');
    });

    it('renders links as <a> elements', async () => {
      const doc = makeDoc([heading(1, 'Test'), linkParagraph('click', 'https://example.com')]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('<a href="https://example.com">click</a>');
    });

    it('renders code blocks with language class', async () => {
      const doc = makeDoc([heading(1, 'Test'), codeBlock('const x = 1;', 'javascript')]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('class="language-javascript"');
      expect(ch).toContain('const x = 1;');
    });

    it('escapes special XML characters in text', async () => {
      const doc = makeDoc([heading(1, 'Test'), paragraph('a < b & c > d')]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('a &lt; b &amp; c &gt; d');
    });

    it('renders tables', async () => {
      const table: MarkdownBlockNode = {
        type: 'table',
        align: ['left', 'right'],
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', isHeader: true, children: [{ type: 'text', value: 'Name' }] },
              { type: 'tableCell', isHeader: true, children: [{ type: 'text', value: 'Age' }] },
            ],
          },
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [{ type: 'text', value: 'Alice' }] },
              { type: 'tableCell', children: [{ type: 'text', value: '30' }] },
            ],
          },
        ],
      };
      const doc = makeDoc([heading(1, 'Test'), table]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('<table>');
      expect(ch).toContain('<th');
      expect(ch).toContain('Name');
      expect(ch).toContain('<td');
      expect(ch).toContain('Alice');
      expect(ch).toContain('text-align: right');
    });

    it('renders thematic breaks as <hr/>', async () => {
      const doc = makeDoc([heading(1, 'Test'), { type: 'thematicBreak' }, paragraph('after')]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('<hr/>');
    });

    it('renders blockquotes', async () => {
      const doc = makeDoc([
        heading(1, 'Test'),
        { type: 'blockquote', children: [paragraph('A quote')] },
      ]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('<blockquote>');
      expect(ch).toContain('A quote');
    });

    it('renders ordered and unordered lists', async () => {
      const doc = makeDoc([
        heading(1, 'Test'),
        {
          type: 'list',
          ordered: false,
          children: [{ type: 'listItem', children: [paragraph('Bullet')] }],
        },
        {
          type: 'list',
          ordered: true,
          children: [{ type: 'listItem', children: [paragraph('Numbered')] }],
        },
      ]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('<ul>');
      expect(ch).toContain('<ol>');
      expect(ch).toContain('Bullet');
      expect(ch).toContain('Numbered');
    });
  });

  describe('images', () => {
    it('embeds provided images in the ZIP', async () => {
      const imgData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
      const doc = makeDoc([heading(1, 'Test'), imageParagraph('Logo', 'images/logo.png')]);
      const zip = await exportAndUnzip(doc, {
        images: new Map([['images/logo.png', imgData]]),
      });

      expect(zip.file('OEBPS/images/logo.png')).toBeTruthy();
    });

    it('references images with correct relative path in XHTML', async () => {
      const imgData = new Uint8Array([0xff, 0xd8]).buffer;
      const doc = makeDoc([heading(1, 'Test'), imageParagraph('Photo', 'photo.jpg')]);
      const zip = await exportAndUnzip(doc, {
        images: new Map([['photo.jpg', imgData]]),
      });

      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('src="../images/photo.jpg"');
      expect(ch).toContain('alt="Photo"');
    });

    it('lists images in the OPF manifest', async () => {
      const imgData = new Uint8Array([0x89]).buffer;
      const doc = makeDoc([heading(1, 'Test'), imageParagraph('Pic', 'pic.png')]);
      const zip = await exportAndUnzip(doc, {
        images: new Map([['pic.png', imgData]]),
      });

      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('images/pic.png');
      expect(opf).toContain('image/png');
    });

    it('embeds cover image with cover-image property', async () => {
      const coverData = new Uint8Array([0xff, 0xd8]).buffer;
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc, { coverImage: coverData });

      expect(zip.file('OEBPS/images/cover.jpg')).toBeTruthy();
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('cover-image');
    });
  });

  describe('metadata', () => {
    it('includes title in OPF', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc, { title: 'My Book' });
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('<dc:title>My Book</dc:title>');
    });

    it('includes author in OPF', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc, { author: 'Jane Doe' });
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('<dc:creator>Jane Doe</dc:creator>');
    });

    it('includes language in OPF', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc, { language: 'fr' });
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('<dc:language>fr</dc:language>');
    });

    it('defaults language to "en"', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc);
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('<dc:language>en</dc:language>');
    });

    it('includes description and publisher when provided', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc, {
        description: 'A great book',
        publisher: 'Acme Publishing',
      });
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('<dc:description>A great book</dc:description>');
      expect(opf).toContain('<dc:publisher>Acme Publishing</dc:publisher>');
    });

    it('includes UUID identifier', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc);
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('urn:uuid:');
    });

    it('uses frontmatter title as fallback', async () => {
      const doc = makeDoc([heading(1, 'Intro')], { title: 'Frontmatter Title' });
      const zip = await exportAndUnzip(doc);
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('<dc:title>Frontmatter Title</dc:title>');
    });
  });

  describe('table of contents', () => {
    it('toc.xhtml lists all chapters', async () => {
      const doc = makeDoc([
        heading(1, 'Introduction'),
        paragraph('Intro content'),
        heading(1, 'Main Body'),
        paragraph('Body content'),
      ]);
      const zip = await exportAndUnzip(doc);
      const toc = await zip.file('OEBPS/toc.xhtml')!.async('string');
      expect(toc).toContain('Introduction');
      expect(toc).toContain('Main Body');
      expect(toc).toContain('epub:type="toc"');
    });

    it('spine references all chapters in order', async () => {
      const doc = makeDoc([heading(1, 'Ch 1'), heading(1, 'Ch 2'), heading(1, 'Ch 3')]);
      const zip = await exportAndUnzip(doc);
      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('idref="chapter-001"');
      expect(opf).toContain('idref="chapter-002"');
      expect(opf).toContain('idref="chapter-003"');
    });
  });

  describe('stylesheet', () => {
    it('includes base CSS styles', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc);
      const css = await zip.file('OEBPS/styles.css')!.async('string');
      expect(css).toContain('body');
      expect(css).toContain('font-family');
      expect(css).toContain('blockquote');
    });

    it('chapters reference the stylesheet', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc);
      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('href="../styles.css"');
    });
  });

  describe('empty document', () => {
    it('handles empty document gracefully', async () => {
      const doc = makeDoc([]);
      const zip = await exportAndUnzip(doc);

      // Should still produce valid EPUB structure
      expect(zip.file('mimetype')).toBeTruthy();
      expect(zip.file('OEBPS/content.opf')).toBeTruthy();
      expect(zip.file('OEBPS/chapters/chapter-001.xhtml')).toBeTruthy();
    });
  });

  describe('audio narration (Media Overlays)', () => {
    const audioData = new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer; // fake MP3 header
    const audioSegments = [
      { src: 'audio/intro.mp3', name: 'intro', duration: 15, startTime: 0 },
      { src: 'audio/body.mp3', name: 'body', duration: 20, startTime: 15 },
    ];

    it('embeds audio files in the ZIP', async () => {
      const doc = makeDoc([
        heading(1, 'Intro'),
        paragraph('Hello'),
        heading(1, 'Body'),
        paragraph('World'),
      ]);
      const zip = await exportAndUnzip(doc, {
        audio: new Map([
          ['audio/intro.mp3', audioData],
          ['audio/body.mp3', audioData],
        ]),
        audioSegments,
        totalDuration: 35,
      });

      expect(zip.file('OEBPS/audio/intro.mp3')).toBeTruthy();
      expect(zip.file('OEBPS/audio/body.mp3')).toBeTruthy();
    });

    it('generates SMIL overlay files for each chapter', async () => {
      const doc = makeDoc([
        heading(1, 'Intro'),
        paragraph('Hello'),
        heading(1, 'Body'),
        paragraph('World'),
      ]);
      const zip = await exportAndUnzip(doc, {
        audio: new Map([
          ['audio/intro.mp3', audioData],
          ['audio/body.mp3', audioData],
        ]),
        audioSegments,
        totalDuration: 35,
      });

      expect(zip.file('OEBPS/chapters/chapter-001.smil')).toBeTruthy();
      expect(zip.file('OEBPS/chapters/chapter-002.smil')).toBeTruthy();
    });

    it('SMIL files reference correct chapter and audio', async () => {
      const doc = makeDoc([heading(1, 'Intro'), paragraph('Content')]);
      const zip = await exportAndUnzip(doc, {
        audio: new Map([['audio/intro.mp3', audioData]]),
        audioSegments: [audioSegments[0]],
        totalDuration: 15,
      });

      const smil = await zip.file('OEBPS/chapters/chapter-001.smil')!.async('string');
      expect(smil).toContain('chapter-001.xhtml');
      expect(smil).toContain('intro.mp3');
      expect(smil).toContain('clipBegin');
      expect(smil).toContain('clipEnd');
      expect(smil).toContain('<par');
      expect(smil).toContain('<text');
      expect(smil).toContain('<audio');
    });

    it('OPF includes media-overlay references', async () => {
      const doc = makeDoc([heading(1, 'Intro'), paragraph('Content')]);
      const zip = await exportAndUnzip(doc, {
        audio: new Map([['audio/intro.mp3', audioData]]),
        audioSegments: [audioSegments[0]],
        totalDuration: 15,
      });

      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('media-overlay=');
      expect(opf).toContain('application/smil+xml');
      expect(opf).toContain('audio/intro.mp3');
    });

    it('OPF includes total duration metadata', async () => {
      const doc = makeDoc([heading(1, 'Intro'), paragraph('Content')]);
      const zip = await exportAndUnzip(doc, {
        audio: new Map([['audio/intro.mp3', audioData]]),
        audioSegments: [audioSegments[0]],
        totalDuration: 35,
      });

      const opf = await zip.file('OEBPS/content.opf')!.async('string');
      expect(opf).toContain('media:duration');
      expect(opf).toContain('media:active-class');
    });

    it('chapter XHTML has element IDs for SMIL references', async () => {
      const doc = makeDoc([heading(1, 'Title'), paragraph('First'), paragraph('Second')]);
      const zip = await exportAndUnzip(doc, {
        audio: new Map([['audio/intro.mp3', audioData]]),
        audioSegments: [audioSegments[0]],
        totalDuration: 15,
      });

      const ch = await zip.file('OEBPS/chapters/chapter-001.xhtml')!.async('string');
      expect(ch).toContain('id="p1"');
      expect(ch).toContain('id="p2"');
      expect(ch).toContain('id="p3"');
    });

    it('stylesheet includes media overlay active class', async () => {
      const doc = makeDoc([heading(1, 'Test')]);
      const zip = await exportAndUnzip(doc);
      const css = await zip.file('OEBPS/styles.css')!.async('string');
      expect(css).toContain('epub-media-overlay-active');
    });

    it('no SMIL files when audio is not provided', async () => {
      const doc = makeDoc([heading(1, 'Test'), paragraph('No audio')]);
      const zip = await exportAndUnzip(doc);

      // No .smil files should exist
      const smilFiles = Object.keys(zip.files).filter((f) => f.endsWith('.smil'));
      expect(smilFiles).toHaveLength(0);

      // No audio directory
      const audioDir = Object.keys(zip.files).filter((f) => f.startsWith('OEBPS/audio/'));
      expect(audioDir).toHaveLength(0);
    });
  });
});

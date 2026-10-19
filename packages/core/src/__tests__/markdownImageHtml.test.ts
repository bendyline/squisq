import { describe, expect, it } from 'vitest';
import { parseMarkdown, stringifyMarkdown } from '../markdown/index.js';
import { rewriteMarkdownReferences } from '../markdown/contentReferences.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { buildNarrationScript } from '../narration/script.js';
import type { MarkdownImage, MarkdownList, MarkdownParagraph } from '../markdown/types.js';

/**
 * The WYSIWYG editor writes a pasted or resized image as `<img alt src width
 * height>`, because `![alt](url)` has no size syntax. The parser reads a lone,
 * plain `<img>` as an image node so slides, exports and reference rewrites all
 * see one kind of picture, and writes the author's tag back unchanged.
 */
const EDITOR_IMAGE = '<img alt="pasted 1" src="Notes_files/pasted 1.png" width="246" height="280">';
const imageIn = (markdown: string) =>
  (parseMarkdown(markdown).children[0] as MarkdownParagraph).children[0] as MarkdownImage;

describe('HTML <img> as an image node', () => {
  it('reads the editor’s sized image as a paragraph holding an image', () => {
    const source = `Intro.\n\n${EDITOR_IMAGE}\n\nAfter.\n`;
    const doc = parseMarkdown(source);
    expect(doc.children.map((node) => node.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect((doc.children[1] as MarkdownParagraph).children[0]).toMatchObject({
      type: 'image',
      url: 'Notes_files/pasted 1.png',
      alt: 'pasted 1',
      width: 246,
      height: 280,
      rawHtml: EDITOR_IMAGE,
    });
    expect(stringifyMarkdown(doc)).toBe(source);
  });

  it('reads inline tags, decodes entities, and writes every tag back as written', () => {
    for (const source of [
      'Text with <img src="i.png" alt="Inline" width="20"> inline.\n',
      '- item <img src="li.png" width="3">\n',
      // Tables are written with padded columns; the cell's tag is unchanged.
      '| A                               |\n| ------------------------------- |\n| <img src="cell.png" height="9"> |\n',
      '<IMG SRC="x.png" WIDTH="10">\n',
      '<img src="x.png" />\n',
      '<img src="x.png" title="Hi" height="7" width="9">\n',
      '<img alt="Tom &amp; Jerry" src="t.png" width="5">\n',
    ])
      expect(stringifyMarkdown(parseMarkdown(source))).toBe(source);
    const inline = parseMarkdown('Text with <img src="i.png" alt="Inline" width="20"> inline.');
    expect((inline.children[0] as MarkdownParagraph).children.map((node) => node.type)).toEqual([
      'text',
      'image',
      'text',
    ]);
    const item = parseMarkdown('- item <img src="li.png" width="3">').children[0] as MarkdownList;
    expect(JSON.stringify(item)).toContain('"type":"image"');
    expect(imageIn('<img alt="Tom &amp; Jerry" src="t.png" width="5">').alt).toBe('Tom & Jerry');
    expect(imageIn('<IMG SRC="x.png" WIDTH="10">')).toMatchObject({ url: 'x.png', width: 10 });
  });

  it('keeps anything more than a plain image as raw HTML', () => {
    for (const source of [
      '<img src="x.png" width="50%">\n',
      '<img src="x.png" width="246px">\n',
      '<img src="x.png" class="hero">\n',
      '<img src="x.png" style="float:left">\n',
      '<img src="x.png" srcset="x2.png 2x">\n',
      '<img src="" alt="Empty">\n',
      '<p><img src="x.png"></p>\n',
      '<img src="x.png">\n<img src="y.png">\n',
    ]) {
      const doc = parseMarkdown(source);
      expect(doc.children[0]!.type).toBe('htmlBlock');
      expect(stringifyMarkdown(doc)).toBe(source);
    }
    expect(parseMarkdown(`${EDITOR_IMAGE}\n`, { parseHtml: false }).children[0]!.type).toBe(
      'htmlBlock',
    );
    // Inline HTML arrives one tag at a time; an <img> inside an element an
    // earlier tag left open belongs to that element.
    const picture = '<picture><source srcset="x.webp"><img src="x.png" alt="X"></picture> text\n';
    expect(JSON.stringify(parseMarkdown(picture))).not.toContain('"type":"image"');
    expect(stringifyMarkdown(parseMarkdown(picture))).toBe(picture);
    expect(JSON.stringify(parseMarkdown('<span>a</span> <img src="x.png"> b'))).toContain(
      '"type":"image"',
    );
  });

  it('writes a fresh tag once the picture changes, keeping its size', () => {
    const doc = parseMarkdown(`${EDITOR_IMAGE}\n`);
    const image = (doc.children[0] as MarkdownParagraph).children[0] as MarkdownImage;
    image.url = 'media/renamed.png';
    image.alt = 'A "quoted" <name>';
    expect(stringifyMarkdown(doc)).toBe(
      '<img alt="A &quot;quoted&quot; &lt;name&gt;" src="media/renamed.png" width="246" height="280">\n',
    );
    expect(imageIn(stringifyMarkdown(doc))).toMatchObject({
      url: 'media/renamed.png',
      alt: 'A "quoted" <name>',
      width: 246,
      height: 280,
    });
    expect(
      rewriteMarkdownReferences(`Before.\n\n${EDITOR_IMAGE}\n`, {
        rewriteUrl: (url) => (url === 'Notes_files/pasted 1.png' ? 'media/one.png' : undefined),
      }),
    ).toBe('Before.\n\n<img alt="pasted 1" src="media/one.png" width="246" height="280">\n');
    // Sharing as text drops the picture just as it drops ![alt](url).
    expect(
      rewriteMarkdownReferences(`Before.\n\n${EDITOR_IMAGE}\n`, { images: 'omit' }).trim(),
    ).toBe('Before.\n\npasted 1');
  });

  it('writes an image sized in code as <img>, which reads back the same', () => {
    const doc = parseMarkdown('![Logo](logo.png)\n');
    const image = (doc.children[0] as MarkdownParagraph).children[0] as MarkdownImage;
    expect(image.rawHtml).toBeUndefined();
    expect(stringifyMarkdown(doc)).toBe('![Logo](logo.png)\n');
    image.width = 120;
    const written = stringifyMarkdown(doc);
    expect(written).toBe('<img alt="Logo" src="logo.png" width="120">\n');
    expect(stringifyMarkdown(parseMarkdown(written))).toBe(written);
  });

  it('adds nothing to the narration script, exactly like the raw HTML it replaces', () => {
    const script = (body: string) =>
      buildNarrationScript(markdownToDoc(parseMarkdown(`# Notes\n\nFirst.\n\n${body}\n\nLast.`)))
        .sourceText;
    expect(script(EDITOR_IMAGE)).toBe(script('<div></div>'));
    expect(script(EDITOR_IMAGE)).not.toContain('pasted');
  });
});

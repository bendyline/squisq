import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown, extractPlainText } from '@bendyline/squisq/markdown';
import { docToHtml, markdownDocToPlainHtml } from '../html/index.js';
import { htmlToMarkdown, htmlToMarkdownDocSync } from '../html/import.js';

describe('htmlToMarkdown', () => {
  it('converts headings and paragraphs', () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Hello <strong>world</strong>.</p>');
    expect(md).toContain('# Title');
    expect(md).toContain('Hello **world**.');
  });

  it('converts links and inline code', () => {
    const md = htmlToMarkdown(
      '<p>See <a href="https://x.test">site</a> and <code>npm i</code></p>',
    );
    expect(md).toContain('[site](https://x.test)');
    expect(md).toContain('`npm i`');
  });

  it('converts unordered and ordered lists', () => {
    const md = htmlToMarkdown('<ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol>');
    expect(md).toMatch(/[-*]\s+a/);
    expect(md).toMatch(/[-*]\s+b/);
    expect(md).toMatch(/1\.\s+one/);
  });

  it('converts blockquotes and tables', () => {
    const md = htmlToMarkdown(
      '<blockquote><p>quoted</p></blockquote>' +
        '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>cell</td></tr></tbody></table>',
    );
    expect(md).toContain('> quoted');
    expect(md).toContain('cell');
  });

  it('drops scripts and styles (sanitized by default)', () => {
    const md = htmlToMarkdown('<p>safe</p><script>alert(1)</script><style>.x{color:red}</style>');
    expect(md).toContain('safe');
    expect(md).not.toContain('alert(1)');
    expect(md).not.toContain('color:red');
  });

  it('strips javascript: links via sanitizer', () => {
    const md = htmlToMarkdown('<a href="javascript:alert(1)">click</a>');
    expect(md).not.toContain('javascript:alert(1)');
  });

  it('builds a document node tree', () => {
    const doc = htmlToMarkdownDocSync('<h2>Hi</h2>');
    expect(doc.type).toBe('document');
    expect(doc.children[0]?.type).toBe('heading');
  });

  it('handles unwrapped div/span containers', () => {
    const md = htmlToMarkdown('<div><span>plain </span><em>text</em></div>');
    expect(md).toContain('plain *text*');
  });

  it('recovers the canonical Doc embedded by the Squisq HTML exporter', () => {
    const source =
      '# Ship Report\n\nOpening paragraph.\n\n## Findings {[quote]}\n\n> Preserve this quote.\n';
    const html = docToHtml(markdownToDoc(parseMarkdown(source)), {
      playerScript: 'var SquisqPlayer={mount:function(){}};',
    });

    const roundTripped = htmlToMarkdown(html);
    expect(roundTripped).toContain('# Ship Report');
    expect(roundTripped).toContain('Opening paragraph.');
    expect(roundTripped).toContain('## Findings {[quote]}');
    expect(roundTripped).toContain('> Preserve this quote.');
  });

  it('rejects a malformed explicit embedded Doc instead of returning page-script noise', () => {
    expect(() =>
      htmlToMarkdown('<script type="application/json" data-squisq-doc="1">{bad</script>'),
    ).toThrow('Invalid embedded Squisq Doc JSON');
  });
  describe('page head', () => {
    const page =
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="Description" content=" About  &amp; more ">\n' +
      '<title>\n  Docs &amp; Notes\n</title>\n</head>\n' +
      '<body><svg><title>icon</title></svg><h1>Docs &amp; Notes</h1><p>Body.</p></body></html>';

    it('keeps the title and description as frontmatter, never as body text', () => {
      const doc = htmlToMarkdownDocSync(page);
      expect(doc.frontmatter).toEqual({ title: 'Docs & Notes', description: 'About & more' });
      expect(doc.children.map((node) => node.type)).toEqual(['heading', 'paragraph']);
      const md = htmlToMarkdown(page);
      expect(md).toMatch(
        /^---\n[\s\S]*title: .*Docs & Notes[\s\S]*\n---\n\n# Docs & Notes\n\nBody\.\n$/,
      );
      // An SVG's <title> is a tooltip, not the page title.
      expect(md).not.toContain('icon');
    });

    it('drops head content without frontmatter when asked', () => {
      const doc = htmlToMarkdownDocSync(page, { headMetadata: false });
      expect(doc.frontmatter).toBeUndefined();
      expect(htmlToMarkdown(page, { headMetadata: false })).toBe('# Docs & Notes\n\nBody.\n');
    });

    it('never surfaces a title as body text, even without sanitizing', () => {
      const md = htmlToMarkdown('<title>Hello</title><h1>Hello</h1><p>x</p>', {
        sanitize: false,
        headMetadata: false,
      });
      expect(md).toBe('# Hello\n\nx\n');
    });

    it('bounds and cleans head metadata', () => {
      const doc = htmlToMarkdownDocSync(
        `<title>${'a'.repeat(5000)}</title><meta name="description" content="one\u0007two"><p>x</p>`,
      );
      expect((doc.frontmatter?.title as string).length).toBe(1024);
      expect(doc.frontmatter?.description).toBe('one two');
      expect(htmlToMarkdownDocSync('<title>   </title><p>x</p>').frontmatter).toBeUndefined();
    });
  });

  describe('whitespace', () => {
    it('lays out pretty-printed HTML the way a browser shows it', () => {
      expect(htmlToMarkdown('<p>\n  Hello  <b>world</b>\n</p>')).toBe('Hello **world**\n');
      expect(htmlToMarkdown('<h1>\n  Title\n</h1>')).toBe('# Title\n');
      expect(htmlToMarkdown('<ul>\n<li>\n  item one\n</li>\n</ul>')).toMatch(/^[-*] item one\n$/);
      expect(htmlToMarkdown('<div>a</div>\n  loose text\n  <div>b</div>')).toBe(
        'a\n\nloose text\n\nb\n',
      );
      expect(htmlToMarkdown('<p>one <span> </span> two</p>')).toBe('one two\n');
    });

    it('moves edge spaces outside emphasis and links', () => {
      expect(htmlToMarkdown('<p>x<strong> bold </strong>y</p>')).toBe('x **bold** y\n');
      expect(htmlToMarkdown('<p>a <em> b </em> c</p>')).toBe('a *b* c\n');
      expect(htmlToMarkdown('<p>see <a href="https://x.test"> link </a>.</p>')).toBe(
        'see [link](https://x.test) .\n',
      );
      // A link whose text was only whitespace falls back to its URL (an autolink).
      expect(htmlToMarkdown('<p><a href="https://x.test"> </a></p>')).toBe('<https://x.test>\n');
      expect(htmlToMarkdown('<p>a<strong> </strong>b</p>')).toBe('a b\n');
    });

    it('trims table cells and never emits escaped edge spaces', () => {
      const md = htmlToMarkdown(
        '<table><tr><th>\n H \n</th></tr><tr><td>\n c \n</td></tr></table><p> x <br>\n y </p>',
      );
      expect(md).toContain('| H |');
      expect(md).toContain('| c |');
      expect(md).not.toContain('&#x20;');
    });

    it('round-trips a plain HTML export without stray title text', () => {
      const source = '# Documents\n\n- [DocBlocks](aboutDocBlocks.md) — Write in plain Markdown.\n';
      const html = markdownDocToPlainHtml(parseMarkdown(source), { title: 'Documents' });
      const md = htmlToMarkdown(html);
      expect(md).not.toContain('&#x20;');
      expect(md).toContain('title: Documents');
      expect(md).toContain(
        '# Documents\n\n- [DocBlocks](aboutDocBlocks.md) — Write in plain Markdown.\n',
      );
    });
  });
});

describe('HTML literal text and mark boundaries', () => {
  it('collapses whitespace and places it outside emphasis, strong and strike markers', () => {
    expect(
      htmlToMarkdown(
        '<p>In <em>Miranda, </em>the court <strong> held </strong><s> otherwise </s>.</p>',
      ),
    ).toBe('In *Miranda,* the court **held** ~~otherwise~~ .\n');
  });

  it('does not turn imported dollars, OCR punctuation or words into Markdown extensions', () => {
    const html =
      '<p>In <em>Miranda, </em>:cferring to awards of $_ and $334.72. County <em>\\ </em>next. $$**$$$</p>';
    const original = htmlToMarkdownDocSync(html);
    const output = parseMarkdown(htmlToMarkdown(html));
    expect(extractPlainText(output)).toBe(extractPlainText(original));
  });
});

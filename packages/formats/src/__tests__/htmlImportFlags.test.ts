import { describe, expect, it } from 'vitest';
import { parseMarkdown, type MarkdownNode } from '@bendyline/squisq/markdown';
import {
  htmlToMarkdown,
  htmlToMarkdownDocSync,
  htmlToPlainText,
  type HtmlImageInfo,
} from '../html/import.js';

/** Every link and image URL the Markdown reads back with, in order. */
function urlsOf(markdown: string): string[] {
  const urls: string[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === 'link' || node.type === 'image') urls.push(node.url);
    if ('children' in node) for (const child of node.children as MarkdownNode[]) visit(child);
  };
  visit(parseMarkdown(markdown));
  return urls;
}

/** A message laid out the way bulk mail is: nested presentation tables. */
const NEWSLETTER = `<html><head><title>Security alert</title></head><body>
<span style="display:none;max-height:0;overflow:hidden">Preview text you never see&zwnj;&nbsp;</span>
<table role="presentation" width="100%"><tr><td align="center">
  <table width="600"><tr><td><img src="https://cdn.example.com/logo.png" alt="Google" width="74" height="24"></td></tr>
  <tr><td><div style="font-size:24px">You allowed <b>Gezel tests</b> access</div>
    <p>Take a moment now to check your account activity.</p>
    <table><tr><td><a href="https://accounts.example.com/check?a=1&amp;b=2">Check activity</a></td></tr></table>
  </td></tr></table>
</td></tr></table>
<img src="https://t.example.com/open?u=123" width="1" height="1" alt="">
</body></html>`;

describe('htmlToMarkdown flags', () => {
  it('reads a newsletter as its content when every mail flag is on', () => {
    const md = htmlToMarkdown(NEWSLETTER, {
      headMetadata: false,
      dropHidden: true,
      dropTrackingPixels: true,
      layoutTables: 'unwrap',
      images: 'alt',
    });
    expect(md).toBe(
      'Google\n\nYou allowed **Gezel tests** access\n\n' +
        'Take a moment now to check your account activity.\n\n' +
        '[Check activity](https://accounts.example.com/check?a=1\\&b=2)\n',
    );
  });

  it('changes nothing without flags', () => {
    const md = htmlToMarkdown(NEWSLETTER);
    expect(md).toContain('title: Security alert');
    expect(md).toContain('Preview text you never see');
    expect(md).toContain('| ![Google](https://cdn.example.com/logo.png)');
    expect(md).toContain('![](https://t.example.com/open?u=123)');
  });

  describe('dropHidden', () => {
    it.each([
      ['hidden attribute', '<div hidden>x</div>'],
      ['display none', '<div style="display: none !important">x</div>'],
      ['visibility hidden', '<span style="visibility:hidden">x</span>'],
      ['mso-hide', '<div style="mso-hide:all">x</div>'],
      ['opacity 0', '<div style="opacity:0.0">x</div>'],
      ['zero height, clipped', '<div style="max-height:0px;overflow:hidden">x</div>'],
      ['zero width, clipped', '<div style="width:0;overflow-x:hidden">x</div>'],
    ])('drops %s', (_name, html) => {
      expect(htmlToMarkdown(`<p>kept</p>${html}`, { dropHidden: true })).toBe('kept\n');
    });

    it('keeps elements that are only small or only clipped', () => {
      const html =
        '<div style="font-size:0">a</div><div style="overflow:hidden">b</div>' +
        '<div style="height:0">c</div><div style="opacity:0.5">d</div>';
      expect(htmlToPlainText(html, { dropHidden: true })).toBe('a\n\nb\n\nc\n\nd');
    });
  });

  describe('dropTrackingPixels', () => {
    it('drops images declared at most one pixel in either direction', () => {
      const html =
        '<p><img src="https://t.test/a" width="1" height="1">' +
        '<img src="https://t.test/b" style="width:0px;height:0px">' +
        '<img src="https://t.test/c" width="600" height="1">' +
        '<img src="https://t.test/keep" width="100%" alt="kept"></p>';
      expect(htmlToMarkdown(html, { dropTrackingPixels: true })).toBe(
        '![kept](https://t.test/keep)\n',
      );
    });
  });

  describe('layoutTables', () => {
    it('keeps data tables, minus rows left empty', () => {
      const html =
        '<table><tr><td>Plan</td><td>Price</td></tr><tr><td></td><td> </td></tr>' +
        '<tr><td>Pro</td><td>$9</td></tr></table>';
      const doc = htmlToMarkdownDocSync(html, { layoutTables: 'unwrap' });
      expect(doc.children).toHaveLength(1);
      expect(doc.children[0]?.type).toBe('table');
      expect(htmlToMarkdown(html, { layoutTables: 'unwrap' })).not.toMatch(/\|\s+\|\s+\|\n/);
    });

    it('keeps a table with a header even when it has one column', () => {
      const html = '<table><thead><tr><th>Name</th></tr></thead><tr><td>Ada</td></tr></table>';
      expect(htmlToMarkdownDocSync(html, { layoutTables: 'unwrap' }).children[0]?.type).toBe(
        'table',
      );
    });

    it.each([
      ['presentation role', '<table role="presentation"><tr><td>a</td><td>b</td></tr></table>'],
      ['one column', '<table><tr><td>a</td></tr><tr><td>b</td></tr></table>'],
      [
        'a nested table',
        '<table><tr><td><table><tr><td>a</td></tr></table></td><td>b</td></tr></table>',
      ],
      ['a heading in a cell', '<table><tr><td><h2>a</h2></td><td>b</td></tr></table>'],
      ['blocks in a cell', '<table><tr><td><p>a</p><p>a2</p></td><td>b</td></tr></table>'],
    ])('unwraps a table with %s', (_name, html) => {
      const doc = htmlToMarkdownDocSync(html, { layoutTables: 'unwrap' });
      expect(doc.children.some((b) => b.type === 'table')).toBe(false);
      expect(htmlToPlainText(html, { layoutTables: 'unwrap' })).toMatch(/^a\n\n(?:a2\n\n)?b$/);
    });

    it('reads a layout table caption first', () => {
      const html = '<table role="none"><caption>Cap</caption><tr><td>a</td></tr></table>';
      expect(htmlToPlainText(html, { layoutTables: 'unwrap' })).toBe('Cap\n\na');
    });
  });

  describe('images', () => {
    const html =
      '<h1><img src="https://x.test/logo.png" alt=""></h1>' +
      '<p>Hi <img src="cid:part1@x" alt="Chart"> there ' +
      '<a href="https://x.test/home"><img src="https://x.test/icon.png" alt=""></a> ' +
      '<a href="https://x.test/shop"><img src="https://x.test/b.png" alt="Shop now"></a></p>';

    it("'alt' keeps alt text, and drops links and headings left empty", () => {
      expect(htmlToMarkdown(html, { images: 'alt' })).toBe(
        'Hi Chart there [Shop now](https://x.test/shop)\n',
      );
    });

    it("'drop' removes images", () => {
      expect(htmlToMarkdown(html, { images: 'drop' })).toBe('Hi there\n');
    });

    it('hands a resolver each image as written, before sanitizing', () => {
      const seen: HtmlImageInfo[] = [];
      const md = htmlToMarkdown(html, {
        images: (image) => {
          seen.push(image);
          if (image.src.startsWith('cid:')) {
            return { action: 'image', url: 'attachment:chart.png' };
          }
          return image.alt ? { action: 'text', text: `[${image.alt}]` } : { action: 'drop' };
        },
      });
      expect(seen.map((i) => i.src)).toEqual([
        'https://x.test/logo.png',
        'cid:part1@x',
        'https://x.test/icon.png',
        'https://x.test/b.png',
      ]);
      expect(seen[1]).toEqual({ src: 'cid:part1@x', alt: 'Chart' });
      expect(urlsOf(md)).toEqual(['attachment:chart.png', 'https://x.test/shop']);
      expect(md).toMatch(
        /^Hi !\[Chart\]\(.+\) there \[\\\[Shop now\\\]\]\(https:\/\/x\.test\/shop\)\n$/,
      );
    });

    it('reports declared sizes from attributes or inline style', () => {
      const seen: HtmlImageInfo[] = [];
      htmlToMarkdown('<img src="a.png" width="40" style="height: 30px" title=" T ">', {
        images: (image) => {
          seen.push(image);
          return { action: 'drop' };
        },
      });
      expect(seen).toEqual([{ src: 'a.png', alt: '', title: 'T', width: 40, height: 30 }]);
    });

    it('never writes a script URL a resolver returns', () => {
      const md = htmlToMarkdown('<img src="a.png" alt="a">', {
        images: () => ({ action: 'image', url: 'javascript:alert(1)' }),
      });
      expect(md).toBe('');
    });

    it('ignores a decision index the document wrote itself', () => {
      const md = htmlToMarkdown(
        '<img src="a.png" data-squisq-image="1"><img src="b.png" data-squisq-image="0">',
        { images: (image) => ({ action: 'text', text: image.src }) },
      );
      expect(md).toBe('a.png b.png\n');
    });

    it('does not ask about images that are hidden or pixels', () => {
      const seen: string[] = [];
      htmlToMarkdown(
        '<div style="display:none"><img src="hidden.png"></div><img src="px.gif" width="1">',
        {
          dropHidden: true,
          dropTrackingPixels: true,
          images: (image) => {
            seen.push(image.src);
            return { action: 'drop' };
          },
        },
      );
      expect(seen).toEqual([]);
    });
  });

  describe('baseUrl', () => {
    it('resolves relative links and images to http(s), leaving the rest', () => {
      const md = htmlToMarkdown(
        '<p><a href="/a?x=1">a</a> <a href="#top">top</a> <a href="mailto:x@y.test">m</a> ' +
          '<img src="img/b.png" alt="b"> <a href="//cdn.test/c">c</a></p>',
        { baseUrl: 'https://site.test/blog/post.html' },
      );
      expect(urlsOf(md)).toEqual([
        'https://site.test/a?x=1',
        '#top',
        'mailto:x@y.test',
        'https://site.test/blog/img/b.png',
        'https://cdn.test/c',
      ]);
    });
  });

  describe('oversize', () => {
    it("refuses by default and converts the first characters with 'truncate'", () => {
      const html = `<p>${'a'.repeat(50)}</p><p>later</p>`;
      expect(() => htmlToMarkdown(html, { maxInputChars: 20 })).toThrow(RangeError);
      expect(htmlToMarkdown(html, { maxInputChars: 20, oversize: 'truncate' })).toBe(
        `${'a'.repeat(17)}\n`,
      );
    });
  });

  describe('embeddedDocs', () => {
    const html =
      '<p>page</p><script data-squisq-doc="1">' +
      JSON.stringify({ articleId: 'x', duration: 1, blocks: [], audio: { segments: [] } }) +
      '</script>';

    it('imports the page, not an embedded document, when off', () => {
      expect(htmlToMarkdown(html, { embeddedDocs: false })).toBe('page\n');
    });
  });
});

describe('htmlToPlainText', () => {
  it('decodes entities, drops markup and head content, and separates blocks', () => {
    expect(
      htmlToPlainText(
        '<head><title>T</title></head><h1>AT&amp;T&nbsp;news</h1>' +
          '<p>One <a href="https://x.test">link</a><br>two</p><ul><li>a</li><li>b</li></ul>',
      ),
    ).toBe('AT&T news\n\nOne link\ntwo\n\na\nb');
  });

  it('writes images as their alt text unless told otherwise', () => {
    expect(htmlToPlainText('<p><img src="a.png" alt="Logo"> hi</p>')).toBe('Logo hi');
    expect(htmlToPlainText('<p><img src="a.png" alt="Logo"> hi</p>', { images: 'drop' })).toBe(
      'hi',
    );
  });

  it('returns nothing for markup with no text', () => {
    expect(htmlToPlainText('<div><span> </span></div>')).toBe('');
  });

  it('agrees with what the Markdown reads back as', () => {
    const md = htmlToMarkdown('<p>1. not a list &lt;b&gt;</p>');
    expect(parseMarkdown(md).children[0]?.type).toBe('paragraph');
    expect(htmlToPlainText('<p>1. not a list &lt;b&gt;</p>')).toBe('1. not a list <b>');
  });
});

import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, htmlToMarkdownDocSync } from '../html/import.js';

describe('htmlToMarkdown', () => {
  it('converts headings and paragraphs', () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Hello <strong>world</strong>.</p>');
    expect(md).toContain('# Title');
    expect(md).toContain('Hello **world**.');
  });

  it('converts links and inline code', () => {
    const md = htmlToMarkdown('<p>See <a href="https://x.test">site</a> and <code>npm i</code></p>');
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
    const md = htmlToMarkdown(
      '<p>safe</p><script>alert(1)</script><style>.x{color:red}</style>',
    );
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
});

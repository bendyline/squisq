import { describe, it, expect } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

// ---------------------------------------------------------------------------
// markdownToTiptap
// ---------------------------------------------------------------------------

describe('markdownToTiptap', () => {
  it('returns empty paragraph for empty input', () => {
    expect(markdownToTiptap('')).toBe('<p></p>');
    expect(markdownToTiptap('   ')).toBe('<p></p>');
  });

  it('converts a plain paragraph', () => {
    const html = markdownToTiptap('Hello world');
    expect(html).toContain('<p>');
    expect(html).toContain('Hello world');
  });

  it('converts headings h1-h3', () => {
    expect(markdownToTiptap('# Title')).toContain('<h1');
    expect(markdownToTiptap('## Subtitle')).toContain('<h2');
    expect(markdownToTiptap('### Section')).toContain('<h3');
  });

  it('converts bold text', () => {
    const html = markdownToTiptap('This is **bold** text');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('converts italic text', () => {
    const html = markdownToTiptap('This is *italic* text');
    expect(html).toContain('<em>italic</em>');
  });

  it('converts strikethrough text', () => {
    const html = markdownToTiptap('This is ~~deleted~~ text');
    expect(html).toContain('<s>deleted</s>');
  });

  it('converts inline code', () => {
    const html = markdownToTiptap('Use `console.log` here');
    expect(html).toContain('<code>console.log</code>');
  });

  it('converts links', () => {
    const html = markdownToTiptap('Visit [Example](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('Example');
  });

  it('converts images', () => {
    const html = markdownToTiptap('![Logo](logo.png)');
    expect(html).toContain('alt="Logo"');
    expect(html).toContain('src="logo.png"');
  });

  it('converts fenced code blocks', () => {
    const md = '```javascript\nconst x = 1;\n```';
    const html = markdownToTiptap(md);
    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
    expect(html).toContain('language-javascript');
    expect(html).toContain('const x = 1;');
  });

  it('converts unordered lists', () => {
    const md = '- Item one\n- Item two\n- Item three';
    const html = markdownToTiptap(md);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
    expect(html).toContain('Item one');
    expect(html).toContain('Item two');
  });

  it('converts ordered lists', () => {
    const md = '1. First\n2. Second\n3. Third';
    const html = markdownToTiptap(md);
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>');
    expect(html).toContain('First');
  });

  it('converts blockquotes', () => {
    const md = '> This is a quote';
    const html = markdownToTiptap(md);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a quote');
  });

  it('converts horizontal rules', () => {
    const md = 'Before\n\n---\n\nAfter';
    const html = markdownToTiptap(md);
    expect(html).toContain('<hr');
  });

  it('converts markdown tables', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const html = markdownToTiptap(md);
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<th>');
    expect(html).toContain('<td>');
  });

  it('handles table column alignment', () => {
    const md = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |';
    const html = markdownToTiptap(md);
    expect(html).toContain('text-align: left');
    expect(html).toContain('text-align: center');
    expect(html).toContain('text-align: right');
  });

  it('escapes HTML special characters in text', () => {
    const html = markdownToTiptap('Use <div> & "quotes"');
    expect(html).toContain('&lt;div&gt;');
    expect(html).toContain('&amp;');
  });

  it('normalizes \\r\\n line endings', () => {
    const html = markdownToTiptap('Line one\r\nLine two');
    // Should not contain raw \r
    expect(html).not.toContain('\r');
  });
});

// ---------------------------------------------------------------------------
// tiptapToMarkdown
// ---------------------------------------------------------------------------

describe('tiptapToMarkdown', () => {
  it('returns empty string for empty paragraph', () => {
    expect(tiptapToMarkdown('')).toBe('');
    expect(tiptapToMarkdown('<p></p>')).toBe('');
  });

  it('converts a paragraph to plain text', () => {
    const md = tiptapToMarkdown('<p>Hello world</p>');
    expect(md).toContain('Hello world');
  });

  it('converts headings', () => {
    expect(tiptapToMarkdown('<h1>Title</h1>')).toContain('# Title');
    expect(tiptapToMarkdown('<h2>Sub</h2>')).toContain('## Sub');
    expect(tiptapToMarkdown('<h3>Section</h3>')).toContain('### Section');
  });

  it('converts strong tags to bold markdown', () => {
    const md = tiptapToMarkdown('<p>This is <strong>bold</strong> text</p>');
    expect(md).toContain('**bold**');
  });

  it('converts em tags to italic markdown', () => {
    const md = tiptapToMarkdown('<p>This is <em>italic</em> text</p>');
    expect(md).toContain('*italic*');
  });

  it('converts s/del tags to strikethrough', () => {
    const md = tiptapToMarkdown('<p>This is <s>deleted</s> text</p>');
    expect(md).toContain('~~deleted~~');
  });

  it('converts code tags to inline code', () => {
    const md = tiptapToMarkdown('<p>Use <code>foo</code> here</p>');
    expect(md).toContain('`foo`');
  });

  it('converts links', () => {
    const md = tiptapToMarkdown('<p><a href="https://example.com">Example</a></p>');
    expect(md).toContain('[Example](https://example.com)');
  });

  it('converts code blocks with language', () => {
    const md = tiptapToMarkdown('<pre><code class="language-js">const x = 1;</code></pre>');
    expect(md).toContain('```js');
    expect(md).toContain('const x = 1;');
    expect(md).toContain('```');
  });

  it('converts code blocks without language', () => {
    const md = tiptapToMarkdown('<pre><code>plain code</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('plain code');
  });

  it('converts blockquotes', () => {
    const md = tiptapToMarkdown('<blockquote><p>A wise quote</p></blockquote>');
    expect(md).toContain('> ');
    expect(md).toContain('A wise quote');
  });

  it('converts horizontal rules', () => {
    const md = tiptapToMarkdown('<p>Before</p><hr><p>After</p>');
    expect(md).toContain('---');
  });

  it('converts unordered lists', () => {
    const md = tiptapToMarkdown('<ul><li><p>Alpha</p></li><li><p>Beta</p></li></ul>');
    expect(md).toContain('- Alpha');
    expect(md).toContain('- Beta');
  });

  it('converts ordered lists', () => {
    const md = tiptapToMarkdown('<ol><li><p>First</p></li><li><p>Second</p></li></ol>');
    expect(md).toContain('1. First');
    expect(md).toContain('2. Second');
  });

  it('converts tables', () => {
    const html =
      '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
      '<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>';
    const md = tiptapToMarkdown(html);
    expect(md).toContain('| Name | Age |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| Alice | 30 |');
  });

  it('preserves template annotations in headings', () => {
    const html = '<h2 data-template="statHighlight" data-template-params="stat=42%">Stats</h2>';
    const md = tiptapToMarkdown(html);
    expect(md).toContain('## Stats');
    expect(md).toContain('{[statHighlight');
    expect(md).toContain('stat=42%');
  });

  it('unescapes HTML entities', () => {
    const md = tiptapToMarkdown('<pre><code>&lt;div&gt; &amp; &quot;test&quot;</code></pre>');
    expect(md).toContain('<div>');
    expect(md).toContain('&');
    expect(md).toContain('"test"');
  });

  it('converts <br> to a hard line break (two trailing spaces)', () => {
    const md = tiptapToMarkdown('<p>line one<br>line two</p>');
    expect(md).toContain('line one  \nline two');
  });

  it('preserves paragraph break inside list items', () => {
    const md = tiptapToMarkdown(
      '<ul><li><p><strong>Title</strong></p><p>Description text</p></li></ul>',
    );
    expect(md).toContain('- **Title**');
    expect(md).toContain('  Description text');
  });

  it('preserves <br> hard break inside list items', () => {
    const md = tiptapToMarkdown('<ul><li><p>First line<br>Second line</p></li></ul>');
    expect(md).toContain('- First line  ');
    expect(md).toContain('  Second line');
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('round-trip: markdownToTiptap → tiptapToMarkdown', () => {
  const roundTrip = (md: string) => tiptapToMarkdown(markdownToTiptap(md));

  it('preserves plain text', () => {
    expect(roundTrip('Hello world')).toContain('Hello world');
  });

  it('preserves headings', () => {
    const result = roundTrip('## My Heading');
    expect(result).toContain('## My Heading');
  });

  it('preserves bold text', () => {
    expect(roundTrip('Some **bold** here')).toContain('**bold**');
  });

  it('preserves italic text', () => {
    expect(roundTrip('Some *italic* here')).toContain('*italic*');
  });

  it('preserves inline code', () => {
    expect(roundTrip('Use `code` here')).toContain('`code`');
  });

  it('preserves code blocks', () => {
    const md = '```js\nconst x = 1;\n```';
    const result = roundTrip(md);
    expect(result).toContain('```js');
    expect(result).toContain('const x = 1;');
  });

  it('preserves links', () => {
    const result = roundTrip('Click [here](https://example.com)');
    expect(result).toContain('[here](https://example.com)');
  });

  it('preserves blockquotes', () => {
    expect(roundTrip('> Important note')).toContain('> Important note');
  });

  it('preserves unordered lists', () => {
    const result = roundTrip('- Alpha\n- Beta');
    expect(result).toContain('- Alpha');
    expect(result).toContain('- Beta');
  });

  it('preserves ordered lists', () => {
    const result = roundTrip('1. First\n2. Second');
    expect(result).toContain('1. First');
    expect(result).toContain('2. Second');
  });
});

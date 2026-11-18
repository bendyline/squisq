import { describe, expect, it } from 'vitest';
import {
  extractPlainText,
  parseMarkdown,
  plainTextToMarkdown,
  plainTextToMarkdownDoc,
  type MarkdownInlineNode,
} from '../markdown/index.js';

/** The links a Markdown string reads back with. */
function linksOf(markdown: string): string[] {
  const urls: string[] = [];
  const visit = (nodes: readonly MarkdownInlineNode[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === 'link') urls.push(node.url);
      if ('children' in node) visit(node.children as MarkdownInlineNode[]);
    }
  };
  for (const block of parseMarkdown(markdown).children) {
    if (block.type === 'paragraph') visit(block.children);
  }
  return urls;
}

describe('plainTextToMarkdown', () => {
  it('reads back as the same text, whatever it looks like as Markdown', () => {
    const lines = [
      'be**t@outlook.com [be**t@outlook.com]',
      '# not a heading',
      '> not a quote',
      '1. not a list',
      '* not a bullet',
      '_x_ and <b>tag</b> and 2 * 3 = 6',
      '-----',
      '`tick`',
    ];
    const md = plainTextToMarkdown(lines.join('\n'), { linkify: false });
    const doc = parseMarkdown(md);
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]?.type).toBe('paragraph');
    expect(extractPlainText(doc).split('\n')).toEqual(lines);
  });

  it('keeps each line by default and reflows with soft breaks', () => {
    const text = 'first line\nsecond line\n\nnext paragraph';
    expect(plainTextToMarkdownDoc(text).children).toHaveLength(2);
    expect(extractPlainText(parseMarkdown(plainTextToMarkdown(text)).children[0]!)).toBe(
      'first line\nsecond line',
    );
    expect(plainTextToMarkdown(text, { lineBreaks: 'soft' })).toBe(
      'first line second line\n\nnext paragraph\n',
    );
  });

  it('treats lines of only whitespace as paragraph breaks and drops indentation', () => {
    const doc = plainTextToMarkdownDoc('  a\r\n \t \r\n   b  ');
    expect(doc.children.map((b) => extractPlainText(b))).toEqual(['a', 'b']);
  });

  it('links the address forms mail clients write in plain-text copies', () => {
    const gmail = 'Check activity\n<https://accounts.google.com/a?Email=x@gmail.com&c=1>';
    expect(linksOf(plainTextToMarkdown(gmail))).toEqual([
      'https://accounts.google.com/a?Email=x@gmail.com&c=1',
    ]);
    expect(plainTextToMarkdown(gmail)).not.toContain('\\<');

    const outlook = 'Review recent activity [https://account.microsoft.com/activity]';
    const md = plainTextToMarkdown(outlook);
    expect(linksOf(md)).toEqual(['https://account.microsoft.com/activity']);
    expect(extractPlainText(parseMarkdown(md))).toBe(
      'Review recent activity https://account.microsoft.com/activity',
    );
  });

  it('leaves sentence punctuation and unmatched brackets outside a bare address', () => {
    const md = plainTextToMarkdown(
      'See https://x.test/a. Or (https://x.test/b) or https://x.test/c_(d), or https://.',
    );
    expect(linksOf(md)).toEqual(['https://x.test/a', 'https://x.test/b', 'https://x.test/c_(d)']);
    expect(extractPlainText(parseMarkdown(md))).toBe(
      'See https://x.test/a. Or (https://x.test/b) or https://x.test/c_(d), or https://.',
    );
  });

  it('links only http(s), and leaves bracketed forms as written when linkify is off', () => {
    expect(linksOf(plainTextToMarkdown('ftp://x.test/a javascript:alert(1)'))).toEqual([]);
    const doc = plainTextToMarkdownDoc('Review [https://x.test/a] <https://x.test/b>', {
      linkify: false,
    });
    expect(doc.children[0]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', value: 'Review [https://x.test/a] <https://x.test/b>' }],
    });
  });

  it('returns nothing for empty text', () => {
    expect(plainTextToMarkdown('')).toBe('');
    expect(plainTextToMarkdownDoc('\n\n  \n').children).toEqual([]);
  });

  it('stays linear on hostile input', () => {
    const started = performance.now();
    plainTextToMarkdown(`${'<https://'.repeat(50_000)}\n${'['.repeat(200_000)}`);
    plainTextToMarkdown(`https://${')'.repeat(200_000)}`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

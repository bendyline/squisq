import { describe, expect, it } from 'vitest';
import { extractPlainText, parseMarkdown, stringifyMarkdown } from '../markdown/index.js';
import type { MarkdownDocument, MarkdownInlineNode } from '../markdown/types.js';

const prose = (children: MarkdownInlineNode[]): MarkdownDocument => ({
  type: 'document',
  children: [{ type: 'paragraph', children }],
});
const text = (value: string): MarkdownInlineNode => ({ type: 'text', value });

describe('literal Markdown serialization fidelity', () => {
  it('preserves dollars beside other escaped punctuation', () => {
    for (const value of ['The award $_ and $334.72.', '$[1]50,000 plus $132,607.68', '$$**$$$']) {
      const output = stringifyMarkdown(prose([text(value)]));
      expect(extractPlainText(parseMarkdown(output))).toBe(value);
    }
  });

  it('preserves directive-like text after emphasis and an OCR backslash before its boundary', () => {
    const doc = prose([
      { type: 'emphasis', children: [text('Miranda, ')] },
      text(':cferring to this.'),
      { type: 'emphasis', children: [text('County \\ ')] },
      text('next'),
    ]);
    expect(extractPlainText(parseMarkdown(stringifyMarkdown(doc)))).toBe(extractPlainText(doc));
  });

  it('does not backtrack across a long malformed OCR/template span', () => {
    const value = "department{[']s officials " + '"quoted testimony" '.repeat(1000);
    expect(extractPlainText(parseMarkdown(stringifyMarkdown(prose([text(value)]))))).toBe(value);
    const heading: MarkdownDocument = {
      type: 'document',
      children: [{ type: 'heading', depth: 1, children: [text('Title {label=' + value)] }],
    };
    expect(stringifyMarkdown(heading)).toContain('quoted testimony');
  });

  it('keeps actual math, directives, annotations and code functional', () => {
    const source =
      '# Title {[hero label="a: b, c"]}\n\n$E=mc^2$ and :note[hello] and `$literal :name\\\\{[bad]`.\n';
    const once = stringifyMarkdown(parseMarkdown(source));
    expect(stringifyMarkdown(parseMarkdown(once))).toBe(once);
    expect(once).toContain('$E=mc^2$');
    expect(once).toContain(':note[hello]');
    expect(once).toContain('{[hero label="a: b, c"]}');
  });
});

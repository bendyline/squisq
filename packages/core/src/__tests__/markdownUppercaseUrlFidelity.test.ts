import { describe, expect, it } from 'vitest';
import { extractPlainText, parseMarkdown, stringifyMarkdown } from '../markdown/index.js';
import type { MarkdownDocument, MarkdownInlineNode } from '../markdown/types.js';

const prose = (children: MarkdownInlineNode[]): MarkdownDocument => ({
  type: 'document',
  children: [{ type: 'paragraph', children }],
});

describe('uppercase HTTP URL serialization fidelity', () => {
  it.each(['HTTP', 'HTTPS', 'HtTP', 'HtTPS'])(
    'preserves %s URLs in prose and emphasis',
    (protocol) => {
      const url = `${protocol}://WWW.EXAMPLE.ORG/SYSTEM/FILES/DOCUMENT.PDF`;
      for (const mark of [null, 'emphasis', 'strong'] as const) {
        const leaf: MarkdownInlineNode = { type: 'text', value: url };
        const doc = prose([mark ? { type: mark, children: [leaf] } : leaf]);
        for (const options of [undefined, { math: false, directive: false }, { gfm: false }]) {
          const output = stringifyMarkdown(doc, options);
          expect(extractPlainText(parseMarkdown(output, options))).toBe(url);
        }
      }
    },
  );

  it('preserves explicit destinations and code without escaping their uppercase scheme', () => {
    const url = 'HTTPS://WWW.EXAMPLE.ORG/PATH/DOCUMENT.PDF';
    const doc = prose([
      { type: 'link', url, children: [{ type: 'text', value: 'Source' }] },
      { type: 'text', value: ' ' },
      { type: 'inlineCode', value: url },
    ]);
    const output = stringifyMarkdown(doc);
    expect(output).toContain(`(${url})`);
    expect(output).toContain('`' + url + '`');
    expect(extractPlainText(parseMarkdown(output))).toBe(extractPlainText(doc));
  });
});

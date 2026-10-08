import { describe, expect, it } from 'vitest';
import { extractPlainText, parseMarkdown } from '@bendyline/squisq/markdown';
import { htmlToMarkdown } from '../html/import.js';

describe('empty imported HTML formatting', () => {
  it.each(['em', 'i', 'strong', 'b', 's', 'del', 'strike'])(
    'does not add visible delimiters for an empty %s tag',
    (tag) => {
      const markdown = htmlToMarkdown(`<p>A citation, <${tag}></${tag}>cert.</p>`);
      expect(extractPlainText(parseMarkdown(markdown))).toBe('A citation, cert.');
    },
  );

  it('keeps whitespace and real emphasis when empty marks are nested', () => {
    const markdown = htmlToMarkdown(
      '<p>Before<strong><em> </em></strong><s><span></span></s>after <em>real emphasis</em>.</p>',
    );
    expect(extractPlainText(parseMarkdown(markdown))).toBe('Before after real emphasis.');
    expect(markdown).toContain('*real emphasis*');
  });
});

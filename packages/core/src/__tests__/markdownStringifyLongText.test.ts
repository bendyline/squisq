import { describe, expect, it } from 'vitest';
import {
  extractPlainText,
  parseMarkdown,
  stringifyMarkdown,
  type MarkdownDocument,
  type MarkdownInlineNode,
} from '../markdown/index.js';
import {
  GROWTH_TEST_TIMEOUT_MS,
  LINEAR_GROWTH_LIMIT,
  growthOnFourfoldInput,
} from './scalingTestUtils.js';

const paragraphOf = (...children: MarkdownInlineNode[]): MarkdownDocument => ({
  type: 'document',
  children: [{ type: 'paragraph', children }],
});

/**
 * One sentence of prose that starts and ends on a letter and carries most of
 * the characters the writer escapes: emphasis, brackets, a heading or list
 * marker mid-line, a directive colon, an autolink-literal shape, dollars.
 */
const SENTENCE =
  'Alpha *beta* and _gamma_ [delta] # epsilon 1. zeta ' +
  'see:Eta www.theta.test iota@kappa.test $5 and 2 * 3 > 4 ~mu~ `nu` xi';

describe('stringifyMarkdown on long text', () => {
  it('writes long text exactly as it writes each part of it', () => {
    const short = stringifyMarkdown(paragraphOf({ type: 'text', value: SENTENCE })).trimEnd();
    const copies = 200;
    const long = stringifyMarkdown(
      paragraphOf({ type: 'text', value: Array(copies).fill(SENTENCE).join(' ') }),
    ).trimEnd();
    expect(long).toBe(Array(copies).fill(short).join(' '));
  });

  it('reads back as the same text after a forced cut', () => {
    const value = `${'['.repeat(3000)}${'*'.repeat(3000)}\n# not a heading ${'_'.repeat(3000)}`;
    const md = stringifyMarkdown(paragraphOf({ type: 'text', value }));
    expect(extractPlainText(parseMarkdown(md))).toBe(value);
  });

  it('leaves a long link text whole, so an autolink stays an autolink', () => {
    const url = `https://x.test/${'a'.repeat(5000)}`;
    const md = stringifyMarkdown(
      paragraphOf({ type: 'link', url, children: [{ type: 'text', value: url }] }),
    );
    expect(md.trimEnd()).toBe(`<${url}>`);
  });

  // Without the bounded escape context, 20,000 → 80,000 `[` in a label grew
  // the write about 16×.
  it(
    'stays linear on a long link label, and reads back the same',
    () => {
      const linkOf = (value: string) =>
        paragraphOf({ type: 'link', url: 'https://x.test', children: [{ type: 'text', value }] });
      expect(
        growthOnFourfoldInput((n) => stringifyMarkdown(linkOf('['.repeat(n))), 20_000),
      ).toBeLessThan(LINEAR_GROWTH_LIMIT);

      const value = '['.repeat(20_000);
      expect(extractPlainText(parseMarkdown(stringifyMarkdown(linkOf(value))))).toBe(value);
    },
    GROWTH_TEST_TIMEOUT_MS,
  );

  // Without text pieces, 20,000 → 80,000 of any of these grew the write 14–16×.
  it.each(['[', '*', '_'])(
    'stays linear on a run of escaped %s',
    (char) => {
      expect(
        growthOnFourfoldInput(
          (n) => stringifyMarkdown(paragraphOf({ type: 'text', value: char.repeat(n) })),
          20_000,
        ),
      ).toBeLessThan(LINEAR_GROWTH_LIMIT);
    },
    GROWTH_TEST_TIMEOUT_MS,
  );
});

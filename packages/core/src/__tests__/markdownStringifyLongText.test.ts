import { describe, expect, it } from 'vitest';
import {
  extractPlainText,
  parseMarkdown,
  stringifyMarkdown,
  type MarkdownDocument,
  type MarkdownInlineNode,
} from '../markdown/index.js';

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

  it('stays linear on a long link label, and reads back the same', () => {
    const value = '['.repeat(200_000);
    const started = performance.now();
    const md = stringifyMarkdown(
      paragraphOf({ type: 'link', url: 'https://x.test', children: [{ type: 'text', value }] }),
    );
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(extractPlainText(parseMarkdown(md))).toBe(value);
  });

  it('stays linear on runs of escaped characters', () => {
    const started = performance.now();
    for (const char of ['[', '*', '_']) {
      stringifyMarkdown(paragraphOf({ type: 'text', value: char.repeat(400_000) }));
    }
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});

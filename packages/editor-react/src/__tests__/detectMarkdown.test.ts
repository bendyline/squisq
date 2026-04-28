import { describe, it, expect } from 'vitest';
import { looksLikeMarkdown } from '../detectMarkdown';

describe('looksLikeMarkdown', () => {
  it('returns false for empty / trivial text', () => {
    expect(looksLikeMarkdown('')).toBe(false);
    expect(looksLikeMarkdown(' ')).toBe(false);
    expect(looksLikeMarkdown('Hello')).toBe(false);
  });

  it('returns false for plain prose', () => {
    expect(looksLikeMarkdown('Hello world. This is just a sentence.')).toBe(false);
    expect(looksLikeMarkdown('Multiple\nlines of\nplain text without any markdown syntax.')).toBe(
      false,
    );
  });

  it('detects ATX headings', () => {
    expect(looksLikeMarkdown('# Heading')).toBe(true);
    expect(looksLikeMarkdown('## Subheading')).toBe(true);
    expect(looksLikeMarkdown('###### Tiny heading')).toBe(true);
    expect(looksLikeMarkdown('Some intro\n\n## A heading\n\nBody text')).toBe(true);
  });

  it('does not treat hash in middle of line as a heading', () => {
    expect(looksLikeMarkdown('See issue #123 for details.')).toBe(false);
  });

  it('detects bullet lists', () => {
    expect(looksLikeMarkdown('- first\n- second\n- third')).toBe(true);
    expect(looksLikeMarkdown('* item one\n* item two')).toBe(true);
    expect(looksLikeMarkdown('+ plus item')).toBe(true);
  });

  it('detects ordered lists', () => {
    expect(looksLikeMarkdown('1. step one\n2. step two')).toBe(true);
  });

  it('detects blockquotes', () => {
    expect(looksLikeMarkdown('> A quoted line')).toBe(true);
  });

  it('detects code fences', () => {
    expect(looksLikeMarkdown('```\nconst x = 1;\n```')).toBe(true);
    expect(looksLikeMarkdown('```ts\nlet y = 2;\n```')).toBe(true);
  });

  it('detects GFM tables', () => {
    expect(looksLikeMarkdown('| Col1 | Col2 |\n| --- | --- |\n| a | b |')).toBe(true);
  });

  it('detects task lists', () => {
    expect(looksLikeMarkdown('- [ ] todo\n- [x] done')).toBe(true);
  });

  it('detects mixed inline patterns (2+ hits)', () => {
    expect(looksLikeMarkdown('**Important:** see [the docs](http://example.com) for more')).toBe(
      true,
    );
    expect(looksLikeMarkdown('Use `foo()` and read [the page](http://x.com)')).toBe(true);
  });

  it('does not trigger on a single inline pattern in plain prose', () => {
    expect(looksLikeMarkdown('Visit https://example.com or [the docs](http://docs.com)')).toBe(
      false,
    );
    expect(looksLikeMarkdown('She said `hello` to him')).toBe(false);
  });

  it('detects markdown with windows line endings', () => {
    expect(looksLikeMarkdown('# Heading\r\n\r\nBody text')).toBe(true);
  });
});

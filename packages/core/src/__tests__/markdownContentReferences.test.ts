import { describe, expect, it } from 'vitest';
import { rewriteMarkdownReferences } from '../markdown/contentReferences.js';

describe('rewriteMarkdownReferences', () => {
  it('preserves untouched source, frontmatter, and code exactly', () => {
    const source =
      '---\ntags: [one, two]\n---\n\nHeading\n=======\n\n[link](old.html)\n\n```md\n[code](old.html)\n```\n';
    const output = rewriteMarkdownReferences(source, {
      rewriteUrl: (url) => (url === 'old.html' ? 'new.md' : undefined),
    });
    expect(output).toBe(source.replace('[link](old.html)', '[link](new.md)'));
    expect(rewriteMarkdownReferences(source)).toBe(source);
  });
  it('rewrites definitions and drops inline and reference images with alt text', () => {
    const source =
      '[guide][ref] ![photo](photo.png) ![logo][logo]\n\n[ref]: old.html\n[logo]: logo.png\n';
    const output = rewriteMarkdownReferences(source, {
      images: 'omit',
      rewriteUrl: (url) => (url === 'old.html' ? 'new.md' : undefined),
    });
    expect(output).toContain('[guide][ref] photo logo');
    expect(output).toContain('[ref]: new.md');
  });
  it('handles nested image links without overlapping edits', () => {
    expect(
      rewriteMarkdownReferences('[![Logo](a.png)](old.html)\n', {
        images: 'omit',
        rewriteUrl: () => 'new.md',
      }),
    ).toBe('[Logo](new.md)\n');
  });
  it('handles raw HTML without changing surrounding prose', () => {
    const source = 'Before <a href="old.html">link</a> <img src="x.png" alt="Diagram"> after\n';
    const output = rewriteMarkdownReferences(source, {
      images: 'omit',
      rewriteUrl: (url) => (url === 'old.html' ? 'new.md' : undefined),
    });
    expect(output).toContain('href="new.md"');
    expect(output).toContain('Diagram after');
    expect(output).not.toContain('<img');
  });
  it('keeps fragments and Unicode intact and escapes image alt text', () => {
    expect(
      rewriteMarkdownReferences('日本 [link](old.html#part) ![a\\[b\\]](x.png)\n', {
        images: 'omit',
        rewriteUrl: (url) => url.replace('old.html', 'new.md'),
      }),
    ).toBe('日本 [link](new.md#part) a\\[b]\n');
  });
  it('retains picture alt text as text and leaves unrelated media alone', () => {
    const source =
      '<picture><source srcset="x.webp"><img src="x.png" alt="&lt;script&gt;"></picture>\n\n<audio><source src="sound.mp3"></audio>\n';
    const output = rewriteMarkdownReferences(source, { images: 'omit' });
    expect(output).not.toContain('<picture');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
    expect(output).toContain('<source src="sound.mp3">');
  });
  it('rewrites synthesized autolinks without losing surrounding source or formatting', () => {
    const source = 'Before  *www\\.example.org* and [guide](old.md) after.\n';
    const result = rewriteMarkdownReferences(source, {
      rewriteUrl: (url) =>
        url.startsWith('http://www.example.org')
          ? 'https://example.org/news'
          : url === 'old.md'
            ? 'new.md'
            : undefined,
    });
    expect(result).toBe(
      'Before  *[www.example.org](https://example.org/news)* and [guide](new.md) after.\n',
    );
    expect(rewriteMarkdownReferences(source)).toBe(source);
  });
});

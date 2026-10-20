import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { stringifyMarkdown } from '../markdown/stringify.js';
import { resolveWikiLinks, wikiLinkPath } from '../markdown/wikiLinks.js';
import { walkMarkdownTree as visit } from '../markdown/utils.js';

describe('wiki articles', () => {
  it('parses literal names and preserves source through serialization', () => {
    const source = '# [[foo]]\n\nSee [[reference/blah]] and [[my_notes]] and [[Café notes.md]].\n';
    expect(stringifyMarkdown(parseMarkdown(source)).trim()).toBe(source.trim());
  });
  it('leaves code and escaped brackets alone', () => {
    const source = '`[[foo]]` and \\[\\[bar]]\n\n```md\n[[baz]]\n```';
    const doc = parseMarkdown(source);
    const targets: string[] = [];
    visit(doc, (node) => {
      if (node.type === 'link' && node.wikiTarget) targets.push(node.wikiTarget);
    });
    expect(targets).toEqual([]);
    expect(stringifyMarkdown(doc)).toContain('`[[foo]]`');
  });
  it('allows descendants and refuses traversal, encoded paths and OS aliases', () => {
    expect(wikiLinkPath('reference/blah')).toBe('reference/blah.md');
    expect(wikiLinkPath('my notes.md')).toBe('my notes.md');
    expect(wikiLinkPath('foo', '.html')).toBe('foo.html');
    expect(wikiLinkPath('foo.html')).toBe('foo.html');
    expect(wikiLinkPath('foo.md', '.html')).toBe('foo.md');
    for (const target of [
      '../foo',
      'a/../foo',
      '/foo',
      '//host/a',
      'a\\b',
      'C:/foo',
      '%2e%2e/foo',
      'a%252fb',
      'foo?x',
      'a#x',
      'foo\0',
      'foo.',
      'con',
      'a//b',
      './foo',
      'a/',
    ]) {
      expect(wikiLinkPath(target), target).toBeNull();
    }
  });
  it('resolves only existing articles, deduplicates checks, and never changes source', async () => {
    const source = '[[foo]] [[missing]] [[foo]] [[space name]]';
    const parsed = parseMarkdown(source);
    const calls: string[] = [];
    const resolved = await resolveWikiLinks(parsed, async (target) => {
      calls.push(target);
      return target !== 'missing';
    });
    const urls: string[] = [];
    visit(resolved, (node) => {
      if (node.type === 'link') urls.push(node.url);
    });
    expect(urls).toEqual(['foo.md', '', 'foo.md', 'space%20name.md']);
    expect(calls).toEqual(['foo', 'missing', 'space name']);
    expect(stringifyMarkdown(resolved).trim()).toBe(source);
    expect(stringifyMarkdown(parsed).trim()).toBe(source);
  });
  it('uses host-resolved HTML URLs without changing wiki source', async () => {
    const source = '[[foo]] [[missing]]';
    const projected = await resolveWikiLinks(parseMarkdown(source), async (target) =>
      target === 'foo' ? '/reference/foo.html' : null,
    );
    const urls: string[] = [];
    visit(projected, (node) => {
      if (node.type === 'link') urls.push(node.url);
    });
    expect(urls).toEqual(['/reference/foo.html', '']);
    expect(stringifyMarkdown(projected).trim()).toBe(source);
    const unsafe = await resolveWikiLinks(
      parseMarkdown('[[foo]]'),
      async () => 'javascript:alert(1)',
    );
    visit(unsafe, (node) => {
      if (node.type === 'link') expect(node.url).toBe('');
    });
  });
  it('reuses an unchanged unresolved document', async () => {
    const document = parseMarkdown('[[missing]]');
    expect(await resolveWikiLinks(document, async () => false)).toBe(document);
  });
  it('does not classify permission failures as missing articles', async () => {
    await expect(
      resolveWikiLinks(parseMarkdown('[[foo]]'), async () => {
        throw new Error('permission');
      }),
    ).rejects.toThrow('permission');
  });
});

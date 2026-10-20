import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { WikiLinkSuggestion } from '@bendyline/squisq/markdown';
import { WikiLink } from '../WikiLink';
import { wikiQueryAt, validWikiSuggestions } from '../wikiSuggestions';

describe('wiki completion queries', () => {
  it('matches a target prefix, including an empty target and folders', () => {
    expect(wikiQueryAt('See [[')).toEqual({ from: 4, query: '' });
    expect(wikiQueryAt('See [[reference/')).toEqual({ from: 4, query: 'reference/' });
    expect(wikiQueryAt('`code` [[Café n')).toEqual({ from: 7, query: 'Café n' });
  });
  it('does not complete code, escaped openers, aliases, closed links or unsafe paths', () => {
    for (const source of [
      '`[[foo',
      '\\[[foo',
      '[[foo|label',
      '[[foo]]',
      '[[../foo',
      '[[/foo',
      '[[a%2fb',
    ]) {
      expect(wikiQueryAt(source), source).toBeNull();
    }
    expect(wikiQueryAt('[[' + 'a'.repeat(2049))).toBeNull();
  });
  it('bounds and validates host suggestions before inserting source', () => {
    expect(
      validWikiSuggestions([
        { target: 'reference/', label: 'reference/', kind: 'folder' },
        { target: 'foo', label: 'Foo', kind: 'article' },
        { target: '../out', label: 'Out', kind: 'article' },
        { target: 'bad/', label: 'Bad', kind: 'article' },
        { target: '/outside/', label: 'Outside', kind: 'folder' },
      ]),
    ).toEqual([
      { target: 'reference/', label: 'reference/', kind: 'folder' },
      { target: 'foo', label: 'Foo', kind: 'article' },
    ]);
    expect(
      validWikiSuggestions(
        Array.from({ length: 30 }, (_, i) => ({
          target: `a${i}`,
          label: `a${i}`,
          kind: 'article',
        })),
      ),
    ).toHaveLength(20);
  });
});

describe('wiki completion lifecycle', () => {
  it('discards slow results after further typing and after the editor is destroyed', async () => {
    const pending: { query: string; resolve: (items: WikiLinkSuggestion[]) => void }[] = [];
    const support = {
      exists: async () => true,
      open: vi.fn(async () => {}),
      suggest: (query: string) =>
        new Promise<WikiLinkSuggestion[]>((resolve) => pending.push({ query, resolve })),
    };
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, WikiLink.configure({ getSupport: () => support })],
      content: '<p>[[a</p>',
    });
    try {
      editor.commands.focus('end');
      await waitFor(() => expect(pending.at(-1)?.query).toBe('a'));
      editor.commands.insertContent('b');
      await waitFor(() => expect(pending.at(-1)?.query).toBe('ab'));
      pending.at(-1)!.resolve([]);
      pending[0].resolve([{ target: 'a', label: 'Old article', kind: 'article' }]);
      await Promise.resolve();
      expect(document.querySelector('.squisq-wiki-suggestions')).toBeNull();
      editor.commands.insertContent('c');
      await waitFor(() => expect(pending.at(-1)?.query).toBe('abc'));
      editor.destroy();
      pending.at(-1)!.resolve([{ target: 'abc', label: 'Destroyed article', kind: 'article' }]);
      await Promise.resolve();
      expect(document.querySelector('.squisq-wiki-suggestions')).toBeNull();
      expect(support.open).not.toHaveBeenCalled();
    } finally {
      if (!editor.isDestroyed) editor.destroy();
      element.remove();
    }
  });
});

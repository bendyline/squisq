/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FindHighlightExtension, updateTiptapFindHighlights } from '../find/FindHighlightExtension';
import { findProseMirrorMatches, findTextMatches, normalizeFindIndex } from '../find/findModel';

const editors: Editor[] = [];

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe('Find model', () => {
  it('finds case-insensitive literal matches and escapes punctuation', () => {
    expect(findTextMatches('A+b a+B A-b', 'a+b')).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);
  });

  it('wraps next and previous indexes', () => {
    expect(normalizeFindIndex(3, 3)).toBe(0);
    expect(normalizeFindIndex(-1, 3)).toBe(2);
    expect(normalizeFindIndex(10, 0)).toBe(0);
  });

  it('matches across adjacent formatted spans but not across paragraphs', () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: '<p>Hello <strong>wide</strong> world</p><p>Hello world</p>',
    });
    editors.push(editor);

    expect(findProseMirrorMatches(editor.state.doc, 'hello wide world')).toHaveLength(1);
    expect(findProseMirrorMatches(editor.state.doc, 'worldhello')).toHaveLength(0);
  });

  it('decorates every WYSIWYG match and marks the selected one separately', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, FindHighlightExtension],
      content: '<p>Alpha alpha ALPHA</p>',
    });
    editors.push(editor);

    expect(updateTiptapFindHighlights(editor, 'alpha', 1)).toBe(3);
    expect(element.querySelectorAll('.squisq-find-match')).toHaveLength(3);
    expect(element.querySelectorAll('.squisq-find-match--selected')).toHaveLength(1);
    expect(element.querySelector('.squisq-find-match--selected')?.textContent).toBe('alpha');
  });
});

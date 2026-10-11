/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  FindHighlightExtension,
  replaceAllTiptapFindMatches,
  replaceTiptapFindMatch,
  updateTiptapFindHighlights,
} from '../find/FindHighlightExtension';
import {
  findProseMirrorMatches,
  findTextMatches,
  nextFindIndexAfter,
  normalizeFindIndex,
} from '../find/findModel';

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

  it('honours Match case and Whole word', () => {
    const text = 'Cat cat category concat cat_x';
    expect(findTextMatches(text, 'cat')).toHaveLength(5);
    expect(findTextMatches(text, 'cat', { matchCase: true })).toHaveLength(4);
    expect(findTextMatches(text, 'cat', { wholeWord: true })).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);
    // Only word-character ends are constrained, so punctuation queries still match.
    expect(findTextMatches('use c++ or c++11', 'c++', { wholeWord: true })).toHaveLength(2);
    // Unicode case folding, and escaping that is valid under the `u` flag.
    expect(findTextMatches('ΣΟΦΌΣ σοφός', 'σοφός')).toHaveLength(2);
    expect(findTextMatches('a-b a/b', 'a-b')).toEqual([{ from: 0, to: 3 }]);
    expect(findTextMatches('a-b a/b', 'a/b')).toEqual([{ from: 4, to: 7 }]);
  });

  it('finds the next match at or after an offset, wrapping to the first', () => {
    const matches = findTextMatches('ab ab ab', 'ab');
    expect(nextFindIndexAfter(matches, 1)).toBe(1);
    expect(nextFindIndexAfter(matches, 3)).toBe(1);
    expect(nextFindIndexAfter(matches, 7)).toBe(0);
  });

  it('moves the editor selection to the current match only when asked', () => {
    const element = document.createElement('div');
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, FindHighlightExtension],
      content: '<p>one two one</p>',
    });
    editors.push(editor);
    const before = editor.state.selection.from;

    updateTiptapFindHighlights(editor, 'one', 1);
    expect(editor.state.selection.from).toBe(before);

    updateTiptapFindHighlights(editor, 'one', 1, {}, { select: true });
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('one');
    expect(from).toBeGreaterThan(5);
  });

  it('replaces the current match and moves past the inserted text', () => {
    const editor = new Editor({
      extensions: [StarterKit, FindHighlightExtension],
      content: '<p>a b a b a</p>',
    });
    editors.push(editor);

    // A replacement that contains the query must not be matched again in
    // place: both `a`s of the inserted `aa` are skipped.
    expect(replaceTiptapFindMatch(editor, 'a', 0, 'aa')).toBe(2);
    expect(editor.getText()).toBe('aa b a b a');
    expect(replaceTiptapFindMatch(editor, 'zzz', 0, 'x')).toBeNull();
  });

  it('replaces every match in a single undoable step', () => {
    const editor = new Editor({
      extensions: [StarterKit, FindHighlightExtension],
      content: '<p>Hello <strong>wide</strong> world, hello again</p>',
    });
    editors.push(editor);

    expect(replaceAllTiptapFindMatches(editor, 'hello', 'bye')).toBe(2);
    expect(editor.getText()).toBe('bye wide world, bye again');
    editor.commands.undo();
    expect(editor.getText()).toBe('Hello wide world, hello again');
    expect(replaceAllTiptapFindMatches(editor, 'world', 'there', { matchCase: true })).toBe(1);
  });
});

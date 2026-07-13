/**
 * Registry / decoration behavior of AsciiDiagramExtension: stable block
 * identity across unrelated edits AND self-inflicted fence rewrites — the
 * property that keeps the mounted canvas (pan/zoom) alive.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import {
  AsciiDiagramExtension,
  ASCII_DIAGRAM_KEY,
  findAsciiDiagramBlockPos,
  isAsciiSourceVisible,
  toggleAsciiSource,
} from '../AsciiDiagramExtension';
import { replaceAsciiFenceText } from '../asciiDiagramCommands';

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

const ART_A = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    │',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
].join('\n');

const ART_B = [
  '+-------+     +-------+',
  '| Left  | --> | Right |',
  '+-------+     +-------+',
].join('\n');

let editors: Editor[] = [];

function makeEditor(md: string, options?: { enabled?: boolean }): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      options ? AsciiDiagramExtension.configure(options) : AsciiDiagramExtension,
    ],
    content: markdownToTiptap(md),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
});

function entriesOf(editor: Editor) {
  return ASCII_DIAGRAM_KEY.getState(editor.state)?.entries ?? [];
}

describe('AsciiDiagramExtension registry', () => {
  it('registers each qualifying fence with a distinct id', () => {
    const editor = makeEditor(
      'Intro paragraph.\n\n```\n' + ART_A + '\n```\n\nBetween.\n\n```\n' + ART_B + '\n```\n',
    );
    const entries = entriesOf(editor);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it('ignores fences with a real language and non-diagram fences', () => {
    const editor = makeEditor(
      '```js\n' + ART_A + '\n```\n\n```\nplain code here\nmore\nlines\n```\n',
    );
    expect(entriesOf(editor)).toHaveLength(0);
  });

  it('keeps ids stable when content above changes (positions remap)', () => {
    const editor = makeEditor('First.\n\n```\n' + ART_A + '\n```\n');
    const [before] = entriesOf(editor);
    editor.commands.insertContentAt(0, '<p>inserted above</p>');
    const [after] = entriesOf(editor);
    expect(after.id).toBe(before.id);
    expect(after.pos).toBeGreaterThan(before.pos);
  });

  it('keeps the id across a self-inflicted fence rewrite', () => {
    const editor = makeEditor('```\n' + ART_A + '\n```\n');
    const [before] = entriesOf(editor);
    const rewritten = ART_A.replace('Beta', 'Delta');
    expect(replaceAsciiFenceText(editor, before.pos, rewritten)).toBe(true);
    const [after] = entriesOf(editor);
    expect(after.id).toBe(before.id);
    expect(findAsciiDiagramBlockPos(editor, before.id)).toBe(after.pos);
  });

  it('drops a block whose fence no longer parses at all', () => {
    const editor = makeEditor('```\n' + ART_A + '\n```\n');
    const [entry] = entriesOf(editor);
    replaceAsciiFenceText(editor, entry.pos, 'no boxes here\njust text\nlines');
    expect(entriesOf(editor)).toHaveLength(0);
  });

  it('hysteresis: a registered block degraded to ONE box stays interactive', () => {
    const editor = makeEditor('```\n' + ART_A + '\n```\n');
    const [entry] = entriesOf(editor);
    const oneBox = '┌────────┐\n│ Alpha  │\n└────────┘';
    replaceAsciiFenceText(editor, entry.pos, oneBox);
    const after = entriesOf(editor);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(entry.id);
  });

  it('toggleAsciiSource flips visibility without touching the doc', () => {
    const editor = makeEditor('```\n' + ART_A + '\n```\n');
    const [entry] = entriesOf(editor);
    const json = JSON.stringify(editor.state.doc.toJSON());
    expect(isAsciiSourceVisible(editor, entry.id)).toBe(false);
    toggleAsciiSource(editor, entry.id);
    expect(isAsciiSourceVisible(editor, entry.id)).toBe(true);
    toggleAsciiSource(editor, entry.id);
    expect(isAsciiSourceVisible(editor, entry.id)).toBe(false);
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(json);
  });

  it('enabled: false disables the plugin entirely', () => {
    const editor = makeEditor('```\n' + ART_A + '\n```\n', { enabled: false });
    expect(ASCII_DIAGRAM_KEY.getState(editor.state)).toBeUndefined();
  });
});

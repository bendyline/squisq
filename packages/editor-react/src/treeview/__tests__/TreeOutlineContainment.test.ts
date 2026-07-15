/**
 * BUG A regression: the tree outline mounts a real rename `<input>` inside a
 * ProseMirror widget decoration. Without containment on the widget host, the
 * browser/IME `beforeinput` / `paste` / `composition*` stream that originates
 * in that field reaches ProseMirror's handlers on `view.dom` and is ALSO
 * interpreted as text insertion at the document selection — the user renames
 * a tree node and the characters land in the document.
 *
 * The timeline family documented and fixed this; the tree and diagram hosts
 * stopped only `mousedown`/`keydown` and were left exposed.
 *
 * NOTE ON WHAT IS ASSERTED: jsdom does not run the browser's native
 * beforeinput → contentEditable insertion path, so "the doc JSON did not
 * change" passes even against the buggy code and would be a worthless test on
 * its own. The load-bearing assertion is therefore that the events never
 * ESCAPE the widget host to the editor's DOM, which is the precondition the
 * real browser bug depends on. The doc-unchanged check rides along as a
 * companion.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { markdownToTiptap } from '../../tiptapBridge';
import { TreeViewExtension } from '../TreeViewExtension';

/**
 * Hardcoded ON PURPOSE — see the note in fenceWidgets/__tests__/
 * fenceWidgetHost.test.ts. Deriving these from FENCE_WIDGET_CONTAINED_EVENTS
 * makes the test tautological against a shrunk constant.
 */
const TEXT_STREAM_EVENTS = [
  'beforeinput',
  'input',
  'paste',
  'cut',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'change',
];
const POINTER_KEY_EVENTS = ['pointerdown', 'mousedown', 'keydown', 'keyup'];

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class RO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = RO as unknown as typeof ResizeObserver;
  }
});

const TREE = ['src/', '├── a.ts', '└── sub/', '    └── b.ts'].join('\n');

let editors: Editor[] = [];

function makeEditor(md: string): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit.configure({ heading: false }), TreeViewExtension],
    content: markdownToTiptap(md),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
  document.body.innerHTML = '';
});

async function renameInputOf(editor: Editor): Promise<HTMLInputElement> {
  const root = editor.view.dom.parentElement ?? editor.view.dom;
  return await vi.waitFor(() => {
    const input = root.querySelector<HTMLInputElement>('input.squisq-tree-label');
    expect(input).not.toBeNull();
    return input!;
  });
}

describe('tree rename input containment (BUG A)', () => {
  it('mounts a rename input inside the widget host', async () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n');
    const input = await renameInputOf(editor);
    expect(input.closest('.squisq-tree-widget-host')).not.toBeNull();
  });

  it('does not leak typing / paste / IME composition to the editor DOM', async () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n');
    const input = await renameInputOf(editor);

    const escaped: string[] = [];
    for (const name of TEXT_STREAM_EVENTS) {
      editor.view.dom.addEventListener(name, () => escaped.push(name));
    }

    const docBefore = JSON.stringify(editor.state.doc.toJSON());

    // Typing a character, pasting, cutting, and an IME composition session.
    for (const name of TEXT_STREAM_EVENTS) {
      input.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
    }

    expect(escaped).toEqual([]);
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(docBefore);
  });

  it('still contains pointer and key events', async () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n');
    const input = await renameInputOf(editor);

    const escaped: string[] = [];
    for (const name of POINTER_KEY_EVENTS) {
      editor.view.dom.addEventListener(name, () => escaped.push(name));
    }
    for (const name of POINTER_KEY_EVENTS) {
      input.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
    }
    expect(escaped).toEqual([]);
  });
});

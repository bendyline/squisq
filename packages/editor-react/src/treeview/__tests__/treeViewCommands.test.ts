/**
 * Command pipeline through a REAL tiptap editor: fence text in →
 * applyTreeCommand → fence text out, verified by re-parsing.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseTree } from '@bendyline/squisq/doc';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { TreeViewExtension, TREEVIEW_KEY } from '../TreeViewExtension';
import { applyTreeCommand } from '../treeViewCommands';

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

const ART = ['src/', '├── index.ts', '├── utils/', '│   └── math.ts', '└── config.ts'].join('\n');

let editors: Editor[] = [];
function makeEditor(md: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      TreeViewExtension,
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

function firstId(editor: Editor): string {
  const s = TREEVIEW_KEY.getState(editor.state);
  expect(s?.entries.length).toBeGreaterThan(0);
  return s?.entries[0].id as string;
}
function fenceOf(editor: Editor): { text: string; language: string | null } {
  let text = '';
  let language: string | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock' && text === '') {
      text = node.textContent;
      language = (node.attrs as { language?: string | null }).language ?? null;
      return false;
    }
    return true;
  });
  return { text, language };
}
function labels(editor: Editor): string[] {
  const out: string[] = [];
  const walk = (ns: ReturnType<typeof parseTree>['roots']) =>
    ns.forEach((n) => (out.push(n.label), walk(n.children)));
  walk(parseTree(fenceOf(editor).text).roots);
  return out;
}

describe('applyTreeCommand', () => {
  it('renameItem rewrites the fence', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstId(editor);
    expect(
      applyTreeCommand(editor, id, { kind: 'renameItem', id: 'index-ts', label: 'main.ts' }),
    ).toBe(true);
    expect(labels(editor)).toContain('main.ts');
    expect(labels(editor)).not.toContain('index.ts');
  });

  it('addItem (child) grows the tree', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstId(editor);
    expect(
      applyTreeCommand(editor, id, {
        kind: 'addItem',
        targetId: 'utils',
        position: 'child',
        label: 'io.ts',
      }),
    ).toBe(true);
    const utils = parseTree(fenceOf(editor).text).roots[0].children.find(
      (n) => n.label === 'utils/',
    );
    expect(utils?.children.map((c) => c.label)).toContain('io.ts');
  });

  it('indentItem / outdentItem restructure', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstId(editor);
    // config.ts indents under utils/
    expect(applyTreeCommand(editor, id, { kind: 'indentItem', id: 'config-ts' })).toBe(true);
    const utils = parseTree(fenceOf(editor).text).roots[0].children.find(
      (n) => n.label === 'utils/',
    );
    expect(utils?.children.map((c) => c.label)).toContain('config.ts');
  });

  it('removeItem drops a node', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstId(editor);
    expect(applyTreeCommand(editor, id, { kind: 'removeItem', id: 'config-ts' })).toBe(true);
    expect(labels(editor)).not.toContain('config.ts');
  });

  it('promotes the fence language to the explicit `tree` tag on edit', () => {
    // A once-edited tree should carry `language: 'tree'` so its identity
    // survives a later flatten → markdown → re-import round-trip.
    const editor = makeEditor('```text\n' + ART + '\n```\n');
    const id = firstId(editor);
    expect(fenceOf(editor).language).toBe('text');
    applyTreeCommand(editor, id, { kind: 'renameItem', id: 'index-ts', label: 'app.ts' });
    expect(fenceOf(editor).language).toBe('tree');
  });

  it('keeps the block id stable across the language-promotion rewrite', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstId(editor);
    applyTreeCommand(editor, id, { kind: 'renameItem', id: 'index-ts', label: 'app.ts' });
    expect(firstId(editor)).toBe(id);
    expect(fenceOf(editor).language).toBe('tree');
  });

  it('one undo restores the original fence bytes', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstId(editor);
    const before = fenceOf(editor).text;
    applyTreeCommand(editor, id, { kind: 'renameItem', id: 'index-ts', label: 'app.ts' });
    expect(fenceOf(editor).text).not.toBe(before);
    editor.commands.undo();
    expect(fenceOf(editor).text).toBe(before);
  });

  it('no-op commands leave the document untouched', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    const id = firstId(editor);
    const json = JSON.stringify(editor.state.doc.toJSON());
    expect(applyTreeCommand(editor, id, { kind: 'indentItem', id: 'src' })).toBe(false); // root
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(json);
  });

  it('returns false for an unknown block id', () => {
    const editor = makeEditor('```\n' + ART + '\n```\n');
    expect(applyTreeCommand(editor, 'tree-999', { kind: 'removeItem', id: 'index-ts' })).toBe(
      false,
    );
  });
});

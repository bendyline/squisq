/**
 * Registry / decoration behavior of TreeViewExtension + mutual exclusion
 * with the diagram extension.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { markdownToTiptap } from '../../tiptapBridge';
import { HeadingWithTemplate } from '../../TemplateAnnotation';
import { TreeViewExtension, TREEVIEW_KEY, findTreeBlockPos } from '../TreeViewExtension';
import { AsciiDiagramExtension, ASCII_DIAGRAM_KEY } from '../../asciiDiagram/AsciiDiagramExtension';
import { replaceAsciiFenceText } from '../../asciiDiagram/asciiDiagramCommands';

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
const TREE_B = ['docs/', '├── guide.md', '└── api.md'].join('\n');
const DIAGRAM = [
  '┌────────┐',
  '│ Alpha  │',
  '└───┬────┘',
  '    ▼',
  '┌────────┐',
  '│ Beta   │',
  '└────────┘',
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
      AsciiDiagramExtension,
      options ? TreeViewExtension.configure(options) : TreeViewExtension,
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

const treeEntries = (e: Editor) => TREEVIEW_KEY.getState(e.state)?.entries ?? [];
const diagramEntries = (e: Editor) => ASCII_DIAGRAM_KEY.getState(e.state)?.entries ?? [];

describe('TreeViewExtension registry', () => {
  it('registers each qualifying tree fence with a distinct id', () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n\nMid.\n\n```\n' + TREE_B + '\n```\n');
    const entries = treeEntries(editor);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).not.toBe(entries[1].id);
  });

  it('ignores real-language and non-tree fences', () => {
    const editor = makeEditor('```bash\n' + TREE + '\n```\n\n```\nplain code\nno tree\n```\n');
    expect(treeEntries(editor)).toHaveLength(0);
  });

  it('mutual exclusion: a box diagram gets the diagram widget, not the tree', () => {
    const editor = makeEditor('```\n' + DIAGRAM + '\n```\n');
    expect(treeEntries(editor)).toHaveLength(0);
    expect(diagramEntries(editor)).toHaveLength(1);
  });

  it('keeps ids stable when content above changes', () => {
    const editor = makeEditor('First.\n\n```\n' + TREE + '\n```\n');
    const [before] = treeEntries(editor);
    editor.commands.insertContentAt(0, '<p>inserted</p>');
    const [after] = treeEntries(editor);
    expect(after.id).toBe(before.id);
    expect(after.pos).toBeGreaterThan(before.pos);
  });

  it('keeps the id across a self-inflicted fence rewrite', () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n');
    const [before] = treeEntries(editor);
    expect(replaceAsciiFenceText(editor, before.pos, TREE.replace('a.ts', 'main.ts'))).toBe(true);
    const [after] = treeEntries(editor);
    expect(after.id).toBe(before.id);
    expect(findTreeBlockPos(editor, before.id)).toBe(after.pos);
  });

  it('hysteresis: degraded to a single node still stays interactive', () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n');
    const [entry] = treeEntries(editor);
    replaceAsciiFenceText(editor, entry.pos, 'src/\n└── only.ts');
    const after = treeEntries(editor);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(entry.id);
  });

  it('drops a block whose fence is rewritten into a box diagram', () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n');
    const [entry] = treeEntries(editor);
    replaceAsciiFenceText(editor, entry.pos, DIAGRAM);
    expect(treeEntries(editor)).toHaveLength(0);
    // The diagram extension now owns the fence.
    expect(diagramEntries(editor)).toHaveLength(1);
  });

  it('enabled: false disables the plugin', () => {
    const editor = makeEditor('```\n' + TREE + '\n```\n', { enabled: false });
    expect(TREEVIEW_KEY.getState(editor.state)).toBeUndefined();
  });
});

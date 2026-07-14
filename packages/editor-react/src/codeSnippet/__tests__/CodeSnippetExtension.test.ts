/** @vitest-environment jsdom */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownToTiptap, tiptapToMarkdown } from '../../tiptapBridge';
import { replaceCodeSnippetText } from '../codeSnippetCommands';
import {
  CODE_SNIPPET_KEY,
  CodeSnippetExtension,
  findCodeSnippetBlockPos,
} from '../CodeSnippetExtension';

vi.mock('../CodeSnippetWidget', () => ({
  CodeSnippetWidget: () => null,
}));

const editors: Editor[] = [];

function makeEditor(markdown: string, enabled = true): Editor {
  const editor = new Editor({
    extensions: [StarterKit, CodeSnippetExtension.configure({ enabled })],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function entriesOf(editor: Editor) {
  return CODE_SNIPPET_KEY.getState(editor.state)?.entries ?? [];
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe('CodeSnippetExtension', () => {
  it('claims all explicit ordinary code languages, including unknown ones', () => {
    const editor = makeEditor(
      '```typescript\nconst n = 1;\n```\n\n```kusto\nTable | take 5\n```\n',
    );
    expect(entriesOf(editor)).toHaveLength(2);
  });

  it('does not steal plain, Mermaid, diagram, tree, or timeline fences', () => {
    const editor = makeEditor(
      [
        '```text\nplain\n```',
        '```mermaid\nflowchart LR\n  a --> b\n```',
        '```diagram\n+---+\n| A |\n+---+\n```',
        '```tree\nsrc/\n└── index.ts\n```',
        '```timeline\nMilestones: ● Start ─►\n```',
        '```\nuntagged\n```',
        '',
      ].join('\n\n'),
    );
    expect(entriesOf(editor)).toHaveLength(0);
  });

  it('keeps a stable block id and rewrites only the fence body', () => {
    const editor = makeEditor('```typescript\nconst before = true;\n```\n');
    const [before] = entriesOf(editor);
    editor.commands.insertContentAt(0, '<p>Intro</p>');
    const [shifted] = entriesOf(editor);
    expect(shifted.id).toBe(before.id);
    expect(shifted.pos).toBeGreaterThan(before.pos);
    expect(findCodeSnippetBlockPos(editor, before.id)).toBe(shifted.pos);

    expect(replaceCodeSnippetText(editor, before.id, 'const after: number = 2;')).toBe(true);
    expect(tiptapToMarkdown(editor.getHTML())).toContain(
      '```typescript\nconst after: number = 2;\n```',
    );
  });

  it('supports clearing the Monaco model without losing the fence language', () => {
    const editor = makeEditor('```json\n{"key": true}\n```\n');
    const [entry] = entriesOf(editor);
    expect(replaceCodeSnippetText(editor, entry.id, '')).toBe(true);
    const node = editor.state.doc.nodeAt(findCodeSnippetBlockPos(editor, entry.id) ?? -1);
    expect(node?.textContent).toBe('');
    expect(node?.attrs.language).toBe('json');
  });

  it('round-trips the language tag and source byte-for-byte', () => {
    const markdown = '```typescript\nconst n: number = 1;\n```\n';
    const editor = makeEditor(markdown);
    expect(tiptapToMarkdown(editor.getHTML())).toBe(markdown);
  });

  it('can be disabled', () => {
    const editor = makeEditor('```typescript\nconst n = 1;\n```\n', false);
    expect(CODE_SNIPPET_KEY.getState(editor.state)).toBeUndefined();
  });
});

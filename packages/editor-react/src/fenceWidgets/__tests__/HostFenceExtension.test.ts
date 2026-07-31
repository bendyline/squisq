/** @vitest-environment jsdom */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import type { FenceRendererMap } from '@bendyline/squisq/fence';
import { markdownToTiptap, tiptapToMarkdown } from '../../tiptapBridge';
import { CODE_SNIPPET_KEY, CodeSnippetExtension } from '../../codeSnippet/CodeSnippetExtension';
import {
  HOST_FENCE_KEY,
  HostFenceExtension,
  findHostFenceBlockPos,
  replaceHostFenceText,
} from '../HostFenceExtension';

const RENDERERS: FenceRendererMap = {
  'gezel-action': () => null,
};

const editors: Editor[] = [];

function makeEditor(markdown: string, renderers: FenceRendererMap | null = RENDERERS): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit,
      CodeSnippetExtension.configure({
        reservedLanguages: renderers ? Object.keys(renderers) : [],
      }),
      HostFenceExtension.configure({
        renderers: () => renderers ?? undefined,
      }),
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function hostEntriesOf(editor: Editor) {
  return HOST_FENCE_KEY.getState(editor.state)?.entries ?? [];
}

function snippetEntriesOf(editor: Editor) {
  return CODE_SNIPPET_KEY.getState(editor.state)?.entries ?? [];
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe('HostFenceExtension', () => {
  it('claims registered fence languages and leaves the rest alone', () => {
    const editor = makeEditor(
      '```gezel-action\nkind: fire-craftbook\n```\n\n```typescript\nconst n = 1;\n```\n',
    );
    expect(hostEntriesOf(editor)).toHaveLength(1);
    // CodeSnippet keeps ordinary languages but not the reserved one.
    expect(snippetEntriesOf(editor)).toHaveLength(1);
  });

  it('without reservedLanguages, CodeSnippet claims the custom language (the land-grab this fixes)', () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        CodeSnippetExtension,
        HostFenceExtension.configure({ renderers: () => RENDERERS }),
      ],
      content: markdownToTiptap('```gezel-action\nkind: fire-craftbook\n```\n'),
    });
    editors.push(editor);
    expect(snippetEntriesOf(editor)).toHaveLength(1);
  });

  it('keeps a stable block id across unrelated edits', () => {
    const editor = makeEditor('```gezel-action\nkind: create-task\n```\n');
    const [before] = hostEntriesOf(editor);
    editor.commands.insertContentAt(0, '<p>Intro</p>');
    const [after] = hostEntriesOf(editor);
    expect(after.id).toBe(before.id);
    expect(after.pos).toBeGreaterThan(before.pos);
    expect(findHostFenceBlockPos(editor, before.id)).toBe(after.pos);
  });

  it('replaceHostFenceText rewrites the fence body in one transaction', () => {
    const editor = makeEditor('```gezel-action\nkind: create-task\n```\n');
    const [entry] = hostEntriesOf(editor);
    expect(replaceHostFenceText(editor, entry.id, 'kind: apply-edits')).toBe(true);
    expect(tiptapToMarkdown(editor.getHTML())).toContain('```gezel-action\nkind: apply-edits\n```');
  });

  it('refuses writes when the editor is read-only', () => {
    const editor = makeEditor('```gezel-action\nkind: create-task\n```\n');
    const [entry] = hostEntriesOf(editor);
    editor.setEditable(false);
    expect(replaceHostFenceText(editor, entry.id, 'kind: apply-edits')).toBe(false);
  });

  it('is inert without a renderers getter', () => {
    const editor = new Editor({
      extensions: [StarterKit, HostFenceExtension],
      content: markdownToTiptap('```gezel-action\nkind: fire-craftbook\n```\n'),
    });
    editors.push(editor);
    expect(HOST_FENCE_KEY.getState(editor.state)).toBeUndefined();
  });
});

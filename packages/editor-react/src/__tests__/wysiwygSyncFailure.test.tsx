/**
 * @vitest-environment jsdom
 *
 * A source that cannot be loaded into the Write view.
 *
 * The load used to set an "external update in progress" flag that only the
 * end of a successful load cleared. A throw left it set for good: Write kept
 * showing what the user typed while every edit was dropped before reaching
 * the document, so nothing was saved and Source showed the old text. Editing
 * now pauses visibly instead, and the next source to load resumes it.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditorContext } from '../EditorContext';
import type { EditorContextValue } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';

vi.mock('../tiptapBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tiptapBridge')>();
  return {
    ...actual,
    markdownToTiptap: (...args: Parameters<typeof actual.markdownToTiptap>) => {
      if (args[0].includes('UNLOADABLE')) throw new Error('cannot convert');
      return actual.markdownToTiptap(...args);
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const DOC = '## Plan\n\nFirst paragraph.\n';

async function mountWrite() {
  const ref: { ctx: EditorContextValue | null; editor: Editor | null } = {
    ctx: null,
    editor: null,
  };
  function Probe() {
    const ctx = useEditorContext();
    ref.ctx = ctx;
    ref.editor = ctx.tiptapEditor;
    return null;
  }
  render(
    <EditorProvider initialMarkdown={DOC} initialView="wysiwyg">
      <WysiwygEditor />
      <Probe />
    </EditorProvider>,
  );
  await screen.findByTestId('wysiwyg-editor');
  await waitFor(() => expect(ref.editor).not.toBeNull());
  return ref as { ctx: EditorContextValue; editor: Editor };
}

describe('Write view source load failure', () => {
  it('pauses editing visibly, drops no edit silently, and resumes on the next load', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ref = await mountWrite();
    const unloadable = '## Plan\n\nUNLOADABLE paragraph.\n';

    act(() => ref.ctx.setMarkdownSource(unloadable));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(ref.editor.isEditable).toBe(false);
    expect(logged).toHaveBeenCalled();

    // Tiptap still holds the previous text; nothing it does may overwrite the
    // source the editor failed to load.
    act(() => {
      ref.editor.commands.insertContentAt(1, 'stale ');
    });
    expect(ref.ctx.markdownSource).toBe(unloadable);

    const recovered = '## Plan\n\nRecovered paragraph.\n';
    act(() => ref.ctx.setMarkdownSource(recovered));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(ref.editor.isEditable).toBe(true);
    expect(ref.editor.getText()).toContain('Recovered paragraph.');

    act(() => {
      ref.editor.commands.insertContentAt(ref.editor.state.doc.content.size - 1, ' More.');
    });
    await waitFor(() => expect(ref.ctx.markdownSource).toContain('Recovered paragraph. More.'));
  });
});

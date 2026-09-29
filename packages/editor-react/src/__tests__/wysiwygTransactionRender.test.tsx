import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';

afterEach(cleanup);

let captured: Editor | null = null;

function EditorProbe() {
  const { tiptapEditor, markdownSource } = useEditorContext();
  captured = tiptapEditor;
  return <pre data-testid="source">{markdownSource}</pre>;
}

// A host sending a chat message hit React's maximum update depth inside
// Tiptap's per-transaction re-render subscriber: every transaction, including
// the decoration updates effects dispatch, synchronously re-rendered the editor
// and re-applied its options, which in turn could run those effects again.
describe('WysiwygEditor transactions', () => {
  it('does not re-render for a transaction that changes no React state', async () => {
    render(
      <EditorProvider initialMarkdown="Hello there" initialView="wysiwyg">
        <WysiwygEditor />
        <EditorProbe />
      </EditorProvider>,
    );
    await screen.findByTestId('wysiwyg-editor');
    await waitFor(() => expect(captured).not.toBeNull());
    const editor = captured!;
    const setOptions = vi.spyOn(editor, 'setOptions');

    for (let i = 0; i < 3; i++) {
      act(() => {
        editor.view.dispatch(editor.state.tr.setMeta('squisq-test-probe', i));
      });
    }

    expect(setOptions).not.toHaveBeenCalled();
  });
});

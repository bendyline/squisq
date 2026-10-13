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

describe('WysiwygEditor accessible input', () => {
  it('keeps the name, multiline and read-only state in sync without replacing the document', async () => {
    const view = render(
      <EditorProvider initialMarkdown="Keep this draft" initialView="wysiwyg">
        <WysiwygEditor />
        <EditorProbe />
      </EditorProvider>,
    );
    const input = await screen.findByRole('textbox', { name: 'Document editor' });
    expect(input.getAttribute('aria-multiline')).toBe('true');
    expect(input.getAttribute('aria-readonly')).toBe('false');
    await waitFor(() => expect(captured).not.toBeNull());
    const editor = captured!;
    act(() => {
      editor.commands.insertContent('More text. ');
    });
    expect(screen.getByRole('textbox', { name: 'Document editor' })).toBe(input);
    view.rerender(
      <EditorProvider initialMarkdown="Keep this draft" initialView="wysiwyg">
        <WysiwygEditor ariaLabel="Task description" readOnly />
        <EditorProbe />
      </EditorProvider>,
    );
    await waitFor(() => expect(input.getAttribute('aria-readonly')).toBe('true'));
    expect(screen.getByRole('textbox', { name: 'Task description' })).toBe(input);
    expect(captured).toBe(editor);
    expect(editor.getText()).toContain('Keep this draft');
    expect(editor.getText()).toContain('More text.');
  });
});

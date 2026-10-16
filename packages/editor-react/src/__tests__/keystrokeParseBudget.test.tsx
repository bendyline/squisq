/**
 * @vitest-environment jsdom
 *
 * Typing must not re-parse or re-convert the whole document per keystroke.
 * On a 12,000-word document one full parse cost ~110 ms, and three paths ran
 * on every key: the block navigator slicing the source while block mode was
 * off, the toolbar recomputing template recommendations while the caret sat
 * in a heading, and the Tiptap options object converting the mount-time body.
 * Together they made each keystroke take ~350 ms. The debounced parse in
 * EditorContext is the only full parse typing should schedule.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditorContext } from '../EditorContext';
import { Toolbar } from '../Toolbar';
import { WysiwygEditor } from '../WysiwygEditor';

const calls = vi.hoisted(() => ({ parseMarkdown: 0, markdownToTiptap: 0 }));

vi.mock('@bendyline/squisq/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq/markdown')>();
  return {
    ...actual,
    parseMarkdown: (...args: Parameters<typeof actual.parseMarkdown>) => {
      calls.parseMarkdown++;
      return actual.parseMarkdown(...args);
    },
  };
});

vi.mock('../tiptapBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tiptapBridge')>();
  return {
    ...actual,
    markdownToTiptap: (...args: Parameters<typeof actual.markdownToTiptap>) => {
      calls.markdownToTiptap++;
      return actual.markdownToTiptap(...args);
    },
  };
});

let captured: Editor | null = null;

function EditorProbe() {
  const { tiptapEditor, markdownSource } = useEditorContext();
  captured = tiptapEditor;
  return <pre data-testid="source">{markdownSource}</pre>;
}

beforeEach(() => {
  captured = null;
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  }
});

afterEach(cleanup);

describe('typing in WYSIWYG', () => {
  it('runs no full parse or Markdown-to-Tiptap conversion per keystroke', async () => {
    render(
      <EditorProvider
        initialMarkdown={'# Title\n\nAlpha.\n\n## Second\n\nBeta.\n'}
        initialView="wysiwyg"
        allowRecording={false}
      >
        <Toolbar />
        <WysiwygEditor />
        <EditorProbe />
      </EditorProvider>,
    );
    await screen.findByTestId('wysiwyg-editor');
    await waitFor(() => expect(captured).not.toBeNull());
    const editor = captured!;

    // Put the caret inside the title, where the toolbar offers templates.
    await act(async () => {
      editor.commands.setTextSelection(3);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    calls.parseMarkdown = 0;
    calls.markdownToTiptap = 0;

    for (let i = 0; i < 5; i++) {
      act(() => {
        editor.commands.insertContent('x');
      });
    }

    expect(screen.getByTestId('source').textContent).toContain('# Tixxxxxtle');
    expect(calls).toEqual({ parseMarkdown: 0, markdownToTiptap: 0 });
  });
});

/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../EditorContext';
import { Toolbar } from '../Toolbar';
import { tiptapToMarkdown } from '../tiptapBridge';

let currentContext: EditorContextValue | null = null;

function ContextProbe() {
  currentContext = useEditorContext();
  return null;
}

function context(): EditorContextValue {
  if (!currentContext) throw new Error('EditorContext has not mounted');
  return currentContext;
}

function monacoWithSelection(selectedText: string) {
  const selection = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: selectedText.split('\n').length,
    endColumn: 1,
  };
  const model = {
    getValueInRange: () => selectedText,
    getLineContent: () => selectedText.split('\n')[0] ?? '',
  };
  const disposable = { dispose: vi.fn() };
  const executeEdits = vi.fn();
  const editor = {
    getSelection: () => selection,
    getModel: () => model,
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    onDidChangeCursorPosition: () => disposable,
    onDidChangeModelContent: () => disposable,
    executeEdits,
    focus: vi.fn(),
  };
  return { editor, executeEdits, selection };
}

beforeEach(() => {
  currentContext = null;
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

describe('<Toolbar> selection conversion menu', () => {
  it('shows Convert above Insert and replaces a delimited Monaco selection', async () => {
    const source = 'Name,Role\nAda,Engineer\n';
    const { editor, executeEdits, selection } = monacoWithSelection(source);
    render(
      <EditorProvider initialMarkdown={source} initialView="raw" allowRecording={false}>
        <Toolbar />
        <ContextProbe />
      </EditorProvider>,
    );
    act(() => context().setMonacoEditor(editor as never));

    fireEvent.click(screen.getByLabelText('Insert'));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByText(/^(Convert|Insert)$/)
        .map((node) => node.textContent),
    ).toEqual(['Convert', 'Insert']);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Convert selection to Table' }));

    expect(executeEdits).toHaveBeenCalledWith('toolbar-convert-selection', [
      {
        range: selection,
        text: '| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n',
      },
    ]);
  });

  it('does not show Convert without selected text', async () => {
    const { editor } = monacoWithSelection('');
    render(
      <EditorProvider initialMarkdown="Intro" initialView="raw" allowRecording={false}>
        <Toolbar />
        <ContextProbe />
      </EditorProvider>,
    );
    act(() => context().setMonacoEditor(editor as never));

    fireEvent.click(screen.getByLabelText('Insert'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText('Convert')).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Convert selection to Table' })).toBeNull();
  });

  it('replaces fully selected Write paragraphs without leaving a blank paragraph', async () => {
    const editor = new Editor({
      extensions: [StarterKit, TaskList, TaskItem],
      content: '<p>First</p><p>Second</p><p>Third</p><h2>After</h2>',
    });
    const paragraphs: Array<{ pos: number; contentSize: number }> = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph') {
        paragraphs.push({ pos, contentSize: node.content.size });
      }
    });
    const first = paragraphs[0];
    const third = paragraphs[2];
    expect(first).toBeDefined();
    expect(third).toBeDefined();
    editor.commands.setTextSelection({
      from: first.pos + 1,
      to: third.pos + 1 + third.contentSize,
    });

    render(
      <EditorProvider
        initialMarkdown="First\n\nSecond\n\nThird\n\n## After"
        initialView="wysiwyg"
        allowRecording={false}
      >
        <Toolbar />
        <ContextProbe />
      </EditorProvider>,
    );
    act(() => context().setTiptapEditor(editor));

    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Convert selection to Task List' }),
    );

    await waitFor(() => {
      expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['taskList', 'heading']);
    });
    expect(tiptapToMarkdown(editor.getHTML())).toBe(
      '- [ ] First\n- [ ] Second\n- [ ] Third\n\n## After\n',
    );
    editor.destroy();
  });
});

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
    getStartPosition: () => ({ lineNumber: 1, column: 1 }),
  };
  let value = selectedText;
  const model = {
    getValue: () => value,
    getValueInRange: () => selectedText,
    getLineContent: () => selectedText.split('\n')[0] ?? '',
    getOffsetAt: () => 0,
    getPositionAt: (offset: number) => {
      const lines = value.slice(0, offset).split('\n');
      return { lineNumber: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
    },
  };
  const disposable = { dispose: vi.fn() };
  const executeEdits = vi.fn((_source: string, edits: Array<{ text: string }>) => {
    value = edits[0]?.text ?? value;
  });
  const setPosition = vi.fn();
  const revealPositionInCenterIfOutsideViewport = vi.fn();
  const editor = {
    getSelection: () => selection,
    getModel: () => model,
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    onDidChangeCursorPosition: () => disposable,
    onDidChangeModelContent: () => disposable,
    executeEdits,
    setPosition,
    revealPositionInCenterIfOutsideViewport,
    focus: vi.fn(),
  };
  return { editor, executeEdits, selection, setPosition };
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

  it('wraps the selected Monaco text in the chosen code-snippet language', async () => {
    const source = 'const answer = 42;';
    const { editor, executeEdits, selection } = monacoWithSelection(source);
    render(
      <EditorProvider initialMarkdown={source} initialView="raw" allowRecording={false}>
        <Toolbar />
        <ContextProbe />
      </EditorProvider>,
    );
    act(() => context().setMonacoEditor(editor as never));

    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert Code Snippet' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Insert JavaScript code snippet' }),
    );

    expect(executeEdits).toHaveBeenCalledWith('toolbar-code-snippet', [
      {
        range: selection,
        text: '\n```javascript\nconst answer = 42;\n```\n',
      },
    ]);
  });

  it('moves generic code from the toolbar to the top of the Code Snippet submenu', async () => {
    const source = 'const answer = 42;';
    const { editor, executeEdits, selection } = monacoWithSelection(source);
    render(
      <EditorProvider initialMarkdown={source} initialView="raw" allowRecording={false}>
        <Toolbar />
        <ContextProbe />
      </EditorProvider>,
    );
    act(() => context().setMonacoEditor(editor as never));

    expect(screen.queryByRole('button', { name: 'Code block' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert Code Snippet' }));

    const menu = await screen.findByRole('menu', { name: 'Code snippet language' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0].getAttribute('aria-label')).toBe('Insert Generic Code');
    fireEvent.click(items[0]);

    expect(executeEdits).toHaveBeenCalledWith('toolbar', [
      {
        range: selection,
        text: '```\nconst answer = 42;\n```',
      },
    ]);
  });

  it('places the Monaco caret after a newly inserted snippet starter', async () => {
    const { editor, setPosition } = monacoWithSelection('');
    render(
      <EditorProvider initialMarkdown="" initialView="raw" allowRecording={false}>
        <Toolbar />
        <ContextProbe />
      </EditorProvider>,
    );
    act(() => context().setMonacoEditor(editor as never));

    fireEvent.click(screen.getByLabelText('Insert'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert Code Snippet' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert JSON code snippet' }));

    expect(setPosition).toHaveBeenCalledWith({ lineNumber: 5, column: 2 });
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

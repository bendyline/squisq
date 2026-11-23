/**
 * @vitest-environment jsdom
 *
 * Toolbar actions in the Source view type their Markdown: an inline action
 * wraps the selection, a block action prefixes each selected line, and with
 * nothing selected the action inserts placeholder text and puts the caret
 * where it is filled in. Link opens the link dialog instead of typing.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../EditorContext';
import { Toolbar } from '../Toolbar';
import { appendedSourceMarkdown, applySourceAction } from '../toolbar/sourceActions';

interface Pos {
  lineNumber: number;
  column: number;
}
interface Range {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * A Monaco editor over a string, enough of one for the toolbar: the selection
 * runs from offset `from` to `to`, edits splice the text, the caret is
 * recorded.
 */
function fakeMonaco(text: string, from: number, to = from) {
  let value = text;
  let caret: number | null = null;
  const positionAt = (offset: number): Pos => {
    const lines = value.slice(0, offset).split('\n');
    return { lineNumber: lines.length, column: lines[lines.length - 1]!.length + 1 };
  };
  const offsetAt = (pos: Pos): number => {
    const lines = value.split('\n');
    let offset = 0;
    for (let i = 0; i < pos.lineNumber - 1; i++) offset += lines[i]!.length + 1;
    return offset + pos.column - 1;
  };
  const start = positionAt(from);
  const end = positionAt(to);
  const selection = {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
    getStartPosition: () => start,
    isEmpty: () => from === to,
  };
  const rangeOffsets = (r: Range) => [
    offsetAt({ lineNumber: r.startLineNumber, column: r.startColumn }),
    offsetAt({ lineNumber: r.endLineNumber, column: r.endColumn }),
  ];
  const model = {
    getValue: () => value,
    getValueInRange: (r: Range) => value.slice(...rangeOffsets(r)),
    getLineContent: (line: number) => value.split('\n')[line - 1] ?? '',
    getOffsetAt: offsetAt,
    getPositionAt: positionAt,
  };
  const executeEdits = vi.fn((_source: string, edits: Array<{ range: Range; text: string }>) => {
    for (const edit of edits) {
      const [a, b] = rangeOffsets(edit.range);
      value = value.slice(0, a) + edit.text + value.slice(b);
    }
    return true;
  });
  const disposable = { dispose: vi.fn() };
  const editor = {
    getSelection: () => selection,
    getModel: () => model,
    getPosition: () => start,
    onDidChangeCursorPosition: () => disposable,
    onDidChangeModelContent: () => disposable,
    executeEdits,
    setPosition: (pos: Pos) => {
      caret = offsetAt(pos);
    },
    revealPositionInCenterIfOutsideViewport: vi.fn(),
    focus: vi.fn(),
  };
  return {
    editor: editor as unknown as MonacoEditor.ICodeEditor,
    executeEdits,
    value: () => value,
    caret: () => caret,
  };
}

describe('applySourceAction', () => {
  it('wraps the selection in an inline action', () => {
    const monaco = fakeMonaco('say hello now', 4, 9);
    expect(applySourceAction(monaco.editor, 'bold')).toBeNull();
    expect(monaco.value()).toBe('say **hello** now');
    expect(monaco.executeEdits).toHaveBeenCalledTimes(1);
    expect(monaco.executeEdits.mock.calls[0]![0]).toBe('toolbar');
  });

  it('inserts placeholder text with nothing selected, caret at the placeholder', () => {
    const monaco = fakeMonaco('a ', 2);
    applySourceAction(monaco.editor, 'italic');
    expect(monaco.value()).toBe('a *italic text*');
    expect(monaco.caret()).toBe(3);
  });

  it('writes vertical alignment as inline HTML', () => {
    const monaco = fakeMonaco('x2', 1, 2);
    applySourceAction(monaco.editor, 'superscript');
    expect(monaco.value()).toBe('x<sup>2</sup>');
  });

  it('prefixes every selected line in a block action', () => {
    const monaco = fakeMonaco('one\ntwo', 0, 7);
    applySourceAction(monaco.editor, 'h2');
    expect(monaco.value()).toBe('## one\n## two');
  });

  it('fences the selection as a code block, or a placeholder with the caret inside', () => {
    const selected = fakeMonaco('let a;', 0, 6);
    applySourceAction(selected.editor, 'codeblock');
    expect(selected.value()).toBe('```\nlet a;\n```');

    const empty = fakeMonaco('', 0);
    applySourceAction(empty.editor, 'codeblock');
    expect(empty.value()).toBe('```\ncode\n```');
    expect(empty.caret()).toBe(4);
  });

  it('opens the link dialog on the selection, editing nothing', () => {
    const monaco = fakeMonaco('read the docs', 9, 13);
    expect(applySourceAction(monaco.editor, 'link')).toEqual({
      mode: 'insert',
      initialText: 'docs',
      initialUrl: '',
      rawRange: null,
    });
    expect(monaco.executeEdits).not.toHaveBeenCalled();
    expect(monaco.value()).toBe('read the docs');
  });

  it('edits the [text](url) under the caret', () => {
    const line = 'see [the docs](https://example.com) here';
    const monaco = fakeMonaco(line, 8);
    expect(applySourceAction(monaco.editor, 'link')).toEqual({
      mode: 'update',
      initialText: 'the docs',
      initialUrl: 'https://example.com',
      rawRange: {
        startLineNumber: 1,
        startColumn: 5,
        endLineNumber: 1,
        endColumn: 5 + '[the docs](https://example.com)'.length,
      },
    });
  });

  it('edits the [[wiki link]] under the caret', () => {
    const source = 'see [[Home Page|home]] here';
    const monaco = fakeMonaco(source, 9);
    const request = applySourceAction(monaco.editor, 'link');
    expect(request).toMatchObject({
      mode: 'update',
      initialText: 'home',
      initialUrl: 'Home Page',
      wikiSource: source,
      rawRange: { startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 23 },
    });
    expect(request?.wiki).toMatchObject({ from: 4, to: 22, target: 'Home Page', label: 'home' });
  });
});

describe('appendedSourceMarkdown', () => {
  it('gives the Markdown appended when there is no Monaco editor', () => {
    expect(appendedSourceMarkdown('bold')).toBe('**bold text**');
    expect(appendedSourceMarkdown('h2')).toBe('\n## Heading 2\n');
    expect(appendedSourceMarkdown('link')).toBe('[link text](url)');
    expect(appendedSourceMarkdown('drawing')).toBe('\n## Drawing {[drawing]}\n');
  });

  it('gives nothing for an action with no Markdown', () => {
    expect(appendedSourceMarkdown('emoji')).toBe('');
  });
});

describe('<Toolbar> in the Source view', () => {
  let ctx: EditorContextValue | null = null;
  function Probe() {
    ctx = useEditorContext();
    return null;
  }

  beforeEach(() => {
    ctx = null;
    if (typeof window.matchMedia !== 'function') {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
      });
    }
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  function mount(source: string) {
    render(
      <EditorProvider initialMarkdown={source} initialView="raw" allowRecording={false}>
        <Toolbar />
        <Probe />
      </EditorProvider>,
    );
  }

  it('types an action into Monaco', () => {
    const monaco = fakeMonaco('say hello', 4, 9);
    mount('say hello');
    act(() => ctx!.setMonacoEditor(monaco.editor as never));
    fireEvent.click(screen.getByRole('button', { name: 'Bold (Ctrl+B)' }));
    expect(monaco.value()).toBe('say **hello**');
  });

  it('opens the link dialog with what Link found', () => {
    const monaco = fakeMonaco('see [the docs](https://example.com)', 8);
    mount('see [the docs](https://example.com)');
    act(() => ctx!.setMonacoEditor(monaco.editor as never));
    // Ctrl+K from inside the Source editor, as the Link button would.
    const surface = document.body.appendChild(document.createElement('div'));
    surface.className = 'monaco-editor';
    act(() => {
      surface.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
      );
    });
    surface.remove();
    expect(screen.getByRole('dialog', { name: 'Edit link' })).toBeTruthy();
    expect(monaco.executeEdits).not.toHaveBeenCalled();
  });

  it('appends to the document when there is no Monaco editor', () => {
    mount('Intro');
    fireEvent.click(screen.getByRole('button', { name: 'Bold (Ctrl+B)' }));
    expect(ctx!.markdownSource).toBe('Intro**bold text**');
  });
});

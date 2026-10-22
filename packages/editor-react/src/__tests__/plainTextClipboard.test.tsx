/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { Selection, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { AlignedTableCell, AlignedTableHeader } from '../tiptap/alignedTableCells';
import { PlainTextClipboard } from '../PlainTextClipboard';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';

const RELEASE_NOTES = [
  'Can you talk about the new release of DocBlocks, including:',
  '',
  '- **Dictation** - narrate your PowerPoints into videos!',
  '- Text to speech',
  '- Local AI integration, which you can opt into',
  '  - review and summarize your document',
  '  - create summaries and note cards',
  '',
  'The AI features run on your own hardware.',
  '',
  'Talk about how easy it is to create content.',
].join('\n');

const editors: Editor[] = [];
afterEach(() => {
  act(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });
  cleanup();
  vi.unstubAllGlobals();
});

function makeEditor(markdown: string, html = markdownToTiptap(markdown)) {
  const editor = new Editor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table,
      TableRow,
      AlignedTableCell,
      AlignedTableHeader,
      PlainTextClipboard,
    ],
    content: html,
  });
  editors.push(editor);
  return editor;
}

/** Document position of `text`'s first character (or just past its end). */
function posOf(editor: Editor, text: string, end = false): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    const index = found < 0 && node.isText ? node.text!.indexOf(text) : -1;
    if (index >= 0) found = pos + index + (end ? text.length : 0);
  });
  if (found < 0) throw new Error(`"${text}" is not in the document`);
  return found;
}

/** The `text/plain` the editor writes for a selection, as a copy runs it. */
function copiedText(editor: Editor, from?: number, to?: number): string {
  const { doc } = editor.state;
  const selection = TextSelection.create(
    doc,
    from ?? Selection.atStart(doc).from,
    to ?? Selection.atEnd(doc).to,
  );
  const { view } = editor;
  return view.someProp('clipboardTextSerializer', (serialize) =>
    serialize(selection.content(), view),
  )!;
}

describe('plain-text clipboard', () => {
  it('writes one line per list item, with no runs of blank lines', () => {
    expect(copiedText(makeEditor(RELEASE_NOTES))).toBe(
      [
        'Can you talk about the new release of DocBlocks, including:',
        '',
        '- Dictation - narrate your PowerPoints into videos!',
        '- Text to speech',
        '- Local AI integration, which you can opt into',
        '  - review and summarize your document',
        '  - create summaries and note cards',
        '',
        'The AI features run on your own hardware.',
        '',
        'Talk about how easy it is to create content.',
      ].join('\n'),
    );
  });

  it('copies words within a list item without the bullet', () => {
    const editor = makeEditor(RELEASE_NOTES);
    expect(copiedText(editor, posOf(editor, 'narrate'), posOf(editor, 'your Power', true))).toBe(
      'narrate your Power',
    );
  });

  it('keeps a sublist indented when the selection starts inside it', () => {
    const editor = makeEditor(RELEASE_NOTES);
    expect(copiedText(editor, posOf(editor, 'review'), posOf(editor, 'hardware.', true))).toBe(
      [
        '  - review and summarize your document',
        '  - create summaries and note cards',
        '',
        'The AI features run on your own hardware.',
      ].join('\n'),
    );
  });

  it('numbers ordered items from their start, marks tasks, and indents hard breaks', () => {
    const tasks = markdownToTiptap('- [x] Shipped\n- [ ] Pending');
    const editor = makeEditor(
      '',
      `<ol start="3"><li><p>First</p></li><li><p>Second<br>continued</p></li></ol>${tasks}`,
    );
    expect(copiedText(editor)).toBe(
      ['3. First', '4. Second', '   continued', '', '- [x] Shipped', '- [ ] Pending'].join('\n'),
    );
  });

  it('writes a table as tab-separated rows, keeping empty cells', () => {
    const editor = makeEditor(
      ['| Name | Notes |', '| --- | --- |', '| A |  |', '| B | two |'].join('\n'),
    );
    expect(copiedText(editor)).toBe(['Name\tNotes', 'A\t', 'B\ttwo'].join('\n'));
  });
});

describe('copy and paste in the Write view', () => {
  async function mountWriteView(markdown: string) {
    const live: { ctx: EditorContextValue | null } = { ctx: null };
    function Probe() {
      live.ctx = useEditorContext();
      return null;
    }
    render(
      <EditorProvider initialMarkdown={markdown} initialView="wysiwyg">
        <WysiwygEditor />
        <Probe />
      </EditorProvider>,
    );
    await waitFor(() => expect(live.ctx?.tiptapEditor).toBeTruthy());
    return live.ctx!.tiptapEditor!;
  }

  function clipboardEvent(type: 'copy' | 'paste', data: Map<string, string>) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        clearData: () => data.clear(),
        setData: (format: string, value: string) => data.set(format, value),
        getData: (format: string) => data.get(format) ?? '',
      },
    });
    return event;
  }

  /** Puts the caret in a new empty paragraph after the document's last text. */
  function caretAfterLastLine(editor: Editor) {
    act(() => {
      editor.commands.setTextSelection(Selection.atEnd(editor.state.doc).to);
      editor.commands.splitBlock();
    });
  }

  function paste(editor: Editor, data: Map<string, string>) {
    act(() => {
      editor.view.dom.dispatchEvent(clipboardEvent('paste', data));
    });
  }

  it('copies plain lines, and pastes its own copy back with its formatting', async () => {
    const editor = await mountWriteView(RELEASE_NOTES);
    act(() => {
      editor.commands.setTextSelection({
        from: posOf(editor, 'Dictation'),
        to: posOf(editor, 'note cards', true),
      });
    });
    const data = new Map<string, string>();
    editor.view.dom.dispatchEvent(clipboardEvent('copy', data));
    expect(data.get('text/plain')).toBe(
      [
        '- Dictation - narrate your PowerPoints into videos!',
        '- Text to speech',
        '- Local AI integration, which you can opt into',
        '  - review and summarize your document',
        '  - create summaries and note cards',
      ].join('\n'),
    );

    caretAfterLastLine(editor);
    paste(editor, data);
    const markdown = tiptapToMarkdown(editor.getHTML());
    expect(markdown.split('- **Dictation** - narrate').length - 1).toBe(2);
    expect(markdown.split('  - create summaries and note cards').length - 1).toBe(2);
  });

  it('still reads pasted plain-text list lines as markdown', async () => {
    // The markdown branch pastes through view.pasteHTML(), which constructs a
    // ClipboardEvent; jsdom has none.
    vi.stubGlobal('ClipboardEvent', class extends Event {});
    const editor = await mountWriteView('Intro');
    caretAfterLastLine(editor);
    paste(editor, new Map([['text/plain', '- One\n- Two\n  - Nested']]));
    expect(tiptapToMarkdown(editor.getHTML()).trim()).toBe('Intro\n\n- One\n- Two\n  - Nested');
  });
});

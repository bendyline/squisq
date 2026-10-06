/** @vitest-environment jsdom */

/**
 * Literal insertion of dictated phrases + the interim caret indicator. Pins:
 * the spacing rule; that markdown-looking speech stays literal text in a real
 * Tiptap editor; one undo step per phrase even when phrases arrive inside
 * ProseMirror's grouping window; Monaco edits between undo stops; and that the
 * interim widget never reaches the document, `onUpdate`, or history.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { undoDepth } from '@tiptap/pm/history';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeDictatedInsertion,
  insertDictationIntoMonaco,
  insertDictationIntoTiptap,
  needsLeadingSpace,
  needsTrailingSpace,
  normalizeDictatedText,
} from '../dictationInsertion';
import {
  DictationExtension,
  dictationInterimLabel,
  setDictationInterim,
} from '../DictationExtension';
import { createMonacoDictationInterim } from '../monacoDictationInterim';
import { dictationInterimText } from '../useDictationController';

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

let editor: Editor | null = null;

function makeEditor(content: string, onUpdate?: () => void): Editor {
  editor = new Editor({
    extensions: [StarterKit, DictationExtension],
    content,
    ...(onUpdate ? { onUpdate } : {}),
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('spacing rule', () => {
  it('prepends a space after a word, never at a line/block start or after whitespace', () => {
    expect(needsLeadingSpace('d', 'next')).toBe(true);
    expect(needsLeadingSpace('.', 'Next')).toBe(true);
    expect(needsLeadingSpace(null, 'Start')).toBe(false);
    expect(needsLeadingSpace(' ', 'x')).toBe(false);
    expect(needsLeadingSpace('\t', 'x')).toBe(false);
    expect(needsLeadingSpace(' ', 'x')).toBe(false);
  });

  it('lets closing punctuation attach to the previous word', () => {
    expect(needsLeadingSpace('d', ', then')).toBe(false);
    expect(needsLeadingSpace('d', '.')).toBe(false);
    expect(needsLeadingSpace('d', '?')).toBe(false);
  });

  it('trims, collapses whitespace, and skips blank transcripts', () => {
    expect(normalizeDictatedText('  hello \n  world  ')).toBe('hello world');
    expect(composeDictatedInsertion('d', '   ')).toBeNull();
    expect(composeDictatedInsertion('d', '')).toBeNull();
    expect(composeDictatedInsertion('d', ' more ')).toEqual({ text: ' more', caret: 5 });
    expect(composeDictatedInsertion(null, ' First ')).toEqual({ text: 'First', caret: 5 });
  });

  it('adds a trailing space before a following word, leaving the caret before it', () => {
    expect(needsTrailingSpace(null)).toBe(false);
    expect(needsTrailingSpace(' ')).toBe(false);
    expect(needsTrailingSpace('.')).toBe(false);
    expect(needsTrailingSpace('w')).toBe(true);
    expect(composeDictatedInsertion(' ', 'new', 'w')).toEqual({ text: 'new ', caret: 3 });
    expect(composeDictatedInsertion('d', 'new', 'w')).toEqual({ text: ' new ', caret: 4 });
  });
});

describe('Write view (Tiptap) insertion', () => {
  it('inserts speech that looks like markdown as literal text', () => {
    const ed = makeEditor('<p>Note</p>');
    ed.commands.setTextSelection(5);
    expect(insertDictationIntoTiptap(ed, '# not a heading *or emphasis*')).toBe(true);
    const json = ed.getJSON();
    expect(json.content).toHaveLength(1);
    expect(json.content?.[0].type).toBe('paragraph');
    const text = json.content?.[0].content ?? [];
    expect(text).toHaveLength(1);
    expect(text[0].marks).toBeUndefined();
    expect(ed.state.doc.textContent).toBe('Note # not a heading *or emphasis*');
  });

  it('applies the spacing rule against the caret', () => {
    const ed = makeEditor('<p>Hello there</p><p></p>');
    ed.commands.setTextSelection(7); // after "Hello ", before "there"
    insertDictationIntoTiptap(ed, 'out');
    expect(ed.state.doc.child(0).textContent).toBe('Hello out there');
    // The caret sits after "out", so the next phrase continues with a space.
    insertDictationIntoTiptap(ed, 'again');
    expect(ed.state.doc.child(0).textContent).toBe('Hello out again there');
    // End of a word at the end of the block: one leading space only.
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize - 1);
    insertDictationIntoTiptap(ed, 'world');
    expect(ed.state.doc.child(0).textContent).toBe('Hello out again there world');
    // Start of an empty block: no leading space.
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize + 1);
    insertDictationIntoTiptap(ed, 'Second line');
    expect(ed.state.doc.child(1).textContent).toBe('Second line');
  });

  it('inserts at the end of a selection without replacing it', () => {
    const ed = makeEditor('<p>keep this</p>');
    ed.commands.setTextSelection({ from: 1, to: 5 }); // "keep"
    insertDictationIntoTiptap(ed, 'words');
    expect(ed.state.doc.textContent).toBe('keep words this');
    expect(ed.state.selection.empty).toBe(true);
  });

  it('makes each phrase exactly one undo step, even inside the grouping window', () => {
    const ed = makeEditor('<p>Start</p>');
    ed.commands.setTextSelection(6);
    const before = undoDepth(ed.state);
    insertDictationIntoTiptap(ed, 'one');
    insertDictationIntoTiptap(ed, 'two');
    expect(undoDepth(ed.state)).toBe(before + 2);
    expect(ed.state.doc.textContent).toBe('Start one two');
    ed.commands.undo();
    expect(ed.state.doc.textContent).toBe('Start one');
    ed.commands.undo();
    expect(ed.state.doc.textContent).toBe('Start');
  });

  it('keeps the user’s next keystroke out of the phrase’s undo step', () => {
    const ed = makeEditor('<p>Start</p>');
    ed.commands.setTextSelection(6);
    insertDictationIntoTiptap(ed, 'spoken');
    ed.commands.insertContent('!');
    ed.commands.undo();
    expect(ed.state.doc.textContent).toBe('Start spoken');
  });

  it('skips blank transcripts without touching history', () => {
    const ed = makeEditor('<p>Start</p>');
    const before = undoDepth(ed.state);
    expect(insertDictationIntoTiptap(ed, '   ')).toBe(false);
    expect(undoDepth(ed.state)).toBe(before);
    expect(ed.state.doc.textContent).toBe('Start');
  });
});

describe('Write view interim widget', () => {
  it('renders at the caret without touching the document, onUpdate, or history', () => {
    const onUpdate = vi.fn();
    const ed = makeEditor('<p>Hello</p>', onUpdate);
    const html = ed.getHTML();
    const depth = undoDepth(ed.state);

    setDictationInterim(ed, 'Listening…');
    const widget = ed.view.dom.querySelector('.squisq-dictation-interim');
    expect(widget?.textContent).toBe('Listening…');
    expect(widget?.getAttribute('contenteditable')).toBe('false');
    expect(dictationInterimLabel(ed.state)).toBe('Listening…');
    expect(ed.getHTML()).toBe(html);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(undoDepth(ed.state)).toBe(depth);

    setDictationInterim(ed, null);
    expect(ed.view.dom.querySelector('.squisq-dictation-interim')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('is a no-op on an editor without the extension', () => {
    const plain = new Editor({ extensions: [StarterKit], content: '<p>x</p>' });
    expect(() => setDictationInterim(plain, 'Listening…')).not.toThrow();
    expect(plain.view.dom.querySelector('.squisq-dictation-interim')).toBeNull();
    plain.destroy();
  });

  it('labels each session state', () => {
    expect(dictationInterimText('idle', 0)).toBeNull();
    expect(dictationInterimText('preparing', 0)).toBe('Starting…');
    expect(dictationInterimText('listening', 0)).toBe('Listening…');
    expect(dictationInterimText('listening', 1)).toBe('Transcribing…');
    expect(dictationInterimText('transcribing', 0)).toBe('Transcribing…');
  });
});

type FakeMonacoEditor = Parameters<typeof insertDictationIntoMonaco>[0];

function makeFakeMonaco(lines: string[], line: number, column: number) {
  const calls: string[] = [];
  const edits: { range: unknown; text: string }[] = [];
  let position = { lineNumber: line, column };
  const decorations: unknown[][] = [];
  const editorLike = {
    getModel: () => ({ getLineContent: (n: number) => lines[n - 1] ?? '' }),
    getSelection: () => ({
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    }),
    getPosition: () => position,
    setPosition: (next: { lineNumber: number; column: number }) => {
      position = next;
    },
    pushUndoStop: () => {
      calls.push('undo-stop');
      return true;
    },
    executeEdits: (_source: string, ops: { range: unknown; text: string }[]) => {
      calls.push('edit');
      edits.push(...ops);
      return true;
    },
    revealPositionInCenterIfOutsideViewport: () => undefined,
    hasTextFocus: () => true,
    focus: () => undefined,
    createDecorationsCollection: () => ({
      set: (next: unknown[]) => decorations.push(next),
      clear: () => decorations.push([]),
    }),
    onDidChangeCursorSelection: () => ({ dispose: () => undefined }),
  };
  return {
    editor: editorLike as unknown as FakeMonacoEditor,
    calls,
    edits,
    decorations,
    position: () => position,
  };
}

describe('Source view (Monaco) insertion', () => {
  it('inserts literal text between undo stops and moves the caret past it', () => {
    const fake = makeFakeMonaco(['Some text'], 1, 10);
    expect(insertDictationIntoMonaco(fake.editor, '**not bold**')).toBe(true);
    expect(fake.calls).toEqual(['undo-stop', 'edit', 'undo-stop']);
    expect(fake.edits).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 10 },
        text: ' **not bold**',
        forceMoveMarkers: true,
      },
    ]);
    expect(fake.position()).toEqual({ lineNumber: 1, column: 10 + ' **not bold**'.length });
  });

  it('omits the space at a line start or after whitespace, and skips blanks', () => {
    const atStart = makeFakeMonaco([''], 1, 1);
    insertDictationIntoMonaco(atStart.editor, 'Hello');
    expect(atStart.edits[0].text).toBe('Hello');

    const afterSpace = makeFakeMonaco(['Hi '], 1, 4);
    insertDictationIntoMonaco(afterSpace.editor, 'there');
    expect(afterSpace.edits[0].text).toBe('there');

    const blank = makeFakeMonaco(['Hi'], 1, 3);
    expect(insertDictationIntoMonaco(blank.editor, '  ')).toBe(false);
    expect(blank.calls).toEqual([]);
  });

  it('shows the interim label as injected after-text at the caret, then clears it', () => {
    const fake = makeFakeMonaco(['abc'], 1, 4);
    const interim = createMonacoDictationInterim(fake.editor);
    interim.update('Listening…');
    const shown = last(fake.decorations) as {
      range: unknown;
      options: { after: { content: string; inlineClassName: string } };
    }[];
    expect(shown[0].range).toEqual({
      startLineNumber: 1,
      startColumn: 4,
      endLineNumber: 1,
      endColumn: 4,
    });
    expect(shown[0].options.after.content).toBe('Listening…');
    expect(shown[0].options.after.inlineClassName).toContain('squisq-dictation-interim');
    interim.update(null);
    expect(last(fake.decorations)).toEqual([]);
    expect(fake.edits).toEqual([]);
    interim.dispose();
  });
});

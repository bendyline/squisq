/**
 * @vitest-environment jsdom
 *
 * The undoable source-edit actions, in Source view.
 *
 * Monaco's `setValue` clears its undo stack, so these actions must edit the
 * model in place between undo stops — including `replaceAll`, which version
 * reverts and host-applied rewrites (an AI review "Apply") go through.
 */
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import type { EditorContextValue } from '../EditorContext';

type MonacoDouble = Parameters<EditorContextValue['setMonacoEditor']>[0];

interface RecordedEdit {
  source: string;
  ops: Array<{
    range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    };
    text: string;
  }>;
}

const DOC = '# Title\n\nFirst paragraph.\n\n## Next\n\nSecond paragraph.\n';

function captureContext(layoutMode?: 'document' | 'block'): { current: EditorContextValue | null } {
  const ref: { current: EditorContextValue | null } = { current: null };
  function Probe() {
    ref.current = useEditorContext();
    return null;
  }
  render(
    <EditorProvider initialMarkdown={DOC} layoutMode={layoutMode}>
      <Probe />
    </EditorProvider>,
  );
  return ref;
}

/** A Monaco double over `text` that records undo stops, edits and setValue. */
function fakeMonaco(text: string, calls: string[], edits: RecordedEdit[], cursorOffset = 0) {
  const positionAt = (offset: number) => {
    const before = text.slice(0, offset);
    const lines = before.split('\n');
    return { lineNumber: lines.length, column: (lines[lines.length - 1] ?? '').length + 1 };
  };
  const cursor = positionAt(cursorOffset);
  return {
    getModel: () => ({
      getValue: () => text,
      getValueLength: () => text.length,
      getPositionAt: positionAt,
      getOffsetAt: (position: { lineNumber: number; column: number }) => {
        const lines = text.split('\n');
        let offset = 0;
        for (let i = 0; i < position.lineNumber - 1; i++) offset += (lines[i] ?? '').length + 1;
        return offset + position.column - 1;
      },
      getValueInRange: () => '',
    }),
    getSelection: () => ({
      startLineNumber: cursor.lineNumber,
      startColumn: cursor.column,
      endLineNumber: cursor.lineNumber,
      endColumn: cursor.column,
      getEndPosition: () => cursor,
    }),
    getPosition: () => cursor,
    pushUndoStop: () => calls.push('undoStop'),
    executeEdits: (source: string, ops: RecordedEdit['ops']) => {
      calls.push(`edit:${source}`);
      edits.push({ source, ops });
      return true;
    },
    setValue: () => calls.push('setValue'),
    revealLineInCenterIfOutsideViewport: () => calls.push('reveal'),
    focus: () => calls.push('focus'),
  } as unknown as MonacoDouble;
}

function sourceView(ctx: { current: EditorContextValue | null }, monaco: MonacoDouble) {
  act(() => {
    ctx.current?.setActiveView('raw');
    ctx.current?.setMonacoEditor(monaco);
  });
}

describe('applySourceEdits in Source view', () => {
  it('edits the model in place between undo stops, at the right positions', () => {
    const calls: string[] = [];
    const edits: RecordedEdit[] = [];
    const ctx = captureContext();
    sourceView(ctx, fakeMonaco(DOC, calls, edits));
    const offset = DOC.indexOf('\n\n## Next');
    act(() => {
      expect(
        ctx.current?.applySourceEdits([{ start: offset, end: offset, text: '\n\nInserted.' }], {
          baseSource: DOC,
        }),
      ).toBe(true);
    });
    expect(calls).toEqual(['undoStop', 'edit:squisq-source-edits', 'undoStop']);
    expect(edits[0]?.ops).toEqual([
      {
        range: { startLineNumber: 3, startColumn: 17, endLineNumber: 3, endColumn: 17 },
        text: '\n\nInserted.',
      },
    ]);
  });

  it('applies nothing when the document no longer matches the planned base', () => {
    const calls: string[] = [];
    const ctx = captureContext();
    sourceView(ctx, fakeMonaco(DOC, calls, []));
    act(() => {
      expect(
        ctx.current?.applySourceEdits([{ start: 0, end: 0, text: 'x' }], { baseSource: 'stale' }),
      ).toBe(false);
    });
    expect(calls).toEqual([]);
  });

  it('rejects overlapping or out-of-range edits without touching the model', () => {
    const calls: string[] = [];
    const ctx = captureContext();
    sourceView(ctx, fakeMonaco(DOC, calls, []));
    act(() => {
      expect(
        ctx.current?.applySourceEdits([
          { start: 0, end: 5, text: 'a' },
          { start: 3, end: 6, text: 'b' },
        ]),
      ).toBe(false);
      expect(ctx.current?.applySourceEdits([{ start: 0, end: 9999, text: '' }])).toBe(false);
    });
    expect(calls).toEqual([]);
  });

  it('refuses in Preview and outside the Document layout', () => {
    const ctx = captureContext();
    act(() => ctx.current?.setActiveView('preview'));
    expect(ctx.current?.applySourceEdits([{ start: 0, end: 0, text: 'x' }])).toBe(false);

    const block = captureContext('block');
    sourceView(block, fakeMonaco(DOC, [], []));
    expect(block.current?.applySourceEdits([{ start: 0, end: 0, text: 'x' }])).toBe(false);
  });
});

describe('replaceAll in Source view', () => {
  it('keeps Monaco undo history: a minimal in-place edit, never setValue', () => {
    const calls: string[] = [];
    const edits: RecordedEdit[] = [];
    const ctx = captureContext();
    sourceView(ctx, fakeMonaco(DOC, calls, edits));
    act(() => ctx.current?.replaceAll(DOC.replace('First paragraph.', 'Rewritten paragraph.')));
    expect(calls).toEqual(['undoStop', 'edit:squisq-source-edits', 'undoStop']);
    expect(calls).not.toContain('setValue');
    // Only the differing middle is replaced.
    expect(edits[0]?.ops[0]?.text).toBe('Rewritten');
  });
});

describe('insertBlockAfterCursor in Source view', () => {
  it('inserts after the cursor block as one undoable edit', () => {
    const calls: string[] = [];
    const edits: RecordedEdit[] = [];
    const ctx = captureContext();
    sourceView(ctx, fakeMonaco(DOC, calls, edits, DOC.indexOf('First')));
    act(() => {
      expect(ctx.current?.insertBlockAfterCursor('```js\nlet a = 1;\n```')).toBe(true);
    });
    expect(calls.slice(0, 3)).toEqual(['undoStop', 'edit:squisq-insert-block', 'undoStop']);
    expect(edits[0]?.ops[0]?.text).toBe('\n\n```js\nlet a = 1;\n```\n\n');
  });

  it('hands a builder the surrounding heading depths, and a null result cancels', () => {
    const calls: string[] = [];
    const ctx = captureContext();
    sourceView(ctx, fakeMonaco(DOC, calls, [], DOC.indexOf('First')));
    let seen: unknown = null;
    act(() => {
      expect(
        ctx.current?.insertBlockAfterCursor(
          (context) => {
            seen = context;
            return null;
          },
          { placement: 'sectionEnd' },
        ),
      ).toBe(false);
    });
    expect(seen).toEqual({ sectionDepth: 1, nextHeadingDepth: 2, maxHeadingDepth: 6 });
    expect(calls).toEqual([]);
  });

  it('refuses in Preview', () => {
    const ctx = captureContext();
    act(() => ctx.current?.setActiveView('preview'));
    expect(ctx.current?.insertBlockAfterCursor('text')).toBe(false);
  });
});

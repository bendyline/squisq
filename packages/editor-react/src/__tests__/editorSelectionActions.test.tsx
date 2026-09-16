/**
 * @vitest-environment jsdom
 *
 * The host-facing selection actions.
 *
 * These exist so a host can read and replace a selection without reaching into
 * Tiptap or Monaco. Two behaviours matter enough to pin: a replacement is ONE
 * undoable edit in both surfaces, and an action that cannot be performed says
 * so rather than silently dropping the caller's text.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import type { EditorContextValue } from '../EditorContext';

/** Capture the live context so a test can drive the actions directly. */
function captureContext(): { current: EditorContextValue | null } {
  const ref: { current: EditorContextValue | null } = { current: null };
  function Probe() {
    ref.current = useEditorContext();
    return null;
  }
  render(
    <EditorProvider initialMarkdown={'# Title\n\nFirst paragraph.\n\nSecond paragraph.\n'}>
      <Probe />
    </EditorProvider>,
  );
  return ref;
}

/** A Monaco double carrying only what these actions touch. */
function fakeMonaco(selectedText: string, calls: string[]) {
  const selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 };
  return {
    getSelection: () => selection,
    getModel: () => ({
      getValueInRange: () => selectedText,
      getValue: () => 'alpha\n\nbeta\n',
      getOffsetAt: () => 8,
    }),
    getPosition: () => ({ lineNumber: 3, column: 1 }),
    pushUndoStop: () => calls.push('undoStop'),
    executeEdits: (source: string) => calls.push(`edit:${source}`),
    focus: () => calls.push('focus'),
  } as unknown as Parameters<EditorContextValue['setMonacoEditor']>[0];
}

describe('EditorContext selection actions', () => {
  it('reports nothing to act on in Preview', () => {
    // Preview has no editable surface, so a host should hide its affordance
    // rather than be told an empty selection exists.
    const ctx = captureContext();
    act(() => ctx.current?.setActiveView('preview'));
    expect(ctx.current?.getSelection()).toBeNull();
  });

  it('refuses to replace in Preview instead of dropping the text', () => {
    const ctx = captureContext();
    act(() => ctx.current?.setActiveView('preview'));
    expect(ctx.current?.replaceSelection('new text')).toBe(false);
  });

  it('reads a Monaco selection in Source view', () => {
    const ctx = captureContext();
    act(() => {
      ctx.current?.setActiveView('raw');
      ctx.current?.setMonacoEditor(fakeMonaco('alpha', []));
    });
    expect(ctx.current?.getSelection()).toEqual({ view: 'raw', text: 'alpha', empty: false });
  });

  it('reports a bare caret as an empty selection, not as no selection', () => {
    const ctx = captureContext();
    act(() => {
      ctx.current?.setActiveView('raw');
      ctx.current?.setMonacoEditor(fakeMonaco('', []));
    });
    expect(ctx.current?.getSelection()).toEqual({ view: 'raw', text: '', empty: true });
  });

  it('brackets a Source replacement in undo stops, so one undo takes it back', () => {
    const calls: string[] = [];
    const ctx = captureContext();
    act(() => {
      ctx.current?.setActiveView('raw');
      ctx.current?.setMonacoEditor(fakeMonaco('alpha', calls));
    });
    act(() => {
      expect(ctx.current?.replaceSelection('beta')).toBe(true);
    });
    expect(calls).toEqual(['undoStop', 'edit:replace-selection', 'undoStop', 'focus']);
  });

  it('finds the block under the caret in Source view', () => {
    const ctx = captureContext();
    act(() => {
      ctx.current?.setActiveView('raw');
      ctx.current?.setMonacoEditor(fakeMonaco('', []));
    });
    // Offset 8 of 'alpha\n\nbeta\n' falls in the second block.
    expect(ctx.current?.getBlockAtCursor()?.text).toContain('beta');
  });

  it('returns no block in Write view rather than guessing one', () => {
    // There is no public mapping from a ProseMirror position back to a
    // markdown offset, and a plausible-but-wrong block would have a caller
    // edit the wrong paragraph.
    const ctx = captureContext();
    act(() => ctx.current?.setActiveView('wysiwyg'));
    expect(ctx.current?.getBlockAtCursor()).toBeNull();
  });

  it('survives an editor that does not report selection changes', () => {
    // A partial editor — a test double, or one predating the event — must
    // degrade to "no selection updates", never fail the mount.
    const ctx = captureContext();
    expect(() =>
      act(() => {
        ctx.current?.setMonacoEditor({
          getSelection: () => null,
          getModel: () => null,
        } as unknown as Parameters<EditorContextValue['setMonacoEditor']>[0]);
      }),
    ).not.toThrow();
    expect(ctx.current?.selectionVersion).toBe(0);
  });

  it('bumps the selection counter when the surface reports a change', () => {
    const listeners: Array<() => void> = [];
    const ctx = captureContext();
    act(() => {
      ctx.current?.setActiveView('raw');
      ctx.current?.setMonacoEditor({
        getSelection: () => null,
        getModel: () => null,
        onDidChangeCursorSelection: (fn: () => void) => {
          listeners.push(fn);
          return { dispose: vi.fn() };
        },
      } as unknown as Parameters<EditorContextValue['setMonacoEditor']>[0]);
    });
    const before = ctx.current?.selectionVersion ?? 0;
    act(() => listeners.forEach((fn) => fn()));
    expect(ctx.current?.selectionVersion).toBe(before + 1);
  });
});

/**
 * @vitest-environment jsdom
 *
 * Source shows the whole file in every layout.
 *
 * Block and Timeline are Write modes. Source used to follow them and show only
 * the active block, so on a phone a user on the title block opened Source,
 * saw nothing but the title, and believed everything after it was lost. Source
 * now always binds the full document; switching between the views carries the
 * block across instead of a scroll position.
 */
import { describe, expect, it } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { EditorProvider, useEditorContext } from '../EditorContext';
import type { EditorContextValue, EditorView } from '../EditorContext';

type MonacoDouble = Parameters<EditorContextValue['setMonacoEditor']>[0];

// Lines: 1 "# One", 3 "Alpha.", 5 "## Two", 7 "Beta.", 9 "## Three", 11 "Gamma."
const DOC = '# One\n\nAlpha.\n\n## Two\n\nBeta.\n\n## Three\n\nGamma.\n';

function capture(layoutMode: 'block' | 'timeline', initialView: EditorView) {
  const ref: { current: EditorContextValue | null } = { current: null };
  function Probe() {
    ref.current = useEditorContext();
    return null;
  }
  render(
    <EditorProvider initialMarkdown={DOC} layoutMode={layoutMode} initialView={initialView}>
      <Probe />
    </EditorProvider>,
  );
  return ref as { current: EditorContextValue };
}

/** A Monaco double that records where it was positioned and revealed. */
function fakeMonaco(caretLine = 1) {
  const calls: string[] = [];
  const editor = {
    getModel: () => ({ getValue: () => DOC }),
    getPosition: () => ({ lineNumber: caretLine, column: 1 }),
    setPosition: (position: { lineNumber: number }) => calls.push(`at:${position.lineNumber}`),
    revealLineNearTop: (line: number) => calls.push(`reveal:${line}`),
    focus: () => calls.push('focus'),
    onDidLayoutChange: () => ({ dispose: () => undefined }),
    onDidContentSizeChange: () => ({ dispose: () => undefined }),
    getDomNode: () => null,
  } as unknown as MonacoDouble;
  return { editor, calls };
}

describe('Source in a block layout', () => {
  it.each(['block', 'timeline'] as const)('binds the whole file in %s layout', (layout) => {
    const ctx = capture(layout, 'wysiwyg');
    expect(ctx.current.blockScoped).toBe(true);
    expect(ctx.current.editorSource).toBe('# One\n\nAlpha.\n\n');

    act(() => ctx.current.setActiveView('raw'));
    expect(ctx.current.editingView).toBe('raw');
    expect(ctx.current.blockScoped).toBe(false);
    expect(ctx.current.editorSource).toBe(DOC);
    // The chosen layout is kept for the return to Write.
    expect(ctx.current.layoutMode).toBe(layout);
  });

  it('opens Source at the block Write was showing, without focusing it', async () => {
    const ctx = capture('block', 'wysiwyg');
    act(() => ctx.current.goToBlock(1));
    expect(ctx.current.activeBlockStartLine).toBe(5);

    const monaco = fakeMonaco();
    act(() => ctx.current.setActiveView('raw'));
    act(() => ctx.current.setMonacoEditor(monaco.editor));
    await waitFor(() => expect(monaco.calls).toEqual(['at:5', 'reveal:5']));
  });

  it('opens Write on the block holding the Source caret', () => {
    const ctx = capture('block', 'raw');
    act(() => ctx.current.setMonacoEditor(fakeMonaco(11).editor));
    act(() => ctx.current.setActiveView('wysiwyg'));
    expect(ctx.current.blockScoped).toBe(true);
    expect(ctx.current.activeBlockKey).toBe(2);
    expect(ctx.current.editorSource).toBe('## Three\n\nGamma.\n');
  });

  it('writes Source edits to the whole document', () => {
    const ctx = capture('block', 'raw');
    const edited = DOC.replace('Gamma.', 'Gamma, edited.');
    act(() => ctx.current.setEditorSource(edited));
    expect(ctx.current.markdownSource).toBe(edited);
  });

  it('keeps the whole file behind Preview when Source was the editing view', () => {
    const ctx = capture('block', 'raw');
    act(() => ctx.current.setActiveView('preview'));
    expect(ctx.current.editingView).toBe('raw');
    expect(ctx.current.blockScoped).toBe(false);
    expect(ctx.current.editorSource).toBe(DOC);
  });

  it('keeps Write scoped behind Preview when Write was the editing view', () => {
    const ctx = capture('block', 'wysiwyg');
    act(() => ctx.current.setActiveView('preview'));
    expect(ctx.current.editingView).toBe('wysiwyg');
    expect(ctx.current.blockScoped).toBe(true);
    expect(ctx.current.editorSource).toBe('# One\n\nAlpha.\n\n');
  });
});

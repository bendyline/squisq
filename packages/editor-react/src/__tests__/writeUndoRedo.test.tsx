/**
 * @vitest-environment jsdom
 *
 * Undo and Redo in the Write view.
 *
 * The toolbar's Undo and Redo buttons step the Write editor's history and are
 * disabled while there is nothing to step. That history is only meaningful
 * for the text it was recorded on. The Blocks and Timeline layouts load a
 * different block into the same editor, and switching layouts swaps the whole
 * document for one block or back; each of those loads used to be an undo step
 * of its own, so ⌘Z right after moving from block 1 to block 2 wrote block 1's
 * text over block 2. The history now starts over whenever the editor is bound
 * to other text.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditorContext } from '../EditorContext';
import type { EditorContextValue, LayoutMode } from '../EditorContext';
import { Toolbar } from '../Toolbar';
import { WysiwygEditor } from '../WysiwygEditor';

afterEach(cleanup);

beforeAll(() => {
  // jsdom lacks matchMedia / ResizeObserver, which the Toolbar uses.
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

const DOC = '# One\n\nAlpha.\n\n## Two\n\nBeta.\n\n## Three\n\nGamma.\n';

type Live = { ctx: EditorContextValue; editor: Editor };

async function mount(
  layoutMode: LayoutMode = 'document',
  toolbar: { showFormattingControls?: boolean } = {},
): Promise<Live> {
  const ref: { ctx: EditorContextValue | null; editor: Editor | null } = {
    ctx: null,
    editor: null,
  };
  function Probe() {
    const ctx = useEditorContext();
    ref.ctx = ctx;
    ref.editor = ctx.tiptapEditor;
    return null;
  }
  render(
    <EditorProvider initialMarkdown={DOC} initialView="wysiwyg" layoutMode={layoutMode}>
      <Toolbar {...toolbar} />
      <WysiwygEditor />
      <Probe />
    </EditorProvider>,
  );
  await screen.findByTestId('wysiwyg-editor');
  await waitFor(() => expect(ref.editor).not.toBeNull());
  await settle();
  // The live ref: the context object changes on every render.
  return ref as Live;
}

/** Let queued loads (microtasks) and the React commits after them run. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const undoButton = () => screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const redoButton = () => screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;

/** Type `text` at the end of the paragraph that reads `paragraph`. */
async function typeAfter(live: Live, paragraph: string, text: string) {
  let end = -1;
  live.editor.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isText && node.text === paragraph) end = pos + paragraph.length;
  });
  if (end < 0) throw new Error(`No text "${paragraph}"`);
  act(() => {
    live.editor.chain().insertContentAt(end, text).run();
  });
  await settle();
}

async function undoInEditor(live: Live) {
  act(() => {
    live.editor.commands.undo();
  });
  await settle();
}

describe('Undo and Redo buttons', () => {
  it('are disabled until there is an edit, then step it back and forward', async () => {
    const live = await mount();
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);

    await typeAfter(live, 'Beta.', ' More.');
    expect(live.ctx.markdownSource).toContain('Beta. More.');
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);

    fireEvent.click(undoButton());
    await settle();
    expect(live.ctx.markdownSource).toBe(DOC);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);

    fireEvent.click(redoButton());
    await settle();
    expect(live.ctx.markdownSource).toContain('Beta. More.');
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
  });

  it('show in the Blocks and Timeline layouts, not in Summarize or Source', async () => {
    const live = await mount('block');
    expect(undoButton()).toBeTruthy();
    act(() => live.ctx.setLayoutMode('timeline'));
    await settle();
    expect(undoButton()).toBeTruthy();
    act(() => live.ctx.setLayoutMode('summary'));
    await settle();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    act(() => live.ctx.setLayoutMode('document'));
    await settle();
    expect(undoButton()).toBeTruthy();
    act(() => live.ctx.setActiveView('raw'));
    await settle();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('are left out with the formatting controls', async () => {
    await mount('document', { showFormattingControls: false });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redo' })).toBeNull();
  });

  it('are disabled while the editor is read-only', async () => {
    const live = await mount();
    await typeAfter(live, 'Beta.', ' More.');
    expect(undoButton().disabled).toBe(false);
    act(() => live.editor.setEditable(false));
    expect(undoButton().disabled).toBe(true);
  });
});

describe('Write view undo history', () => {
  it('starts over on another block, so undo cannot write one block over another', async () => {
    const live = await mount('block');
    await typeAfter(live, 'Alpha.', ' More.');
    expect(undoButton().disabled).toBe(false);

    act(() => live.ctx.goToBlock(1));
    await settle();
    expect(live.editor.getText()).toContain('Beta.');
    expect(undoButton().disabled).toBe(true);

    await undoInEditor(live);
    expect(live.ctx.markdownSource).toBe(DOC.replace('Alpha.', 'Alpha. More.'));
  });

  it.each([
    ['document', 'block'],
    ['block', 'document'],
  ] as const)('starts over on switching from %s to %s', async (from, to) => {
    const live = await mount(from);
    await typeAfter(live, 'Alpha.', ' More.');
    act(() => live.ctx.setLayoutMode(to));
    await settle();
    expect(undoButton().disabled).toBe(true);

    await undoInEditor(live);
    expect(live.ctx.markdownSource).toBe(DOC.replace('Alpha.', 'Alpha. More.'));
  });

  it('starts over when deleting a heading slides the next block under the card', async () => {
    const live = await mount('block');
    act(() => live.ctx.goToBlock(1));
    await settle();
    // Delete the "Two" heading: its body merges into block 1, and the block
    // index now names what was block 3.
    act(() => {
      live.editor
        .chain()
        .deleteRange({ from: 0, to: live.editor.state.doc.child(0).nodeSize })
        .run();
    });
    await settle();
    const merged = '# One\n\nAlpha.\n\nBeta.\n\n## Three\n\nGamma.\n';
    expect(live.ctx.markdownSource).toBe(merged);
    expect(live.editor.getText()).toContain('Gamma.');
    expect(undoButton().disabled).toBe(true);

    await undoInEditor(live);
    expect(live.ctx.markdownSource).toBe(merged);
  });

  it('keeps its history between Blocks and Timeline on the same block', async () => {
    const live = await mount('block');
    await typeAfter(live, 'Alpha.', ' More.');
    act(() => live.ctx.setLayoutMode('timeline'));
    await settle();
    expect(undoButton().disabled).toBe(false);

    fireEvent.click(undoButton());
    await settle();
    expect(live.ctx.markdownSource).toBe(DOC);
  });

  it('keeps an outside edit to the shown block undoable', async () => {
    const live = await mount('block');
    act(() => live.ctx.setMarkdownSource(DOC.replace('Alpha.', 'Alpha, edited.')));
    await settle();
    expect(live.editor.getText()).toContain('Alpha, edited.');
    expect(undoButton().disabled).toBe(false);

    fireEvent.click(undoButton());
    await settle();
    expect(live.ctx.markdownSource).toBe(DOC);
  });
});

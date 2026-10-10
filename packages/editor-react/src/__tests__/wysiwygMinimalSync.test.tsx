/**
 * @vitest-environment jsdom
 *
 * Source edits applied while the Write view is showing.
 *
 * An external change used to reload the whole Tiptap document, which reset
 * the caret and remounted every diagram widget. It now replaces only the
 * range that changed, as one undo step of its own.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorProvider, useEditorContext } from '../EditorContext';
import type { EditorContextValue } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';
import { insertLayoutBlock } from '../toolbar/sceneBlockInserts';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no ResizeObserver; the layout canvas widget observes its host.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const DOC = '## Plan\n\nFirst paragraph.\n\nSecond paragraph.\n\n## Next\n\nThird paragraph.\n';

async function mountWrite(markdown = DOC) {
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
    <EditorProvider initialMarkdown={markdown} initialView="wysiwyg">
      <WysiwygEditor />
      <Probe />
    </EditorProvider>,
  );
  await screen.findByTestId('wysiwyg-editor');
  await waitFor(() => expect(ref.editor).not.toBeNull());
  // Return the live ref: the context object changes on every render.
  return ref as { ctx: EditorContextValue; editor: Editor };
}

/** Put the caret inside the first top-level block whose text includes `text`. */
function caretIn(editor: Editor, text: string): number {
  let target = -1;
  editor.state.doc.forEach((node, offset) => {
    if (target < 0 && node.textContent.includes(text)) target = offset + 2;
  });
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)),
    );
  });
  return target;
}

function topLevelTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.forEach((node) => {
    types.push(
      node.type.name === 'heading'
        ? `h${String(node.attrs.level)}${node.attrs.dataTemplate ? `:${String(node.attrs.dataTemplate)}` : ''}`
        : node.type.name,
    );
  });
  return types;
}

describe('Write view source edits', () => {
  it('applies a source insert as a minimal change that keeps the caret, undone in one step', async () => {
    const live = await mountWrite();
    const { editor } = live;
    const caret = caretIn(editor, 'First');
    const offset = DOC.indexOf('Second paragraph.') + 'Second paragraph.'.length;
    act(() => {
      expect(
        live.ctx.applySourceEdits(
          [{ start: offset, end: offset, text: '\n\n```js\nlet a = 1;\n```' }],
          {
            baseSource: DOC,
          },
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(topLevelTypes(editor)).toContain('codeBlock'));
    expect(topLevelTypes(editor)).toEqual([
      'h2',
      'paragraph',
      'paragraph',
      'codeBlock',
      'h2',
      'paragraph',
    ]);
    expect(editor.state.selection.from).toBe(caret);

    act(() => {
      editor.commands.undo();
    });
    expect(topLevelTypes(editor)).not.toContain('codeBlock');
    expect(live.ctx.markdownSource).not.toContain('let a = 1;');
  });

  it('undoes metadata-only source edits without undoing narration or body text', async () => {
    const original = '{[audio src=take.webm anchor=document]}\n\n' + DOC;
    const live = await mountWrite(original);
    const next = '---\nsquisq-presentation: {"version":1}\n---\n' + original;
    act(() => {
      live.ctx.applySourceEdits([{ start: 0, end: original.length, text: next }], {
        baseSource: original,
      });
    });
    await waitFor(() =>
      expect(live.editor.state.doc.attrs.sourceFrontmatter).toContain('squisq-presentation'),
    );
    act(() => {
      live.editor.commands.undo();
    });
    await waitFor(() => expect(live.ctx.markdownSource).not.toContain('squisq-presentation'));
    expect(live.ctx.markdownSource).toContain('anchor=document');
    expect(live.ctx.markdownSource).toContain('First paragraph.');
    act(() => {
      live.editor.commands.redo();
    });
    await waitFor(() => expect(live.ctx.markdownSource).toContain('squisq-presentation'));
    expect(live.ctx.markdownSource).toContain('anchor=document');
  });

  it('keeps document frontmatter out of a block slice after changing layouts', async () => {
    const live = await mountWrite('---\nsquisq-theme: gezellig\n---\n\n' + DOC);
    act(() => {
      live.ctx.setLayoutMode('block');
    });
    await waitFor(() => expect(live.ctx.editorSource).not.toContain('squisq-theme'));
    act(() => {
      live.editor.commands.insertContent('Added words. ');
    });
    await waitFor(() => expect(live.ctx.markdownSource).toContain('Added words.'));
    expect(live.ctx.markdownSource.match(/squisq-theme/g)).toHaveLength(1);
    act(() => {
      live.ctx.setLayoutMode('document');
    });
    await waitFor(() =>
      expect(live.editor.state.doc.attrs.sourceFrontmatter).toContain('squisq-theme'),
    );
  });

  it.each(['block', 'timeline'] as const)(
    'keeps a newly inserted video mounted when switching to %s layout and back',
    async (layout) => {
      const live = await mountWrite('---\nsquisq-theme: gezellig\n---\n\n' + DOC);
      const { editor } = live;
      caretIn(editor, 'First');
      act(() => {
        editor.commands.insertContent('<video src="video/take.webm" controls width="480"></video>');
      });
      await waitFor(() => expect(live.ctx.markdownSource).toContain('<video'));
      const video = editor.view.dom.querySelector('video');
      expect(video).not.toBeNull();

      act(() => {
        live.ctx.setLayoutMode(layout);
      });
      await waitFor(() => expect(editor.state.doc.textContent).not.toContain('Third paragraph.'));
      expect(editor.view.dom.querySelector('video')).toBe(video);
      expect(live.ctx.editorSource).not.toContain('squisq-theme');

      // Edits still use the block's source channel, preserving the rest of
      // the document and its metadata while the player stays mounted.
      caretIn(editor, 'Second');
      act(() => {
        editor.commands.insertContent('Added words. ');
      });
      await waitFor(() => expect(live.ctx.markdownSource).toContain('Added words.'));
      expect(live.ctx.markdownSource).toContain('Third paragraph.');

      act(() => {
        live.ctx.setLayoutMode('document');
      });
      await waitFor(() => expect(editor.state.doc.textContent).toContain('Third paragraph.'));
      expect(editor.view.dom.querySelector('video')).toBe(video);
      expect(editor.state.doc.attrs.sourceFrontmatter).toContain('squisq-theme');
      expect(live.ctx.markdownSource.match(/squisq-theme/g)).toHaveLength(1);
      expect(live.ctx.markdownSource.match(/<video/g)).toHaveLength(1);
    },
  );

  it('inserts a block after the caret block, leaving the caret, undone in one step', async () => {
    const live = await mountWrite();
    const { editor } = live;
    const caret = caretIn(editor, 'First');
    act(() => {
      expect(live.ctx.insertBlockAfterCursor('```js\nlet b = 2;\n```')).toBe(true);
    });
    expect(topLevelTypes(editor)).toEqual([
      'h2',
      'paragraph',
      'codeBlock',
      'paragraph',
      'h2',
      'paragraph',
    ]);
    expect(editor.state.selection.from).toBe(caret);
    await waitFor(() => expect(live.ctx.markdownSource).toContain('let b = 2;'));
    act(() => {
      editor.commands.undo();
    });
    expect(topLevelTypes(editor)).not.toContain('codeBlock');
  });

  it('puts a section-end heading block before the next heading, deep enough to close', async () => {
    const live = await mountWrite();
    const { editor } = live;
    caretIn(editor, 'First');
    act(() => {
      expect(
        live.ctx.insertBlockAfterCursor(
          (context) => `${'#'.repeat(context.sectionDepth + 1)} Added`,
          { placement: 'sectionEnd' },
        ),
      ).toBe(true);
    });
    expect(topLevelTypes(editor)).toEqual([
      'h2',
      'paragraph',
      'paragraph',
      'h3',
      'h2',
      'paragraph',
    ]);
  });

  it('puts the toolbar layout at the section end instead of capturing the next paragraph', async () => {
    const live = await mountWrite();
    const { editor } = live;
    caretIn(editor, 'First');
    act(() => insertLayoutBlock(editor));
    // Before: the layout landed after "First paragraph." and swallowed
    // "Second paragraph." as a canvas text box body.
    expect(topLevelTypes(editor)).toEqual([
      'h2',
      'paragraph',
      'paragraph',
      'h3:layout',
      'h4:text',
      'paragraph',
      'h2',
      'paragraph',
    ]);
    await waitFor(() =>
      expect(live.ctx.markdownSource).toMatch(/Second paragraph\.\n\n### Layout/),
    );
  });
});

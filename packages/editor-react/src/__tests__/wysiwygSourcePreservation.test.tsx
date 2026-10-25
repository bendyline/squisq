/**
 * @vitest-environment jsdom
 *
 * Saving from the Write view keeps the original bytes of everything an edit
 * did not touch.
 *
 * The Write view serializes its whole document on every change. Typing one
 * word used to rewrite the entire file in the bridge's dialect: setext
 * headings became ATX, tables lost their padding, `~~~` fences turned into
 * escaped paragraphs, a badge lost its link, and a code fence lost its info
 * string — on a desktop that autosaves, just by typing.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorProvider, useEditorContext } from '../EditorContext';
import type { EditorContextValue } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';
import { tiptapToMarkdown } from '../tiptapBridge';

afterEach(cleanup);

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const README = [
  '---',
  'title: Fidelity Fixture',
  '---',
  '',
  'Project Readme',
  '==============',
  '',
  '[![Build](https://img.shields.io/badge/build-passing-green.svg)](https://example.com/ci)',
  '',
  'Some intro text with __bold underscores__ and _italic underscores_.',
  '',
  'Install',
  '-------',
  '',
  '* first star bullet',
  '* second star bullet',
  '',
  '| Option      | Default | Description       |',
  '|:------------|:-------:|------------------:|',
  '| `--verbose` | `false` | Print more output |',
  '',
  '~~~bash',
  'npm install --save my-package',
  '~~~',
  '',
  '```js title="x.js"',
  'const a = 1;',
  '```',
  '',
  '> [!NOTE]',
  '> GitHub alert body.',
  '',
  '> Outer quote',
  '',
  'Line with backslash break\\',
  'next line.',
  '',
  'Last line of the readme.',
  '',
].join('\n');

async function mountWrite(markdown: string) {
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
  return ref as { ctx: EditorContextValue; editor: Editor };
}

/** Type `text` at the end of the last top-level block containing `anchor`. */
function typeAtEndOf(editor: Editor, anchor: string, text: string): void {
  let end = -1;
  editor.state.doc.forEach((node, offset) => {
    if (node.textContent.includes(anchor)) end = offset + node.nodeSize - 1;
  });
  expect(end).toBeGreaterThan(0);
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
    editor.commands.insertContent(text);
  });
}

describe('Write view source preservation', () => {
  it('changes only the edited line when one word is typed', async () => {
    const live = await mountWrite(README);
    typeAtEndOf(live.editor, 'Last line of the readme.', ' Edited');
    await waitFor(() => expect(live.ctx.markdownSource).toContain('readme. Edited'));
    expect(live.ctx.markdownSource).toBe(
      README.replace('Last line of the readme.', 'Last line of the readme. Edited'),
    );
  });

  it('writes the original back byte for byte after the edit is undone', async () => {
    const live = await mountWrite(README);
    typeAtEndOf(live.editor, 'Some intro text', ' More.');
    await waitFor(() => expect(live.ctx.markdownSource).toContain('More.'));
    act(() => {
      live.editor.commands.undo();
    });
    await waitFor(() => expect(live.ctx.markdownSource).not.toContain('More.'));
    expect(live.ctx.markdownSource).toBe(README);
  });

  it('keeps a ~~~ fence and an info string while the code inside them is edited', async () => {
    const live = await mountWrite(README);
    typeAtEndOf(live.editor, 'npm install --save my-package', ' --verbose');
    await waitFor(() => expect(live.ctx.markdownSource).toContain('--verbose'));
    typeAtEndOf(live.editor, 'const a = 1;', ' // edited');
    await waitFor(() => expect(live.ctx.markdownSource).toContain('// edited'));
    expect(live.ctx.markdownSource).toBe(
      README.replace('my-package\n', 'my-package --verbose\n').replace(
        'const a = 1;',
        'const a = 1; // edited',
      ),
    );
  });

  it('serializes a badge, a ~~~ fence and an info string from the editor itself', async () => {
    // What an edit to those blocks would write, not just what preservation keeps.
    const live = await mountWrite(README);
    const serialized = tiptapToMarkdown(live.editor.getHTML());
    expect(serialized).toContain(
      '[![Build](https://img.shields.io/badge/build-passing-green.svg)](https://example.com/ci)',
    );
    expect(serialized).toContain('~~~bash\nnpm install --save my-package\n~~~');
    expect(serialized).toContain('```js title="x.js"\nconst a = 1;\n```');
  });

  it('preserves a source edited outside the Write view, from that edit on', async () => {
    const live = await mountWrite(README);
    const external = README.replace('* second star bullet', '* second star bullet\n* third');
    act(() => {
      live.ctx.setMarkdownSource(external);
    });
    await waitFor(() => expect(live.editor.getText()).toContain('third'));
    typeAtEndOf(live.editor, 'Last line of the readme.', ' Edited');
    await waitFor(() => expect(live.ctx.markdownSource).toContain('readme. Edited'));
    expect(live.ctx.markdownSource).toBe(
      external.replace('Last line of the readme.', 'Last line of the readme. Edited'),
    );
  });

  it('keeps a CRLF document CRLF when one word is typed', async () => {
    const crlf = README.replace(/\n/g, '\r\n');
    const live = await mountWrite(crlf);
    typeAtEndOf(live.editor, 'Last line of the readme.', ' Edited');
    await waitFor(() => expect(live.ctx.markdownSource).toContain('readme. Edited'));
    expect(live.ctx.markdownSource).toBe(
      crlf.replace('Last line of the readme.', 'Last line of the readme. Edited'),
    );
  });

  it('keeps every other paragraph of a hard-wrapped document as written', async () => {
    // The wrap policy shows wrapped prose unwrapped and re-wraps on save.
    const wrapped = [
      'Wrapped Guide',
      '=============',
      '',
      'The first paragraph is hard-wrapped the way many READMEs are, at about',
      'seventy-two columns, so that it reads well in a plain terminal window.',
      '',
      'The second paragraph is also wrapped. It is the one this test edits,',
      'and only its own lines should change when the document is saved.',
      '',
      'The third paragraph closes the document and must come back exactly',
      'as it was written, with its line breaks where the author put them.',
      '',
    ].join('\n');
    const live = await mountWrite(wrapped);
    typeAtEndOf(live.editor, 'The second paragraph', ' Edited.');
    await waitFor(() => expect(live.ctx.markdownSource).toContain('Edited.'));
    const saved = live.ctx.markdownSource.split('\n');
    const original = wrapped.split('\n');
    // Heading and first paragraph, then the third paragraph, byte for byte.
    expect(saved.slice(0, 6)).toEqual(original.slice(0, 6));
    expect(saved.slice(-4)).toEqual(original.slice(-4));
    expect(saved.join('\n')).toMatch(/saved\. Edited\.\n\nThe third paragraph/);
  });
});

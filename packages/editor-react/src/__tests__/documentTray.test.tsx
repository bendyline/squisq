/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { DocumentTray } from '../documentTray/DocumentTray';
import { DocumentTrayExtension, DOCUMENT_TRAY_KEY } from '../documentTray/DocumentTrayExtension';
import { TiptapAudio } from '../tiptap/TiptapAudio';
import { TiptapVideo } from '../tiptap/TiptapVideo';
import { VideoEmbedExtension } from '../videoEmbed/VideoEmbedExtension';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../EditorContext';
import { WysiwygEditor } from '../WysiwygEditor';

vi.mock('../tiptap/useResolvedMediaSrc', () => ({ useResolvedMediaSrc: (src: string) => src }));
const editors: Editor[] = [];
afterEach(() => {
  act(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });
  cleanup();
});

async function mount(markdown: string, enabled = true, editable = true) {
  const onUpdate = vi.fn();
  const editor = new Editor({
    extensions: [
      StarterKit,
      Link,
      Image,
      TiptapAudio,
      TiptapVideo,
      VideoEmbedExtension,
      DocumentTrayExtension.configure({ enabled }),
    ],
    content: markdownToTiptap(markdown),
    editable,
    onUpdate,
  });
  editors.push(editor);
  const rendered = render(
    <>
      <DocumentTray editor={editor} />
      <EditorContent editor={editor} />
    </>,
  );
  // Tiptap initializes its React node-view portals in a microtask.
  await act(async () => {});
  return { editor, onUpdate, ...rendered };
}
const items = (editor: Editor) => DOCUMENT_TRAY_KEY.getState(editor.state)!.items;
const AUDIO = '<audio src="audio/narration.mp3" controls data-squisq-audio-clip-start="2"></audio>';
const VIDEO =
  '<video src="video/background.mp4" controls width="480" data-squisq-video-placement="overlay" data-squisq-video-lock-to-block="false"></video>';

describe('document tray', () => {
  it('preserves the complete source, including frontmatter, across tray toggles and layout switches', async () => {
    const source = `---\ntitle: Original title\n---\n\n{[audio src=take.webm anchor=document]}\n\n# Title\n\n${VIDEO}\n\nBody.\n`;
    const live: { ctx: EditorContextValue | null } = { ctx: null };
    function Probe() {
      live.ctx = useEditorContext();
      return null;
    }
    render(
      <EditorProvider initialMarkdown={source} initialView="wysiwyg">
        <WysiwygEditor />
        <Probe />
      </EditorProvider>,
    );
    await screen.findByRole('region', { name: 'Document tray' });
    fireEvent.click(screen.getByRole('button', { name: 'Audio: take.webm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Audio: take.webm' }));
    expect(live.ctx!.markdownSource).toBe(source);
    act(() => {
      live.ctx!.setLayoutMode('block');
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Document tray' })).toBeNull());
    expect(live.ctx!.markdownSource).toBe(source);
    act(() => {
      live.ctx!.setLayoutMode('document');
    });
    await screen.findByRole('region', { name: 'Document tray' });
    expect(
      screen.getByRole('button', { name: 'Audio: take.webm' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(live.ctx!.markdownSource).toBe(source);
  });

  it('collapses opening media, mounts only one expanded player, and never writes Markdown on toggle', async () => {
    const { editor, container, onUpdate } = await mount(
      `${AUDIO}\n\n# Title\n\n${VIDEO}\n\nBody.\n\n${AUDIO}\n`,
    );
    const original = editor.getHTML();
    const originalMarkdown = tiptapToMarkdown(original);
    const tray = screen.getByRole('region', { name: 'Document tray' });
    expect(within(tray).getAllByRole('button')).toHaveLength(2);
    expect(items(editor)).toHaveLength(2);
    // The later body audio remains inline. Collapsed tray players do not load.
    expect(container.querySelectorAll('audio')).toHaveLength(1);
    expect(container.querySelectorAll('video')).toHaveLength(0);
    const pill = within(tray).getByRole('button', { name: 'Video: background.mp4' });
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(pill);
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(tray.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelectorAll('.ProseMirror video')).toHaveLength(0);
    fireEvent.click(pill);
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(editor.getHTML()).toBe(original);
    expect(tiptapToMarkdown(editor.getHTML())).toBe(originalMarkdown);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps narration annotations verbatim, including quotes, timing and unknown params', async () => {
    const annotation =
      '{[audio src="audio/my narration.webm" anchor=document startAt=3 fx="denoise" custom=keep]}';
    const { editor } = await mount(`# Title\n\n${annotation}\n\n${VIDEO}\n\nBody.\n`);
    expect(items(editor)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Audio: my narration.webm' }));
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('audio/my narration.webm');
    const pos = editor.state.doc.content.size - 1;
    act(() => {
      editor.commands.insertContentAt(pos, ' More.');
    });
    const markdown = tiptapToMarkdown(editor.getHTML());
    expect(markdown).toContain(annotation);
    expect(markdown).toContain(VIDEO);
    expect(markdown).toContain('Body. More.');
    expect(markdown).not.toContain('document-tray');
  });

  it.each([
    ['prose', 'Body text.'],
    ['list', '- Item'],
    ['quote', '> Quotation'],
    ['code', '```text\nExample\n```'],
    ['image', '![Cover](cover.png)'],
    ['second heading', '# Title\n\n## Section'],
    ['inline code example', '`{[audio src=example.mp3]}`'],
    ['mixed link', 'Listen to [this](example.mp3).'],
  ])('does not promote media after %s', async (_label, body) => {
    const { editor } = await mount(`${body}\n\n${VIDEO}\n`);
    expect(items(editor)).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Document tray' })).toBeNull();
    expect(document.querySelector('.ProseMirror video')).not.toBeNull();
  });

  it('supports media-only documents, standalone file links, and hosted video without duplicate iframes', async () => {
    const { editor, container } = await mount(
      '[Music](music.mp3)\n\n[Demo](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n',
    );
    expect(items(editor)).toHaveLength(2);
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Video: Demo' }));
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    expect(container.querySelector('.ProseMirror iframe')).toBeNull();
    expect(tiptapToMarkdown(editor.getHTML())).toContain(
      '[Demo](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
    );
    act(() => {
      editor.view.dispatch(editor.state.tr.setMeta(DOCUMENT_TRAY_KEY, false));
    });
    expect(screen.queryByRole('region', { name: 'Document tray' })).toBeNull();
    expect(container.querySelectorAll('.ProseMirror iframe')).toHaveLength(1);
  });

  it('reclassifies on body insertion and undo, and keeps expanded players mounted across unrelated edits', async () => {
    const { editor, container } = await mount(`${AUDIO}\n\nBody.\n`);
    fireEvent.click(screen.getByRole('button', { name: 'Audio: narration.mp3' }));
    const player = container.querySelector('audio');
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' More.');
    });
    expect(container.querySelector('audio')).toBe(player);
    act(() => {
      editor.commands.insertContentAt(0, '<p>New body before media.</p>');
    });
    expect(items(editor)).toHaveLength(0);
    expect(container.querySelector('.ProseMirror audio')).not.toBeNull();
    act(() => {
      editor.commands.undo();
    });
    expect(items(editor)).toHaveLength(1);
    expect(container.querySelector('.ProseMirror audio')).toBeNull();
  });

  it('edits and removes the correct occurrence when two clips share a source; undo restores it', async () => {
    const { editor } = await mount(`${VIDEO}\n\n${VIDEO}\n\nBody.\n`);
    const pills = screen.getAllByRole('button', { name: 'Video: background.mp4' });
    fireEvent.click(pills[1]);
    fireEvent.click(screen.getByRole('button', { name: 'PIP' }));
    expect(items(editor)[0].node.attrs.placement).toBe('overlay');
    expect(items(editor)[1].node.attrs.placement).toBe('picture-in-picture');
    expect(pills[1].getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove background.mp4 from document' }));
    expect(items(editor)).toHaveLength(1);
    expect(items(editor)[0].node.attrs.placement).toBe('overlay');
    act(() => {
      editor.commands.undo();
    });
    expect(items(editor)).toHaveLength(2);
  });

  it('can be disabled for block slices, and respects read-only documents', async () => {
    const first = await mount(`${AUDIO}\n\nBody.`, false);
    expect(items(first.editor)).toHaveLength(0);
    expect(first.container.querySelector('.ProseMirror audio')).not.toBeNull();
    first.unmount();
    await mount(`${VIDEO}\n\nBody.`, true, false);
    fireEvent.click(screen.getByRole('button', { name: 'Video: background.mp4' }));
    expect(
      screen.queryByRole('button', { name: 'Remove background.mp4 from document' }),
    ).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Video placement' })).toBeNull();
  });

  it('does not let Backspace at the body boundary delete a hidden attachment', async () => {
    const { editor, container } = await mount(`${AUDIO}\n\nBody.\n`);
    const position = items(editor)[0].node.nodeSize + 1;
    act(() => {
      editor.commands.setTextSelection(position);
    });
    fireEvent.keyDown(container.querySelector('.ProseMirror')!, { key: 'Backspace' });
    expect(items(editor)).toHaveLength(1);
    expect(editor.state.selection.from).toBe(position);
  });

  it('moves Home/arrow selections past hidden annotation text without changing source', async () => {
    const { editor, onUpdate } = await mount('{[audio src=take.mp3]}\n\nBody.\n');
    const original = editor.getHTML();
    act(() => {
      editor.commands.setTextSelection(1);
    });
    expect(editor.state.selection.from).toBe(items(editor)[0].node.nodeSize + 1);
    expect(editor.getHTML()).toBe(original);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('starts visible body text when typing into a media-only document, undoably', async () => {
    const annotation = '{[audio src=take.mp3 anchor=document]}';
    const { editor } = await mount(annotation);
    act(() => {
      editor.view.someProp('handleTextInput', (handler) =>
        handler(editor.view, 1, 1, 'Hello', () => editor.state.tr.insertText('Hello')),
      );
    });
    expect(tiptapToMarkdown(editor.getHTML())).toBe(`${annotation}\n\nHello\n`);
    expect(editor.state.selection.$from.parent.textContent).toBe('Hello');
    act(() => {
      editor.commands.undo();
    });
    expect(tiptapToMarkdown(editor.getHTML()).trim()).toBe(annotation);
  });

  it.each(['type', 'paste', 'enter'] as const)(
    'preserves a selected media-only video on %s',
    async (action) => {
      const { editor, container } = await mount(VIDEO);
      act(() => {
        editor.commands.setNodeSelection(0);
      });
      act(() => {
        if (action === 'type') {
          editor.view.someProp('handleTextInput', (handler) =>
            handler(editor.view, 0, 1, 'Hello', () => editor.state.tr.insertText('Hello')),
          );
        } else if (action === 'paste') {
          const slice = new Slice(Fragment.from(editor.schema.text('Hello')), 0, 0);
          editor.view.someProp('handlePaste', (handler) =>
            handler(editor.view, new Event('paste') as ClipboardEvent, slice),
          );
        } else {
          fireEvent.keyDown(container.querySelector('.ProseMirror')!, { key: 'Enter' });
        }
      });
      expect(items(editor)).toHaveLength(1);
      expect(tiptapToMarkdown(editor.getHTML())).toContain(VIDEO);
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
      if (action !== 'enter') expect(editor.state.selection.$from.parent.textContent).toBe('Hello');
    },
  );
});

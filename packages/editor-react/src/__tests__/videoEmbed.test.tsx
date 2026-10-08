/** @vitest-environment jsdom */

/**
 * Hosted-video embeds in the editor: VideoEmbedExtension claims top-level
 * paragraphs that are only a link (or bare URL, or provider `<iframe>` line)
 * to a video page and mounts the player above them — decoration-only, so the
 * markdown round-trips byte-identically — plus the Insert → Online Video
 * dialog, embed-code paste, and insertion in both views.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { LinkWithTitle } from '../WysiwygEditor';
import {
  VIDEO_EMBED_KEY,
  VideoEmbedExtension,
  convertVideoEmbedToLink,
} from '../videoEmbed/VideoEmbedExtension';
import { pasteVideoEmbedCode } from '../videoEmbed/videoEmbedPaste';
import { videoEmbedMarkdown } from '../videoEmbed/videoEmbedParagraph';
import { VideoEmbedDialog } from '../videoEmbed/VideoEmbedDialog';
import { videoEmbedAtCaret } from '../videoEmbed/useVideoEmbedDialog';
import { insertVideoEmbedReference, type MediaInsertionTarget } from '../mediaInsertion';

const YT = 'dQw4w9WgXcQ';
const WATCH = `https://www.youtube.com/watch?v=${YT}`;
const EMBED_SRC = `https://www.youtube-nocookie.com/embed/${YT}`;
const IFRAME_LINE = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?si=x" title="Our demo" allowfullscreen></iframe>`;

const editors: Editor[] = [];

function makeEditor(markdown: string): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit,
      LinkWithTitle.configure({ openOnClick: false, autolink: false }),
      VideoEmbedExtension,
    ],
    content: markdownToTiptap(markdown),
  });
  editors.push(editor);
  return editor;
}

function entriesOf(editor: Editor) {
  return VIDEO_EMBED_KEY.getState(editor.state)?.entries ?? [];
}

function iframes(editor: Editor): HTMLIFrameElement[] {
  return Array.from(editor.view.dom.querySelectorAll('.squisq-video-embed-host iframe'));
}

function markdownOf(editor: Editor): string {
  return tiptapToMarkdown(editor.getHTML());
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

const DOC = [
  '# Talks',
  '',
  `[Launch keynote](${WATCH})`,
  '',
  'https://vimeo.com/76979871',
  '',
  `Watch [the keynote](${WATCH}) before the meeting.`,
  '',
  `- ${WATCH}`,
  '',
  IFRAME_LINE,
].join('\n');

describe('VideoEmbedExtension', () => {
  it('claims standalone video paragraphs, not prose links or list items', () => {
    const editor = makeEditor(DOC);
    expect(entriesOf(editor)).toHaveLength(3);
    expect(iframes(editor).map((f) => f.getAttribute('src'))).toEqual([
      EMBED_SRC,
      'https://player.vimeo.com/video/76979871',
      EMBED_SRC,
    ]);
  });

  it('keeps the paragraph as an editable caption under the player', () => {
    const editor = makeEditor(`[Launch keynote](${WATCH})`);
    const caption = editor.view.dom.querySelector('p.squisq-video-embed-caption');
    expect(caption?.textContent).toBe('Launch keynote');
    const host = editor.view.dom.querySelector('.squisq-video-embed-host')!;
    expect(host.getAttribute('contenteditable')).toBe('false');
    expect(host.nextElementSibling).toBe(caption);
    expect(host.querySelector('iframe')!.getAttribute('title')).toBe('Launch keynote');
  });

  it('never perturbs the markdown round-trip', () => {
    const editor = makeEditor(DOC);
    expect(markdownOf(editor).trimEnd()).toBe(DOC);
  });

  it('keeps the same player while text elsewhere — or its caption — changes', () => {
    const editor = makeEditor(`Intro\n\n[Launch keynote](${WATCH})`);
    const [before] = iframes(editor);
    editor.commands.insertContentAt(1, 'More ');
    // Inside the link text, so the new words carry the link mark.
    let pos = -1;
    editor.state.doc.descendants((node, nodePos) => {
      if (pos < 0 && node.isText && node.text?.includes('keynote')) {
        pos = nodePos + node.text.indexOf('keynote');
      }
    });
    expect(pos).toBeGreaterThan(0);
    editor.commands.insertContentAt(pos, 'big ');
    const [after] = iframes(editor);
    expect(after).toBe(before);
    expect(editor.view.dom.querySelector('p.squisq-video-embed-caption')?.textContent).toBe(
      'Launch big keynote',
    );
  });

  it('lets a caption with unlinked prose beside the link fall back to a link', () => {
    const editor = makeEditor(`[Launch keynote](${WATCH})`);
    editor.commands.insertContentAt(1, 'See: ');
    expect(iframes(editor)).toHaveLength(0);
  });

  it('swaps the player when the link changes, and drops it when the link goes', () => {
    const editor = makeEditor(`[Launch keynote](${WATCH})`);
    const end = editor.state.doc.content.size - 1;
    editor
      .chain()
      .setTextSelection({ from: 1, to: end })
      .extendMarkRange('link')
      .updateAttributes('link', { href: 'https://vimeo.com/76979871' })
      .run();
    expect(iframes(editor)[0]!.getAttribute('src')).toBe('https://player.vimeo.com/video/76979871');

    editor.chain().setTextSelection({ from: 1, to: end }).unsetLink().run();
    expect(iframes(editor)).toHaveLength(0);
    expect(entriesOf(editor)).toHaveLength(0);
  });

  it('offers to rewrite a raw iframe line as a link', () => {
    const editor = makeEditor(IFRAME_LINE);
    expect(editor.view.dom.querySelector('p.squisq-video-embed-caption--html')?.textContent).toBe(
      IFRAME_LINE,
    );
    const button = editor.view.dom.querySelector<HTMLButtonElement>(
      '.squisq-video-embed-host-convert',
    )!;
    button.click();
    expect(markdownOf(editor).trim()).toBe(`[Our demo](${WATCH})`);
    expect(editor.view.dom.querySelector('.squisq-video-embed-host-convert')).toBeNull();
    expect(iframes(editor)).toHaveLength(1);
  });

  it('converts by id only while the block is still embed code', () => {
    const editor = makeEditor(`[Launch keynote](${WATCH})`);
    expect(convertVideoEmbedToLink(editor.view, entriesOf(editor)[0]!.id)).toBe(false);
    expect(convertVideoEmbedToLink(editor.view, 'video-embed-missing')).toBe(false);
  });
});

describe('pasting embed code', () => {
  it('turns a provider iframe into the link paragraph in place of an empty line', () => {
    const editor = makeEditor('Intro\n\n');
    editor.commands.focus('end');
    expect(pasteVideoEmbedCode(editor.view, IFRAME_LINE)).toBe(true);
    expect(markdownOf(editor).trim()).toBe(`Intro\n\n[Our demo](${WATCH})`);
    expect(iframes(editor)).toHaveLength(1);
  });

  it('puts the paragraph after a non-empty line and leaves other HTML alone', () => {
    const editor = makeEditor('Intro');
    editor.commands.focus('end');
    expect(
      pasteVideoEmbedCode(
        editor.view,
        `<iframe src="https://player.vimeo.com/video/76979871"></iframe>`,
      ),
    ).toBe(true);
    expect(markdownOf(editor).trim()).toBe('Intro\n\nhttps://vimeo.com/76979871');
    expect(pasteVideoEmbedCode(editor.view, '<iframe src="https://evil.example/x"></iframe>')).toBe(
      false,
    );
    expect(pasteVideoEmbedCode(editor.view, `https://youtu.be/${YT}`)).toBe(false);
  });
});

/** Just enough of a Monaco editor for an edit over `lines`. */
function fakeMonaco(lines: string[], line: number, column: number) {
  const edits: Array<{ text: string; range: unknown }> = [];
  const selection = {
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: column,
  };
  const monaco = {
    getSelection: () => selection,
    getModel: () => ({
      getLineContent: (n: number) => lines[n - 1] ?? '',
      getLineCount: () => lines.length,
      getLineMaxColumn: (n: number) => (lines[n - 1] ?? '').length + 1,
    }),
    executeEdits: (_source: string, ops: Array<{ text: string; range: unknown }>) => {
      edits.push(...ops);
      return true;
    },
    focus: () => undefined,
  };
  return { monaco: monaco as unknown as MediaInsertionTarget['monacoEditor'], edits };
}

describe('insertVideoEmbedReference', () => {
  it('adds its own paragraph in the Write view', () => {
    const editor = makeEditor('Intro');
    editor.commands.focus('end');
    insertVideoEmbedReference(
      { activeView: 'wysiwyg', tiptapEditor: editor, monacoEditor: null, appendMarkdown: vi.fn() },
      WATCH,
      'Launch [v2] keynote',
    );
    // Balanced brackets are legal link text; the bridge keeps them as written.
    expect(markdownOf(editor).trim()).toBe(`Intro\n\n[Launch [v2] keynote](${WATCH})`);
    expect(iframes(editor)).toHaveLength(1);
  });

  it('writes the bare URL as its own paragraph in the Source view', () => {
    const { monaco, edits } = fakeMonaco(['Intro text'], 1, 11);
    insertVideoEmbedReference(
      { activeView: 'raw', tiptapEditor: null, monacoEditor: monaco, appendMarkdown: vi.fn() },
      WATCH,
    );
    expect(edits.map((e) => e.text)).toEqual([`\n\n${WATCH}`]);
  });

  it('builds the canonical markdown', () => {
    expect(videoEmbedMarkdown(WATCH)).toBe(WATCH);
    expect(videoEmbedMarkdown(WATCH, '  ')).toBe(WATCH);
    expect(videoEmbedMarkdown(WATCH, 'Demo')).toBe(`[Demo](${WATCH})`);
  });
});

describe('videoEmbedAtCaret', () => {
  it('finds the video paragraph under the Write-view caret', () => {
    const editor = makeEditor(`Intro\n\n[Launch keynote](${WATCH}&t=90)`);
    editor.commands.focus('end');
    expect(videoEmbedAtCaret('wysiwyg', editor, null)).toMatchObject({
      initialInput: `${WATCH}&t=90s`,
      initialTitle: 'Launch keynote',
      target: { view: 'wysiwyg' },
    });
    editor.commands.focus('start');
    expect(videoEmbedAtCaret('wysiwyg', editor, null)).toBeNull();
  });

  it('finds a standalone video line in the Source view, not one glued to prose', () => {
    const own = fakeMonaco(['Intro', '', `https://youtu.be/${YT}`, ''], 3, 4);
    expect(videoEmbedAtCaret('raw', null, own.monaco)).toMatchObject({
      initialInput: WATCH,
      initialTitle: '',
      target: { view: 'raw', line: 3 },
    });
    const glued = fakeMonaco(['Intro', `https://youtu.be/${YT}`], 2, 4);
    expect(videoEmbedAtCaret('raw', null, glued.monaco)).toBeNull();
  });
});

describe('VideoEmbedDialog', () => {
  function renderDialog(initialInput = '', initialTitle = '') {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <VideoEmbedDialog
        mode={initialInput ? 'update' : 'insert'}
        initialInput={initialInput}
        initialTitle={initialTitle}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    return { onConfirm, onClose };
  }

  function urlField(): HTMLInputElement {
    return screen.getByLabelText(/^Video link or embed code/) as HTMLInputElement;
  }

  it('recognizes a link as it is typed, previews it, and confirms the normalized video', () => {
    const { onConfirm } = renderDialog();
    const insert = screen.getByRole('button', { name: 'Insert' });
    expect(insert).toHaveProperty('disabled', true);

    fireEvent.change(urlField(), { target: { value: `https://youtu.be/${YT}?si=abc&t=90` } });
    expect(screen.getByText(/YouTube video · starts at 1:30/)).toBeTruthy();
    expect(
      screen.getByTestId('video-embed-dialog').querySelector('iframe')!.getAttribute('src'),
    ).toBe(`${EMBED_SRC}?start=90`);

    fireEvent.change(screen.getByLabelText('Title (optional)'), {
      target: { value: '  Keynote  ' },
    });
    fireEvent.click(insert);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [embed, title] = onConfirm.mock.calls[0]!;
    expect(embed.watchUrl).toBe(`${WATCH}&t=90s`);
    expect(title).toBe('Keynote');
  });

  it('explains an unsupported link and keeps Insert disabled', () => {
    renderDialog();
    fireEvent.change(urlField(), { target: { value: 'https://example.com/clip' } });
    expect(screen.getByText(/isn’t a link to a video that can play here/)).toBeTruthy();
    expect(urlField().getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('button', { name: 'Insert' })).toHaveProperty('disabled', true);
  });

  it('takes the title from pasted embed code until the author types one', () => {
    renderDialog();
    fireEvent.change(urlField(), { target: { value: IFRAME_LINE } });
    expect((screen.getByLabelText('Title (optional)') as HTMLInputElement).value).toBe('Our demo');
  });

  it('opens in edit mode with the current video', () => {
    renderDialog(WATCH, 'Launch keynote');
    expect(screen.getByRole('heading', { name: 'Edit video' })).toBeTruthy();
    expect(urlField().value).toBe(WATCH);
    expect(screen.getByRole('button', { name: 'Update' })).toHaveProperty('disabled', false);
  });
});

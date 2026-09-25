import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { describe, expect, it, vi } from 'vitest';
import { tiptapToMarkdown } from '../tiptapBridge';
import { TiptapVideo } from '../tiptap/TiptapVideo';
import { TiptapAudio } from '../tiptap/TiptapAudio';
import {
  MEDIA_FILE_ACCEPT,
  buildSquisqMediaReference,
  mediaAltText,
  mediaMimeType,
  squisqMediaNode,
  type SquisqMediaDragPayload,
} from '../mediaDragMime';
import { asOwnParagraph, insertMediaReference, type MediaInsertionTarget } from '../mediaInsertion';

const video: SquisqMediaDragPayload = {
  name: 'media/clip.mp4',
  mimeType: 'video/mp4',
  alt: 'clip',
};
const audio: SquisqMediaDragPayload = {
  name: 'media/take.mp3',
  mimeType: 'audio/mpeg',
  alt: 'take',
};
const image: SquisqMediaDragPayload = {
  name: 'media/party.gif',
  mimeType: 'image/gif',
  alt: 'party',
};
const pdf: SquisqMediaDragPayload = {
  name: 'media/brief.pdf',
  mimeType: 'application/pdf',
  alt: 'brief',
};

describe('media file typing', () => {
  it('keeps a real media MIME type and infers one from the extension otherwise', () => {
    expect(mediaMimeType({ name: 'clip.mp4', type: 'video/mp4' })).toBe('video/mp4');
    expect(mediaMimeType({ name: 'song.flac', type: '' })).toBe('audio/flac');
    expect(mediaMimeType({ name: 'Song.M4A', type: 'application/octet-stream' })).toBe('audio/mp4');
    expect(mediaMimeType({ name: 'screen.mkv', type: '' })).toBe('video/x-matroska');
    expect(mediaMimeType({ name: 'brief.pdf', type: 'application/pdf' })).toBe('application/pdf');
    expect(mediaMimeType({ name: 'mystery', type: '' })).toBe('application/octet-stream');
  });

  it('derives alt text from the file name', () => {
    expect(mediaAltText('my_holiday-clip.mp4')).toBe('my holiday clip');
  });

  it('lets the picker select images, video and audio, including untyped extensions', () => {
    const accepted = MEDIA_FILE_ACCEPT.split(',');
    expect(accepted).toEqual(
      expect.arrayContaining(['image/*', 'video/*', 'audio/*', '.flac', '.m4a']),
    );
  });

  it('maps each kind to its Write-view node', () => {
    expect(squisqMediaNode(image)).toEqual({
      type: 'image',
      attrs: { src: 'media/party.gif', alt: 'party' },
    });
    expect(squisqMediaNode(video)).toEqual({
      type: 'video',
      attrs: { src: 'media/clip.mp4', controls: true, width: 480 },
    });
    expect(squisqMediaNode(audio)).toEqual({
      type: 'audio',
      attrs: { src: 'media/take.mp3', controls: true },
    });
    expect(squisqMediaNode(pdf)).toBeNull();
  });
});

describe('asOwnParagraph', () => {
  const tag = '<video></video>';
  const ctx = (
    before: string,
    after: string,
    previousLine: string | null = null,
    nextLine: string | null = null,
  ) => ({ before, after, previousLine, nextLine });

  it('separates the tag from prose on its own line', () => {
    expect(asOwnParagraph(tag, ctx('Intro', ''))).toBe(`\n\n${tag}`);
    expect(asOwnParagraph(tag, ctx('', 'Outro'))).toBe(`${tag}\n\n`);
    expect(asOwnParagraph(tag, ctx('Mid', 'dle'))).toBe(`\n\n${tag}\n\n`);
  });

  it('adds a blank line against a neighbouring paragraph line', () => {
    expect(asOwnParagraph(tag, ctx('', '', 'Above', 'Below'))).toBe(`\n${tag}\n`);
  });

  it('adds nothing on an empty line between blank lines', () => {
    expect(asOwnParagraph(tag, ctx('', '', '', ''))).toBe(tag);
    expect(asOwnParagraph(tag, ctx('  ', '', null, null))).toBe(tag);
  });
});

function makeEditor() {
  return new Editor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Image.configure({ inline: false }),
      Link,
      TiptapVideo,
      TiptapAudio,
    ],
    content: '<p>Intro text</p>',
  });
}

function wysiwygTarget(editor: Editor): MediaInsertionTarget {
  return {
    activeView: 'wysiwyg',
    tiptapEditor: editor,
    monacoEditor: null,
    appendMarkdown: vi.fn(),
  };
}

describe('insertMediaReference — Write view', () => {
  it('inserts a video as a player that serializes to the recorder tag', () => {
    const editor = makeEditor();
    editor.commands.focus('end');
    insertMediaReference(wysiwygTarget(editor), video);
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    expect(md).toContain('Intro text');
    expect(md).toMatch(/^<video src="media\/clip\.mp4" controls width="480"><\/video>$/m);
  });

  it('inserts audio as a player', () => {
    const editor = makeEditor();
    editor.commands.focus('end');
    insertMediaReference(wysiwygTarget(editor), audio);
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    expect(md).toMatch(/^<audio src="media\/take\.mp3" controls><\/audio>$/m);
  });

  it('keeps an image — animated or not — an image', () => {
    const editor = makeEditor();
    editor.commands.focus('end');
    insertMediaReference(wysiwygTarget(editor), image);
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    expect(md).toContain('![party](media/party.gif)');
  });

  it('links any other file', () => {
    const editor = makeEditor();
    editor.commands.focus('end');
    insertMediaReference(wysiwygTarget(editor), pdf);
    // Read the mark from the document model: Tiptap's Link renderer applies
    // its own href allow-list on the way out to HTML.
    const text = JSON.stringify(editor.getJSON());
    editor.destroy();
    expect(text).toContain('"text":"brief"');
    expect(text).toContain('"href":"media/brief.pdf"');
  });
});

/** Just enough of a Monaco editor for an insertion over `lines`. */
function fakeMonaco(lines: string[], line: number, column: number) {
  const edits: string[] = [];
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
    }),
    executeEdits: (_source: string, ops: Array<{ text: string }>) => {
      edits.push(...ops.map((op) => op.text));
      return true;
    },
    focus: () => undefined,
  };
  return { monaco: monaco as unknown as MediaInsertionTarget['monacoEditor'], edits };
}

describe('insertMediaReference — Source view', () => {
  it('writes a player tag as its own paragraph', () => {
    const { monaco, edits } = fakeMonaco(['Intro text', 'More prose'], 1, 11);
    insertMediaReference(
      { activeView: 'raw', tiptapEditor: null, monacoEditor: monaco, appendMarkdown: vi.fn() },
      video,
    );
    expect(edits).toEqual([`\n\n${buildSquisqMediaReference(video)}\n`]);
  });

  it('writes an image inline at the caret', () => {
    const { monaco, edits } = fakeMonaco(['Intro text'], 1, 11);
    insertMediaReference(
      { activeView: 'raw', tiptapEditor: null, monacoEditor: monaco, appendMarkdown: vi.fn() },
      image,
    );
    expect(edits).toEqual(['![party](media/party.gif)']);
  });
});

describe('insertMediaReference — no live editor', () => {
  it('appends the reference to the source', () => {
    const appendMarkdown = vi.fn();
    insertMediaReference(
      { activeView: 'preview', tiptapEditor: null, monacoEditor: null, appendMarkdown },
      audio,
    );
    expect(appendMarkdown).toHaveBeenCalledWith('<audio src="media/take.mp3" controls></audio>');
  });
});

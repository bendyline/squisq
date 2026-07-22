import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc, flattenBlocks } from '@bendyline/squisq/doc';
import { tiptapToMarkdown } from '../tiptapBridge';
import { insertMediaBlock, insertMediaBlocks } from '../recorder/insertMediaBlock';
import { buildDualClipInsertion } from '../recorder/dualClipInsertion';
import type { RecorderSaveResult } from '../recorder/RecorderModal';
import { collectEmbeddedMedia } from '../embeddedMedia';
import { TiptapVideo } from '../tiptap/TiptapVideo';

/**
 * Regression: a recorded clip used to vanish from the markdown source
 * (and therefore the timeline) when the editor caret sat inside a list
 * item. The recorder inserts a block-level `<video>` atom; a plain
 * `insertContent` nests it inside the `<li>`, and `tiptapToMarkdown`'s
 * list serializer emits only the item's inline text — silently dropping
 * the nested media. `insertMediaBlock` lifts the insertion to the
 * top level so the tag round-trips.
 */
function makeEditor() {
  return new Editor({
    extensions: [Document, Paragraph, Text, OrderedList, ListItem, TiptapVideo],
    content: '<ol><li><p>First</p></li><li><p>Second</p></li></ol>',
  });
}

/** Put the caret at the end of the last list item — where the recorder
 * modal typically leaves it after the user selected a list-bearing block. */
function caretInLastListItem(editor: Editor) {
  editor.commands.focus('end');
}

describe('recorder media insertion (caret inside a list)', () => {
  it('a plain insertContent buries the video as an indented continuation of the <li>', () => {
    const editor = makeEditor();
    caretInLastListItem(editor);
    editor
      .chain()
      .focus()
      .insertContent({ type: 'video', attrs: { src: 'video/clip.webm', controls: true } })
      .run();
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    // The hardened serializer no longer drops it, but it lands nested
    // inside the list item (indented continuation) rather than as its
    // own block — which is why the recorder uses `insertMediaBlock`.
    expect(md).toMatch(/\n {2,}<video/);
  });

  it('insertMediaBlock places the video as a top-level block after the list', () => {
    const editor = makeEditor();
    caretInLastListItem(editor);
    insertMediaBlock(editor, {
      type: 'video',
      attrs: { src: 'video/clip.webm', controls: true, width: 480 },
    });
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    // The list is preserved and the clip sits at the document level
    // (start of line, not indented under a bullet).
    expect(md).toContain('1. First');
    expect(md).toContain('2. Second');
    expect(md).toMatch(/^<video src="video\/clip\.webm"/m);
  });
});

describe('dual (screen + camera) insertion', () => {
  it('inserts both clips as top-level blocks, screen before camera, byte-stable to raw markup', () => {
    const result: RecorderSaveResult = {
      source: 'screen+camera',
      relativePath: 'video/screen-x.webm',
      filename: 'screen-x.webm',
      mimeType: 'video/webm',
      duration: 8,
      hasTimingSidecar: false,
      camera: {
        relativePath: 'video/camera-x.webm',
        filename: 'camera-x.webm',
        mimeType: 'video/webm',
        duration: 7.7,
        offsetSec: 0.3,
      },
    };
    const dual = buildDualClipInsertion(result)!;

    const editor = new Editor({
      extensions: [Document, Paragraph, Text, OrderedList, ListItem, TiptapVideo],
      content: '<p>Intro</p>',
    });
    editor.commands.focus('end');
    insertMediaBlocks(editor, [
      { type: 'video', attrs: dual.screenAttrs },
      { type: 'video', attrs: dual.cameraAttrs },
    ]);
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();

    // The WYSIWYG round-trip re-serializes to exactly the raw-view tags.
    expect(md).toContain(dual.screenTag);
    expect(md).toContain(dual.cameraTag);
    // Screen precedes camera (DOM order = z-order), each at column 0.
    expect(md.indexOf(dual.screenTag)).toBeLessThan(md.indexOf(dual.cameraTag));
    expect(md).toMatch(/^<video src="video\/screen-x\.webm"/m);
    expect(md).toMatch(/^<video src="video\/camera-x\.webm"/m);
  });
});

describe('hardened list serializer: nested media round-trips to a detectable clip', () => {
  it('a <video> left inside a list item still parses back as embedded media', () => {
    // Even when media ends up nested in a list item (drag/paste, not the
    // recorder path), the serializer keeps it — and the markdown re-parses
    // to a block whose embedded media the timeline can surface.
    const md = tiptapToMarkdown(
      '<h2>Section</h2><ol><li><p>Step</p><video src="video/clip.webm" controls=""></video></li></ol>',
    );
    expect(md).toContain('<video');

    const doc = markdownToDoc(parseMarkdown(md));
    const blocks = flattenBlocks(doc.blocks);
    const total = blocks.reduce((s, b) => s + collectEmbeddedMedia(b).length, 0);
    expect(total).toBe(1);
  });
});

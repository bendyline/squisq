import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { describe, expect, it } from 'vitest';
import { tiptapToMarkdown } from '../tiptapBridge';

/**
 * The actual end-to-end question the chat composer hinges on:
 *
 *   when a pasted / uploaded image is inserted into the tiptap
 *   editor via `setImage({src, alt})`, does the markdown we serialize
 *   out (via `getHTML()` + `tiptapToMarkdown`) contain
 *   `![alt](src)` — the shape the gezel service's image-attachment
 *   extractor expects?
 *
 * Unit tests on the regex alone have been green the whole time, and
 * yet the production app kept sending image-less messages. This test
 * exercises the real tiptap editor in jsdom so the HTML tiptap
 * actually emits is what we check, not a hand-synthesized string.
 */

function makeEditor() {
  return new Editor({
    // Bare-minimum schema: doc → paragraph (text) + block image. No
    // React node-view — we only care about the serialized HTML.
    extensions: [Document, Paragraph, Text, Image.configure({ inline: false })],
    content: '<p></p>',
  });
}

describe('tiptap Image node → markdown round-trip', () => {
  it('produces `![alt](src)` for an image inserted via setImage', () => {
    const editor = makeEditor();
    editor.chain().focus().setImage({ src: 'attachments/xyz.png', alt: 'my screenshot' }).run();
    const html = editor.getHTML();
    const md = tiptapToMarkdown(html);
    editor.destroy();
    expect(html).toMatch(/<img\b/);
    expect(html).toContain('src="attachments/xyz.png"');
    expect(md).toContain('![my screenshot](attachments/xyz.png)');
  });

  it('produces `![](src)` when alt is empty (most common pasted-image shape)', () => {
    const editor = makeEditor();
    editor.chain().focus().setImage({ src: 'attachments/pasted.png', alt: '' }).run();
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    expect(md).toContain('![](attachments/pasted.png)');
  });

  it('produces `![](src)` when alt is omitted entirely', () => {
    const editor = makeEditor();
    editor.chain().focus().setImage({ src: 'attachments/no-alt.png' }).run();
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    expect(md).toContain('![](attachments/no-alt.png)');
  });

  it('coexists with paragraph text', () => {
    // Seed the editor with a paragraph, then insert the image after
    // it — mirrors the common case where the user types "here:" and
    // then pastes an image.
    const editor = makeEditor();
    editor.chain().focus().insertContent('here you go').run();
    editor.chain().focus().setImage({ src: 'attachments/foo.png', alt: 'foo' }).run();
    const md = tiptapToMarkdown(editor.getHTML());
    editor.destroy();
    expect(md).toContain('![foo](attachments/foo.png)');
    expect(md).toContain('here you go');
  });
});

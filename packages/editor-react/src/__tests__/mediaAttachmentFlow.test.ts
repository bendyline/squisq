import { describe, expect, it } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';
import { buildSquisqMediaReference, fileReference } from '../mediaDragMime';

/**
 * Attachment-flow regression: earlier versions of MediaBin dropped
 * uploaded files into the bin without inserting a markdown ref into
 * the editor body. A user would upload an image, hit Send in the
 * downstream chat composer, and the outgoing markdown would have no
 * image reference — the downstream consumer would reply "nothing came through."
 *
 * The fix: after `mediaProvider.addMedia(...)` succeeds, MediaBin
 * fires `onMediaUploaded(relativePath, name, mimeType)`. The
 * EditorShell wires this to an `insertAtCursor` that emits
 * `![alt](attachments/<filename>)` so the file actually participates
 * in the outgoing markdown.
 *
 * These tests exercise the contract directly: the markdown snippet
 * produced by the upload callback, once round-tripped through the
 * editor's markdown↔HTML bridge, must round-trip back to a form
 * the downstream service's image-extraction regex can see.
 */

function fakeMediaProvider(records: string[]): MediaProvider {
  let counter = 0;
  return {
    async addMedia(name: string, _data: ArrayBuffer | Blob | Uint8Array, _mime: string) {
      counter += 1;
      const relative = `attachments/${counter}-${name}`;
      records.push(relative);
      return relative;
    },
    async resolveUrl(relPath: string) {
      return relPath;
    },
    async listMedia() {
      return [];
    },
    async removeMedia(_relPath: string) {
      /* no-op */
    },
    dispose() {
      /* no-op */
    },
  };
}

/**
 * The source snippet EditorShell's `insertMediaRef` writes in the Source
 * view — built from the same shared helpers it uses.
 */
function buildAttachmentSnippet(relativePath: string, name: string, mimeType: string): string {
  return buildSquisqMediaReference(fileReference(relativePath, name, mimeType));
}

describe('media attachment flow', () => {
  it('addMedia → buildAttachmentSnippet → markdown round-trip keeps the ref', async () => {
    const records: string[] = [];
    const provider = fakeMediaProvider(records);

    // Simulate MediaBin.handleFileChange for a single PNG drop.
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const relative = await provider.addMedia('my_screenshot.png', pngBytes, 'image/png');

    expect(records).toEqual([relative]);
    const snippet = buildAttachmentSnippet(relative, 'my_screenshot.png', 'image/png');
    expect(snippet).toBe(`![my screenshot](${relative})`);

    // Insert snippet into the editor: markdown → HTML → markdown.
    // This is the path a real insertAtCursor + tiptap onUpdate goes
    // through. The outbound markdown must still contain the ref.
    const html = markdownToTiptap(snippet);
    expect(html).toMatch(/<img\b/);
    expect(html).toContain(`src="${relative}"`);

    const back = tiptapToMarkdown(html);
    expect(back).toContain(`![my screenshot](${relative})`);
  });

  it('handles empty-alt (most common pasted-image shape)', async () => {
    const records: string[] = [];
    const provider = fakeMediaProvider(records);
    const relative = await provider.addMedia('pasted.png', new Uint8Array([0]), 'image/png');

    // Simulate what happens when alt is empty — common for bare pastes
    // where the user hasn't typed a caption.
    const snippet = `![](${relative})`;
    const html = markdownToTiptap(snippet);
    expect(html).toMatch(/<img\b/);
    expect(html).toContain(`src="${relative}"`);
    const back = tiptapToMarkdown(html);
    expect(back).toContain(`![](${relative})`);
  });

  it('non-image files fall back to a plain link, still preserving the ref', async () => {
    const records: string[] = [];
    const provider = fakeMediaProvider(records);
    const relative = await provider.addMedia('design.pdf', new Uint8Array([0]), 'application/pdf');
    const snippet = buildAttachmentSnippet(relative, 'design.pdf', 'application/pdf');
    // Linked by its full name, so a reader sees what the link downloads.
    expect(snippet).toBe(`[design.pdf](${relative})`);
    // Non-images don't go through the `<img>` regex — they stay as
    // plain markdown links, which the service-side extractor ignores
    // but the UI renders as normal hyperlinks.
    expect(snippet).not.toContain('!');
  });

  it('video and audio become players that survive the round-trip', async () => {
    const records: string[] = [];
    const provider = fakeMediaProvider(records);
    const clip = await provider.addMedia('demo_clip.mp4', new Uint8Array([0]), 'video/mp4');
    // An upload the OS could not type still becomes a player via its extension.
    const take = await provider.addMedia('take.flac', new Uint8Array([0]), '');

    const videoSnippet = buildAttachmentSnippet(clip, 'demo_clip.mp4', 'video/mp4');
    const audioSnippet = buildAttachmentSnippet(take, 'take.flac', 'application/octet-stream');
    expect(videoSnippet).toBe(`<video src="${clip}" controls width="480"></video>`);
    expect(audioSnippet).toBe(`<audio src="${take}" controls></audio>`);

    for (const snippet of [videoSnippet, audioSnippet]) {
      expect(tiptapToMarkdown(markdownToTiptap(snippet))).toContain(snippet);
    }
  });
});

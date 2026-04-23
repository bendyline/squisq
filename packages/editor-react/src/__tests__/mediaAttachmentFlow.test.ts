import { describe, expect, it } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

/**
 * Attachment-flow regression: earlier versions of MediaBin dropped
 * uploaded files into the bin without inserting a markdown ref into
 * the editor body. A user would upload an image, hit Send in the
 * downstream chat composer, and the outgoing markdown would have no
 * image reference — the gezel would reply "nothing came through."
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
 * the gezel service's image-extraction regex can see.
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
 * Re-implements the exact snippet EditorShell's `insertMediaRef`
 * builds. Keeping this aligned with the real impl would ordinarily
 * rely on directly importing the helper; since it's currently inline
 * in EditorShell, mirror the logic here and lean on the test to
 * alert us if we drift apart.
 */
function buildAttachmentSnippet(relativePath: string, name: string, mimeType: string): string {
  const alt = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  return mimeType.startsWith('image/') ? `![${alt}](${relativePath})` : `[${alt}](${relativePath})`;
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
    expect(snippet).toBe(`[design](${relative})`);
    // Non-images don't go through the `<img>` regex — they stay as
    // plain markdown links, which the service-side extractor ignores
    // but the UI renders as normal hyperlinks.
    expect(snippet).not.toContain('!');
  });
});

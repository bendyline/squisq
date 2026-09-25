/** @vitest-environment jsdom */

/**
 * The Write view's image node: an animated GIF gets play/pause controls and
 * loses the Edit affordance (the raster editor would save one still frame
 * back over the animation); a still image keeps Edit and gets no controls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { EditorProvider } from '../EditorContext';
import { ImageWithMediaProvider } from '../ImageNodeView';

function gifDataUrl(frames: number): string {
  const bytes: number[] = [...'GIF89a'].map((c) => c.charCodeAt(0));
  bytes.push(1, 0, 1, 0, 0, 0, 0);
  bytes.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  for (let i = 0; i < frames; i++) {
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0);
  }
  bytes.push(0x3b);
  return `data:image/gif;base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Resolves workspace paths to data URLs, as a container provider resolves to blob URLs. */
function providerFor(files: Record<string, string>): MediaProvider {
  return {
    addMedia: vi.fn(async (name: string) => name),
    resolveUrl: vi.fn(async (name: string) => files[name] ?? name),
    listMedia: vi.fn(async () => []),
    removeMedia: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

const editors: Editor[] = [];

function mountImage(src: string, provider: MediaProvider) {
  const editor = new Editor({
    extensions: [StarterKit, ImageWithMediaProvider.configure({ inline: false })],
    content: `<img src="${src}" alt="demo">`,
  });
  editors.push(editor);
  return render(
    <EditorProvider initialMarkdown="" mediaProvider={provider} allowRecording={false}>
      <EditorContent editor={editor} />
    </EditorProvider>,
  );
}

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('ImageNodeView with animated images', () => {
  it('shows playback controls and hides Edit for an animated GIF', async () => {
    const { container } = mountImage(
      'media/party.gif',
      providerFor({ 'media/party.gif': gifDataUrl(3) }),
    );
    await screen.findByRole('button', { name: 'Pause animation' });
    const figure = container.querySelector('figure') as HTMLElement;
    fireEvent.mouseEnter(figure);
    expect(screen.queryByTestId('image-edit-affordance')).toBeNull();
  });

  it('keeps Edit and adds no controls for a single-frame GIF', async () => {
    const { container } = mountImage(
      'media/logo.gif',
      providerFor({ 'media/logo.gif': gifDataUrl(1) }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    fireEvent.mouseEnter(container.querySelector('figure') as HTMLElement);
    expect(screen.getByTestId('image-edit-affordance')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /animation/ })).toBeNull();
  });
});

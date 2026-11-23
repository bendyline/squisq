/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { EditorProvider } from '../EditorContext';
import { VideoMedia } from '../tiptap/TiptapVideo';

const CLIP = 'notes_files/clip.mp4';

function mountVideo(provider: MediaProvider | null) {
  return render(
    <EditorProvider initialMarkdown="" mediaProvider={provider} allowRecording={false}>
      <VideoMedia attrs={{ src: CLIP, controls: true }} readOnly />
    </EditorProvider>,
  );
}

function providerResolving(resolve: MediaProvider['resolveUrl']): MediaProvider {
  return {
    resolveUrl: vi.fn(resolve),
    addMedia: vi.fn(async (name) => name),
    listMedia: vi.fn(async () => []),
    removeMedia: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

afterEach(cleanup);

// A relative `src` on the element is requested from the page origin: in the
// DocBlocks desktop app every clip the provider could not supply yet logged a
// `404 app://docblocks/<doc>_files/clip.mp4` before it played.
describe('a video node with a media provider', () => {
  it('plays the URL the provider supplies', async () => {
    const provider = providerResolving(async () => 'blob:clip');
    const { container } = mountVideo(provider);
    await waitFor(() =>
      expect(container.querySelector('video')?.getAttribute('src')).toBe('blob:clip'),
    );
  });

  it.each([
    ['the provider has no such file yet', async (path: string) => path],
    [
      'resolution fails',
      async () => {
        throw new Error('not readable');
      },
    ],
  ])('never requests the raw path when %s', async (_case, resolve) => {
    const provider = providerResolving(resolve);
    const { container } = mountVideo(provider);
    await waitFor(() => expect(provider.resolveUrl).toHaveBeenCalledWith(CLIP));
    await new Promise((settle) => setTimeout(settle, 0));
    expect(container.querySelector('video')?.hasAttribute('src')).toBe(false);
  });
});

describe('a video node without a media provider', () => {
  it('keeps the path for hosts that serve media from their own origin', () => {
    const { container } = mountVideo(null);
    expect(container.querySelector('video')?.getAttribute('src')).toBe(CLIP);
  });
});

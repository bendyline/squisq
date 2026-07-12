import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { MediaProvider, ScheduledClip } from '@bendyline/squisq/schemas';
import { MediaClipLayer } from '../MediaClipLayer';
import { MediaContext } from '../hooks/MediaContext';

afterEach(() => vi.restoreAllMocks());

describe('MediaClipLayer', () => {
  it('mutes scheduled audio when the player muted contract is enabled', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const clip: ScheduledClip = {
      id: 'narration',
      kind: 'audio',
      src: 'narration.mp3',
      absoluteStart: 0,
      absoluteEnd: 5,
      sourceIn: 0,
      anchor: 'document',
    };
    const { container } = render(
      <MediaClipLayer schedule={[clip]} currentTime={0} isPlaying={false} basePath="." muted />,
    );
    expect(container.querySelector('audio')?.muted).toBe(true);
  });

  it('restores a paused clip position after an async media URL resolves', async () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    let resolveUrl!: (url: string) => void;
    const provider = {
      resolveUrl: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveUrl = resolve;
          }),
      ),
    } as unknown as MediaProvider;
    const clip: ScheduledClip = {
      id: 'background-video',
      kind: 'video',
      src: 'background.mp4',
      absoluteStart: 0,
      absoluteEnd: 10,
      sourceIn: 2,
      anchor: 'document',
    };

    const { container } = render(
      <MediaContext.Provider value={provider}>
        <MediaClipLayer
          schedule={[clip]}
          currentTime={5}
          isPlaying={false}
          basePath="/media"
          muted
        />
      </MediaContext.Provider>,
    );
    const video = container.querySelector('video')!;
    await waitFor(() => expect(video.currentTime).toBe(7));

    // Replacing an HTMLMediaElement source resets its playback position in a
    // browser. Simulate that reset before the provider's blob URL arrives.
    video.currentTime = 0;
    await act(async () => resolveUrl('blob:resolved-background'));

    await waitFor(() => expect(video.getAttribute('src')).toBe('blob:resolved-background'));
    expect(video.currentTime).toBe(7);
  });
});

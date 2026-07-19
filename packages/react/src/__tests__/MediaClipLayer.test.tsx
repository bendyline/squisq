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

  it('lets a scheduled video carry audio unless the player is muted', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const clip: ScheduledClip = {
      id: 'presenter',
      kind: 'video',
      src: 'presenter.mp4',
      absoluteStart: 0,
      absoluteEnd: 5,
      sourceIn: 0,
      anchor: 'document',
    };
    const { container, rerender } = render(
      <MediaClipLayer schedule={[clip]} currentTime={0} isPlaying={false} basePath="." />,
    );
    expect(container.querySelector('video')?.muted).toBe(false);
    rerender(
      <MediaClipLayer schedule={[clip]} currentTime={0} isPlaying={false} basePath="." muted />,
    );
    expect(container.querySelector('video')?.muted).toBe(true);
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

  it('tracks small paused scrubber movements exactly', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const clip: ScheduledClip = {
      id: 'scrubbed-video',
      kind: 'video',
      src: 'scrubbed.mp4',
      absoluteStart: 0,
      absoluteEnd: 10,
      sourceIn: 0,
      anchor: 'document',
    };
    const { container, rerender } = render(
      <MediaClipLayer schedule={[clip]} currentTime={1} isPlaying={false} basePath="." muted />,
    );
    const video = container.querySelector('video')!;
    expect(video.currentTime).toBe(1);

    // This is smaller than the live-playback drift tolerance. A paused
    // playhead drag still needs to select the requested frame exactly.
    rerender(
      <MediaClipLayer schedule={[clip]} currentTime={1.1} isPlaying={false} basePath="." muted />,
    );
    expect(video.currentTime).toBe(1.1);
  });

  it('groups authored PIP and overlay clips independently of the player default', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const base: ScheduledClip = {
      id: 'base',
      kind: 'video',
      src: 'base.mp4',
      absoluteStart: 0,
      absoluteEnd: 10,
      sourceIn: 0,
      anchor: 'block',
    };
    const schedule: ScheduledClip[] = [
      base,
      { ...base, id: 'pip', src: 'pip.mp4', placement: 'picture-in-picture' },
      { ...base, id: 'overlay', src: 'overlay.mp4', placement: 'overlay' },
    ];
    const { container } = render(
      <MediaClipLayer
        schedule={schedule}
        currentTime={1}
        isPlaying={false}
        basePath="."
        presentation="background"
        muted
      />,
    );

    expect(
      container.querySelector('[data-presentation="background"] video[data-clip-id="base"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-presentation="picture-in-picture"] video[data-clip-id="pip"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-presentation="full-frame"] video[data-clip-id="overlay"]'),
    ).toBeTruthy();
  });
});

/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { VideoLayer as VideoLayerType } from '@bendyline/squisq/schemas';
import { VideoLayer } from '../layers/VideoLayer';

const layer: VideoLayerType = {
  id: 'video',
  type: 'video',
  position: { x: 0, y: 0, width: 640, height: 360 },
  content: {
    src: 'clip.mp4',
    alt: 'Demo clip',
    clipStart: 2,
    clipEnd: 8,
    startAt: 1,
  },
};

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VideoLayer playback synchronization', () => {
  it('lets a recorded clip carry audio unless the player explicitly mutes it', () => {
    const props = {
      layer,
      basePath: '/media',
      viewport: { width: 640, height: 360 },
      blockTime: 0,
    };
    const { container, rerender } = render(
      <svg>
        <VideoLayer {...props} />
      </svg>,
    );
    expect(container.querySelector('video')?.muted).toBe(false);

    rerender(
      <svg>
        <VideoLayer {...props} muted />
      </svg>,
    );
    expect(container.querySelector('video')?.muted).toBe(true);
  });

  it('joins the document clock when mounted partway through a block', async () => {
    const { container, rerender } = render(
      <svg>
        <VideoLayer
          layer={layer}
          basePath="/media"
          viewport={{ width: 640, height: 360 }}
          blockTime={4}
          isPlaying
        />
      </svg>,
    );
    const video = container.querySelector('video')!;

    // clipStart 2 + (blockTime 4 - startAt 1) = source time 5.
    await waitFor(() => expect(video.currentTime).toBe(5));

    rerender(
      <svg>
        <VideoLayer
          layer={layer}
          basePath="/media"
          viewport={{ width: 640, height: 360 }}
          blockTime={6}
          isPlaying
        />
      </svg>,
    );
    expect(video.currentTime).toBe(7);

    rerender(
      <svg>
        <VideoLayer
          layer={layer}
          basePath="/media"
          viewport={{ width: 640, height: 360 }}
          blockTime={20}
          isPlaying
        />
      </svg>,
    );
    expect(video.currentTime).toBe(8);
    expect(video.pause).toHaveBeenCalled();
  });

  it.each(['captureSequential', 'captureDecoded'] as const)(
    'leaves %s videos for frame capture to position',
    async (flag) => {
      const { container, rerender } = render(
        <svg>
          <VideoLayer
            layer={layer}
            basePath="/media"
            viewport={{ width: 640, height: 360 }}
            blockTime={4}
          />
        </svg>,
      );
      const video = container.querySelector('video')!;
      await waitFor(() => expect(video.currentTime).toBe(5));
      video.dataset[flag] = 'true';
      vi.mocked(video.pause).mockClear();

      rerender(
        <svg>
          <VideoLayer
            layer={layer}
            basePath="/media"
            viewport={{ width: 640, height: 360 }}
            blockTime={6}
          />
        </svg>,
      );

      expect(video.currentTime).toBe(5);
      expect(video.pause).not.toHaveBeenCalled();
    },
  );

  it('holds at the in-point until startAt', async () => {
    const { container } = render(
      <svg>
        <VideoLayer
          layer={layer}
          basePath="/media"
          viewport={{ width: 640, height: 360 }}
          blockTime={0.5}
          isPlaying
        />
      </svg>,
    );
    const video = container.querySelector('video')!;

    await waitFor(() => expect(video.currentTime).toBe(2));
    expect(video.pause).toHaveBeenCalled();
  });
});

describe('VideoLayer player mode', () => {
  const renderPlayer = (blockTime: number) => (
    <svg>
      <VideoLayer
        layer={layer}
        basePath="/media"
        viewport={{ width: 640, height: 360 }}
        blockTime={blockTime}
        mode="player"
      />
    </svg>
  );

  it('hands a slideshow clip to the viewer with native controls', async () => {
    const { container } = render(renderPlayer(0));
    const video = container.querySelector('video')!;

    expect(video.controls).toBe(true);
    expect(video.style.pointerEvents).toBe('');
    expect(video.hasAttribute('data-no-swipe')).toBe(true);
    expect(video.getAttribute('aria-label')).toBe('Demo clip');
    // Frame capture's seekTo handler must not drive a viewer's clip.
    expect(video.hasAttribute('data-clip-start')).toBe(false);
    await waitFor(() => expect(video.currentTime).toBe(2));
  });

  it('neither follows the stepped clock nor stops at the block-length out-point', async () => {
    const { container, rerender } = render(renderPlayer(0));
    const video = container.querySelector('video')!;
    await waitFor(() => expect(video.currentTime).toBe(2));
    vi.mocked(video.pause).mockClear();

    video.currentTime = 30;
    video.dispatchEvent(new Event('timeupdate'));
    rerender(renderPlayer(20));

    expect(video.currentTime).toBe(30);
    expect(video.pause).not.toHaveBeenCalled();
  });
});

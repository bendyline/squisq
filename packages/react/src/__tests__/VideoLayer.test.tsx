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

  describe('a clip with cuts', () => {
    // 0–30 s of source with 10–20 s cut: 20 s of played time.
    const cut: VideoLayerType = {
      ...layer,
      content: {
        src: 'clip.mp4',
        alt: 'Demo clip',
        clipStart: 0,
        clipEnd: 30,
        cuts: [{ start: 10, end: 20 }],
      },
    };
    const at = (blockTime: number, mode?: 'player') => (
      <svg>
        <VideoLayer
          layer={cut}
          basePath="/media"
          viewport={{ width: 640, height: 360 }}
          blockTime={blockTime}
          isPlaying
          mode={mode}
        />
      </svg>
    );

    it('maps the doc clock to source time through the cuts', async () => {
      const { container, rerender } = render(at(4));
      const video = container.querySelector('video')!;
      await waitFor(() => expect(video.currentTime).toBe(4));
      // Twelve seconds in is two seconds past the join: source 22, not 12.
      rerender(at(12));
      expect(video.currentTime).toBe(22);
      rerender(at(40));
      expect(video.currentTime).toBe(30);
    });

    it('tells the frame-capture seek handler about the cuts', () => {
      const { container } = render(at(0));
      expect(container.querySelector('video')?.dataset.cuts).toBe('10-20');
      cleanup();
      const uncut = render(
        <svg>
          <VideoLayer
            layer={layer}
            basePath="/media"
            viewport={{ width: 640, height: 360 }}
            blockTime={0}
          />
        </svg>,
      );
      expect(uncut.container.querySelector('video')?.dataset.cuts).toBeUndefined();
    });

    it.each([undefined, 'player'] as const)(
      'jumps a playing video out of a cut it runs into (mode %s)',
      async (mode) => {
        const { container } = render(at(4, mode));
        const video = container.querySelector('video')!;
        Object.defineProperty(video, 'paused', { configurable: true, value: false });
        // The element plays on into the cut between two ticks of the doc clock.
        video.currentTime = 10.4;
        await waitFor(() => expect(video.currentTime).toBe(20));
        // Kept material is left alone.
        video.currentTime = 24;
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(video.currentTime).toBe(24);
      },
    );

    it('leaves a paused video where the viewer put it', async () => {
      const { container } = render(at(4, 'player'));
      const video = container.querySelector('video')!;
      Object.defineProperty(video, 'paused', { configurable: true, value: true });
      video.currentTime = 12;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(video.currentTime).toBe(12);
    });
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

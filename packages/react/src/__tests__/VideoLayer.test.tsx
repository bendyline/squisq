/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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

describe('VideoLayer on WebKit', () => {
  const iphoneSafari =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
  const restores: Array<() => void> = [];

  // A 1920×1080 slide shown in a 480×400 box: a quarter scale, letterboxed
  // 65px from the top. jsdom has no layout, so stand in for it.
  function slideBox(): void {
    const define = (name: string, value: unknown) => {
      Object.defineProperty(SVGSVGElement.prototype, name, {
        configurable: true,
        get: () => value,
      });
      restores.push(
        () => delete (SVGSVGElement.prototype as unknown as Record<string, unknown>)[name],
      );
    };
    define('viewBox', { baseVal: { x: 0, y: 0, width: 1920, height: 1080 } });
    define('clientWidth', 480);
    define('clientHeight', 400);
    const spy = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(iphoneSafari);
    restores.push(() => spy.mockRestore());
  }
  afterEach(() => {
    while (restores.length) restores.pop()!();
  });

  const clip: VideoLayerType = {
    ...layer,
    position: { x: 960, y: 540, width: 480, height: 270 },
  };
  const renderClip = (capture = false) =>
    render(
      <svg viewBox="0 0 1920 1080">
        <VideoLayer
          layer={clip}
          basePath="/media"
          viewport={{ width: 1920, height: 1080 }}
          blockTime={0}
          mode="player"
          capture={capture}
        />
      </svg>,
    );

  it('gives the foreignObject the on-screen box WebKit paints it at', async () => {
    slideBox();
    const { container } = renderClip();
    const fo = container.querySelector('foreignObject')!;
    await waitFor(() => expect(fo.hasAttribute('data-screen-placed')).toBe(true));
    expect(fo.getAttribute('x')).toBe('240');
    expect(fo.getAttribute('y')).toBe(String(65 + 135));
    expect(fo.getAttribute('width')).toBe('120');
    expect(fo.getAttribute('height')).toBe('67.5');
    expect(container.querySelector('video')!.style.width).toBe('120px');
  });

  it('keeps the slide-unit box for frame capture, which reads it', () => {
    slideBox();
    const { container } = renderClip(true);
    const fo = container.querySelector('foreignObject')!;
    expect(fo.hasAttribute('data-screen-placed')).toBe(false);
    expect(fo.getAttribute('x')).toBe('960');
    expect(fo.getAttribute('width')).toBe('480');
  });

  it('draws an idle clip as its poster, so no composited video covers the slide', () => {
    slideBox();
    const { container } = render(
      <svg viewBox="0 0 1920 1080">
        <VideoLayer
          layer={{ ...clip, content: { ...clip.content, posterSrc: 'poster.jpg' } }}
          basePath="/media"
          viewport={{ width: 1920, height: 1080 }}
          blockTime={0}
          mode="player"
        />
      </svg>,
    );
    const poster = container.querySelector<HTMLImageElement>('[data-video-poster] img')!;
    expect(poster.getAttribute('src')).toBe('/media/poster.jpg');
    expect(poster.style.objectFit).toBe('cover');
    expect(poster.closest('foreignObject')!.getAttribute('x')).toBe('960');
    const video = container.querySelector('video')!;
    expect(video.style.display).toBe('none');

    const play = container.querySelector<SVGGElement>('[role="button"]')!;
    expect(play.getAttribute('aria-label')).toBe('Play Demo clip');
    fireEvent.click(play);
    // Shown and started inside the tap, as iOS requires for sound.
    expect(video.style.display).toBe('block');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(container.querySelector('[data-video-poster]')).toBeNull();
  });

  it('keeps the slide-unit box on other engines', () => {
    const { container } = renderClip();
    const fo = container.querySelector('foreignObject')!;
    expect(fo.getAttribute('x')).toBe('960');
    expect(fo.hasAttribute('data-screen-placed')).toBe(false);
  });
});

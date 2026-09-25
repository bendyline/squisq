import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import { DocPlayer } from '../DocPlayer';
import type { AudioController } from '../hooks/AudioController';
import type { RenderVideoFrameSelector, SquisqRenderAPI } from '../types';

const seekVideoToFrame = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../docPlayer/renderReadiness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../docPlayer/renderReadiness')>()),
  seekVideoToFrame,
}));

function docWithVideos(): Doc {
  return {
    articleId: 'frame-selector',
    duration: 5,
    blocks: [
      {
        id: 'recorded',
        startTime: 0,
        duration: 5,
        audioSegment: 0,
        layers: [
          {
            id: 'recording',
            type: 'video',
            content: { src: 'recording.webm', alt: 'Recorded clip', clipStart: 2, clipEnd: 5 },
            position: { x: 0, y: 0, width: 640, height: 360 },
          },
        ],
      },
    ],
    audio: { segments: [] },
    documentMedia: [
      {
        id: 'presenter',
        src: 'presenter.mp4',
        kind: 'video',
        startAt: 0,
        clipEnd: 4,
        anchor: 'document',
      },
    ],
  };
}

function controller(): AudioController {
  return {
    currentTime: 0,
    isPlaying: false,
    currentSegment: 0,
    totalDuration: 5,
    isEnded: false,
    isReady: true,
    isAvailable: true,
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    toggle: vi.fn(async () => {}),
    seekTo: vi.fn(async () => {}),
    skipToSegment: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
  };
}

function renderCapturePlayer(selector: RenderVideoFrameSelector) {
  const observed: Array<SquisqRenderAPI | null> = [];
  const { container } = render(
    <DocPlayer
      doc={docWithVideos()}
      renderMode
      audioController={controller()}
      renderVideoFrameSelector={selector}
      onRenderAPIReady={(api) => observed.push(api)}
    />,
  );
  const api = observed[observed.length - 1];
  if (!api) throw new Error('Render API was not published');
  const blockVideo = container.querySelector<HTMLVideoElement>('video[data-clip-start]')!;
  const scheduledVideo = container.querySelector<HTMLVideoElement>('video[data-clip-id]')!;
  return { api, blockVideo, scheduledVideo };
}

describe('DocPlayer render video frame selector', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    seekVideoToFrame.mockClear();
  });

  it('lets the selector supply block and scheduled video frames', async () => {
    const selector = vi.fn<RenderVideoFrameSelector>(async () => true);
    const { api, blockVideo, scheduledVideo } = renderCapturePlayer(selector);

    await act(async () => api.seekTo(1.5));

    expect(selector).toHaveBeenCalledWith(blockVideo, 3.5);
    expect(selector).toHaveBeenCalledWith(scheduledVideo, 1.5);
    expect(seekVideoToFrame).not.toHaveBeenCalled();
  });

  it('seeks the element itself for every video the selector declines', async () => {
    const selector = vi.fn<RenderVideoFrameSelector>(
      async (video) => video.dataset.clipId === undefined,
    );
    const { api, scheduledVideo } = renderCapturePlayer(selector);

    await act(async () => api.seekTo(1.5));

    expect(selector).toHaveBeenCalledTimes(2);
    expect(seekVideoToFrame).toHaveBeenCalledOnce();
    expect(seekVideoToFrame).toHaveBeenCalledWith(scheduledVideo, 1.5);
  });
});

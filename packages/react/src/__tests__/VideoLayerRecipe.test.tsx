/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { parseMediaEdits } from '@bendyline/squisq/mediaEdit';
import type { MediaClip, VideoLayer as VideoLayerType } from '@bendyline/squisq/schemas';
import { ProcessedAudioContext } from '../hooks/MediaContext';
import { InlineAudioPlayer } from '../InlineAudioPlayer';
import { InlineVideoPlayer } from '../InlineVideoPlayer';
import { VideoLayer } from '../layers/VideoLayer';
import { mediaCropStyle } from '../mediaRecipePlayback';

/**
 * A video laid out in a slide is not a scheduled clip, so the layer applies
 * the clip's recipe itself — and the inline players of the Write and Document
 * views skip its cuts and show its crop.
 */

function layerWith(recipe: Parameters<typeof parseMediaEdits>[0]): VideoLayerType {
  const { cuts, ...edits } = parseMediaEdits(recipe) ?? {};
  return {
    id: 'clip',
    type: 'video',
    position: { x: 0, y: 0, width: 640, height: 360 },
    content: {
      src: 'clip.webm',
      alt: 'Demo clip',
      clipStart: 0,
      clipEnd: 30,
      ...(cuts ? { cuts } : {}),
      ...(Object.keys(edits).length > 0 ? { edits } : {}),
    },
  };
}

function stage(
  layer: VideoLayerType,
  blockTime: number,
  options: { mode?: 'player'; isPlaying?: boolean; muted?: boolean } = {},
) {
  return (
    <svg>
      <VideoLayer
        layer={layer}
        basePath="/media"
        viewport={{ width: 640, height: 360 }}
        blockTime={blockTime}
        isPlaying={options.isPlaying ?? true}
        muted={options.muted}
        mode={options.mode}
      />
    </svg>
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VideoLayer — crop', () => {
  it('crops the live picture and tells frame capture the same', () => {
    const { container } = render(stage(layerWith({ crop: '0.1 0.2 0.5 0.6' }), 0));
    const video = container.querySelector('video')!;
    expect(video.dataset.crop).toBe('0.1 0.2 0.5 0.6');
    // (The test DOM drops `object-view-box`, so the live style is pinned below.)
  });

  it('leaves an uncropped clip alone', () => {
    const { container } = render(stage(layerWith({}), 0));
    expect(container.querySelector('video')!.dataset.crop).toBeUndefined();
  });

  it('frames the picture with object-view-box, inset from each edge', () => {
    expect(mediaCropStyle({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })).toEqual({
      objectViewBox: 'inset(20.000% 40.000% 20.000% 10.000%)',
    });
    expect(mediaCropStyle(undefined)).toEqual({});
  });
});

describe('VideoLayer — gain and fades', () => {
  const faded = layerWith({ gain: '-6.0206', fadeIn: '2', fadeOut: '4', cuts: '10-20' });

  it('follows the fades across the PLAYED clip on the doc clock', async () => {
    // 30 s of file less a 10 s cut plays for 20 s.
    const { container, rerender } = render(stage(faded, 1));
    const video = container.querySelector('video')!;
    await waitFor(() => expect(video.volume).toBeCloseTo(0.25, 3)); // half gain, half faded in
    rerender(stage(faded, 10));
    expect(video.volume).toBeCloseTo(0.5, 3);
    rerender(stage(faded, 18)); // two seconds from the end of a four-second fade
    expect(video.volume).toBeCloseTo(0.25, 3);
  });

  it('gives a viewer-driven clip its gain once, then leaves the volume to them', async () => {
    const { container, rerender } = render(stage(faded, 0, { mode: 'player' }));
    const video = container.querySelector('video')!;
    await waitFor(() => expect(video.volume).toBeCloseTo(0.5, 3));
    video.volume = 0.9; // the viewer turns it up
    rerender(stage(faded, 0, { mode: 'player' }));
    expect(video.volume).toBe(0.9);
  });

  it('never touches the volume of a clip with no gain or fades', () => {
    const { container } = render(stage(layerWith({ cuts: '10-20' }), 5));
    const video = container.querySelector('video')!;
    video.volume = 0.3;
    expect(video.volume).toBe(0.3);
  });
});

describe('VideoLayer — processed audio', () => {
  const cleaned = layerWith({ fx: 'loudness:-16', cuts: '10-20', gain: '-6.0206' });
  const lookups: MediaClip[] = [];
  const processedAudio = (clip: MediaClip) => {
    lookups.push(clip);
    return '.mediaEdits/clip.0123456789ab.webm';
  };
  const withRenders = (
    node: React.ReactNode,
    lookup: (clip: MediaClip) => string | undefined = processedAudio,
  ) => <ProcessedAudioContext.Provider value={lookup}>{node}</ProcessedAudioContext.Provider>;

  it('plays the clip’s render beside the muted picture, on the same clock', async () => {
    lookups.length = 0;
    const { container, rerender } = render(withRenders(stage(cleaned, 4)));
    const video = container.querySelector('video')!;
    const audio = container.querySelector('audio')!;
    expect(lookups[0]).toMatchObject({
      src: 'clip.webm',
      kind: 'video',
      edits: { fx: { ops: [{ id: 'loudness', value: -16 }] } },
    });
    expect(audio.getAttribute('src')).toBe('/media/.mediaEdits/clip.0123456789ab.webm');
    expect(video.muted).toBe(true);
    expect(audio.muted).toBe(false);
    await waitFor(() => expect(audio.currentTime).toBe(4));

    // Past the cut, both jump to the same source instant.
    rerender(withRenders(stage(cleaned, 12)));
    expect(video.currentTime).toBe(22);
    expect(audio.currentTime).toBe(22);
    // The level goes on the track that is heard.
    expect(audio.volume).toBeCloseTo(0.5, 3);
    expect(video.volume).toBe(1);

    rerender(withRenders(stage(cleaned, 12, { isPlaying: false })));
    expect(audio.pause).toHaveBeenCalled();
  });

  it('skips a cut on the processed track as on the picture', async () => {
    const { container } = render(withRenders(stage(cleaned, 4)));
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    audio.currentTime = 10.4;
    await waitFor(() => expect(audio.currentTime).toBe(20));
  });

  it('keeps the picture’s own sound until a render exists, and when none is wired', () => {
    const none = render(withRenders(stage(cleaned, 4), () => undefined));
    expect(none.container.querySelector('audio')).toBeNull();
    expect(none.container.querySelector('video')!.muted).toBe(false);
    cleanup();
    const bare = render(stage(cleaned, 4));
    expect(bare.container.querySelector('audio')).toBeNull();
  });

  it('leaves a viewer-driven clip its own sound, so its controls mean what they say', () => {
    const { container } = render(withRenders(stage(cleaned, 0, { mode: 'player' })));
    expect(container.querySelector('audio')).toBeNull();
    expect(container.querySelector('video')!.muted).toBe(false);
  });

  it('silences the processed track with the player', () => {
    const { container } = render(withRenders(stage(cleaned, 4, { muted: true })));
    expect(container.querySelector('audio')!.muted).toBe(true);
  });
});

describe('inline players', () => {
  const edits = parseMediaEdits({ cuts: '10-20', crop: '0 0 0.5 1' });

  it('skips a video’s cuts as it plays', async () => {
    const { container } = render(
      <InlineVideoPlayer src="clip.webm" basePath="/media" edits={edits} />,
    );
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    video.currentTime = 12;
    await waitFor(() => expect(video.currentTime).toBe(20));
  });

  it('skips an audio clip’s cuts as it plays', async () => {
    const { container } = render(
      <InlineAudioPlayer src="take.webm" basePath="/media" edits={edits} />,
    );
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    audio.currentTime = 15;
    await waitFor(() => expect(audio.currentTime).toBe(20));
  });

  it('plays an unedited clip straight through', async () => {
    const { container } = render(<InlineVideoPlayer src="clip.webm" basePath="/media" />);
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    video.currentTime = 12;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(video.currentTime).toBe(12);
  });
});

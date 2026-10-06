/**
 * useVideoExport's MP4 audio path after the shared `documentAudio` refactor:
 * the hook schedules with `documentAudioTimeline`, reads sources through
 * `loadAudioTimelineSources` (audio map → images map → MediaProvider), and
 * mixes with `mixAudioTimeline` over at least the export duration — the same
 * code `renderDocumentAudio` runs for hosts.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';

const mocks = vi.hoisted(() => ({
  renderAudioTimeline: vi.fn(),
  encodeAacTrack: vi.fn(async () => {}),
  addAudioChunk: vi.fn(),
  encodeFrame: vi.fn(async (frame: { close?: () => void }) => frame.close?.()),
}));

vi.mock('../hooks/useFrameCapture.js', () => {
  const handle = {
    init: vi.fn(async () => 0.1),
    captureFrame: vi.fn(async () => ({ close: vi.fn() })),
    captureCanvasFrame: vi.fn(async () => ({})),
    setCoverVisible: vi.fn(async () => {}),
    destroy: vi.fn(),
  };
  return { useFrameCapture: () => handle };
});

vi.mock('../mainThreadEncoder.js', () => ({
  supportsWebCodecs: () => true,
  supportsWebCodecsH264: async () => true,
  createEncoder: () => ({
    encodeFrame: mocks.encodeFrame,
    addAudioChunk: mocks.addAudioChunk,
    finalize: async () => new Uint8Array([0, 0, 0, 1]).buffer,
    close: vi.fn(),
  }),
}));

vi.mock('../workerEncoder.js', () => ({ createWorkerEncoder: vi.fn() }));

vi.mock('../audioTrack.js', () => ({
  supportsWebCodecsAac: async () => true,
  selectAudioTier: () => ({ tier: 1, reason: null }),
  renderAudioTimeline: mocks.renderAudioTimeline,
  encodeAacTrack: mocks.encodeAacTrack,
  audioBufferToWav: vi.fn(),
  muxAudioWithFfmpegWasm: vi.fn(),
  EXPORT_AUDIO_SAMPLE_RATE: 48_000,
  EXPORT_AUDIO_CHANNELS: 2,
}));

import { useVideoExport } from '../hooks/useVideoExport.js';

const doc: Doc = {
  articleId: 'audio-hook-test',
  duration: 0.1,
  blocks: [{ id: 'b1', startTime: 0, duration: 0.1, audioSegment: 0, layers: [] }],
  audio: {
    segments: [
      { name: 'intro', src: 'intro.mp3', startTime: 0, duration: 0.05 },
      // Runs past the 0.1 s video: the mix must cover it.
      { name: 'outro', src: 'outro.mp3', startTime: 0.05, duration: 0.2 },
    ],
  },
};

const mixed = { numberOfChannels: 2, sampleRate: 48_000 } as unknown as AudioBuffer;
/** Snapshot of the source bytes handed to the mixer (the hook clears its map afterwards). */
let mixedSources = new Map<string, ArrayBuffer>();

beforeEach(() => {
  vi.clearAllMocks();
  mixedSources = new Map();
  mocks.renderAudioTimeline.mockImplementation(
    async (_timeline: unknown, buffers: Map<string, ArrayBuffer>) => {
      mixedSources = new Map(buffers);
      return mixed;
    },
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mp4-output');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useVideoExport MP4 audio (shared document-audio path)', () => {
  it('reads each source from the audio map, mixes over the full timeline, and muxes AAC', async () => {
    const audio = new Map([
      ['intro.mp3', new Uint8Array([1]).buffer],
      ['outro.mp3', new Uint8Array([2]).buffer],
    ]);
    const hook = renderHook(() => useVideoExport());
    await act(async () => {
      await hook.result.current.startExport(doc, { audio, fps: 10 });
    });

    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.state).toBe('complete');
    expect(hook.result.current.audioIncluded).toBe(true);

    expect(mocks.renderAudioTimeline).toHaveBeenCalledTimes(1);
    const [timeline, , totalDuration, sampleRate] = mocks.renderAudioTimeline.mock.calls[0] as [
      Array<{ src: string; startSec: number }>,
      Map<string, ArrayBuffer>,
      number,
      number,
    ];
    expect(timeline.map((clip) => [clip.src, clip.startSec])).toEqual([
      ['intro.mp3', 0],
      ['outro.mp3', 0.05],
    ]);
    expect([...mixedSources.keys()]).toEqual(['intro.mp3', 'outro.mp3']);
    expect(totalDuration).toBeCloseTo(0.25, 10);
    expect(sampleRate).toBe(48_000);
    expect(mocks.encodeAacTrack).toHaveBeenCalledWith(mixed, expect.anything(), 128_000);
  });

  it('falls back to the MediaProvider for sources the maps do not hold', async () => {
    const provider = {
      resolveUrl: vi.fn(async (src: string) => `data:audio/mpeg;base64,${btoa(src)}`),
      listMedia: async () => [],
    };
    const hook = renderHook(() => useVideoExport());
    await act(async () => {
      await hook.result.current.startExport(doc, {
        audio: new Map([['intro.mp3', new Uint8Array([1]).buffer]]),
        images: new Map(),
        mediaProvider: provider as never,
        fps: 10,
      });
    });

    expect(hook.result.current.error).toBeNull();
    expect(provider.resolveUrl).toHaveBeenCalledWith('outro.mp3');
    expect(provider.resolveUrl).not.toHaveBeenCalledWith('intro.mp3');
    expect(new TextDecoder().decode(mixedSources.get('outro.mp3'))).toBe('outro.mp3');
  });

  it('fails a require-policy export that cannot load a source, naming it', async () => {
    const hook = renderHook(() => useVideoExport());
    await act(async () => {
      await hook.result.current.startExport(doc, {
        audio: new Map([['intro.mp3', new Uint8Array([1]).buffer]]),
        fps: 10,
      });
    });
    expect(hook.result.current.state).toBe('error');
    expect(hook.result.current.error).toBe(
      'Audio could not be prepared: Audio files could not be loaded: outro.mp3',
    );
    expect(mocks.renderAudioTimeline).not.toHaveBeenCalled();
  });

  it('degrades a best-effort export to video-only with the reason', async () => {
    const hook = renderHook(() => useVideoExport());
    await act(async () => {
      await hook.result.current.startExport(doc, { audioPolicy: 'best-effort', fps: 10 });
    });
    expect(hook.result.current.state).toBe('complete');
    expect(hook.result.current.audioIncluded).toBe(false);
    expect(hook.result.current.audioSkippedReason).toBe(
      'Audio files could not be loaded: intro.mp3, outro.mp3',
    );
    expect(mocks.renderAudioTimeline).not.toHaveBeenCalled();
  });
});

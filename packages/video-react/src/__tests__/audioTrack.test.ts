/**
 * audioTrack — tier selection + capability probe.
 *
 * The tier decision is the boundary `useVideoExport` delegates to, so testing
 * `selectAudioTier` directly exercises the exact logic the hook runs (jsdom
 * lacks real WebCodecs / OfflineAudioContext, so the end-to-end encode path
 * can only be exercised in a browser). `supportsWebCodecsAac` is verified to
 * degrade to `false` when `AudioEncoder` is undefined (jsdom's state).
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  selectAudioTier,
  supportsWebCodecsAac,
  REASON_NO_AAC_NO_SAB,
  audioBufferToWav,
  renderAudioTimeline,
} from '../audioTrack.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('selectAudioTier', () => {
  it('tier 1 when AAC is supported on the main-thread WebCodecs encoder', () => {
    expect(
      selectAudioTier({
        hasClips: true,
        aacSupported: true,
        sharedArrayBufferAvailable: true,
        canUseMainThreadWebCodecs: true,
      }),
    ).toEqual({ tier: 1, reason: null });
  });

  it('tier 2 when AAC is unsupported but SharedArrayBuffer (ffmpeg.wasm) is available', () => {
    expect(
      selectAudioTier({
        hasClips: true,
        aacSupported: false,
        sharedArrayBufferAvailable: true,
        canUseMainThreadWebCodecs: false,
      }),
    ).toEqual({ tier: 2, reason: null });
  });

  it('tier 2 when AAC is supported but the main-thread encoder is not in use', () => {
    // AAC exists but the video is going through the worker/ffmpeg path — the
    // inline muxer isn't available, so fall back to the ffmpeg mux pass.
    expect(
      selectAudioTier({
        hasClips: true,
        aacSupported: true,
        sharedArrayBufferAvailable: true,
        canUseMainThreadWebCodecs: false,
      }),
    ).toEqual({ tier: 2, reason: null });
  });

  it('tier 3 with a reason when neither AAC nor SharedArrayBuffer is available', () => {
    expect(
      selectAudioTier({
        hasClips: true,
        aacSupported: false,
        sharedArrayBufferAvailable: false,
        canUseMainThreadWebCodecs: false,
      }),
    ).toEqual({ tier: 3, reason: REASON_NO_AAC_NO_SAB });
  });

  it('tier 3 with a null reason when there is no audio to include', () => {
    expect(
      selectAudioTier({
        hasClips: false,
        aacSupported: true,
        sharedArrayBufferAvailable: true,
        canUseMainThreadWebCodecs: true,
      }),
    ).toEqual({ tier: 3, reason: null });
  });
});

describe('supportsWebCodecsAac', () => {
  it('returns false when AudioEncoder is undefined (jsdom/Node)', async () => {
    expect(typeof AudioEncoder).toBe('undefined');
    await expect(supportsWebCodecsAac()).resolves.toBe(false);
  });
});

describe('renderAudioTimeline', () => {
  it('rejects an undecodable authored audio source', async () => {
    class RejectingOfflineAudioContext {
      destination = {};

      async decodeAudioData(): Promise<AudioBuffer> {
        throw new Error('no audio stream');
      }

      createBufferSource(): AudioBufferSourceNode {
        throw new Error('unreachable');
      }

      async startRendering(): Promise<AudioBuffer> {
        throw new Error('unreachable');
      }
    }
    vi.stubGlobal('OfflineAudioContext', RejectingOfflineAudioContext);

    await expect(
      renderAudioTimeline(
        [{ src: 'audio/narration.webm', startSec: 0, sourceInSec: 0, durationSec: 5 }],
        new Map([['audio/narration.webm', new Uint8Array([1, 2, 3]).buffer]]),
        5,
      ),
    ).rejects.toThrow('No decodable audio track was found in: audio/narration.webm');
  });

  it('skips a silent video and mixes every video source that has audio', async () => {
    const decoded = new Map<number, AudioBuffer>([
      [1, { id: 'camera-1' } as unknown as AudioBuffer],
      [2, { id: 'camera-2' } as unknown as AudioBuffer],
    ]);
    const output = { id: 'mixed' } as unknown as AudioBuffer;
    const starts: Array<{ buffer: AudioBuffer | null; args: number[] }> = [];

    class SelectiveOfflineAudioContext {
      destination = {};

      async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
        const marker = new Uint8Array(data)[0];
        const buffer = decoded.get(marker);
        if (!buffer) throw new Error('no audio stream');
        return buffer;
      }

      createBufferSource(): AudioBufferSourceNode {
        const node = {
          buffer: null as AudioBuffer | null,
          connect: vi.fn(),
          start: (...args: number[]) => starts.push({ buffer: node.buffer, args }),
        };
        return node as unknown as AudioBufferSourceNode;
      }

      async startRendering(): Promise<AudioBuffer> {
        return output;
      }
    }
    vi.stubGlobal('OfflineAudioContext', SelectiveOfflineAudioContext);

    const result = await renderAudioTimeline(
      [
        {
          src: 'video/camera-1.webm',
          startSec: 0,
          sourceInSec: 0,
          durationSec: 5,
          sourceKind: 'video',
        },
        {
          src: 'video/screen.webm',
          startSec: 0,
          sourceInSec: 0,
          durationSec: 5,
          sourceKind: 'video',
        },
        {
          src: 'video/camera-2.webm',
          startSec: 2,
          sourceInSec: 1,
          durationSec: 3,
          sourceKind: 'video',
        },
      ],
      new Map([
        ['video/camera-1.webm', new Uint8Array([1]).buffer],
        ['video/screen.webm', new Uint8Array([0]).buffer],
        ['video/camera-2.webm', new Uint8Array([2]).buffer],
      ]),
      5,
    );

    expect(result).toBe(output);
    expect(starts).toEqual([
      { buffer: decoded.get(1), args: [0, 0, 5] },
      { buffer: decoded.get(2), args: [2, 1, 3] },
    ]);
  });
});

describe('audioBufferToWav', () => {
  it('serializes a minimal AudioBuffer-shaped value to a RIFF/WAVE header', () => {
    // Hand-rolled AudioBuffer stand-in (jsdom has no AudioBuffer). Only the
    // fields audioBufferToWav reads are provided.
    const frames = 4;
    const left = new Float32Array([0, 0.5, -0.5, 1]);
    const right = new Float32Array([0, -1, 0.25, -0.25]);
    const fake = {
      numberOfChannels: 2,
      sampleRate: 48_000,
      length: frames,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    } as unknown as AudioBuffer;

    const wav = audioBufferToWav(fake);
    const ascii = (i: number, n: number) =>
      String.fromCharCode(...Array.from(wav.subarray(i, i + n)));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(36, 4)).toBe('data');
    // 44-byte header + 2 channels * 2 bytes * 4 frames = 60 bytes.
    expect(wav.byteLength).toBe(44 + frames * 2 * 2);
  });
});

/**
 * audioTrack — tier selection + capability probe.
 *
 * The tier decision is the boundary `useVideoExport` delegates to, so testing
 * `selectAudioTier` directly exercises the exact logic the hook runs (jsdom
 * lacks real WebCodecs / OfflineAudioContext, so the end-to-end encode path
 * can only be exercised in a browser). `supportsWebCodecsAac` is verified to
 * degrade to `false` when `AudioEncoder` is undefined (jsdom's state).
 */

import { describe, it, expect } from 'vitest';
import {
  selectAudioTier,
  supportsWebCodecsAac,
  REASON_NO_AAC_NO_SAB,
  audioBufferToWav,
} from '../audioTrack.js';

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

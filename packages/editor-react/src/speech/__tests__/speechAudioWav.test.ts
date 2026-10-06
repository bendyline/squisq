/**
 * The speech-input wire format: mono 16-bit PCM WAV at 16 kHz. Pins the RIFF
 * header fields a whisper.cpp build checks, the data length, sample encoding
 * and clamping, the down-mix, the resampling fallback, and that a decoded
 * take of any rate comes out at 16 kHz.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downmixToMono,
  encodeMonoPcm16Wav,
  microphoneTakeAsWav,
  resampleLinear,
} from '../speechAudioWav';
import { SPEECH_INPUT_SAMPLE_RATE } from '../types';

function ascii(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}

function readHeader(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  return {
    riff: ascii(view, 0, 4),
    riffSize: view.getUint32(4, true),
    wave: ascii(view, 8, 4),
    fmt: ascii(view, 12, 4),
    fmtSize: view.getUint32(16, true),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: ascii(view, 36, 4),
    dataSize: view.getUint32(40, true),
  };
}

/** Minimal AudioBuffer stand-in for the decode stubs. */
function fakeAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    duration: channels[0].length / sampleRate,
    getChannelData: (index: number) => channels[index],
  } as unknown as AudioBuffer;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encodeMonoPcm16Wav', () => {
  it('writes a canonical 44-byte PCM header for 16 kHz mono 16-bit', () => {
    const samples = new Float32Array(1600);
    const bytes = encodeMonoPcm16Wav([samples], SPEECH_INPUT_SAMPLE_RATE);
    expect(bytes.byteLength).toBe(44 + 1600 * 2);
    expect(readHeader(bytes.buffer)).toEqual({
      riff: 'RIFF',
      riffSize: 36 + 3200,
      wave: 'WAVE',
      fmt: 'fmt ',
      fmtSize: 16,
      format: 1,
      channels: 1,
      sampleRate: 16_000,
      byteRate: 32_000,
      blockAlign: 2,
      bitsPerSample: 16,
      data: 'data',
      dataSize: 3200,
    });
  });

  it('encodes little-endian signed samples, clamped to full scale', () => {
    const bytes = encodeMonoPcm16Wav([new Float32Array([0, 1, -1, 2, -2, 0.5])], 16_000);
    const view = new DataView(bytes.buffer);
    const read = (index: number) => view.getInt16(44 + index * 2, true);
    expect([0, 1, 2, 3, 4].map(read)).toEqual([0, 0x7fff, -0x8000, 0x7fff, -0x8000]);
    expect(read(5)).toBe(Math.round(0.5 * 0x7fff));
  });

  it('down-mixes several channels by averaging', () => {
    const bytes = encodeMonoPcm16Wav([new Float32Array([1, 0]), new Float32Array([0, 0])], 16_000);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(readHeader(bytes.buffer).channels).toBe(1);
  });

  it('rejects empty audio and invalid rates', () => {
    expect(() => encodeMonoPcm16Wav([], 16_000)).toThrow(/empty/);
    expect(() => encodeMonoPcm16Wav([new Float32Array(0)], 16_000)).toThrow(/empty/);
    expect(() => encodeMonoPcm16Wav([new Float32Array(4)], 0)).toThrow(/sample rate/);
  });
});

describe('down-mix + resample helpers', () => {
  it('averages channels and passes a single channel through', () => {
    const mono = new Float32Array([0.25, -0.25]);
    expect(downmixToMono([mono])).toBe(mono);
    expect(Array.from(downmixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual(
      [0.5, 0.5],
    );
  });

  it('resamples 48 kHz to 16 kHz at a third of the length, preserving a constant signal', () => {
    const input = new Float32Array(4800).fill(0.3);
    const output = resampleLinear(input, 48_000, 16_000);
    expect(output.length).toBe(1600);
    expect(output.every((sample) => Math.abs(sample - 0.3) < 1e-6)).toBe(true);
  });

  it('returns the input unchanged when the rates match', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resampleLinear(input, 16_000, 16_000)).toBe(input);
  });
});

describe('microphoneTakeAsWav', () => {
  it('decodes through a 16 kHz OfflineAudioContext and emits 16 kHz WAV', async () => {
    const created: number[] = [];
    class FakeOfflineContext {
      constructor(_channels: number, _length: number, rate: number) {
        created.push(rate);
      }
      async decodeAudioData(): Promise<AudioBuffer> {
        // The engine resamples to the context rate during decode.
        return fakeAudioBuffer([new Float32Array(800), new Float32Array(800)], 16_000);
      }
    }
    vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
    const wav = await microphoneTakeAsWav(new Blob(['webm'], { type: 'audio/webm' }));
    expect(created).toEqual([16_000]);
    const header = readHeader(wav);
    expect(header.sampleRate).toBe(16_000);
    expect(header.channels).toBe(1);
    expect(header.dataSize).toBe(800 * 2);
  });

  it('falls back to a realtime decode plus linear resample', async () => {
    vi.stubGlobal('OfflineAudioContext', undefined);
    class FakeAudioContext {
      async decodeAudioData(): Promise<AudioBuffer> {
        return fakeAudioBuffer([new Float32Array(4800)], 48_000);
      }
      async close(): Promise<void> {}
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const wav = await microphoneTakeAsWav(new Blob(['webm'], { type: 'audio/webm' }));
    const header = readHeader(wav);
    expect(header.sampleRate).toBe(16_000);
    expect(header.dataSize).toBe(1600 * 2);
  });

  it('explains a decode failure', async () => {
    class BrokenOfflineContext {
      async decodeAudioData(): Promise<AudioBuffer> {
        throw new Error('bad container');
      }
    }
    vi.stubGlobal('OfflineAudioContext', BrokenOfflineContext);
    await expect(microphoneTakeAsWav(new Blob(['x']))).rejects.toThrow(
      /could not be prepared for speech recognition \(bad container\)/,
    );
  });
});

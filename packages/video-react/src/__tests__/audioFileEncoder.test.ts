/**
 * @vitest-environment node
 *
 * WAV path + validation + capability probe of the audio-file encoder. Node has
 * no WebCodecs, so the probe must report WAV alone and lossy formats must
 * reject rather than silently degrade. The lossy (mediabunny) path runs
 * against registered fake codecs in `audioFileEncoderLossy.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  createAudioFileEncoder,
  supportedAudioFileFormats,
  type AudioFileEncoderOptions,
} from '../audioFile/audioFileEncoder.js';
import { createWavStreamWriter, MAX_WAV_DATA_BYTES, wavHeader } from '../audioFile/wavStream.js';

interface ParsedWav {
  riffSize: number;
  format: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataSize: number;
  samples: Int16Array;
}

async function parseWav(blob: Blob): Promise<ParsedWav> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  expect(ascii(0)).toBe('RIFF');
  expect(ascii(8)).toBe('WAVE');
  expect(ascii(12)).toBe('fmt ');
  expect(ascii(36)).toBe('data');
  const dataSize = view.getUint32(40, true);
  const samples = new Int16Array(dataSize / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true);
  return {
    riffSize: view.getUint32(4, true),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize,
    samples,
  };
}

describe('createAudioFileEncoder — wav', () => {
  it('streams appends into a valid 16-bit PCM WAV with the final sizes in its header', async () => {
    const encoder = await createAudioFileEncoder({
      format: 'wav',
      sampleRate: 24_000,
      channels: 1,
    });
    expect(encoder.format).toBe('wav');
    expect(encoder.mimeType).toBe('audio/wav');
    expect(encoder.extension).toBe('wav');

    await encoder.append([new Float32Array([0, 0.5, -0.5])]);
    await encoder.append([new Float32Array([1, -1, 2, -2, Number.NaN])]);
    const blob = await encoder.finish();
    expect(blob.type).toBe('audio/wav');

    const wav = await parseWav(blob);
    expect(blob.size).toBe(44 + 8 * 2);
    expect(wav).toMatchObject({
      riffSize: 36 + 16,
      format: 1,
      channels: 1,
      sampleRate: 24_000,
      byteRate: 48_000,
      blockAlign: 2,
      bitsPerSample: 16,
      dataSize: 16,
    });
    // Quantized, clamped, NaN → silence.
    expect([...wav.samples]).toEqual([0, 16384, -16384, 32767, -32768, 32767, -32768, 0]);
  });

  it('interleaves stereo frames L, R, L, R', async () => {
    const encoder = await createAudioFileEncoder({
      format: 'wav',
      sampleRate: 48_000,
      channels: 2,
    });
    await encoder.append([new Float32Array([0.25, 0.5]), new Float32Array([-0.25, -0.5])]);
    const wav = await parseWav(await encoder.finish());
    expect(wav.channels).toBe(2);
    expect(wav.blockAlign).toBe(4);
    expect(wav.byteRate).toBe(192_000);
    expect([...wav.samples]).toEqual([8192, -8192, 16384, -16384]);
  });

  it('keeps every frame across many scratch-buffer flushes', async () => {
    const writer = createWavStreamWriter(8_000, 2, { chunkBytes: 12 });
    const left = new Float32Array(1_001).map((_, i) => (i % 100) / 100);
    const right = left.map((v) => -v);
    writer.append([left.subarray(0, 500), right.subarray(0, 500)]);
    writer.append([left.subarray(500), right.subarray(500)]);
    expect(writer.dataBytes).toBe(1_001 * 4);
    const wav = await parseWav(writer.finish());
    expect(wav.dataSize).toBe(1_001 * 4);
    expect(wav.samples[2 * 999]).toBe(Math.round(left[999] * 32767));
    expect(wav.samples[2 * 999 + 1]).toBe(Math.round(right[999] * 32768));
  });

  it('writes a header-only file when nothing was appended', async () => {
    const encoder = await createAudioFileEncoder({
      format: 'wav',
      sampleRate: 16_000,
      channels: 1,
    });
    const wav = await parseWav(await encoder.finish());
    expect(wav.dataSize).toBe(0);
    expect(wav.riffSize).toBe(36);
  });

  it('rejects appends after finish or cancel', async () => {
    const finished = await createAudioFileEncoder({
      format: 'wav',
      sampleRate: 16_000,
      channels: 1,
    });
    await finished.finish();
    await expect(finished.append([new Float32Array(1)])).rejects.toThrow('already finished');
    await expect(finished.finish()).rejects.toThrow('already finished');

    const cancelled = await createAudioFileEncoder({
      format: 'wav',
      sampleRate: 16_000,
      channels: 1,
    });
    await cancelled.cancel();
    await expect(cancelled.append([new Float32Array(1)])).rejects.toThrow('cancelled');
  });

  it('rejects malformed blocks', async () => {
    const encoder = await createAudioFileEncoder({
      format: 'wav',
      sampleRate: 16_000,
      channels: 2,
    });
    await expect(encoder.append([new Float32Array(4)])).rejects.toThrow('Expected 2 channel(s)');
    await expect(encoder.append([new Float32Array(4), new Float32Array(3)])).rejects.toThrow(
      'same length',
    );
    // A rejected append does not wedge the queue.
    await encoder.append([new Float32Array(2), new Float32Array(2)]);
    expect((await parseWav(await encoder.finish())).dataSize).toBe(8);
  });

  it('refuses to grow past the 4 GiB RIFF limit', () => {
    expect(MAX_WAV_DATA_BYTES).toBe(0xffffffff - 36);
    const header = new DataView(wavHeader(48_000, 2, MAX_WAV_DATA_BYTES).buffer);
    expect(header.getUint32(4, true)).toBe(0xffffffff);
  });
});

describe('createAudioFileEncoder — options and capability', () => {
  it.each<[string, AudioFileEncoderOptions]>([
    ['unknown format', { format: 'mp3' as never, sampleRate: 48_000, channels: 2 }],
    ['fractional rate', { format: 'wav', sampleRate: 44_100.5, channels: 2 }],
    ['tiny rate', { format: 'wav', sampleRate: 100, channels: 1 }],
    ['three channels', { format: 'wav', sampleRate: 48_000, channels: 3 as never }],
    ['absurd bitrate', { format: 'opus-webm', sampleRate: 48_000, channels: 1, bitrate: 10 }],
  ])('rejects %s', async (_name, options) => {
    await expect(createAudioFileEncoder(options)).rejects.toThrow(RangeError);
  });

  it('reports only WAV where WebCodecs audio encoders are absent', async () => {
    expect(typeof AudioEncoder).toBe('undefined');
    await expect(supportedAudioFileFormats()).resolves.toEqual(['wav']);
  });

  it('rejects a lossy format the runtime cannot encode instead of switching formats', async () => {
    await expect(
      createAudioFileEncoder({ format: 'm4a', sampleRate: 24_000, channels: 1 }),
    ).rejects.toThrow('cannot encode AAC (M4A) audio');
    await expect(
      createAudioFileEncoder({ format: 'opus-webm', sampleRate: 48_000, channels: 2 }),
    ).rejects.toThrow('cannot encode Opus (WebM) audio');
  });
});

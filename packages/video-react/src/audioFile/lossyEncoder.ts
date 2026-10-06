/**
 * The mediabunny-backed half of the audio-file encoder (AAC/M4A and
 * Opus/WebM). Loaded only through a dynamic import from `audioFileEncoder.ts`,
 * and imports mediabunny by NAME so the bundler keeps just the writers this
 * path uses — a namespace import would drag every demuxer and muxer along.
 */

import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
} from 'mediabunny';
import { createResampler, type StreamingResampler } from './resampler.js';
import {
  assertOpen,
  blockFrames,
  createSerialQueue,
  type AudioFileEncoder,
  type AudioFileEncoderOptions,
  type EncoderState,
  type LossyFormatInfo,
} from './shared.js';

/** Rates WebCodecs encoders commonly accept, tried after the caller's own rate. */
const FALLBACK_ENCODE_RATES = [48_000, 44_100] as const;
/** Input seconds encoded per slice: bounds the temporary copies an append makes. */
const SLICE_SECONDS = 0.5;

/**
 * The first sample rate the codec can encode at this channel count: the input
 * rate when possible (no resampling), else 48 kHz, else 44.1 kHz.
 */
export async function pickEncodeRate(
  codec: LossyFormatInfo['codec'],
  channels: number,
  inputRate: number,
  bitrate: number,
): Promise<number | null> {
  const candidates = [inputRate, ...FALLBACK_ENCODE_RATES.filter((rate) => rate !== inputRate)];
  for (const sampleRate of candidates) {
    if (await canEncodeAudio(codec, { numberOfChannels: channels, sampleRate, bitrate })) {
      return sampleRate;
    }
  }
  return null;
}

/** Whether this runtime can encode the format at all (stereo or mono, 48/44.1 kHz). */
export async function canEncodeLossyFormat(info: LossyFormatInfo): Promise<boolean> {
  for (const channels of [2, 1] as const) {
    if ((await pickEncodeRate(info.codec, channels, 48_000, info.bitrate[channels])) !== null) {
      return true;
    }
  }
  return false;
}

export async function createLossyEncoder(
  options: AudioFileEncoderOptions,
  info: LossyFormatInfo,
): Promise<AudioFileEncoder> {
  const channels = options.channels;
  const bitrate = options.bitrate ?? info.bitrate[channels];
  const encodeRate = await pickEncodeRate(info.codec, channels, options.sampleRate, bitrate);
  if (encodeRate === null) {
    throw new Error(`This browser cannot encode ${info.label} audio.`);
  }

  const target = new BufferTarget();
  const output = new Output({
    // Audio-only MP4 (no video track), metadata up front for progressive playback.
    format:
      info.codec === 'aac'
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
    target,
  });
  const source = new AudioSampleSource({ codec: info.codec, bitrate });
  output.addAudioTrack(source);
  await output.start();

  const resamplers: StreamingResampler[] | null =
    encodeRate === options.sampleRate
      ? null
      : Array.from({ length: channels }, () => createResampler(options.sampleRate, encodeRate));
  const sliceFrames = Math.max(1024, Math.round(options.sampleRate * SLICE_SECONDS));
  const serial = createSerialQueue();
  let state: EncoderState = 'open';
  let written = 0; // frames at encodeRate

  const encodeBlock = async (planar: readonly Float32Array[]): Promise<void> => {
    const frames = planar[0]?.length ?? 0;
    if (frames === 0) return;
    const data = new Float32Array(frames * channels);
    for (let c = 0; c < channels; c++) data.set(planar[c], c * frames);
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: channels,
      sampleRate: encodeRate,
      timestamp: written / encodeRate,
    });
    try {
      await source.add(sample);
    } finally {
      sample.close();
    }
    written += frames;
  };

  return {
    format: info.format,
    mimeType: info.mimeType,
    extension: info.extension,
    append: (block) =>
      serial(async () => {
        assertOpen(state);
        const frames = blockFrames(block, channels);
        for (let start = 0; start < frames; start += sliceFrames) {
          assertOpen(state);
          const end = Math.min(frames, start + sliceFrames);
          const slice = block.map((channel) => channel.subarray(start, end));
          await encodeBlock(resamplers ? slice.map((s, c) => resamplers[c].process(s)) : slice);
        }
      }),
    finish: () =>
      serial(async () => {
        assertOpen(state);
        if (resamplers) await encodeBlock(resamplers.map((resampler) => resampler.flush()));
        if (written === 0) {
          state = 'cancelled';
          await output.cancel();
          throw new Error('Cannot finish an empty audio file: no samples were appended.');
        }
        state = 'finished';
        source.close();
        await output.finalize();
        if (!target.buffer) throw new Error('The audio encoder produced no output.');
        return new Blob([target.buffer], { type: info.mimeType });
      }),
    cancel: async () => {
      if (state !== 'open') return;
      state = 'cancelled';
      await output.cancel();
    },
  };
}

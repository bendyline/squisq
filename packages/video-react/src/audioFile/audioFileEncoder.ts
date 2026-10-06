/**
 * Streaming audio-file encoder: planar float32 PCM in, an M4A (AAC), Opus/WebM
 * or WAV `Blob` out.
 *
 * - `m4a` — AAC in an audio-only MP4 (mediabunny's MP4 writer; unlike the
 *   video export's muxer it declares no video track). Needs a WebCodecs AAC
 *   encoder, which Linux Chromium lacks.
 * - `opus-webm` — Opus in WebM, the container recorded takes already use.
 * - `wav` — 16-bit PCM, always available, written by a streaming writer.
 *
 * Callers append blocks at their own sample rate. When the codec cannot encode
 * that rate (WebCodecs AAC takes only 44.1/48 kHz; TTS commonly emits 24 kHz)
 * the encoder resamples in-stream with a band-limited converter. Input is
 * consumed in short slices, so appending even a whole document's buffer never
 * allocates another copy of it; lossy output accumulates as encoded bytes only.
 *
 * The lossy path (mediabunny) sits behind a dynamic import, so WAV-only
 * callers and the rest of the `/encoder` entry never load it.
 */

import { createWavStreamWriter } from './wavStream.js';
import {
  LOSSY_FORMATS,
  assertOpen,
  blockFrames,
  createSerialQueue,
  type AudioFileEncoder,
  type AudioFileEncoderOptions,
  type AudioFileFormat,
  type EncoderState,
} from './shared.js';

export type { AudioFileEncoder, AudioFileEncoderOptions, AudioFileFormat } from './shared.js';

type LossyModule = typeof import('./lossyEncoder.js');

let lossyModule: Promise<LossyModule> | null = null;
function loadLossyModule(): Promise<LossyModule> {
  lossyModule ??= import('./lossyEncoder.js');
  return lossyModule;
}

function validateOptions(options: AudioFileEncoderOptions): void {
  if (options.format !== 'wav' && !(options.format in LOSSY_FORMATS)) {
    throw new RangeError(`Unknown audio file format: ${String(options.format)}`);
  }
  if (
    !Number.isInteger(options.sampleRate) ||
    options.sampleRate < 3_000 ||
    options.sampleRate > 768_000
  ) {
    throw new RangeError(`Unsupported sample rate: ${options.sampleRate}`);
  }
  if (options.channels !== 1 && options.channels !== 2) {
    throw new RangeError(`Audio files support 1 or 2 channels (got ${String(options.channels)}).`);
  }
  if (
    options.bitrate !== undefined &&
    (!Number.isFinite(options.bitrate) || options.bitrate < 6_000 || options.bitrate > 512_000)
  ) {
    throw new RangeError(`Unsupported bitrate: ${options.bitrate}`);
  }
}

/**
 * Formats this runtime can encode. `'wav'` is always included; `'m4a'` needs a
 * WebCodecs AAC encoder (absent on Linux Chromium) and `'opus-webm'` an Opus
 * one. Ordered m4a, opus-webm, wav.
 */
export async function supportedAudioFileFormats(): Promise<readonly AudioFileFormat[]> {
  const formats: AudioFileFormat[] = [];
  try {
    const lossy = await loadLossyModule();
    for (const info of [LOSSY_FORMATS.m4a, LOSSY_FORMATS['opus-webm']]) {
      if (await lossy.canEncodeLossyFormat(info)) formats.push(info.format);
    }
  } catch {
    // Without the encoder library only WAV remains possible.
  }
  formats.push('wav');
  return formats;
}

/**
 * Create a streaming encoder for one audio file. Rejects when the runtime
 * cannot encode the requested format (probe with
 * {@link supportedAudioFileFormats} first); it never silently switches format.
 */
export async function createAudioFileEncoder(
  options: AudioFileEncoderOptions,
): Promise<AudioFileEncoder> {
  validateOptions(options);
  if (options.format === 'wav') return createWavEncoder(options);
  const lossy = await loadLossyModule();
  return lossy.createLossyEncoder(options, LOSSY_FORMATS[options.format]);
}

function createWavEncoder(options: AudioFileEncoderOptions): AudioFileEncoder {
  const writer = createWavStreamWriter(options.sampleRate, options.channels);
  const serial = createSerialQueue();
  let state: EncoderState = 'open';
  return {
    format: 'wav',
    mimeType: 'audio/wav',
    extension: 'wav',
    append: (block) =>
      serial(async () => {
        assertOpen(state);
        blockFrames(block, options.channels);
        writer.append(block);
      }),
    finish: () =>
      serial(async () => {
        assertOpen(state);
        state = 'finished';
        return writer.finish();
      }),
    cancel: async () => {
      if (state === 'open') state = 'cancelled';
    },
  };
}

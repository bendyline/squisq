/**
 * Types and helpers shared by the audio-file encoder's WAV and lossy paths.
 */

export type AudioFileFormat = 'm4a' | 'opus-webm' | 'wav';

export interface AudioFileEncoderOptions {
  readonly format: AudioFileFormat;
  /** Sample rate of the PCM passed to `append` (e.g. 24000 or 48000). */
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  /** Bits per second for lossy formats. Defaults depend on format and channel count. */
  readonly bitrate?: number;
}

export interface AudioFileEncoder {
  readonly format: AudioFileFormat;
  /** `'audio/mp4'` | `'audio/webm'` | `'audio/wav'` */
  readonly mimeType: string;
  /** `'m4a'` | `'webm'` | `'wav'` */
  readonly extension: string;
  /**
   * Append planar float32 PCM, one Float32Array per channel, at
   * `options.sampleRate`. Streams; never buffers the whole file in float32.
   * Calls are serialized, but awaiting each one respects encoder backpressure.
   */
  append(channels: readonly Float32Array[]): Promise<void>;
  /** Flush and return the finished file. */
  finish(): Promise<Blob>;
  /** Abandon the file and release encoder resources. */
  cancel(): Promise<void>;
}

export type LossyAudioFileFormat = Exclude<AudioFileFormat, 'wav'>;

export interface LossyFormatInfo {
  format: LossyAudioFileFormat;
  codec: 'aac' | 'opus';
  label: string;
  mimeType: string;
  extension: string;
  /** Default bits/s by channel count. */
  bitrate: Record<1 | 2, number>;
}

export const LOSSY_FORMATS: Record<LossyAudioFileFormat, LossyFormatInfo> = {
  m4a: {
    format: 'm4a',
    codec: 'aac',
    label: 'AAC (M4A)',
    mimeType: 'audio/mp4',
    extension: 'm4a',
    bitrate: { 1: 96_000, 2: 128_000 },
  },
  'opus-webm': {
    format: 'opus-webm',
    codec: 'opus',
    label: 'Opus (WebM)',
    mimeType: 'audio/webm',
    extension: 'webm',
    bitrate: { 1: 64_000, 2: 96_000 },
  },
};

/** Validate one appended block and return its frame count. */
export function blockFrames(block: readonly Float32Array[], channels: number): number {
  if (block.length !== channels) {
    throw new RangeError(`Expected ${channels} channel(s) of PCM, got ${block.length}.`);
  }
  const frames = block[0].length;
  for (const channel of block) {
    if (!(channel instanceof Float32Array)) {
      throw new TypeError('PCM channels must be Float32Arrays.');
    }
    if (channel.length !== frames) throw new RangeError('Every channel must have the same length.');
  }
  return frames;
}

/** Serialize async operations so appends never interleave. */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}

export type EncoderState = 'open' | 'finished' | 'cancelled';

export function assertOpen(state: EncoderState): void {
  if (state === 'finished') throw new Error('The audio file encoder is already finished.');
  if (state === 'cancelled') throw new Error('The audio file encoder was cancelled.');
}

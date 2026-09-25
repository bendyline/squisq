/**
 * Encode the chain's output into the render file: Opus in WebM when
 * WebCodecs can encode Opus, 16-bit WAV otherwise. Opus keeps renders small
 * (~7 MB per 10 minutes at 96 kb/s mono) so they fit every surface's media
 * transport; WAV is the always-available fallback.
 */

import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Output,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
} from 'mediabunny';

export interface EncodedAudio {
  bytes: ArrayBuffer;
  mimeType: 'audio/webm' | 'audio/wav';
  extension: 'webm' | 'wav';
}

export interface AudioRenderSink {
  write(block: Float32Array[]): Promise<void>;
  finish(): Promise<EncodedAudio>;
  cancel(): Promise<void>;
}

/** Opus bitrate per channel. Speech is transparent well below this. */
const OPUS_BITRATE_PER_CHANNEL = 96_000;

export async function createAudioRenderSink(
  channels: number,
  sampleRate: number,
): Promise<AudioRenderSink> {
  const bitrate = OPUS_BITRATE_PER_CHANNEL * channels;
  const opus = await canEncodeAudio('opus', { numberOfChannels: channels, sampleRate, bitrate });
  const target = new BufferTarget();
  const output = new Output({
    format: opus ? new WebMOutputFormat() : new WavOutputFormat(),
    target,
  });
  const source = new AudioSampleSource(opus ? { codec: 'opus', bitrate } : { codec: 'pcm-s16' });
  output.addAudioTrack(source);
  await output.start();
  let written = 0;

  return {
    async write(block) {
      const frames = block[0]?.length ?? 0;
      if (frames === 0) return;
      const data = new Float32Array(frames * channels);
      for (let c = 0; c < channels; c++) data.set(block[c], c * frames);
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: channels,
        sampleRate,
        timestamp: written / sampleRate,
      });
      try {
        await source.add(sample);
      } finally {
        sample.close();
      }
      written += frames;
    },
    async finish() {
      source.close();
      await output.finalize();
      if (!target.buffer) throw new Error('The audio render produced no output.');
      return opus
        ? { bytes: target.buffer, mimeType: 'audio/webm', extension: 'webm' }
        : { bytes: target.buffer, mimeType: 'audio/wav', extension: 'wav' };
    },
    cancel: () => output.cancel(),
  };
}

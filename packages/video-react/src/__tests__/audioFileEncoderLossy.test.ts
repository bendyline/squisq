/**
 * @vitest-environment node
 *
 * The lossy path of the audio-file encoder, end to end through mediabunny's
 * real MP4/WebM writers. Node has no WebCodecs, so fake AAC and Opus encoders
 * are registered with mediabunny (its supported seam for custom codecs). The
 * fake AAC encoder accepts only 44.1/48 kHz — like WebCodecs AAC — which
 * forces the encoder to resample a 24 kHz TTS stream in-stream.
 *
 * Kept in its own file: codec registration and mediabunny's `canEncodeAudio`
 * memo are process-global, and the WAV-only suite asserts their absence.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_FORMATS,
  BufferSource,
  CustomAudioEncoder,
  EncodedPacket,
  Input,
  registerEncoder,
  type AudioCodec,
  type AudioSample,
} from 'mediabunny';
import {
  createAudioFileEncoder,
  supportedAudioFileFormats,
} from '../audioFile/audioFileEncoder.js';

interface EncodeLog {
  frames: number;
  sampleRates: Set<number>;
  /** End time of the last sample, to prove timestamps are contiguous. */
  cursor: number;
  gaps: number;
  peak: number;
}

const logs: Record<'aac' | 'opus', EncodeLog> = {
  aac: { frames: 0, sampleRates: new Set(), cursor: 0, gaps: 0, peak: 0 },
  opus: { frames: 0, sampleRates: new Set(), cursor: 0, gaps: 0, peak: 0 },
};

function resetLog(codec: 'aac' | 'opus'): void {
  logs[codec] = { frames: 0, sampleRates: new Set(), cursor: 0, gaps: 0, peak: 0 };
}

const AAC_RATE_INDEX: Record<number, number> = { 48_000: 3, 44_100: 4 };

/** AudioSpecificConfig for AAC-LC (object type 2). */
function aacAudioSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const bits = (2 << 11) | (AAC_RATE_INDEX[sampleRate] << 7) | (channels << 3);
  return new Uint8Array([bits >> 8, bits & 0xff]);
}

/** RFC 7845 identification header. */
function opusHead(sampleRate: number, channels: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set([...'OpusHead'].map((c) => c.charCodeAt(0)));
  const view = new DataView(head.buffer);
  view.setUint8(8, 1);
  view.setUint8(9, channels);
  view.setUint16(10, 312, true);
  view.setUint32(12, sampleRate, true);
  return head;
}

abstract class FakeEncoder extends CustomAudioEncoder {
  private sentConfig = false;
  protected abstract get log(): EncodeLog;
  protected abstract decoderConfig(): AudioDecoderConfig;

  init(): void {}

  encode(sample: AudioSample): void {
    const log = this.log;
    if (Math.abs(sample.timestamp - log.cursor) > 1e-6) log.gaps += 1;
    log.cursor = sample.timestamp + sample.duration;
    log.frames += sample.numberOfFrames;
    log.sampleRates.add(sample.sampleRate);
    const pcm = new Float32Array(sample.numberOfFrames);
    sample.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
    for (const value of pcm) log.peak = Math.max(log.peak, Math.abs(value));

    const meta = this.sentConfig ? undefined : { decoderConfig: this.decoderConfig() };
    this.sentConfig = true;
    this.onPacket(
      new EncodedPacket(
        new Uint8Array([0x21, 0x10, 0x04]),
        'key',
        sample.timestamp,
        sample.duration,
      ),
      meta,
    );
  }

  flush(): void {}
  close(): void {}
}

class FakeAacEncoder extends FakeEncoder {
  static override supports(codec: AudioCodec, config: AudioEncoderConfig): boolean {
    return codec === 'aac' && config.sampleRate in AAC_RATE_INDEX;
  }
  protected get log(): EncodeLog {
    return logs.aac;
  }
  protected decoderConfig(): AudioDecoderConfig {
    return {
      codec: 'mp4a.40.2',
      sampleRate: this.config.sampleRate,
      numberOfChannels: this.config.numberOfChannels,
      description: aacAudioSpecificConfig(this.config.sampleRate, this.config.numberOfChannels),
    };
  }
}

class FakeOpusEncoder extends FakeEncoder {
  static override supports(codec: AudioCodec): boolean {
    return codec === 'opus';
  }
  protected get log(): EncodeLog {
    return logs.opus;
  }
  protected decoderConfig(): AudioDecoderConfig {
    return {
      codec: 'opus',
      sampleRate: this.config.sampleRate,
      numberOfChannels: this.config.numberOfChannels,
      description: opusHead(this.config.sampleRate, this.config.numberOfChannels),
    };
  }
}

function tone(frames: number, rate: number): Float32Array {
  return new Float32Array(frames).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
}

async function demux(blob: Blob) {
  const input = new Input({
    source: new BufferSource(await blob.arrayBuffer()),
    formats: ALL_FORMATS,
  });
  return {
    audio: await input.getAudioTracks(),
    video: await input.getVideoTracks(),
    duration: await input.computeDuration(),
  };
}

beforeAll(() => {
  registerEncoder(FakeAacEncoder);
  registerEncoder(FakeOpusEncoder);
});

describe('createAudioFileEncoder — m4a', () => {
  it('resamples 24 kHz TTS to 48 kHz and writes an audio-only MP4 (no video track)', async () => {
    resetLog('aac');
    const encoder = await createAudioFileEncoder({
      format: 'm4a',
      sampleRate: 24_000,
      channels: 1,
    });
    expect(encoder.mimeType).toBe('audio/mp4');
    expect(encoder.extension).toBe('m4a');

    // 1.5 s in uneven chunks, including one larger than the encoder's slice.
    const input = tone(36_000, 24_000);
    await encoder.append([input.subarray(0, 1_000)]);
    await encoder.append([input.subarray(1_000, 20_000)]);
    await encoder.append([input.subarray(20_000)]);
    const blob = await encoder.finish();
    expect(blob.type).toBe('audio/mp4');

    expect(logs.aac.sampleRates).toEqual(new Set([48_000]));
    expect(logs.aac.frames).toBe(72_000); // exactly 2× the 24 kHz input
    expect(logs.aac.gaps).toBe(0);
    expect(logs.aac.peak).toBeGreaterThan(0.45);
    expect(logs.aac.peak).toBeLessThan(0.55);

    const file = await demux(blob);
    expect(file.video).toHaveLength(0);
    expect(file.audio).toHaveLength(1);
    expect(file.audio[0].codec).toBe('aac');
    expect(file.audio[0].sampleRate).toBe(48_000);
    expect(file.audio[0].numberOfChannels).toBe(1);
    expect(file.duration).toBeCloseTo(1.5, 2);
  });

  it('encodes 48 kHz stereo without resampling', async () => {
    resetLog('aac');
    const encoder = await createAudioFileEncoder({
      format: 'm4a',
      sampleRate: 48_000,
      channels: 2,
    });
    const left = tone(48_000, 48_000);
    await encoder.append([left, left.map((v) => -v)]);
    const file = await demux(await encoder.finish());
    expect(logs.aac.frames).toBe(48_000);
    expect(file.audio[0].numberOfChannels).toBe(2);
    expect(file.duration).toBeCloseTo(1, 2);
  });
});

describe('createAudioFileEncoder — opus-webm', () => {
  it('keeps a rate the codec accepts and writes a WebM audio track', async () => {
    resetLog('opus');
    const encoder = await createAudioFileEncoder({
      format: 'opus-webm',
      sampleRate: 24_000,
      channels: 1,
    });
    expect(encoder.mimeType).toBe('audio/webm');
    expect(encoder.extension).toBe('webm');
    await encoder.append([tone(24_000, 24_000)]);
    const blob = await encoder.finish();
    expect(blob.type).toBe('audio/webm');
    expect(logs.opus.sampleRates).toEqual(new Set([24_000]));
    expect(logs.opus.frames).toBe(24_000);

    const file = await demux(blob);
    expect(file.video).toHaveLength(0);
    expect(file.audio).toHaveLength(1);
    expect(file.audio[0].codec).toBe('opus');
  });
});

describe('lossy encoder lifecycle', () => {
  it('lists every encodable format once codecs exist', async () => {
    await expect(supportedAudioFileFormats()).resolves.toEqual(['m4a', 'opus-webm', 'wav']);
  });

  it('refuses to finish an empty file', async () => {
    const encoder = await createAudioFileEncoder({
      format: 'm4a',
      sampleRate: 48_000,
      channels: 1,
    });
    await expect(encoder.finish()).rejects.toThrow('no samples were appended');
  });

  it('rejects appends after cancel', async () => {
    const encoder = await createAudioFileEncoder({
      format: 'opus-webm',
      sampleRate: 48_000,
      channels: 1,
    });
    await encoder.append([tone(4_800, 48_000)]);
    await encoder.cancel();
    await expect(encoder.append([tone(10, 48_000)])).rejects.toThrow('cancelled');
    await expect(encoder.finish()).rejects.toThrow('cancelled');
  });
});

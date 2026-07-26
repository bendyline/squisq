/**
 * audioTrack — In-browser audio rendering + AAC encoding for MP4 export.
 *
 * Replaces the CLI's ffmpeg `adelay`/`atrim`/`amix` graph with browser-native
 * primitives:
 *
 *  - {@link supportsWebCodecsAac} probes whether the browser can encode AAC
 *    (WebCodecs `AudioEncoder`).
 *  - {@link renderAudioTimeline} mixes an {@link AudioTimelineClip} list into a
 *    single `AudioBuffer` using an `OfflineAudioContext` (decode → schedule →
 *    render).
 *  - {@link encodeAacTrack} feeds that buffer through a WebCodecs
 *    `AudioEncoder` and hands the chunks to an mp4-muxer audio track (tier 1).
 *  - {@link audioBufferToWav} + {@link muxAudioWithFfmpegWasm} cover the
 *    ffmpeg.wasm fallback (tier 2).
 *  - {@link selectAudioTier} is the pure capability→tier decision shared with
 *    `useVideoExport` (and unit-tested at the module boundary).
 */

import {
  ffmpegAudioMuxArgs,
  resolveFfmpegWasmLoad,
  type AudioTimelineClip,
  type FfmpegWasmLoadConfig,
} from '@bendyline/squisq-video';

/** Sample rate the export renders + encodes audio at. */
export const EXPORT_AUDIO_SAMPLE_RATE = 48_000;
/** Channel count the export renders + encodes audio at (stereo). */
export const EXPORT_AUDIO_CHANNELS = 2;

/** Tier-3 reason used when AAC encoding is impossible and no ffmpeg fallback. */
export const REASON_NO_AAC_NO_SAB =
  'This browser cannot encode AAC audio (WebCodecs AudioEncoder unavailable) ' +
  'and the ffmpeg.wasm fallback requires cross-origin isolation (SharedArrayBuffer).';

// ── Capability probe ───────────────────────────────────────────────

/**
 * Whether the browser can encode AAC (`mp4a.40.2`) via WebCodecs.
 * Returns false when `AudioEncoder` is undefined (e.g. Node/jsdom, Safari,
 * older Chromium) or the config is unsupported.
 */
export async function supportsWebCodecsAac(
  sampleRate: number = EXPORT_AUDIO_SAMPLE_RATE,
  channels: number = EXPORT_AUDIO_CHANNELS,
): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: channels,
      bitrate: 128_000,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

// ── Tier selection (pure) ──────────────────────────────────────────

export interface AudioTierInputs {
  /** Whether the doc has any audio timeline clips to include at all. */
  hasClips: boolean;
  /** Whether WebCodecs AAC encoding is available. */
  aacSupported: boolean;
  /** Whether `SharedArrayBuffer` (ffmpeg.wasm path) is available. */
  sharedArrayBufferAvailable: boolean;
  /** Whether the main-thread WebCodecs H.264 encoder is in use (tier-1 host). */
  canUseMainThreadWebCodecs: boolean;
}

export interface AudioTierDecision {
  /**
   * 1 → inline AAC into the video muxer.
   * 2 → finalize video-only then ffmpeg.wasm mux pass.
   * 3 → video-only (no audio).
   */
  tier: 1 | 2 | 3;
  /**
   * Reason audio will be absent, when tier 3. `null` means "there was simply
   * no audio to include" (not a failure). Non-null for a genuine capability
   * shortfall. Always `null` for tiers 1 and 2 (the attempt is expected to
   * succeed; the caller downgrades with a fresh reason on runtime failure).
   */
  reason: string | null;
}

/**
 * Decide which audio tier to run from capability booleans. Pure — the single
 * source of truth for tier selection, shared with `useVideoExport`.
 */
export function selectAudioTier(inputs: AudioTierInputs): AudioTierDecision {
  if (!inputs.hasClips) {
    return { tier: 3, reason: null };
  }
  if (inputs.aacSupported && inputs.canUseMainThreadWebCodecs) {
    return { tier: 1, reason: null };
  }
  if (inputs.sharedArrayBufferAvailable) {
    return { tier: 2, reason: null };
  }
  return { tier: 3, reason: REASON_NO_AAC_NO_SAB };
}

// ── OfflineAudioContext rendering ──────────────────────────────────

type OfflineCtor = new (
  numberOfChannels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

function resolveOfflineAudioContext(): OfflineCtor {
  const g = globalThis as unknown as {
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  const ctor = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!ctor) {
    throw new Error('OfflineAudioContext is not available in this environment.');
  }
  return ctor;
}

/**
 * Mix a list of timeline clips into one `AudioBuffer`.
 *
 * Decodes each unique source once, then schedules an `AudioBufferSourceNode`
 * per clip at its `startSec` with the trim window (`offset = sourceInSec`,
 * `duration = durationSec`). Authored audio/narration sources must decode.
 * Video sources are optional because a valid video can be silent: each is
 * decoded independently, silent ones are skipped, and every audible video is
 * connected to the same destination so overlapping tracks are mixed.
 */
export async function renderAudioTimeline(
  clips: AudioTimelineClip[],
  buffers: Map<string, ArrayBuffer>,
  totalDurationSec: number,
  sampleRate: number = EXPORT_AUDIO_SAMPLE_RATE,
): Promise<AudioBuffer | null> {
  const Ctor = resolveOfflineAudioContext();
  const channels = EXPORT_AUDIO_CHANNELS;
  const length = Math.max(1, Math.ceil(totalDurationSec * sampleRate));
  const ctx = new Ctor(channels, length, sampleRate);

  // Decode each unique source once. decodeAudioData detaches the buffer, so
  // hand it a copy to keep the caller's ArrayBuffer reusable.
  const decoded = new Map<string, AudioBuffer>();
  const decodeFailures: string[] = [];
  for (const [src, data] of buffers) {
    try {
      decoded.set(src, await ctx.decodeAudioData(data.slice(0)));
    } catch {
      decodeFailures.push(src);
    }
  }
  const requiredFailures = decodeFailures.filter((src) =>
    clips.some((clip) => clip.src === src && clip.sourceKind !== 'video'),
  );
  if (requiredFailures.length > 0) {
    throw new Error(`No decodable audio track was found in: ${requiredFailures.join(', ')}`);
  }

  const scheduledNodes: AudioBufferSourceNode[] = [];
  try {
    for (const clip of clips) {
      const buffer = decoded.get(clip.src);
      if (!buffer) {
        // A video can legitimately have no audio stream. Its visual frames
        // still export; this source simply contributes silence to the mix.
        if (clip.sourceKind === 'video') continue;
        throw new Error(`Audio source was not decoded: ${clip.src}`);
      }
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      const when = Math.max(0, clip.startSec);
      const offset = Math.max(0, clip.sourceInSec);
      const duration = Math.max(0, clip.durationSec);
      node.start(when, offset, duration);
      scheduledNodes.push(node);
    }

    if (scheduledNodes.length === 0) return null;
    return await ctx.startRendering();
  } finally {
    // OfflineAudioContext retains scheduled sources and their decoded PCM.
    // Disconnect and detach them as soon as the mixed result exists so only
    // that one output buffer survives into the export pipeline.
    for (const node of scheduledNodes) {
      node.disconnect();
      node.buffer = null;
    }
    decoded.clear();
  }
}

// ── WebCodecs AAC encode (tier 1) ──────────────────────────────────

const AAC_FRAME_SAMPLES = 1024;
const MAX_AAC_QUEUE_SECONDS = 2;

/** Minimal muxer surface {@link encodeAacTrack} needs. */
export interface AudioChunkSink {
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
}

/**
 * Encode an `AudioBuffer` to AAC via WebCodecs and feed the chunks to `sink`.
 * Resolves once every chunk has been flushed to the muxer. Throws only if the
 * `AudioEncoder` errors — the caller wraps this so audio failure never aborts
 * the video export.
 */
export async function encodeAacTrack(
  audioBuffer: AudioBuffer,
  sink: AudioChunkSink,
  bitrate: number,
): Promise<void> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
    throw new Error('WebCodecs AudioEncoder is not available.');
  }

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;

  let encodeError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => sink.addAudioChunk(chunk, meta ?? undefined),
    error: (err) => {
      encodeError = err instanceof Error ? err : new Error(String(err));
    },
  });

  encoder.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate });

  const total = audioBuffer.length;
  const queueLimit = Math.max(
    1,
    Math.ceil((sampleRate * MAX_AAC_QUEUE_SECONDS) / AAC_FRAME_SAMPLES),
  );
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  try {
    for (let offset = 0; offset < total; offset += AAC_FRAME_SAMPLES) {
      if (encodeError) throw encodeError;
      // Closing AudioData does not guarantee Chromium has released the native
      // PCM surface. Drain at a short timeline bound rather than queueing a
      // multi-minute narration in one burst.
      if (encoder.encodeQueueSize >= queueLimit) {
        await encoder.flush();
        if (encodeError) throw encodeError;
      }

      const count = Math.min(AAC_FRAME_SAMPLES, total - offset);
      // Planar layout: all of channel 0, then all of channel 1, …
      const planar = new Float32Array(count * channels);
      for (let ch = 0; ch < channels; ch++) {
        planar.set(channelData[ch].subarray(offset, offset + count), ch * count);
      }
      const timestamp = Math.round((offset / sampleRate) * 1_000_000);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: count,
        numberOfChannels: channels,
        timestamp,
        data: planar,
      });
      try {
        encoder.encode(audioData);
      } finally {
        audioData.close();
      }
    }

    await encoder.flush();
    if (encodeError) throw encodeError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

// ── WAV serialization (tier 2 input) ───────────────────────────────

/**
 * Serialize an `AudioBuffer` to a 16-bit PCM WAV byte array. Used to hand the
 * rendered audio to the ffmpeg.wasm fallback for muxing.
 */
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) channelData.push(buffer.getChannelData(ch));

  let pos = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      let sample = channelData[ch][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      pos += 2;
    }
  }

  return new Uint8Array(out);
}

// ── ffmpeg.wasm mux fallback (tier 2) ──────────────────────────────

/**
 * Mux a pre-encoded video-only MP4 with a WAV audio track in a single
 * ffmpeg.wasm pass (`-c:v copy -c:a aac -af apad -shortest`). Requires
 * `SharedArrayBuffer` (cross-origin isolation). Returns the muxed MP4 bytes.
 */
export async function muxAudioWithFfmpegWasm(
  videoMp4: Uint8Array,
  wav: Uint8Array,
  audioBitrate: number,
  loadConfig?: FfmpegWasmLoadConfig,
): Promise<Uint8Array> {
  // Validate runtime assets first: an unconfigured core must fail with an
  // actionable message rather than silently fetching the unpkg CDN default.
  const load = resolveFfmpegWasmLoad(loadConfig, 'ffmpeg.wasm audio muxing', {
    classWorkerURL: new URL('./workers/ffmpeg.class-worker.js', import.meta.url).href,
  });

  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  try {
    await ffmpeg.load(load);
    await ffmpeg.writeFile('video.mp4', videoMp4);
    await ffmpeg.writeFile('audio.wav', wav);
    const exitCode = await ffmpeg.exec([
      '-i',
      'video.mp4',
      '-i',
      'audio.wav',
      '-c:v',
      'copy',
      ...ffmpegAudioMuxArgs(audioBitrate),
      'out.mp4',
    ]);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg.wasm audio mux failed with exit code ${exitCode}`);
    }
    const data = await ffmpeg.readFile('out.mp4');
    return data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
  } finally {
    ffmpeg.terminate();
  }
}

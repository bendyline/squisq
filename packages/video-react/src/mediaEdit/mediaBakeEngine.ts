/**
 * Media-bake engine (browser): a clip with its whole recipe applied, encoded
 * as one ordinary media file — for players that cannot apply a recipe.
 *
 * Audio clips: decode the trim window once, drop the cut ranges, apply gain
 * and fades, encode (M4A where the browser can encode AAC, else Opus in WebM,
 * else WAV). Video clips: decode the kept ranges, crop, re-encode (H.264 in
 * MP4 where available, else VP9/VP8 in WebM) and mux with the same baked
 * audio. The sound comes from the clip's processed-audio render when the
 * caller passes one, so the signal chain is never run twice.
 *
 * Realm-agnostic, like the render engine: runs in the media-edit worker, or
 * on the main thread as a fallback.
 */

import {
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink,
  VideoSampleSource,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  getFirstEncodableVideoCodec,
  type OutputFormat,
} from 'mediabunny';
import {
  MEDIA_BAKE_ENGINE,
  createMediaBakeAudioStage,
  createMediaTimeMap,
  mediaBakeFrameRanges,
  type MediaBakeAudioStage,
  type MediaCrop,
  type MediaCut,
  type MediaTimeMap,
} from '@bendyline/squisq/mediaEdit';
import {
  MEDIA_INPUT_FORMATS,
  openMediaAudio,
  type DecodedAudioSource,
} from './mediaAudioSource.js';

export interface MediaBakeRequest {
  /** The clip's source file. */
  source: Blob;
  kind: 'audio' | 'video';
  /**
   * Processed audio to use for the sound instead of the source's own: an `fx`
   * render, which is sample-aligned with the source's audio track.
   */
  audio?: Blob;
  /** Source in-point in seconds. Default 0. */
  clipStart?: number;
  /** Source out-point in seconds. Default: the source's end. */
  clipEnd?: number;
  /** Removed source ranges. */
  cuts?: MediaCut[];
  /** Clip gain in dB. */
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Video only: the part of the frame to keep. */
  crop?: MediaCrop;
}

export interface MediaBakeResult {
  bytes: ArrayBuffer;
  mimeType: string;
  extension: 'mp4' | 'webm' | 'm4a' | 'wav';
  /** Length of the baked clip in seconds. */
  durationSec: number;
  engine: string;
}

export interface MediaBakeJobOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * A cut this long or longer is skipped by seeking; a shorter one is decoded
 * through and its frames dropped. Seeking restarts the decoder at the previous
 * key frame, so for the short cuts pause-tightening makes it costs more than
 * it saves.
 */
const SEEK_PAST_CUT_SEC = 6;

/** Frame length assumed when a container gives a frame no duration. */
const FALLBACK_FRAME_SEC = 1 / 30;

const AUDIO_BITRATE_PER_CHANNEL = 96_000;

function audioBitrate(channels: number): number {
  return Math.min(192_000, AUDIO_BITRATE_PER_CHANNEL * channels);
}

function timeMapFor(request: MediaBakeRequest, sourceDuration: number): MediaTimeMap {
  const map = createMediaTimeMap({
    clipStart: request.clipStart,
    clipEnd: request.clipEnd,
    cuts: request.cuts,
    sourceDuration,
  });
  if (!(map.playedDuration > 0) || !Number.isFinite(map.playedDuration)) {
    throw new Error('Nothing is left of this clip after its trim and cuts.');
  }
  return map;
}

function audioStageFor(
  request: MediaBakeRequest,
  map: MediaTimeMap,
  sampleRate: number,
): MediaBakeAudioStage {
  return createMediaBakeAudioStage({
    ranges: mediaBakeFrameRanges(map.keptRanges(), map.windowStart, sampleRate),
    sampleRate,
    gainDb: request.gain,
    fadeInSec: request.fadeIn,
    fadeOutSec: request.fadeOut,
  });
}

/**
 * Decode `audio`'s trim window through the stage into `source`. Resolves with
 * the frames written.
 */
async function pumpAudio(
  audio: DecodedAudioSource,
  stage: MediaBakeAudioStage,
  source: AudioSampleSource,
  options: MediaBakeJobOptions,
  onFrames?: (written: number) => void,
): Promise<number> {
  let written = 0;
  for await (const block of audio.open()) {
    options.signal?.throwIfAborted();
    const kept = stage.process(block);
    if (!kept) continue;
    const frames = kept[0].length;
    const data = new Float32Array(frames * kept.length);
    kept.forEach((channel, c) => data.set(channel, c * frames));
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: kept.length,
      sampleRate: audio.sampleRate,
      timestamp: written / audio.sampleRate,
    });
    try {
      await source.add(sample);
    } finally {
      sample.close();
    }
    written += frames;
    onFrames?.(written);
  }
  return written;
}

interface AudioTarget {
  format: OutputFormat;
  codec: 'aac' | 'opus' | 'pcm-s16';
  mimeType: string;
  extension: 'm4a' | 'webm' | 'wav';
}

/** The most widely playable audio file this browser can write. */
async function pickAudioTarget(channels: number, sampleRate: number): Promise<AudioTarget> {
  const probe = { numberOfChannels: channels, sampleRate, bitrate: audioBitrate(channels) };
  if (await canEncodeAudio('aac', probe)) {
    return {
      format: new Mp4OutputFormat(),
      codec: 'aac',
      mimeType: 'audio/mp4',
      extension: 'm4a',
    };
  }
  if (await canEncodeAudio('opus', probe)) {
    return {
      format: new WebMOutputFormat(),
      codec: 'opus',
      mimeType: 'audio/webm',
      extension: 'webm',
    };
  }
  return {
    format: new WavOutputFormat(),
    codec: 'pcm-s16',
    mimeType: 'audio/wav',
    extension: 'wav',
  };
}

async function bakeAudioClip(
  request: MediaBakeRequest,
  options: MediaBakeJobOptions,
): Promise<MediaBakeResult> {
  const audio = await openMediaAudio(request.audio ?? request.source, {
    startSec: request.clipStart ?? 0,
    endSec: request.clipEnd,
  });
  if (!audio) throw new Error('This clip has no audio track to bake.');
  try {
    const map = timeMapFor(request, audio.trackDurationSec);
    const stage = audioStageFor(request, map, audio.sampleRate);
    const target = await pickAudioTarget(audio.channels, audio.sampleRate);
    const buffer = new BufferTarget();
    const output = new Output({ format: target.format, target: buffer });
    const source = new AudioSampleSource(
      target.codec === 'pcm-s16'
        ? { codec: 'pcm-s16' }
        : { codec: target.codec, bitrate: audioBitrate(audio.channels) },
    );
    output.addAudioTrack(source);
    await output.start();
    try {
      const written = await pumpAudio(audio, stage, source, options, (frames) =>
        options.onProgress?.(Math.min(1, frames / Math.max(1, stage.totalFrames))),
      );
      source.close();
      await output.finalize();
      if (!buffer.buffer) throw new Error('The bake produced no output.');
      options.onProgress?.(1);
      return {
        bytes: buffer.buffer,
        mimeType: target.mimeType,
        extension: target.extension,
        durationSec: written / audio.sampleRate,
        engine: MEDIA_BAKE_ENGINE,
      };
    } catch (err: unknown) {
      await output.cancel().catch(() => {});
      throw err;
    }
  } finally {
    audio.dispose();
  }
}

interface VideoTarget {
  format: OutputFormat;
  video: 'avc' | 'vp9' | 'vp8';
  audio: 'aac' | 'opus';
  mimeType: string;
  extension: 'mp4' | 'webm';
}

/** MP4 (H.264 + AAC) plays everywhere; WebM is the fallback where a browser cannot encode it. */
async function pickVideoTarget(
  width: number,
  height: number,
  audio: { channels: number; sampleRate: number } | null,
): Promise<VideoTarget> {
  const audioProbe = audio && {
    numberOfChannels: audio.channels,
    sampleRate: audio.sampleRate,
    bitrate: audioBitrate(audio.channels),
  };
  const size = { width, height };
  if (
    (await canEncodeVideo('avc', size)) &&
    (!audioProbe || (await canEncodeAudio('aac', audioProbe)))
  ) {
    return {
      format: new Mp4OutputFormat(),
      video: 'avc',
      audio: 'aac',
      mimeType: 'video/mp4',
      extension: 'mp4',
    };
  }
  const webm = await getFirstEncodableVideoCodec(['vp9', 'vp8'], size);
  if (webm && (!audioProbe || (await canEncodeAudio('opus', audioProbe)))) {
    return {
      format: new WebMOutputFormat(),
      video: webm as 'vp9' | 'vp8',
      audio: 'opus',
      mimeType: 'video/webm',
      extension: 'webm',
    };
  }
  throw new Error('This browser cannot encode video, so the clip cannot be baked.');
}

/**
 * The frame region to encode, in display pixels. Encoders want even
 * dimensions, so an odd-sized frame is trimmed by a pixel even with no crop.
 * Null when the whole frame is kept as is.
 */
export function bakeCropRectangle(
  crop: MediaCrop | undefined,
  displayWidth: number,
  displayHeight: number,
): { left: number; top: number; width: number; height: number } | null {
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
  const left = crop ? Math.round(crop.x * displayWidth) : 0;
  const top = crop ? Math.round(crop.y * displayHeight) : 0;
  const width = even(
    Math.min(displayWidth - left, crop ? Math.round(crop.w * displayWidth) : displayWidth),
  );
  const height = even(
    Math.min(displayHeight - top, crop ? Math.round(crop.h * displayHeight) : displayHeight),
  );
  if (left === 0 && top === 0 && width === displayWidth && height === displayHeight) return null;
  return { left, top, width, height };
}

/**
 * Kept ranges grouped into stretches decoded in one pass: a short cut is
 * decoded through, a long one starts a new stretch (a seek).
 */
export function bakeDecodeRuns(kept: readonly MediaCut[]): MediaCut[] {
  const runs: MediaCut[] = [];
  for (const range of kept) {
    const last = runs[runs.length - 1];
    if (last && range.start - last.end < SEEK_PAST_CUT_SEC) last.end = range.end;
    else runs.push({ ...range });
  }
  return runs;
}

async function bakeVideoClip(
  request: MediaBakeRequest,
  options: MediaBakeJobOptions,
): Promise<MediaBakeResult> {
  const input = new Input({ source: new BlobSource(request.source), formats: MEDIA_INPUT_FORMATS });
  let audio: DecodedAudioSource | null = null;
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This clip has no video track to bake.');
    if (!(await track.canDecode())) throw new Error('This browser cannot decode this video.');
    audio = await openMediaAudio(request.audio ?? request.source, {
      startSec: request.clipStart ?? 0,
      endSec: request.clipEnd,
    });
    // The clip runs to the end of its longer track, as a media element plays it.
    const sourceDuration = Math.max(await track.computeDuration(), audio?.trackDurationSec ?? 0);
    const map = timeMapFor(request, sourceDuration);
    const crop = bakeCropRectangle(request.crop, track.displayWidth, track.displayHeight);
    const width = crop?.width ?? track.displayWidth;
    const height = crop?.height ?? track.displayHeight;
    const target = await pickVideoTarget(width, height, audio);

    const buffer = new BufferTarget();
    const output = new Output({ format: target.format, target: buffer });
    const videoSource = new VideoSampleSource({
      codec: target.video,
      quality: QUALITY_HIGH,
      // A screen recording can change size mid-take; keep the first frame's box.
      sizeChangeBehavior: 'contain',
      ...(crop ? { transform: { crop } } : {}),
    });
    output.addVideoTrack(videoSource);
    const audioSource = audio
      ? new AudioSampleSource({ codec: target.audio, bitrate: audioBitrate(audio.channels) })
      : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    const pumpVideo = async (): Promise<void> => {
      const sink = new VideoSampleSink(track);
      let lastEnd = 0;
      for (const run of bakeDecodeRuns(map.keptRanges())) {
        for await (const sample of sink.samples(run.start, run.end)) {
          try {
            options.signal?.throwIfAborted();
            const length = sample.duration > 0 ? sample.duration : FALLBACK_FRAME_SEC;
            // Where the part of this frame that survives the cuts lands in the baked clip.
            const start = Math.max(lastEnd, map.snapSourceToPlayed(sample.timestamp));
            const end = map.snapSourceToPlayed(sample.timestamp + length);
            if (end - start < 1e-4) continue;
            sample.setTimestamp(start);
            sample.setDuration(end - start);
            await videoSource.add(sample);
            lastEnd = end;
            options.onProgress?.(Math.min(1, end / map.playedDuration));
          } finally {
            sample.close();
          }
        }
      }
      videoSource.close();
    };
    const pumpSound = async (): Promise<void> => {
      if (!audio || !audioSource) return;
      await pumpAudio(audio, audioStageFor(request, map, audio.sampleRate), audioSource, options);
      audioSource.close();
    };

    try {
      // Fed together: each track's backpressure holds it level with the other.
      await Promise.all([pumpVideo(), pumpSound()]);
      await output.finalize();
    } catch (err: unknown) {
      await output.cancel().catch(() => {});
      throw err;
    }
    if (!buffer.buffer) throw new Error('The bake produced no output.');
    options.onProgress?.(1);
    return {
      bytes: buffer.buffer,
      mimeType: target.mimeType,
      extension: target.extension,
      durationSec: map.playedDuration,
      engine: MEDIA_BAKE_ENGINE,
    };
  } finally {
    audio?.dispose();
    input.dispose();
  }
}

/** Bake a clip: its source with trim, cuts, gain, fades and crop applied, as one file. */
export async function bakeMediaClip(
  request: MediaBakeRequest,
  options: MediaBakeJobOptions = {},
): Promise<MediaBakeResult> {
  options.signal?.throwIfAborted();
  return request.kind === 'video'
    ? bakeVideoClip(request, options)
    : bakeAudioClip(request, options);
}

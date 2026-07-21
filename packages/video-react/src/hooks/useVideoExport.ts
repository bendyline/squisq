/**
 * useVideoExport — Main orchestration hook for browser video export.
 *
 * Coordinates frame capture (hidden iframe + html2canvas) with
 * main-thread WebCodecs encoding via mp4-muxer. Manages the full
 * lifecycle: prepare → capture + encode → download.
 *
 * Encoding runs on the main thread because frame capture via html2canvas
 * (~100-200ms per frame) is the bottleneck, not encoding (~1ms per frame
 * with hardware-accelerated WebCodecs). Worker offloading would add
 * complexity with minimal benefit.
 *
 * Usage:
 *   const { state, progress, phase, startExport, cancel, downloadUrl } = useVideoExport();
 *   <button onClick={() => startExport(doc, options)}>Export</button>
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  Doc,
  MediaProvider,
  Theme,
  VideoPipPosition,
  VideoPipShape,
  VideoPipSize,
  VideoPresentation,
} from '@bendyline/squisq/schemas';
import {
  DEFAULT_INTERACTIVE_RESOURCE_POLICY,
  fetchResourceBytes,
  type ResourcePolicy,
} from '@bendyline/squisq/markdown';
import type {
  VideoQuality,
  VideoOrientation,
  AudioTimelineClip,
  FfmpegWasmLoadConfig,
} from '@bendyline/squisq-video';
import {
  resolveDimensions,
  computeAudioTimeline,
  resolveFfmpegWasmLoad,
  QUALITY_PRESETS,
} from '@bendyline/squisq-video';
import type { CaptionMode } from '@bendyline/squisq-react';
import {
  createEncoder,
  supportsWebCodecs,
  supportsWebCodecsH264,
  type EncoderFrameSource,
  type MainThreadEncoder,
} from '../mainThreadEncoder.js';
import { createWorkerEncoder } from '../workerEncoder.js';
import {
  supportsWebCodecsAac,
  selectAudioTier,
  renderAudioTimeline,
  encodeAacTrack,
  audioBufferToWav,
  muxAudioWithFfmpegWasm,
  EXPORT_AUDIO_SAMPLE_RATE,
  EXPORT_AUDIO_CHANNELS,
} from '../audioTrack.js';
import { transcodeMp4ToGifWithFfmpegWasm } from '../gifTranscode.js';
import { useFrameCapture } from './useFrameCapture.js';

const MAX_EXPORT_MEDIA_FILES = 256;
const MAX_EXPORT_MEDIA_FILE_BYTES = 64 * 1024 * 1024;
const MAX_EXPORT_MEDIA_TOTAL_BYTES = 256 * 1024 * 1024;
const ENCODER_PROBE_TIMEOUT_MS = 5_000;
const ENCODER_START_TIMEOUT_MS = 60_000;
const FRAME_CAPTURE_TIMEOUT_MS = 60_000;
const FRAME_ENCODE_TIMEOUT_MS = 60_000;
const CAPTURE_PROGRESS_START = 7;
const CAPTURE_PROGRESS_END = 95;
const FRAME_RATE_WINDOW_SIZE = 30;
export const DEFAULT_VIDEO_COVER_PRE_ROLL_SECONDS = 2;

/**
 * Calculate throughput from frame-boundary timestamps in milliseconds.
 * The most recent 31 boundaries describe the requested rolling 30-frame
 * window (the first boundary is the start of the oldest included frame).
 */
export function calculateRollingFramesPerSecond(
  frameBoundaryTimes: readonly number[],
): number | null {
  if (frameBoundaryTimes.length < 2) return null;
  const firstIndex = Math.max(0, frameBoundaryTimes.length - (FRAME_RATE_WINDOW_SIZE + 1));
  const elapsedMs =
    frameBoundaryTimes[frameBoundaryTimes.length - 1] - frameBoundaryTimes[firstIndex];
  const completedFrames = frameBoundaryTimes.length - 1 - firstIndex;
  if (elapsedMs <= 0 || completedFrames <= 0) return null;
  return (completedFrames * 1000) / elapsedMs;
}

function releaseEncoderFrame(frame: EncoderFrameSource): void {
  if ('close' in frame) frame.close();
}

/**
 * Bound browser APIs whose promises are allowed to remain pending forever.
 * Late results are observed (and optionally disposed) so a timed-out export
 * cannot create an unhandled rejection or leak an ImageBitmap.
 */
export function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  onLateResult?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    void operation.then(
      (value) => {
        if (settled) {
          onLateResult?.(value);
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (caught: unknown) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        reject(caught);
      },
    );
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/** Collect exact string values from the document that may name stored media. */
export function collectDocumentMediaReferences(doc: Doc): Set<string> {
  const references = new Set<string>();
  const seen = new WeakSet<object>();

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      references.add(value);
      if (value.startsWith('./')) references.add(value.slice(2));
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    Object.values(value as Record<string, unknown>).forEach(visit);
  };

  visit(doc);
  return references;
}

// ── Audio resolution ───────────────────────────────────────────────

/**
 * Resolve the raw bytes for every unique source in the audio timeline from
 * (in order) the pre-collected audio map, the images map, then the
 * MediaProvider. Sources that can't be resolved are simply omitted — the
 * caller degrades gracefully rather than failing.
 */
async function resolveAudioBuffers(
  clips: AudioTimelineClip[],
  sources: {
    audio?: Map<string, ArrayBuffer>;
    images?: Map<string, ArrayBuffer>;
    mediaProvider?: MediaProvider;
    resourcePolicy?: ResourcePolicy;
  },
): Promise<Map<string, ArrayBuffer>> {
  const srcs = new Set(clips.map((c) => c.src));
  const out = new Map<string, ArrayBuffer>();
  for (const src of srcs) {
    let data = sources.audio?.get(src) ?? sources.images?.get(src);
    if (!data && sources.mediaProvider) {
      try {
        const url = await sources.mediaProvider.resolveUrl(src);
        const resource = await fetchResourceBytes(url, {
          policy: sources.resourcePolicy,
        });
        data = toArrayBuffer(resource.bytes);
      } catch {
        // Unresolvable source; skip it.
      }
    }
    if (data) out.set(src, data);
  }
  return out;
}

// ── Types ──────────────────────────────────────────────────────────

export type VideoExportState =
  | 'idle'
  | 'preparing'
  | 'capturing'
  | 'encoding'
  | 'complete'
  | 'error';

/** Browser export container format. */
export type VideoOutputFormat = 'mp4' | 'gif';
export type VideoAudioPolicy = 'require' | 'best-effort' | 'omit';

export interface VideoExportConfig {
  /** Output container (default: 'mp4') */
  outputFormat?: VideoOutputFormat;
  /**
   * How authored MP4 audio is handled. `require` (default) fails before
   * capture when audio cannot be loaded/decoded and fails the export if later
   * encoding or muxing fails. `best-effort` explicitly permits video-only
   * degradation; `omit` intentionally skips audio.
   */
  audioPolicy?: VideoAudioPolicy;
  /** Render authored animations and slide transitions (default: true for MP4, false for GIF). */
  animationsEnabled?: boolean;
  /** Encoding quality preset (default: 'normal') */
  quality?: VideoQuality;
  /** Frames per second (default: 30) */
  fps?: number;
  /** Viewport orientation (default: 'landscape') */
  orientation?: VideoOrientation;
  /** Explicit output width. GIF defaults to 960 landscape / 540 portrait. */
  width?: number;
  /** Explicit output height. GIF defaults to 540 landscape / 960 portrait. */
  height?: number;
  /**
   * Map of relative image paths to binary data.
   * Used to embed images into the render HTML.
   */
  images?: Map<string, ArrayBuffer>;
  /**
   * Map of audio segment names to binary data.
   * Used to embed audio into the render HTML.
   */
  audio?: Map<string, ArrayBuffer>;
  /** MediaProvider to resolve media URLs (alternative to passing images directly) */
  mediaProvider?: MediaProvider;
  /** Policy and byte/time limits for MediaProvider URLs. */
  resourcePolicy?: ResourcePolicy;
  /** Caption mode for the exported video (default: 'off' for MP4, 'standard' for GIF). */
  captionMode?: CaptionMode;
  /** Theme override for capture. Omitted values resolve from the Doc. */
  theme?: Theme;
  /** Player-level video placement override. Omitted values resolve from Doc frontmatter. */
  videoPresentation?: VideoPresentation;
  /** Picture-in-picture size override. Omitted values resolve from Doc frontmatter. */
  pipSize?: VideoPipSize;
  /** Picture-in-picture shape override. Omitted values resolve from Doc frontmatter. */
  pipShape?: VideoPipShape;
  /** Picture-in-picture corner override. Omitted values resolve from Doc frontmatter. */
  pipPosition?: VideoPipPosition;
  /** Managed-cover visibility override. Omitted values resolve from Doc frontmatter. */
  showCoverSlide?: boolean;
  /** Seconds to hold an enabled managed cover before story frame zero (default: 2). */
  coverPreRoll?: number;
  /** Player IIFE bundle (unused in browser export, kept for CLI/Playwright path) */
  playerScript?: string;
  /** Optional self-hosted ffmpeg.wasm core URLs for fallback/offline/CSP use. */
  ffmpegWasm?: FfmpegWasmLoadConfig;
}

export interface ResolvedVideoExportCover {
  showCoverSlide: boolean;
  coverPreRoll: number;
}

function resolveFrontmatterBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on' ||
    normalized === 'show' ||
    normalized === 'visible'
  ) {
    return true;
  }
  if (
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off' ||
    normalized === 'hide' ||
    normalized === 'hidden'
  ) {
    return false;
  }
  return undefined;
}

/** Resolve the cover segment shared by browser MP4/GIF capture. */
export function resolveVideoExportCover(
  doc: Doc,
  config: Pick<VideoExportConfig, 'showCoverSlide' | 'coverPreRoll'> = {},
): ResolvedVideoExportCover {
  const frontmatter = doc.frontmatter;
  const frontmatterValue = frontmatter
    ? Object.prototype.hasOwnProperty.call(frontmatter, 'squisq-cover-slide')
      ? frontmatter['squisq-cover-slide']
      : frontmatter['cover-slide']
    : undefined;
  const showCoverSlide =
    config.showCoverSlide ?? resolveFrontmatterBoolean(frontmatterValue) ?? true;
  const requestedPreRoll = config.coverPreRoll ?? DEFAULT_VIDEO_COVER_PRE_ROLL_SECONDS;
  if (!Number.isFinite(requestedPreRoll) || requestedPreRoll < 0) {
    throw new Error('Cover pre-roll must be a finite number of seconds greater than or equal to 0');
  }
  return {
    showCoverSlide,
    coverPreRoll: showCoverSlide && !!doc.startBlock ? requestedPreRoll : 0,
  };
}

export interface VideoExportResult {
  /** Current export state */
  state: VideoExportState;
  /** 0–100 progress percentage */
  progress: number;
  /** Human-readable description of the current phase */
  phase: string;
  /** Current timestamp being captured from the output timeline (seconds). */
  currentFrameTime: number | null;
  /** Rolling throughput over at most the last 30 completed frames. */
  processingFps: number | null;
  /** Video duration detected from the doc (seconds) */
  duration: number;
  /** Effective output format for the current or most recent export. */
  outputFormat: VideoOutputFormat;
  /** Encoder backend ('webcodecs' when WebCodecs H.264 active, 'ffmpeg-wasm' when worker fallback active, null when idle) */
  backend: 'webcodecs' | 'ffmpeg-wasm' | null;
  /** Blob download URL (populated when state === 'complete') */
  downloadUrl: string | null;
  /** File size in bytes (populated when state === 'complete') */
  fileSize: number;
  /**
   * Whether an audio track was muxed into the exported MP4 (populated when
   * state === 'complete'). False when the doc had no audio or when audio was
   * skipped/degraded — see {@link audioSkippedReason}.
   */
  audioIncluded: boolean;
  /**
   * Why audio is absent, when `audioIncluded` is false. `null` means the doc
   * simply had no audio (not a failure); a non-null string explains a genuine
   * capability shortfall or runtime failure. Audio problems never fail the
   * export — the video always completes.
   */
  audioSkippedReason: string | null;
  /** Error message (populated when state === 'error') */
  error: string | null;
  /** Seconds elapsed since export started */
  elapsed: number;
  /** Estimated seconds remaining (0 when idle or complete) */
  estimatedRemaining: number;
  /** Start a new export */
  startExport: (doc: Doc, config: VideoExportConfig) => Promise<void>;
  /** Cancel an in-progress export */
  cancel: () => void;
  /** Reset state back to idle (e.g., after complete or error) */
  reset: () => void;
}

export interface VideoExportFramePreview {
  /** The raster that is about to be submitted to the encoder. Valid only during the callback. */
  source: EncoderFrameSource;
  /** Zero-based frame index. */
  frameIndex: number;
  /** Total number of frames in the export. */
  totalFrames: number;
  /** Timestamp on the output timeline, in seconds. */
  time: number;
}

export interface UseVideoExportOptions {
  /**
   * Observe an occasional captured frame without performing another rasterization.
   * The source may be reused or closed as soon as this synchronous callback returns.
   * Observer errors are ignored so display-only work cannot fail an export.
   */
  onFramePreview?: (preview: VideoExportFramePreview) => void;
  /** Preview the first, last, and every Nth frame. Defaults to 1. */
  previewEveryNFrames?: number;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useVideoExport(options: UseVideoExportOptions = {}): VideoExportResult {
  const [state, setState] = useState<VideoExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
  const [currentFrameTime, setCurrentFrameTime] = useState<number | null>(null);
  const [processingFps, setProcessingFps] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [outputFormat, setOutputFormat] = useState<VideoOutputFormat>('mp4');
  const [backend, setBackend] = useState<'webcodecs' | 'ffmpeg-wasm' | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [audioIncluded, setAudioIncluded] = useState(false);
  const [audioSkippedReason, setAudioSkippedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const [estimatedRemaining, setEstimatedRemaining] = useState(0);

  const encoderRef = useRef<MainThreadEncoder | null>(null);
  const gifAbortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const downloadUrlRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewOptionsRef = useRef(options);
  previewOptionsRef.current = options;

  const frameCapture = useFrameCapture();

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
      }
      if (encoderRef.current) {
        encoderRef.current.close();
      }
      gifAbortRef.current?.abort();
      frameCapture.destroy();
    };
  }, [frameCapture]);

  const reset = useCallback(() => {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
    if (encoderRef.current) {
      encoderRef.current.close();
      encoderRef.current = null;
    }
    gifAbortRef.current?.abort();
    gifAbortRef.current = null;
    frameCapture.destroy();
    setState('idle');
    setProgress(0);
    setPhase('');
    setCurrentFrameTime(null);
    setProcessingFps(null);
    setDuration(0);
    setOutputFormat('mp4');
    setBackend(null);
    setDownloadUrl(null);
    setFileSize(0);
    setAudioIncluded(false);
    setAudioSkippedReason(null);
    setError(null);
    setElapsed(0);
    setEstimatedRemaining(0);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    cancelledRef.current = false;
  }, [frameCapture]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    if (encoderRef.current) {
      encoderRef.current.close();
      encoderRef.current = null;
    }
    gifAbortRef.current?.abort();
    gifAbortRef.current = null;
    frameCapture.destroy();
    setState('idle');
    setProgress(0);
    setPhase('Cancelled');
  }, [frameCapture]);

  const startExport = useCallback(
    async (doc: Doc, config: VideoExportConfig) => {
      // Clear previous state
      cancelledRef.current = false;
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
        downloadUrlRef.current = null;
      }
      setDownloadUrl(null);
      setFileSize(0);
      setAudioIncluded(false);
      setAudioSkippedReason(null);
      setError(null);
      setCurrentFrameTime(null);
      setProcessingFps(null);

      const quality = config.quality ?? 'normal';
      const effectiveOutputFormat = config.outputFormat ?? 'mp4';
      const fps = config.fps ?? (effectiveOutputFormat === 'gif' ? 10 : 30);
      const orientation = config.orientation ?? 'landscape';
      const animationsEnabled = config.animationsEnabled ?? effectiveOutputFormat === 'mp4';
      const captionMode =
        config.captionMode ?? (effectiveOutputFormat === 'gif' ? 'standard' : 'off');
      const audioPolicy = config.audioPolicy ?? 'require';
      setOutputFormat(effectiveOutputFormat);

      try {
        const cover = resolveVideoExportCover(doc, config);
        const gifDefaults =
          orientation === 'portrait' ? { width: 540, height: 960 } : { width: 960, height: 540 };
        const { width, height } = resolveDimensions({
          orientation,
          fps,
          quality,
          ...(config.width !== undefined
            ? { width: config.width }
            : effectiveOutputFormat === 'gif'
              ? { width: gifDefaults.width }
              : {}),
          ...(config.height !== undefined
            ? { height: config.height }
            : effectiveOutputFormat === 'gif'
              ? { height: gifDefaults.height }
              : {}),
        });
        // ── Check browser support ─────────────────────────────────
        const webCodecsAvailable = supportsWebCodecs();
        const sharedArrayBufferAvailable = typeof SharedArrayBuffer !== 'undefined';
        if (effectiveOutputFormat === 'gif' && !sharedArrayBufferAvailable) {
          throw new Error(
            'Animated GIF export requires ffmpeg.wasm and SharedArrayBuffer ' +
              '(Cross-Origin-Isolation headers).',
          );
        }
        // GIF always finishes with an ffmpeg.wasm palette pass. Validate its
        // runtime assets now: discovering an unconfigured core after capturing
        // every frame wastes the whole export.
        if (effectiveOutputFormat === 'gif') {
          resolveFfmpegWasmLoad(config.ffmpegWasm, 'Animated GIF export');
        }
        if (!webCodecsAvailable && !sharedArrayBufferAvailable) {
          throw new Error(
            'No video encoder available. WebCodecs requires Chrome 94+ / Edge 94+, ' +
              'and the ffmpeg.wasm fallback requires SharedArrayBuffer ' +
              '(Cross-Origin-Isolation headers).',
          );
        }

        // ── Step 1: Prepare ───────────────────────────────────────
        setState('preparing');
        setPhase('Loading document…');
        setProgress(0);
        setElapsed(0);
        setEstimatedRemaining(0);

        // Start elapsed timer
        startTimeRef.current = performance.now();
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = setInterval(() => {
          setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000));
        }, 1000);

        // Resolve only assets referenced by this document. Providers can hold an
        // entire workspace; downloading that workspace makes export memory scale
        // with unrelated customer files instead of with the exported document.
        let images = config.images;
        if (!images && config.mediaProvider) {
          images = new Map<string, ArrayBuffer>();
          const entries = await config.mediaProvider.listMedia();
          const references = collectDocumentMediaReferences(doc);
          const neededEntries = entries.filter(
            (entry) => references.has(entry.name) || references.has(`./${entry.name}`),
          );
          if (neededEntries.length > MAX_EXPORT_MEDIA_FILES) {
            throw new Error(
              `Document references ${neededEntries.length} media files; browser export supports at most ${MAX_EXPORT_MEDIA_FILES}.`,
            );
          }
          let totalMediaBytes = 0;
          for (const entry of neededEntries) {
            if (cancelledRef.current) return;
            if (entry.size > MAX_EXPORT_MEDIA_FILE_BYTES) {
              throw new Error(`Media file "${entry.name}" is too large for browser video export.`);
            }
            const url = await config.mediaProvider.resolveUrl(entry.name);
            const resource = await fetchResourceBytes(url, {
              policy: {
                ...DEFAULT_INTERACTIVE_RESOURCE_POLICY,
                ...config.resourcePolicy,
                maxBytes: Math.min(
                  config.resourcePolicy?.maxBytes ?? MAX_EXPORT_MEDIA_FILE_BYTES,
                  MAX_EXPORT_MEDIA_FILE_BYTES,
                ),
              },
            });
            const data = toArrayBuffer(resource.bytes);
            totalMediaBytes += data.byteLength;
            if (totalMediaBytes > MAX_EXPORT_MEDIA_TOTAL_BYTES) {
              throw new Error('Referenced media exceeds the browser video export memory limit.');
            }
            images.set(entry.name, data);
          }
        }

        const docDuration = await frameCapture.init(
          doc,
          {
            images,
            audio: config.audio,
            width,
            height,
            animationsEnabled,
            theme: config.theme,
            videoPresentation: config.videoPresentation,
            pipSize: config.pipSize,
            pipShape: config.pipShape,
            pipPosition: config.pipPosition,
            showCoverSlide: cover.showCoverSlide,
          },
          captionMode,
        );

        if (cancelledRef.current) return;

        if (docDuration <= 0) {
          throw new Error('Document has zero duration — nothing to export');
        }

        // Keep the two segments separate so rounding cannot steal a story
        // frame or drift the audio offset at the cover/story boundary.
        const coverFrameCount = Math.ceil(cover.coverPreRoll * fps);
        const storyFrameCount = Math.ceil(docDuration * fps);
        const totalFrames = coverFrameCount + storyFrameCount;
        const exportDuration = totalFrames / fps;
        setDuration(exportDuration);

        // ── Step 2: Create encoder ────────────────────────────────
        setPhase('Checking video encoder…');
        setProgress(5);

        // Prefer main-thread WebCodecs (fast), but probe whether H.264
        // is actually supported. Linux Chromium has VideoEncoder but
        // no proprietary H.264 codec — fall back to the worker, which
        // loads ffmpeg.wasm in that case.
        const canUseWebCodecs =
          webCodecsAvailable &&
          (await settleWithin(
            supportsWebCodecsH264({ width, height, fps, quality }),
            ENCODER_PROBE_TIMEOUT_MS,
            'The browser did not finish checking WebCodecs support.',
          ).catch(() => false));

        // ── Audio: tier selection + (best-effort) render ──────────
        // The audio timeline uses the exact rendered cover-frame duration, so
        // story frame zero and the first authored sound stay aligned. Operations are
        // wrapped so a failure degrades to a silent video with a reason —
        // audio never aborts the export.
        const audioBitrate = (QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.normal).audioBitrate;
        // GIF has no audio track. An empty timeline skips preparation and
        // muxing without reporting the format limitation as an export error.
        const timeline =
          effectiveOutputFormat === 'mp4' && audioPolicy !== 'omit'
            ? computeAudioTimeline(doc, coverFrameCount / fps)
            : [];
        const aacSupported =
          timeline.length > 0
            ? await supportsWebCodecsAac(EXPORT_AUDIO_SAMPLE_RATE, EXPORT_AUDIO_CHANNELS)
            : false;
        const tierDecision = selectAudioTier({
          hasClips: timeline.length > 0,
          aacSupported,
          sharedArrayBufferAvailable,
          canUseMainThreadWebCodecs: canUseWebCodecs,
        });

        let renderedAudio: AudioBuffer | null = null;
        let audioIncludedLocal = false;
        let audioReasonLocal: string | null = tierDecision.reason;

        if (timeline.length > 0 && tierDecision.tier === 3 && audioPolicy === 'require') {
          throw new Error(tierDecision.reason ?? 'This browser cannot include the document audio.');
        }

        if (tierDecision.tier === 1 || tierDecision.tier === 2) {
          setPhase('Preparing audio…');
          try {
            const buffers = await resolveAudioBuffers(timeline, {
              audio: config.audio,
              images,
              mediaProvider: config.mediaProvider,
              resourcePolicy: config.resourcePolicy,
            });
            const missingSources = [...new Set(timeline.map((clip) => clip.src))].filter(
              (src) => !buffers.has(src),
            );
            if (missingSources.length > 0) {
              audioReasonLocal = `Audio files could not be loaded: ${missingSources.join(', ')}`;
              if (audioPolicy === 'require') throw new Error(audioReasonLocal);
            }
            if (buffers.size === 0) {
              audioReasonLocal ??= 'Audio files for this document could not be loaded.';
            } else {
              const totalAudioDur = timeline.reduce(
                (max, c) => Math.max(max, c.startSec + c.durationSec),
                exportDuration,
              );
              renderedAudio = await renderAudioTimeline(
                timeline,
                buffers,
                totalAudioDur,
                EXPORT_AUDIO_SAMPLE_RATE,
              );
            }
          } catch (audioErr: unknown) {
            renderedAudio = null;
            audioReasonLocal = `Audio could not be prepared: ${
              audioErr instanceof Error ? audioErr.message : String(audioErr)
            }`;
            if (audioPolicy === 'require') throw new Error(audioReasonLocal);
          }
        }

        const useInlineAudio = renderedAudio !== null && tierDecision.tier === 1;
        const useFfmpegAudio = renderedAudio !== null && tierDecision.tier === 2;

        if (cancelledRef.current) return;

        let encoder: MainThreadEncoder;
        if (canUseWebCodecs) {
          encoder = createEncoder({
            width,
            height,
            fps,
            quality,
            ...(useInlineAudio && renderedAudio
              ? {
                  audio: {
                    numberOfChannels: renderedAudio.numberOfChannels,
                    sampleRate: renderedAudio.sampleRate,
                  },
                }
              : {}),
          });
          encoderRef.current = encoder;
          setBackend('webcodecs');
        } else if (sharedArrayBufferAvailable) {
          setProgress(6);
          setPhase('Loading export engine…');
          const workerEncoder = createWorkerEncoder({
            width,
            height,
            fps,
            quality,
            totalFrames,
            ffmpegWasm: config.ffmpegWasm,
          });
          encoder = workerEncoder;
          // Publish ownership before awaiting readiness so Cancel can stop a
          // worker that is still loading/compiling ffmpeg.wasm.
          encoderRef.current = workerEncoder;
          const selectedBackend = await settleWithin(
            workerEncoder.ready,
            ENCODER_START_TIMEOUT_MS,
            'The browser export engine did not start within 60 seconds.',
          );
          setBackend(selectedBackend);
        } else {
          throw new Error(
            'WebCodecs H.264 is unavailable in this browser and the ffmpeg.wasm ' +
              'fallback requires SharedArrayBuffer (Cross-Origin-Isolation headers).',
          );
        }

        if (cancelledRef.current) return;

        setProgress(CAPTURE_PROGRESS_START);
        setPhase(`Capturing frame 1/${totalFrames}`);
        setCurrentFrameTime(0);

        // ── Step 3: Capture frames and encode ─────────────────────
        setState('capturing');

        const captureStartTime = performance.now();
        const frameBoundaryTimes = [captureStartTime];
        if (coverFrameCount > 0) await frameCapture.setCoverVisible(true);

        for (let i = 0; i < totalFrames; i++) {
          if (cancelledRef.current) return;

          if (coverFrameCount > 0 && i === coverFrameCount) {
            await frameCapture.setCoverVisible(false);
          }
          const time = i / fps;
          const captureTime = i < coverFrameCount ? 0 : (i - coverFrameCount) / fps;

          const captureOperation: Promise<EncoderFrameSource> = canUseWebCodecs
            ? frameCapture.captureCanvasFrame(captureTime, { reuseIfUnchanged: true })
            : frameCapture.captureFrame(captureTime, { reuseIfUnchanged: true });
          const frame = await settleWithin(
            captureOperation,
            FRAME_CAPTURE_TIMEOUT_MS,
            `Frame capture stopped responding at frame ${i + 1}/${totalFrames}.`,
            releaseEncoderFrame,
          );

          if (cancelledRef.current) {
            releaseEncoderFrame(frame);
            return;
          }

          const previewOptions = previewOptionsRef.current;
          const previewInterval = Math.max(1, Math.floor(previewOptions.previewEveryNFrames ?? 1));
          if (
            previewOptions.onFramePreview &&
            (i === 0 || i === totalFrames - 1 || i % previewInterval === 0)
          ) {
            try {
              previewOptions.onFramePreview({ source: frame, frameIndex: i, totalFrames, time });
            } catch {
              // A display-only observer must never make the export fail.
            }
          }

          // Normally this state is too brief to paint. When backpressure has
          // paused capture to drain a saturated encoder queue, it makes the
          // actual wait visible instead of blaming the next frame capture.
          setPhase(`Encoding frame ${i + 1}/${totalFrames}`);
          setCurrentFrameTime(time);
          await settleWithin(
            encoder.encodeFrame(frame, i),
            FRAME_ENCODE_TIMEOUT_MS,
            `Video encoding stopped responding at frame ${i + 1}/${totalFrames}.`,
          );

          // Progress represents completed work, not the frame we are about to
          // start. Tenths keep long exports visibly moving without inventing
          // progress or waiting for ten-frame batches.
          const completedFrames = i + 1;
          const completedAt = performance.now();
          frameBoundaryTimes.push(completedAt);
          if (frameBoundaryTimes.length > FRAME_RATE_WINDOW_SIZE + 1) {
            frameBoundaryTimes.shift();
          }
          setProcessingFps(calculateRollingFramesPerSecond(frameBoundaryTimes));
          setCurrentFrameTime(Math.min(completedFrames / fps, exportDuration));
          setPhase(
            completedFrames < totalFrames
              ? `Capturing frame ${completedFrames + 1}/${totalFrames}`
              : `Captured ${totalFrames.toLocaleString()} frames…`,
          );
          const captureRatio = completedFrames / totalFrames;
          const captureProgress =
            CAPTURE_PROGRESS_START + captureRatio * (CAPTURE_PROGRESS_END - CAPTURE_PROGRESS_START);
          setProgress(Math.round(captureProgress * 10) / 10);

          const elapsedCapture = (performance.now() - captureStartTime) / 1000;
          const avgPerFrame = elapsedCapture / completedFrames;
          setEstimatedRemaining(Math.round(avgPerFrame * (totalFrames - completedFrames)));
          setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000));
        }

        if (cancelledRef.current) return;

        // ── Step 4a: Inline audio (tier 1) ────────────────────────
        // Encode the rendered audio into the same muxer before finalizing.
        if (useInlineAudio && renderedAudio && encoder.addAudioChunk) {
          setState('encoding');
          setPhase('Encoding audio…');
          try {
            await encodeAacTrack(
              renderedAudio,
              { addAudioChunk: encoder.addAudioChunk.bind(encoder) },
              audioBitrate,
            );
            audioIncludedLocal = true;
          } catch (audioErr: unknown) {
            audioIncludedLocal = false;
            audioReasonLocal = `Audio encoding failed: ${
              audioErr instanceof Error ? audioErr.message : String(audioErr)
            }`;
            if (audioPolicy === 'require') throw new Error(audioReasonLocal);
          }
        }

        // ── Step 4: Finalize MP4 (or GIF's MP4 intermediate) ─────
        setState('encoding');
        setPhase(effectiveOutputFormat === 'gif' ? 'Finalizing GIF frames…' : 'Finalizing video…');
        setProgress(95);

        let outputBytes: ArrayBuffer | Uint8Array = await encoder.finalize();
        encoderRef.current = null;

        if (cancelledRef.current) return;

        // ── Step 4b: GIF palette transcode or audio mux ───────────
        if (effectiveOutputFormat === 'gif') {
          setPhase('Generating GIF palette…');
          const videoOnly =
            outputBytes instanceof Uint8Array ? outputBytes : new Uint8Array(outputBytes);
          const gifAbort = new AbortController();
          gifAbortRef.current = gifAbort;
          try {
            outputBytes = await transcodeMp4ToGifWithFfmpegWasm(
              videoOnly,
              { width, height, loop: 0 },
              config.ffmpegWasm,
              gifAbort.signal,
            );
          } finally {
            if (gifAbortRef.current === gifAbort) gifAbortRef.current = null;
          }
        } else if (useFfmpegAudio && renderedAudio) {
          // Video is finalized; add audio in a single copy-video pass.
          setPhase('Muxing audio…');
          try {
            const wav = audioBufferToWav(renderedAudio);
            const videoOnly =
              outputBytes instanceof Uint8Array ? outputBytes : new Uint8Array(outputBytes);
            outputBytes = await muxAudioWithFfmpegWasm(
              videoOnly,
              wav,
              audioBitrate,
              config.ffmpegWasm,
            );
            audioIncludedLocal = true;
          } catch (audioErr: unknown) {
            audioIncludedLocal = false;
            audioReasonLocal = `Audio muxing failed: ${
              audioErr instanceof Error ? audioErr.message : String(audioErr)
            }`;
            if (audioPolicy === 'require') throw new Error(audioReasonLocal);
          }
        }

        if (cancelledRef.current) return;

        // ── Step 5: Create download URL ───────────────────────────
        // Normalize to a plain ArrayBuffer-backed view for Blob (ffmpeg.wasm
        // output may be typed over SharedArrayBuffer).
        const finalBytes =
          outputBytes instanceof Uint8Array ? outputBytes.slice() : new Uint8Array(outputBytes);
        const mimeType = effectiveOutputFormat === 'gif' ? 'image/gif' : 'video/mp4';
        const blob = new Blob([finalBytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        downloadUrlRef.current = url;

        setDownloadUrl(url);
        setFileSize(finalBytes.byteLength);
        setAudioIncluded(audioIncludedLocal);
        setAudioSkippedReason(
          effectiveOutputFormat === 'gif' || audioIncludedLocal ? null : audioReasonLocal,
        );
        setState('complete');
        setProgress(100);
        setPhase('Export complete');
        setEstimatedRemaining(0);
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);

        // Clean up
        frameCapture.destroy();
      } catch (err: unknown) {
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
        if (cancelledRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setState('error');
        setError(message);
        setPhase('Export failed');

        // Clean up on error
        if (encoderRef.current) {
          encoderRef.current.close();
          encoderRef.current = null;
        }
        gifAbortRef.current?.abort();
        gifAbortRef.current = null;
        frameCapture.destroy();
      }
    },
    [frameCapture],
  );

  return {
    state,
    progress,
    phase,
    currentFrameTime,
    processingFps,
    duration,
    outputFormat,
    backend,
    downloadUrl,
    fileSize,
    audioIncluded,
    audioSkippedReason,
    error,
    elapsed,
    estimatedRemaining,
    startExport,
    cancel,
    reset,
  };
}

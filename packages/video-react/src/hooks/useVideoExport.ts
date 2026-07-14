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
import type { Doc } from '@bendyline/squisq/schemas';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type {
  VideoQuality,
  VideoOrientation,
  AudioTimelineClip,
  FfmpegWasmLoadConfig,
} from '@bendyline/squisq-video';
import { resolveDimensions, computeAudioTimeline, QUALITY_PRESETS } from '@bendyline/squisq-video';
import type { CaptionMode } from '@bendyline/squisq-react';
import {
  createEncoder,
  supportsWebCodecs,
  supportsWebCodecsH264,
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
  },
): Promise<Map<string, ArrayBuffer>> {
  const srcs = new Set(clips.map((c) => c.src));
  const out = new Map<string, ArrayBuffer>();
  for (const src of srcs) {
    let data = sources.audio?.get(src) ?? sources.images?.get(src);
    if (!data && sources.mediaProvider) {
      try {
        const url = await sources.mediaProvider.resolveUrl(src);
        const res = await fetch(url);
        if (res.ok) data = await res.arrayBuffer();
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

export interface VideoExportConfig {
  /** Output container (default: 'mp4') */
  outputFormat?: VideoOutputFormat;
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
  /** Caption mode for the exported video (default: 'off') */
  captionMode?: CaptionMode;
  /** Player IIFE bundle (unused in browser export, kept for CLI/Playwright path) */
  playerScript?: string;
  /** Optional self-hosted ffmpeg.wasm core URLs for fallback/offline/CSP use. */
  ffmpegWasm?: FfmpegWasmLoadConfig;
}

export interface VideoExportResult {
  /** Current export state */
  state: VideoExportState;
  /** 0–100 progress percentage */
  progress: number;
  /** Human-readable description of the current phase */
  phase: string;
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

// ── Hook ───────────────────────────────────────────────────────────

export function useVideoExport(): VideoExportResult {
  const [state, setState] = useState<VideoExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('');
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

      const quality = config.quality ?? 'normal';
      const effectiveOutputFormat = config.outputFormat ?? 'mp4';
      const fps = config.fps ?? (effectiveOutputFormat === 'gif' ? 10 : 30);
      const orientation = config.orientation ?? 'landscape';
      const animationsEnabled = config.animationsEnabled ?? effectiveOutputFormat === 'mp4';
      setOutputFormat(effectiveOutputFormat);

      try {
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
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.arrayBuffer();
              if (data.byteLength > MAX_EXPORT_MEDIA_FILE_BYTES) {
                throw new Error(
                  `Media file "${entry.name}" is too large for browser video export.`,
                );
              }
              totalMediaBytes += data.byteLength;
              if (totalMediaBytes > MAX_EXPORT_MEDIA_TOTAL_BYTES) {
                throw new Error('Referenced media exceeds the browser video export memory limit.');
              }
              images.set(entry.name, data);
            }
          }
        }

        const docDuration = await frameCapture.init(
          doc,
          { images, audio: config.audio, width, height, animationsEnabled },
          config.captionMode,
        );

        if (cancelledRef.current) return;

        setDuration(docDuration);
        if (docDuration <= 0) {
          throw new Error('Document has zero duration — nothing to export');
        }

        // ── Step 2: Create encoder ────────────────────────────────
        setPhase('Starting encoder…');
        setProgress(5);

        // Prefer main-thread WebCodecs (fast), but probe whether H.264
        // is actually supported. Linux Chromium has VideoEncoder but
        // no proprietary H.264 codec — fall back to the worker, which
        // loads ffmpeg.wasm in that case.
        const canUseWebCodecs =
          webCodecsAvailable && (await supportsWebCodecsH264({ width, height, fps, quality }));

        // ── Audio: tier selection + (best-effort) render ──────────
        // The browser frame-capture path has no cover pre-roll (Playwright
        // only), so the timeline is unshifted. Every audio operation below is
        // wrapped so a failure degrades to a silent video with a reason —
        // audio never aborts the export.
        const audioBitrate = (QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.normal).audioBitrate;
        // GIF has no audio track. An empty timeline skips preparation and
        // muxing without reporting the format limitation as an export error.
        const timeline = effectiveOutputFormat === 'mp4' ? computeAudioTimeline(doc, 0) : [];
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

        if (tierDecision.tier === 1 || tierDecision.tier === 2) {
          setPhase('Preparing audio…');
          try {
            const buffers = await resolveAudioBuffers(timeline, {
              audio: config.audio,
              images,
              mediaProvider: config.mediaProvider,
            });
            if (buffers.size === 0) {
              audioReasonLocal = 'Audio files for this document could not be loaded.';
            } else {
              const totalAudioDur = timeline.reduce(
                (max, c) => Math.max(max, c.startSec + c.durationSec),
                docDuration,
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
          setBackend('webcodecs');
        } else if (sharedArrayBufferAvailable) {
          const workerEncoder = createWorkerEncoder({
            width,
            height,
            fps,
            quality,
            ffmpegWasm: config.ffmpegWasm,
          });
          encoder = workerEncoder;
          const selectedBackend = await workerEncoder.ready;
          setBackend(selectedBackend);
          setPhase(
            selectedBackend === 'ffmpeg-wasm'
              ? 'Starting encoder (ffmpeg.wasm)…'
              : 'Starting encoder…',
          );
        } else {
          throw new Error(
            'WebCodecs H.264 is unavailable in this browser and the ffmpeg.wasm ' +
              'fallback requires SharedArrayBuffer (Cross-Origin-Isolation headers).',
          );
        }
        encoderRef.current = encoder;

        if (cancelledRef.current) return;

        // ── Step 3: Capture frames and encode ─────────────────────
        setState('capturing');
        const totalFrames = Math.ceil(docDuration * fps);

        const captureStartTime = performance.now();
        // Throttle UI updates to every ~10 frames to avoid excessive re-renders.
        // Each setState between awaits triggers a separate render cycle.
        const UI_UPDATE_INTERVAL = 10;

        for (let i = 0; i < totalFrames; i++) {
          if (cancelledRef.current) return;

          const time = i / fps;

          // Update UI periodically (not every frame)
          if (i % UI_UPDATE_INTERVAL === 0 || i === totalFrames - 1) {
            const captureProgress = Math.round((i / totalFrames) * 90);
            setProgress(5 + captureProgress);
            setPhase(`Capturing frame ${i + 1}/${totalFrames} (${time.toFixed(1)}s)`);

            if (i > 0) {
              const elapsedCapture = (performance.now() - captureStartTime) / 1000;
              const avgPerFrame = elapsedCapture / i;
              const remaining = Math.round(avgPerFrame * (totalFrames - i));
              setEstimatedRemaining(remaining);
            }
          }

          const bitmap = await frameCapture.captureFrame(time);

          if (cancelledRef.current) {
            bitmap.close();
            return;
          }

          // Encode immediately — WebCodecs is fast and async internally
          await encoder.encodeFrame(bitmap, i);
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

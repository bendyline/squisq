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
import type { VideoQuality, VideoOrientation } from '@bendyline/squisq-video';
import { resolveDimensions } from '@bendyline/squisq-video';
import type { CaptionMode } from '@bendyline/squisq-react';
import { createEncoder, supportsWebCodecs, type MainThreadEncoder } from '../mainThreadEncoder.js';
import { useFrameCapture } from './useFrameCapture.js';

// ── Types ──────────────────────────────────────────────────────────

export type VideoExportState =
  | 'idle'
  | 'preparing'
  | 'capturing'
  | 'encoding'
  | 'complete'
  | 'error';

export interface VideoExportConfig {
  /** Encoding quality preset (default: 'normal') */
  quality?: VideoQuality;
  /** Frames per second (default: 30) */
  fps?: number;
  /** Viewport orientation (default: 'landscape') */
  orientation?: VideoOrientation;
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
  /** Encoder backend ('webcodecs' when active, null when idle) */
  backend: 'webcodecs' | null;
  /** Blob download URL (populated when state === 'complete') */
  downloadUrl: string | null;
  /** File size in bytes (populated when state === 'complete') */
  fileSize: number;
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
  const [backend, setBackend] = useState<'webcodecs' | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const [estimatedRemaining, setEstimatedRemaining] = useState(0);

  const encoderRef = useRef<MainThreadEncoder | null>(null);
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
    frameCapture.destroy();
    setState('idle');
    setProgress(0);
    setPhase('');
    setDuration(0);
    setBackend(null);
    setDownloadUrl(null);
    setFileSize(0);
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
      setError(null);

      const quality = config.quality ?? 'normal';
      const fps = config.fps ?? 30;
      const orientation = config.orientation ?? 'landscape';
      const { width, height } = resolveDimensions({ orientation });

      try {
        // ── Check browser support ─────────────────────────────────
        if (!supportsWebCodecs()) {
          throw new Error(
            'WebCodecs is not available in this browser. ' +
              'Video export requires Chrome 94+, Edge 94+, or another Chromium-based browser.',
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

        // Collect images from MediaProvider if provided and images not passed directly
        let images = config.images;
        if (!images && config.mediaProvider) {
          images = new Map<string, ArrayBuffer>();
          const entries = await config.mediaProvider.listMedia();
          for (const entry of entries) {
            const url = await config.mediaProvider.resolveUrl(entry.name);
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.arrayBuffer();
              images.set(entry.name, data);
            }
          }
        }

        const docDuration = await frameCapture.init(
          doc,
          { images, audio: config.audio, width, height },
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

        const encoder = createEncoder({ width, height, fps, quality });
        encoderRef.current = encoder;
        setBackend('webcodecs');

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
          encoder.encodeFrame(bitmap, i);
        }

        if (cancelledRef.current) return;

        // ── Step 4: Finalize MP4 ──────────────────────────────────
        setState('encoding');
        setPhase('Finalizing video…');
        setProgress(95);

        const mp4Buffer = await encoder.finalize();
        encoderRef.current = null;

        if (cancelledRef.current) return;

        // ── Step 5: Create download URL ───────────────────────────
        const blob = new Blob([mp4Buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        downloadUrlRef.current = url;

        setDownloadUrl(url);
        setFileSize(mp4Buffer.byteLength);
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
    backend,
    downloadUrl,
    fileSize,
    error,
    elapsed,
    estimatedRemaining,
    startExport,
    cancel,
    reset,
  };
}

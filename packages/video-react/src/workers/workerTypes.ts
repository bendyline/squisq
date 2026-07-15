/**
 * Worker Message Protocol
 *
 * Defines the message types exchanged between the main thread and
 * the video encoding Web Worker.
 */

import type { VideoQuality, FfmpegWasmLoadConfig } from '@bendyline/squisq-video';

// ── Main → Worker Messages ─────────────────────────────────────────

/** Initialize the encoder with video parameters. */
export interface InitMessage {
  type: 'init';
  width: number;
  height: number;
  fps: number;
  quality: VideoQuality;
  /**
   * Total frames the caller intends to submit, when known. The worker cannot
   * derive this itself (frames simply arrive until `finalize`), so without it
   * frame progress is reported as indeterminate rather than guessed.
   */
  totalFrames?: number;
  ffmpegWasm?: FfmpegWasmLoadConfig;
}

/** Send a single video frame to the encoder. */
export interface FrameMessage {
  type: 'frame';
  /** Frame bitmap — transferred (zero-copy) from main thread */
  bitmap: ImageBitmap;
  /** Frame index (0-based) */
  frameIndex: number;
  /** Timestamp in microseconds */
  timestamp: number;
}

/** Signal that all frames have been sent; finalize the video. */
export interface FinalizeMessage {
  type: 'finalize';
}

/** Cancel the export and clean up resources. */
export interface CancelMessage {
  type: 'cancel';
}

export type MainToWorkerMessage = InitMessage | FrameMessage | FinalizeMessage | CancelMessage;

// ── Worker → Main Messages ─────────────────────────────────────────

/** Encoder backend detection result, sent after init. */
export interface CapabilitiesMessage {
  type: 'capabilities';
  /** Which encoder backend the worker selected */
  backend: 'webcodecs' | 'ffmpeg-wasm';
}

/** Progress update during encoding. */
export interface ProgressMessage {
  type: 'progress';
  /** 0–100 completion percentage. Meaningless when {@link indeterminate}. */
  percent: number;
  /** Human-readable phase description */
  phase: string;
  /**
   * True when the worker cannot compute a real completion ratio (no
   * `totalFrames` was supplied at init). Consumers should show a busy
   * indicator and ignore `percent` rather than render a fake bar.
   */
  indeterminate?: boolean;
}

/** Encoding complete — MP4 data returned. */
export interface CompleteMessage {
  type: 'complete';
  /** MP4 file data — transferred (zero-copy) back to main thread */
  data: ArrayBuffer;
  /** File size in bytes */
  size: number;
}

/** A frame has been fully consumed by the selected backend. */
export interface FrameCompleteMessage {
  type: 'frame-complete';
  frameIndex: number;
}

/** An error occurred during encoding. */
export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerToMainMessage =
  | CapabilitiesMessage
  | FrameCompleteMessage
  | ProgressMessage
  | CompleteMessage
  | ErrorMessage;

/**
 * Worker Message Protocol
 *
 * Defines the message types exchanged between the main thread and
 * the video encoding Web Worker.
 */

import type { VideoQuality } from '@bendyline/squisq-video';

// ── Main → Worker Messages ─────────────────────────────────────────

/** Initialize the encoder with video parameters. */
export interface InitMessage {
  type: 'init';
  width: number;
  height: number;
  fps: number;
  quality: VideoQuality;
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
  /** 0–100 completion percentage */
  percent: number;
  /** Human-readable phase description */
  phase: string;
}

/** Encoding complete — MP4 data returned. */
export interface CompleteMessage {
  type: 'complete';
  /** MP4 file data — transferred (zero-copy) back to main thread */
  data: ArrayBuffer;
  /** File size in bytes */
  size: number;
}

/** An error occurred during encoding. */
export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerToMainMessage =
  | CapabilitiesMessage
  | ProgressMessage
  | CompleteMessage
  | ErrorMessage;

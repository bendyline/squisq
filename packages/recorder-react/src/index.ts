/**
 * @bendyline/squisq-recorder-react — Browser-based audio, video, and
 * screen recording for Squisq documents.
 *
 * Captures media via `MediaRecorder` (audio/mic, camera+mic, screen,
 * screen+mic) and persists the resulting blob into a
 * `ContentContainer` through the same `MediaProvider.addMedia()` path
 * the rest of the editor uses. Narration recordings additionally drop
 * a `.timing.json` sidecar so `resolveAudioMapping()` in
 * `@bendyline/squisq` auto-links them to blocks with no schema or
 * playback changes.
 *
 * Format strategy is browser-native: WebM in Chromium/Firefox, MP4 in
 * Safari. No transcoding.
 */

// ── Components ─────────────────────────────────────────────────────
export { RecorderModal } from './RecorderModal.js';
export type { RecorderModalProps, RecorderSaveResult } from './RecorderModal.js';

export { RecorderButton } from './RecorderButton.js';
export type { RecorderButtonProps } from './RecorderButton.js';

export { RecorderPanel } from './RecorderPanel.js';
export type { RecorderPanelProps } from './RecorderPanel.js';

// ── Hooks ──────────────────────────────────────────────────────────
export { useMediaRecorder, getCaptureKind } from './hooks/useMediaRecorder.js';
export type {
  UseMediaRecorderOptions,
  UseMediaRecorderResult,
  RecorderSource,
  RecorderState,
} from './hooks/useMediaRecorder.js';

export { useStreamPreview } from './hooks/useStreamPreview.js';

// ── Source acquisition (for headless / custom UI) ──────────────────
export { requestMicStream } from './sources/micStream.js';
export { requestCameraStream } from './sources/cameraStream.js';
export type { CameraStreamOptions } from './sources/cameraStream.js';
export { requestScreenStream } from './sources/screenStream.js';
export type { ScreenStreamOptions, ScreenStreamHandle } from './sources/screenStream.js';

// ── Format probe ───────────────────────────────────────────────────
export {
  resolveFormat,
  supportsMediaRecorder,
  supportsUserMedia,
  supportsDisplayMedia,
  buildFilename,
} from './formats.js';
export type { CaptureKind, ResolvedFormat } from './formats.js';

// ── Narration timing sidecar ───────────────────────────────────────
export { buildTimingJson, encodeTimingJson, timingPathFor } from './timingJson.js';
export type { TimingJson, RecordedBookmark } from './timingJson.js';

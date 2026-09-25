/**
 * @bendyline/squisq-video-react — Browser Video Export for Squisq Documents
 *
 * Provides React components and hooks for exporting Squisq documents
 * to MP4 video directly in the browser.
 *
 * - VideoExportModal: Full modal UI for configure → export → download
 * - VideoExportButton: Drop-in button that opens the modal
 * - useVideoExport: Low-level hook for custom UIs
 * - useFrameCapture: Frame capture via hidden iframe + html2canvas
 *
 * Encoding: WebCodecs (H.264 via hardware-accelerated VideoEncoder, Chrome 94+)
 */

// ── Components ─────────────────────────────────────────────────────
export { VideoExportModal } from './VideoExportModal.js';
export type { VideoExportModalProps, VideoExportPalette } from './VideoExportModal.js';

export { VideoExportButton } from './VideoExportButton.js';
export type { VideoExportButtonProps } from './VideoExportButton.js';

export {
  CoverImageExportModal,
  coverImageFilename,
  validateCoverImageDimensions,
} from './CoverImageExportModal.js';
export type {
  CoverImageExportFormat,
  CoverImageExportModalProps,
} from './CoverImageExportModal.js';

// ── Hooks ──────────────────────────────────────────────────────────
export {
  DEFAULT_VIDEO_COVER_PRE_ROLL_SECONDS,
  resolveVideoCoverFramePlan,
  resolveVideoExportCover,
  useVideoExport,
} from './hooks/useVideoExport.js';
export type {
  ResolvedVideoExportCover,
  VideoCoverFramePlan,
  VideoExportState,
  VideoExportConfig,
  VideoExportResult,
  VideoExportFramePreview,
  UseVideoExportOptions,
  VideoOutputFormat,
  VideoAudioPolicy,
} from './hooks/useVideoExport.js';

export { useFrameCapture } from './hooks/useFrameCapture.js';
export type {
  FrameCaptureHandle,
  FrameCaptureOptions,
  FrameCaptureRenderOptions,
} from './hooks/useFrameCapture.js';

// ── Encoder Utilities (for advanced usage) ─────────────────────────
export { supportsWebCodecs, supportsWebCodecsH264, createEncoder } from './mainThreadEncoder.js';
export type { MainThreadEncoder, EncoderConfig, EncoderFrameSource } from './mainThreadEncoder.js';
export type { FfmpegWasmLoadConfig } from '@bendyline/squisq-video';

// ── Audio (capability probe) ───────────────────────────────────────
export { supportsWebCodecsAac } from './audioTrack.js';

// ── Media edits (processed-audio renders) ──────────────────────────
export { createMediaEditRenderer } from './mediaEdit/mediaEditRenderer.js';
export type { MediaEditRenderer, MediaEditRendererOptions } from './mediaEdit/mediaEditRenderer.js';
export type {
  MediaEditJobOptions,
  MediaEditPausesRequest,
  MediaEditPausesResult,
  MediaEditPreviewRequest,
  MediaEditPreviewResult,
  MediaEditRenderRequest,
  MediaEditRenderResult,
} from './mediaEdit/mediaEditEngine.js';
export { createMediaEditRenderManager } from './mediaEdit/mediaEditRenderManager.js';
export type {
  MediaEditRenderManager,
  MediaEditRenderManagerOptions,
  MediaEditRenderState,
  MediaEditRenderStatus,
} from './mediaEdit/mediaEditRenderManager.js';
export {
  useMediaEditRenders,
  useMediaEditStatus,
  useProcessedAudio,
} from './mediaEdit/useMediaEditRenders.js';
export type { MediaEditRendersView } from './mediaEdit/useMediaEditRenders.js';

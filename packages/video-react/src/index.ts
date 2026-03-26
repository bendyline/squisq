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
export type { VideoExportModalProps } from './VideoExportModal.js';

export { VideoExportButton } from './VideoExportButton.js';
export type { VideoExportButtonProps } from './VideoExportButton.js';

// ── Hooks ──────────────────────────────────────────────────────────
export { useVideoExport } from './hooks/useVideoExport.js';
export type {
  VideoExportState,
  VideoExportConfig,
  VideoExportResult,
} from './hooks/useVideoExport.js';

export { useFrameCapture } from './hooks/useFrameCapture.js';
export type { FrameCaptureHandle } from './hooks/useFrameCapture.js';

// ── Encoder Utilities (for advanced usage) ─────────────────────────
export { supportsWebCodecs, createEncoder } from './mainThreadEncoder.js';
export type { MainThreadEncoder } from './mainThreadEncoder.js';

export {
  DEFAULT_VIDEO_COVER_PRE_ROLL_SECONDS,
  resolveVideoExportCover,
  useVideoExport,
} from '../hooks/useVideoExport.js';
export type {
  ResolvedVideoExportCover,
  VideoExportState,
  VideoExportConfig,
  VideoExportResult,
  VideoExportFramePreview,
  UseVideoExportOptions,
  VideoOutputFormat,
  VideoAudioPolicy,
} from '../hooks/useVideoExport.js';
export { useFrameCapture } from '../hooks/useFrameCapture.js';
export type {
  FrameCaptureHandle,
  FrameCaptureOptions,
  FrameCaptureRenderOptions,
} from '../hooks/useFrameCapture.js';

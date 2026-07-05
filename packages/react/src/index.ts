// Main components
export { DocPlayer } from './DocPlayer.js';
export { BlockRenderer, VIEWPORT } from './BlockRenderer.js';
export { CaptionOverlay } from './CaptionOverlay.js';
export { SocialCaptionOverlay } from './SocialCaptionOverlay.js';
export { DocControlsOverlay } from './DocControlsOverlay.js';
export { DocControlsBottom } from './DocControlsBottom.js';
export { DocControlsSidebar } from './DocControlsSidebar.js';
export { DocControlsSlideshow } from './DocControlsSlideshow.js';
export { DocPlayerWithSidebar } from './DocPlayerWithSidebar.js';
export { DocProgressBar } from './DocProgressBar.js';
export { MarkdownRenderer } from './MarkdownRenderer.js';
export { LinearDocView } from './LinearDocView.js';
export type { LinearDocViewProps, ImageDisplayMode } from './LinearDocView.js';
export { InlineVideoPlayer } from './InlineVideoPlayer.js';
export type { InlineVideoPlayerProps } from './InlineVideoPlayer.js';
export { InlineAudioPlayer } from './InlineAudioPlayer.js';
export type { InlineAudioPlayerProps } from './InlineAudioPlayer.js';

// Layer components
export { ImageLayer } from './layers/ImageLayer.js';
export { TextLayer } from './layers/TextLayer.js';
export { ShapeLayer } from './layers/ShapeLayer.js';
export { PathLayer } from './layers/PathLayer.js';
export { VideoLayer } from './layers/VideoLayer.js';
export { TableLayer } from './layers/TableLayer.js';
export { MapLayer } from './layers/MapLayer.js';

// Timed media clips (block.media + doc.documentMedia playback)
export { MediaClipLayer } from './MediaClipLayer.js';
export type { MediaClipLayerProps } from './MediaClipLayer.js';

// Hooks
export { useAudioSync } from './hooks/useAudioSync.js';
export { useMediaSchedule } from './hooks/useMediaSchedule.js';
export type { MediaScheduleController } from './hooks/useMediaSchedule.js';
export { useDocPlayback } from './hooks/useDocPlayback.js';
export { useViewportOrientation } from './hooks/useViewportOrientation.js';
export { MediaContext, useMediaProvider, useMediaUrl } from './hooks/MediaContext.js';
export { useAutoSurface } from './hooks/useAutoSurface.js';

// Types
export type { AudioController, AudioState, AudioActions } from './hooks/AudioController.js';
export type {
  PlaybackState,
  PlaybackActions,
  BlockMarker,
  ControlsLayout,
  DisplayMode,
  CaptionStyle,
  CaptionMode,
  SlideNavActions,
  SquisqRenderAPI,
  SquisqWindow,
  RenderBlockInfo,
  RenderAudioSegmentInfo,
  RenderCaptionInfo,
  RenderChapterInfo,
} from './types.js';
export { formatTime } from './types.js';

// Utilities
export { getAnimationStyle, getTransitionClass } from './utils/animationUtils.js';

// JSON Form — read-only viewer
export { JsonView } from './jsonView/index.js';
export type { JsonViewProps } from './jsonView/index.js';

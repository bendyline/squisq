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

// Layer components
export { ImageLayer } from './layers/ImageLayer.js';
export { TextLayer } from './layers/TextLayer.js';
export { ShapeLayer } from './layers/ShapeLayer.js';
export { VideoLayer } from './layers/VideoLayer.js';
export { TableLayer } from './layers/TableLayer.js';
export { MapLayer } from './layers/MapLayer.js';

// Hooks
export { useAudioSync } from './hooks/useAudioSync.js';
export { useDocPlayback } from './hooks/useDocPlayback.js';
export { useViewportOrientation } from './hooks/useViewportOrientation.js';
export { MediaContext, useMediaProvider, useMediaUrl } from './hooks/MediaContext.js';

// Types
export type { AudioProvider, AudioState, AudioActions } from './hooks/AudioProvider.js';
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

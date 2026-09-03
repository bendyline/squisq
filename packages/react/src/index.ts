// Main components
export { DocPlayer } from './DocPlayer.js';
export type { DocPlayerProps } from './DocPlayer.js';
export type { MountOptions, SquisqPlayerHandle } from './standalone-entry.js';
export { BlockRenderer } from './BlockRenderer.js';
export { CaptionOverlay } from './CaptionOverlay.js';
export { SocialCaptionOverlay } from './SocialCaptionOverlay.js';
export { DocControlsOverlay } from './DocControlsOverlay.js';
export { DocControlsBottom } from './DocControlsBottom.js';
export { DocControlsSidebar } from './DocControlsSidebar.js';
export { DocControlsSlideshow } from './DocControlsSlideshow.js';
export { DocPlayerWithSidebar } from './DocPlayerWithSidebar.js';
export { DocProgressBar } from './DocProgressBar.js';
export { MarkdownRenderer } from './MarkdownRenderer.js';
export type {
  MarkdownRendererProps,
  CodeBlockCopyContext,
  CodeBlockCopyHandler,
} from './MarkdownRenderer.js';
export { MermaidDiagram } from './mermaid/MermaidDiagram.js';
export type { MermaidDiagramProps } from './mermaid/MermaidDiagram.js';
export { LinearDocView } from './LinearDocView.js';
export type { LinearDocViewProps, ImageDisplayMode } from './LinearDocView.js';
export { DashboardView } from './DashboardView.js';
export type { DashboardViewProps } from './DashboardView.js';
export { FlashcardFaceView, FlashcardView } from './FlashcardView.js';
export type { FlashcardFaceViewProps, FlashcardViewProps } from './FlashcardView.js';
export { PageSectionView } from './page/PageSectionView.js';
export type { PageSectionViewProps } from './page/PageSectionView.js';
export { CanvasSection } from './page/CanvasSection.js';
export type { CanvasSectionProps } from './page/CanvasSection.js';
export { PageViewContext, usePageView } from './page/PageViewContext.js';
export type { PageViewContextValue } from './page/PageViewContext.js';
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
export { TreeLayer } from './layers/TreeLayer.js';
export { MapLayer } from './layers/MapLayer.js';
export { MermaidLayer } from './layers/MermaidLayer.js';

// Timed media clips (block.media + doc.documentMedia playback)
export { MediaClipLayer } from './MediaClipLayer.js';
export type { MediaClipLayerProps } from './MediaClipLayer.js';
export { resolveDocPlayerAppearance } from './docPlayer/playerAppearance.js';
export type {
  DocPlayerAppearanceOverrides,
  ResolvedDocPlayerAppearance,
} from './docPlayer/playerAppearance.js';

// Hooks
export { useAudioSync } from './hooks/useAudioSync.js';
export { useModalDialog } from './hooks/useModalDialog.js';
export type { ModalDialogOptions } from './hooks/useModalDialog.js';
export { useMediaSchedule } from './hooks/useMediaSchedule.js';
export type { MediaScheduleController } from './hooks/useMediaSchedule.js';
export { useMediaClipDurations } from './hooks/useMediaClipDurations.js';
export { useDocPlayback } from './hooks/useDocPlayback.js';
export type { UseDocPlaybackOptions } from './hooks/useDocPlayback.js';
export { useViewportOrientation } from './hooks/useViewportOrientation.js';
export {
  MediaContext,
  ResourcePolicyContext,
  useMediaProvider,
  useResourcePolicy,
  useMediaUrl,
} from './hooks/MediaContext.js';
export { FenceRendererContext, useFenceRenderers } from './hooks/FenceRendererContext.js';
export type { FenceRenderContext, FenceRenderer, FenceRendererMap } from '@bendyline/squisq/fence';
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
  CaptionPosition,
  CaptionMode,
  PipPosition,
  PipShape,
  PipSize,
  VideoPresentation,
  SlideNavActions,
  SquisqRenderAPI,
  RenderBlockInfo,
  RenderAudioSegmentInfo,
  RenderCaptionInfo,
  RenderChapterInfo,
} from './types.js';
export { formatTime } from './types.js';

// Utilities
export { getAnimationStyle, getTransitionClass } from './utils/animationUtils.js';

// JSON Form — read-only viewer
export { JsonView, createJsonFormFenceRenderer } from './jsonView/index.js';
export type {
  JsonViewProps,
  JsonFormFenceAction,
  JsonFormFenceRendererOptions,
} from './jsonView/index.js';

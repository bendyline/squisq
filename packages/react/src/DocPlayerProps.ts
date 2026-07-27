import type { Doc, SurfaceScheme, Theme } from '@bendyline/squisq/schemas';
import type { ViewportConfig } from '@bendyline/squisq/doc';
import type { CoverSlidePlayback, CoverSlideTemplate } from '@bendyline/squisq/doc';
import type { AudioController } from './hooks/AudioController';
import type {
  BlockMarker,
  CaptionStyle,
  DisplayMode,
  PipPosition,
  PipShape,
  PipSize,
  PlaybackActions,
  PlaybackState,
  SquisqRenderAPI,
  VideoPresentation,
} from './types';

export interface DocPlayerProps {
  /** The Doc to play. Wins over `markdown` when both are provided. */
  doc?: Doc;
  /** Markdown source to convert when `doc` is absent. */
  markdown?: string;
  /** Base path for resolving media URLs (default: `'.'`). */
  basePath?: string;
  /** Render mode for deterministic video capture. */
  renderMode?: boolean;
  /** Render slide transitions and per-layer animations (default: true). */
  animationsEnabled?: boolean;
  /** Receives the instance-scoped render API, and `null` on cleanup. */
  onRenderAPIReady?: (api: SquisqRenderAPI | null) => void;
  autoPlay?: boolean;
  /** Restart Video-mode playback automatically when the timeline ends. */
  loop?: boolean;
  onEnded?: () => void;
  onTimeUpdate?: (time: number) => void;
  /** Optional host-owned audio controller. */
  audioController?: AudioController;
  /** Explicit synthetic clock for timed documents that intentionally have no audio asset. */
  audioMode?: 'media' | 'synthetic';
  showControls?: boolean;
  showScrubber?: boolean;
  muted?: boolean;
  captionsEnabled?: boolean;
  onCaptionsToggle?: (enabled: boolean) => void;
  onPlaybackStateChange?: (state: PlaybackState) => void;
  onControlsReady?: (controls: PlaybackActions & { play: () => void; pause: () => void }) => void;
  isFullscreen?: boolean;
  onFullscreenToggle?: () => void;
  onBlockMarkers?: (markers: BlockMarker[]) => void;
  forceViewport?: ViewportConfig;
  theme?: Theme;
  surface?: SurfaceScheme | 'auto';
  /** Video, manual slideshow, or long-scrolling linear rendition. */
  displayMode?: DisplayMode;
  showCoverSlide?: boolean;
  /** Visual template used to materialize the managed cover. */
  coverSlideTemplate?: CoverSlideTemplate;
  /** Seconds the cover remains visible after Video playback starts. */
  coverSlideDuration?: number;
  /** Whether video export advances or delays the story while the cover is visible. */
  coverSlidePlayback?: CoverSlidePlayback;
  coverVisible?: boolean;
  captionStyle?: CaptionStyle;
  /**
   * Placement of scheduled video relative to the slide content.
   * Defaults to `'background'` for backward compatibility.
   */
  videoPresentation?: VideoPresentation;
  /** Size of presenter video in picture-in-picture mode (default `'small'`). */
  pipSize?: PipSize;
  /** Shape of presenter video in picture-in-picture mode (default `'square'`). */
  pipShape?: PipShape;
  /** Corner used by presenter video in picture-in-picture mode. */
  pipPosition?: PipPosition;
  enableSwipe?: boolean;
  globalKeyboardShortcuts?: boolean;
}

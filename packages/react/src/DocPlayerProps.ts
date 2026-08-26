import type { Doc, SurfaceScheme, Theme } from '@bendyline/squisq/schemas';
import type { DashboardStyleId, ViewportConfig } from '@bendyline/squisq/doc';
import type { CoverSlidePlayback, CoverSlideTemplate } from '@bendyline/squisq/doc';
import type { FenceRendererMap } from '@bendyline/squisq/fence';
import type { AudioController } from './hooks/AudioController';
import type { CodeBlockCopyHandler } from './MarkdownRenderer';
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
  /** Video, slideshow, page, dashboard, or flashcards rendition. */
  displayMode?: DisplayMode;
  /** Dashboard mode: layout id or `'auto'`. Overrides doc frontmatter. */
  dashboardLayout?: string;
  /** Dashboard mode: title-band override. Overrides doc frontmatter. */
  dashboardShowTitle?: boolean;
  /** Dashboard mode: cell style variant. Overrides doc frontmatter. */
  dashboardStyle?: DashboardStyleId;
  /** Dashboard mode: host-supplied title fallback (typically the file name). */
  dashboardDocumentTitle?: string;
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
  /** Show a Copy button on fenced code blocks in linear mode (default: false). */
  showCodeCopyButton?: boolean;
  /** Optional host clipboard adapter; otherwise the browser Clipboard API is used. */
  onCopyCode?: CodeBlockCopyHandler;
  /**
   * Host fence-renderer registry (`@bendyline/squisq/fence`), applied in
   * linear mode's markdown sections. Video/slideshow modes render blocks
   * as SVG layers and do not consult it.
   */
  fenceRenderers?: FenceRendererMap;
}

/**
 * DocPlayer Component
 *
 * Main component for playing visual stories. Combines audio playback
 * with synchronized SVG block animations. Supports both interactive
 * browser playback and headless rendering for video export.
 *
 * Features:
 * - Audio synchronization with multiple MP3 segments
 * - Block transitions (fade, dissolve, slide)
 * - Playback controls (play/pause, seek, next/prev)
 * - Progress display
 * - Instance-scoped render API for deterministic video capture
 * - Pluggable audio controller for different environments (browser, EFB)
 * - Multiple control layouts: overlay (default), sidebar, bottom
 *
 * Related Files:
 * - DocControlsOverlay.tsx -- Default overlay controls
 * - DocProgressBar.tsx -- Extracted progress bar
 * - DocControlsSidebar.tsx -- Vertical sidebar controls
 * - DocPlayerWithSidebar.tsx -- Wrapper for sidebar layout
 * - types.ts -- Shared control types
 */

import { Fragment, useId, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { Doc, Block, TextLayer, StartBlockConfig, DocBlock } from '@bendyline/squisq/schemas';
import {
  isTemplateBlock,
  getCaptionAtTime,
  resolveMediaSchedule,
  getDocPlaybackDuration,
} from '@bendyline/squisq/schemas';
import { MediaClipLayer } from './MediaClipLayer';
import type { SurfaceScheme, Theme } from '@bendyline/squisq/schemas';
import { applySurface } from '@bendyline/squisq/schemas';
import { BlockRenderer } from './BlockRenderer';
import { CaptionOverlay } from './CaptionOverlay';
import { useAutoSurface } from './hooks/useAutoSurface';
import { useAudioSync } from './hooks/useAudioSync';
import { useDocPlayback } from './hooks/useDocPlayback';
import { useViewportOrientation } from './hooks/useViewportOrientation';
import { useSlideSwipe } from './hooks/useSlideSwipe';
import type { AudioController } from './hooks/AudioController';
import {
  expandCoverBlock,
  createTemplateContext,
  markdownToDoc,
  DEFAULT_THEME,
  VIEWPORT_PRESETS,
  type ViewportConfig,
} from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { DocControlsOverlay } from './DocControlsOverlay';
import { DocControlsSlideshow } from './DocControlsSlideshow';
import { DocProgressBar } from './DocProgressBar';
import { LinearDocView } from './LinearDocView';
import type {
  PlaybackState,
  PlaybackActions,
  BlockMarker,
  DisplayMode,
  CaptionStyle,
  CaptionMode,
  SlideNavActions,
  SquisqRenderAPI,
} from './types';

const SMALL_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'for',
  'nor',
  'on',
  'at',
  'to',
  'in',
  'of',
  'by',
  'is',
]);

/**
 * Build a map of audio segment index -> display-friendly title.
 * Uses sectionHeader blocks to find real titles, with fallbacks
 * for "intro" and slug-based names.
 */
function buildSegmentTitleMap(doc: Doc): Map<number, string> {
  const map = new Map<number, string>();

  // Scan blocks for sectionHeader templates which carry the real title
  for (const block of doc.blocks as DocBlock[]) {
    if (isTemplateBlock(block) && block.template === 'sectionHeader' && 'title' in block) {
      const segIdx = block.audioSegment;
      if (!map.has(segIdx)) {
        map.set(segIdx, (block as { title: string }).title);
      }
    }
  }

  // Fill in any segments that weren't covered by sectionHeader blocks
  for (let i = 0; i < doc.audio.segments.length; i++) {
    if (!map.has(i)) {
      const name = doc.audio.segments[i].name;
      if (name === 'intro' || name.includes('intro')) {
        map.set(i, 'Introduction');
      } else if (name === 'flight-context' || name.includes('flight-context')) {
        map.set(i, 'Flight Context');
      } else {
        // Title-case the slug: "hands-on-history" -> "Hands on History"
        const words = name.split('-');
        const titled = words
          .map((w, idx) =>
            idx === 0 || !SMALL_WORDS.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w,
          )
          .join(' ');
        map.set(i, titled);
      }
    }
  }

  return map;
}

export interface DocPlayerProps {
  /**
   * The Doc to play. Wins over `markdown` when both are provided.
   * When neither `doc` nor `markdown` is given, the player renders a
   * minimal themed empty state instead of crashing.
   */
  doc?: Doc;
  /**
   * Markdown source to play. When `doc` is absent, the markdown is parsed
   * and converted to a Doc via `markdownToDoc(parseMarkdown(markdown))`.
   * Ignored when `doc` is provided.
   */
  markdown?: string;
  /** Base path for resolving media URLs (default: `'.'`) */
  basePath?: string;
  /** Render mode for video capture (hides controls and creates a render API). */
  renderMode?: boolean;
  /**
   * Whether to render slide transitions and per-layer animations (default: true).
   * Set to false for static slide changes while preserving timeline and media
   * playback.
   */
  animationsEnabled?: boolean;
  /**
   * Receives this player's instance-scoped render API, and `null` on cleanup.
   * The API is created in render mode and `?debug=true` mode only.
   */
  onRenderAPIReady?: (api: SquisqRenderAPI | null) => void;
  /** Auto-play when loaded */
  autoPlay?: boolean;
  /** Callback when playback ends */
  onEnded?: () => void;
  /** Callback for time updates */
  onTimeUpdate?: (time: number) => void;
  /** Optional audio controller (if not provided, uses default HTML5 audio) */
  audioController?: AudioController;
  /** Show built-in controls (default: true). Set to false for custom controls. */
  showControls?: boolean;
  /** Show only the progress bar/scrubber at bottom (no other controls).
   *  Only takes effect when showControls is false. Allows external controls
   *  while keeping the scrubber in-video. */
  showScrubber?: boolean;
  /** Mute audio (default: false) */
  muted?: boolean;
  /** Enable captions (default: true) */
  captionsEnabled?: boolean;
  /** Callback when captions enabled state is toggled */
  onCaptionsToggle?: (enabled: boolean) => void;
  /** Callback for playback state changes (for external controls) */
  onPlaybackStateChange?: (state: PlaybackState) => void;
  /** Callback when playback controls are ready (for external controls) */
  onControlsReady?: (
    controls: PlaybackActions & {
      play: () => void;
      pause: () => void;
    },
  ) => void;
  /** Whether the player is currently in fullscreen mode */
  isFullscreen?: boolean;
  /** Callback to toggle fullscreen mode */
  onFullscreenToggle?: () => void;
  /** Callback when block markers are computed (for external progress bars) */
  onBlockMarkers?: (markers: BlockMarker[]) => void;
  /** Force a specific viewport preset, bypassing window-based orientation detection.
   *  Used when the player is rendered in a constrained container (e.g., map overlay panel)
   *  whose shape differs from the window's. */
  forceViewport?: ViewportConfig;
  /** Theme to use for rendering (default: DEFAULT_THEME from the theme library) */
  theme?: Theme;
  /**
   * Optional surface scheme (light / dark paper) overlaid on top of the
   * theme's colors. Passed through to the underlying LinearDocView when
   * `displayMode === 'linear'`; otherwise overlaid onto the theme that
   * renders the player's SVG blocks.
   */
  surface?: SurfaceScheme | 'auto';
  /**
   * Display mode for the player.
   * - `'video'` (default) — Traditional video playback with play/pause, scrub bar, auto-advance.
   * - `'slideshow'` — PowerPoint-style with prev/next buttons. Blocks are static slides
   *   that only change on user click. No auto-advance, no scrub bar.
   * - `'linear'` — Long-scrolling document view. Renders markdown as readable HTML with
   *   template-annotated sections as inline SVG cards. No audio, no timeline.
   */
  displayMode?: DisplayMode;
  /**
   * Whether to synthesize and show the managed cover slide from
   * `doc.startBlock`. Defaults to true for existing documents.
   */
  showCoverSlide?: boolean;
  /** Caption display style (default: 'standard').
   *  'social' shows large centered words with the active word highlighted. */
  captionStyle?: CaptionStyle;
  /**
   * Enable drag-to-swipe slide navigation in slideshow mode (default: true).
   * When enabled, press-and-drag on a slide advances/rewinds on release past a
   * threshold (or a quick flick), and snaps back otherwise. Only applies when
   * `displayMode === 'slideshow'` and not in render/headless mode.
   */
  enableSwipe?: boolean;
  /**
   * Listen for playback/navigation shortcuts at the document level instead of
   * requiring this player to hold focus. Intended for a primary preview or
   * standalone presentation; leave disabled when several players share a page.
   */
  globalKeyboardShortcuts?: boolean;
}

// Dev-only, browser-safe environment probe. Bundlers substitute the
// `process.env.NODE_ENV` expression; bare browsers without a bundler have
// no `process` at all and are treated as production (no warning noise).
function isDevEnvironment(): boolean {
  try {
    return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

// One-shot flag for the missing-stylesheet warning (module-level so the
// warning fires at most once per page, not once per player instance).
let warnedMissingStyles = false;

/**
 * Front-door component: resolves the `doc` / `markdown` props into a Doc
 * and renders a themed empty state when neither is provided. The playback
 * machinery lives in `DocPlayerContent` so its hook order never changes
 * when a doc appears or disappears.
 */
export function DocPlayer(props: DocPlayerProps) {
  const { doc, markdown } = props;

  // Parse markdown into a Doc only when no explicit doc is supplied.
  const markdownDoc = useMemo(
    () => (!doc && markdown !== undefined ? markdownToDoc(parseMarkdown(markdown)) : undefined),
    [doc, markdown],
  );

  const resolvedDoc = doc ?? markdownDoc;

  if (!resolvedDoc) {
    return <div className="doc-player doc-player--empty" />;
  }

  return <DocPlayerContent {...props} doc={resolvedDoc} />;
}

interface DocPlayerContentProps extends DocPlayerProps {
  doc: Doc;
}

function DocPlayerContent({
  doc,
  basePath = '.',
  renderMode = false,
  animationsEnabled = true,
  autoPlay = false,
  onEnded,
  onTimeUpdate,
  audioController: externalAudioController,
  showControls = true,
  showScrubber = false,
  muted = false,
  captionsEnabled: captionsEnabledProp,
  onCaptionsToggle,
  onPlaybackStateChange,
  onControlsReady,
  onRenderAPIReady,
  isFullscreen = false,
  onFullscreenToggle,
  onBlockMarkers,
  forceViewport,
  displayMode = 'video',
  showCoverSlide = true,
  theme,
  surface,
  captionStyle = 'standard',
  enableSwipe = true,
  globalKeyboardShortcuts = false,
}: DocPlayerContentProps) {
  const isSlideshowMode = displayMode === 'slideshow';
  const isLinearMode = displayMode === 'linear';
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerId = `squisq-player-${useId().replace(/:/g, '')}`;

  // Tap-to-toggle play/pause feedback animation
  const [tapFeedback, setTapFeedback] = useState<'play' | 'pause' | null>(null);
  const tapFeedbackTimer = useRef<ReturnType<typeof setTimeout>>();

  // Detect viewport orientation for responsive docs
  // forceViewport takes precedence (used by render mode with explicit viewport and constrained panels)
  // In render mode without forceViewport, default to landscape for backward compatibility
  const { viewport, orientation } = useViewportOrientation();
  const activeViewport = forceViewport || (renderMode ? VIEWPORT_PRESETS.landscape : viewport);

  // Check for debug mode via URL parameter
  const isDebugMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === 'true';
  }, []);

  // Use internal HTML5 audio sync if no external controller is given
  const internalAudio = useAudioSync(audioRef, doc.audio, basePath, !externalAudioController);

  // Use external controller if provided, otherwise fall back to internal
  const audio = externalAudioController || internalAudio;

  // Dev-only sentinel: warn once when the package stylesheet isn't loaded.
  // The stylesheet sets `--squisq-styles-loaded: 1` on `.doc-player`; if the
  // mounted container computes an empty value, the CSS never made it in.
  useEffect(() => {
    if (warnedMissingStyles || !isDevEnvironment()) return;
    const el = containerRef.current;
    if (!el || typeof getComputedStyle !== 'function') return;
    const value = getComputedStyle(el).getPropertyValue('--squisq-styles-loaded');
    if (!value.trim()) {
      warnedMissingStyles = true;
      console.warn(
        '[squisq] @bendyline/squisq-react/styles is not loaded — import "@bendyline/squisq-react/styles"',
      );
    }
  }, []);

  // Destructure for convenience
  const {
    currentTime,
    isPlaying,
    currentSegment,
    totalDuration,
    isEnded,
    isReady: isAudioReady,
    isAvailable,
    unavailableMessage,
    play,
    pause,
    toggle,
    seekTo,
    skipToSegment: _skipToSegment,
    restart,
  } = audio;

  // Timed media clips (block.media + doc.documentMedia) resolved to absolute
  // doc-timeline coordinates. Empty for documents without the media model, so
  // <MediaClipLayer> renders nothing and the legacy audio path is unaffected.
  const mediaSchedule = useMemo(() => resolveMediaSchedule(doc), [doc]);

  // Refs for frequently-changing values used in the keyboard handler,
  // so the handler callback doesn't need to be recreated every frame.
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const totalDurationRef = useRef(totalDuration);
  totalDurationRef.current = totalDuration;
  const expandedBlocksLenRef = useRef(0);

  // Tap the player surface to toggle play/pause (disabled in slideshow and linear mode)
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (renderMode || isLinearMode) return;
      const target = e.target as HTMLElement;
      if (isSlideshowMode) {
        // The keyboard shortcuts are intentionally scoped to the focused player.
        // A presentation surface is not naturally focusable on click, so focus it
        // explicitly while preserving native focus for its controls.
        if (!target.closest('button, a, input, textarea, select, [contenteditable="true"]')) {
          containerRef.current?.focus({ preventScroll: true });
        }
        return;
      }
      // Don't toggle if user clicked a control element
      if (
        target.closest(
          'button, a, input, textarea, select, [contenteditable="true"], .doc-player__controls, .doc-player__scrubber, .doc-controls-sidebar, .doc-controls-slideshow',
        )
      )
        return;
      containerRef.current?.focus({ preventScroll: true });
      toggle();
      // Show visual feedback (show the state we're transitioning TO)
      const nextState = isPlaying ? 'pause' : 'play';
      setTapFeedback(nextState);
      clearTimeout(tapFeedbackTimer.current);
      tapFeedbackTimer.current = setTimeout(() => setTapFeedback(null), 600);
    },
    [renderMode, toggle, isPlaying, isSlideshowMode, isLinearMode],
  );

  // Resolve surface (light/dark paper) and apply it to the theme before
  // handing off to downstream renderers. Orthogonal to the editorial theme.
  const autoSurface = useAutoSurface(surface === 'auto');
  const resolvedSurface = surface === 'auto' ? autoSurface : surface;
  const effectiveTheme = useMemo(() => {
    const base = theme ?? DEFAULT_THEME;
    return resolvedSurface ? applySurface(base, resolvedSurface) : base;
  }, [theme, resolvedSurface]);

  // Doc playback hook - pass viewport for responsive template expansion
  const {
    currentBlock,
    currentBlockIndex,
    previousBlock,
    isEntering,
    isExiting,
    blockTime,
    blockProgress: _blockProgress,
    docProgress,
    nextBlock: _nextBlock,
    prevBlock: _prevBlock,
    blocks: expandedBlocks,
    suppressOutgoingForNextBlock,
  } = useDocPlayback(doc, currentTime, {
    viewport: activeViewport,
    theme: effectiveTheme,
    onSeek: seekTo,
  });

  // Expand cover block (startBlock) if present - uses active viewport
  const coverBlock = useMemo((): Block | null => {
    const startBlockConfig = doc.startBlock as StartBlockConfig | undefined;
    if (!showCoverSlide) return null;
    if (!startBlockConfig) return null;

    const context = createTemplateContext(effectiveTheme, 0, 1, activeViewport);
    const layers = expandCoverBlock(startBlockConfig, context);

    return {
      id: 'cover-block',
      startTime: -1, // Not part of timeline
      duration: 0, // Static
      audioSegment: -1,
      layers,
    };
  }, [doc.startBlock, activeViewport, effectiveTheme, showCoverSlide]);

  // Slideshow mode treats the managed cover as a static slide before block 1.
  // It has no timeline startTime, so keep its visibility separate from audio.
  const hasManagedCover = !!coverBlock;
  const [slideshowCoverVisible, setSlideshowCoverVisible] = useState(false);
  const [isSlideshowPickerOpen, setIsSlideshowPickerOpen] = useState(false);
  const slideshowCoverInitKeyRef = useRef('');
  useEffect(() => {
    slideshowCoverInitKeyRef.current = '';
  }, [doc]);
  useEffect(() => {
    const initKey = `${isSlideshowMode}:${hasManagedCover}:${renderMode}`;
    if (slideshowCoverInitKeyRef.current === initKey) return;
    slideshowCoverInitKeyRef.current = initKey;
    if (isSlideshowMode && hasManagedCover && !renderMode) {
      setSlideshowCoverVisible(true);
      pause();
    } else {
      setSlideshowCoverVisible(false);
    }
  }, [isSlideshowMode, hasManagedCover, renderMode, pause]);

  // Render-mode cover block control: allows Playwright to force-show the cover block
  const [coverForced, setCoverForced] = useState(false);

  // Grace period: keep cover block visible for 3s after first play press
  const [coverGraceActive, setCoverGraceActive] = useState(false);
  const coverGraceTimer = useRef<ReturnType<typeof setTimeout>>();
  const coverWasShowing = useRef(false);
  // Track whether playback has ever been initiated — prevents the cover block
  // from re-appearing when paused at currentTime === 0 (e.g., no audio source).
  const hasPlayedOnce = useRef(false);

  useEffect(() => {
    hasPlayedOnce.current = false;
    coverWasShowing.current = false;
    clearTimeout(coverGraceTimer.current);
    setCoverGraceActive(false);
    setCoverForced(false);
  }, [doc]);

  // Track when cover is showing at rest (before play)
  const atRest = !!(
    coverBlock &&
    !isSlideshowMode &&
    !isPlaying &&
    currentTime === 0 &&
    !hasPlayedOnce.current &&
    !renderMode &&
    !autoPlay
  );
  if (atRest) coverWasShowing.current = true;

  useEffect(() => {
    if (isPlaying && coverWasShowing.current && coverBlock && !renderMode && !isSlideshowMode) {
      coverWasShowing.current = false;
      hasPlayedOnce.current = true;
      setCoverGraceActive(true);
      // Intentionally no cleanup: if coverBlock's memoized reference changes
      // mid-grace (e.g., due to a preview re-render), clearing the timer would
      // leave coverGraceActive stuck at true because the effect body won't
      // re-run (coverWasShowing.current is now false).
      coverGraceTimer.current = setTimeout(() => setCoverGraceActive(false), 3000);
    }
  }, [isPlaying, coverBlock, renderMode, isSlideshowMode]);

  // Always clear the grace timer on unmount
  useEffect(() => () => clearTimeout(coverGraceTimer.current), []);

  // Determine if we should show the cover block
  // Show cover when: has cover block, not playing, at time 0, not in render mode
  // OR during the grace period after first play, OR when coverForced (render mode)
  const showVideoCoverBlock =
    !isSlideshowMode &&
    !isLinearMode &&
    !!coverBlock &&
    (coverForced ||
      coverGraceActive ||
      (!isPlaying && currentTime === 0 && !hasPlayedOnce.current && !renderMode && !autoPlay));
  const showSlideshowCover = !!(
    isSlideshowMode &&
    !isLinearMode &&
    !renderMode &&
    coverBlock &&
    slideshowCoverVisible
  );
  const showCoverBlock = showVideoCoverBlock || showSlideshowCover;

  const slideshowHasCover = !!(isSlideshowMode && !renderMode && coverBlock);
  const slideshowSlideIndex = slideshowHasCover
    ? slideshowCoverVisible
      ? 0
      : currentBlockIndex + 1
    : currentBlockIndex;
  const slideshowTotalSlides = slideshowHasCover
    ? expandedBlocks.length + 1
    : expandedBlocks.length;

  // Auto-play if enabled (wait for audio to be ready)
  // Use a ref to track if we've already auto-played to avoid repeating on every render
  const hasAutoPlayed = useRef(false);
  useEffect(() => {
    hasAutoPlayed.current = false;
  }, [doc]);
  useEffect(() => {
    if (isAudioReady && autoPlay && !hasAutoPlayed.current) {
      hasAutoPlayed.current = true;
      play();
    }
  }, [isAudioReady, autoPlay, play]);

  // Callback for time updates
  useEffect(() => {
    onTimeUpdate?.(currentTime);
  }, [currentTime, onTimeUpdate]);

  // Callback for ended
  useEffect(() => {
    if (isEnded) {
      onEnded?.();
    }
  }, [isEnded, onEnded]);

  // Consumers keep this API object for the lifetime of the mounted player
  // (the standalone handle promise and Playwright both do). The implementation
  // behind it may change as audio segments, documents, or viewports change, so
  // every method dispatches through the latest implementation ref.
  const liveRenderAPIRef = useRef<SquisqRenderAPI | null>(null);
  const stableRenderAPIRef = useRef<SquisqRenderAPI | null>(null);
  if (!stableRenderAPIRef.current) {
    const current = (): SquisqRenderAPI => {
      const api = liveRenderAPIRef.current;
      if (!api) throw new Error('Squisq render API is not currently available.');
      return api;
    };
    stableRenderAPIRef.current = {
      seekTo: (time) => current().seekTo(time),
      getDuration: () => current().getDuration(),
      getBlocks: () => current().getBlocks(),
      getAudioSegments: () => current().getAudioSegments(),
      getCaptions: () => current().getCaptions(),
      getChapters: () => current().getChapters(),
      showCover: () => current().showCover(),
      hideCover: () => current().hideCover(),
      hasCoverBlock: () => current().hasCoverBlock(),
    };
  }
  const stableRenderAPI = stableRenderAPIRef.current;

  // Refresh the implementation behind the stable instance API.
  useEffect(() => {
    if (!renderMode && !isDebugMode) {
      liveRenderAPIRef.current = null;
      return;
    }
    const root = containerRef.current;
    if (!root) {
      liveRenderAPIRef.current = null;
      return;
    }
    const renderSeekTo = (time: number) => {
      seekTo(time);
      // After React renders the correct block, advance CSS animations
      // (Ken Burns, transitions) to match the doc timeline position.
      // Without this, animations restart from zero on each seekTo because
      // they run on the browser's real clock, not doc time.
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          // Find the current block's start time
          let blockStartTime = 0;
          for (let i = expandedBlocks.length - 1; i >= 0; i--) {
            if (time >= expandedBlocks[i].startTime) {
              blockStartTime = expandedBlocks[i].startTime;
              break;
            }
          }
          const elapsedMs = (time - blockStartTime) * 1000;

          // Set all CSS animations to the correct timeline position
          (root.getAnimations?.() ?? []).forEach((anim) => {
            const target = (anim.effect as KeyframeEffect)?.target as Element | null;
            if (!target) return;

            // Animations on the active block: use current block elapsed time
            if (target.closest('.doc-player__block--active')) {
              anim.currentTime = Math.max(0, elapsedMs);
            }
            // Animations on the exiting block (during crossfade): use current
            // block elapsed for transition animations, keep Ken Burns at their
            // natural position based on when that block started
            // eslint-disable-next-line sonarjs/no-duplicated-branches
            else if (target.closest('.doc-player__block--previous')) {
              anim.currentTime = Math.max(0, elapsedMs);
            }
          });

          // Seek <video> elements in the active block to the correct clip position.
          // Each <video> carries data-clip-start/data-clip-end attributes set by
          // VideoLayer.tsx; we calculate targetTime = clipStart + blockElapsed.
          const blockElapsed = time - blockStartTime;
          const videoSeekPromises: Promise<void>[] = [];
          const activeBlockEl = root.querySelector('.doc-player__block--active');
          if (activeBlockEl) {
            const videos = activeBlockEl.querySelectorAll('video[data-clip-start]');
            videos.forEach((el) => {
              const video = el as HTMLVideoElement;
              const clipStart = parseFloat(video.dataset.clipStart || '0');
              const clipEnd = parseFloat(video.dataset.clipEnd || '0');
              // Honor the per-clip startAt offset: before it, hold at the
              // in-point; after, advance by (blockElapsed - startAt).
              const startAt = parseFloat(video.dataset.startAt || '0');
              const targetTime = Math.min(clipStart + Math.max(0, blockElapsed - startAt), clipEnd);

              video.pause();
              video.currentTime = targetTime;

              videoSeekPromises.push(
                new Promise<void>((r) => {
                  if (Math.abs(video.currentTime - targetTime) < 0.1) {
                    r();
                  } else {
                    video.addEventListener('seeked', () => r(), { once: true });
                    setTimeout(r, 200); // Fallback if seeked never fires
                  }
                }),
              );
            });
          }

          // Seek player-level scheduled videos (document-spanning clips
          // rendered by MediaClipLayer, outside any single block). Each
          // carries data-abs-start/data-abs-end/data-source-in.
          root.querySelectorAll('video[data-clip-id]').forEach((el) => {
            const video = el as HTMLVideoElement;
            const absStart = parseFloat(video.dataset.absStart || '0');
            const absEnd = parseFloat(video.dataset.absEnd || '0');
            const sourceIn = parseFloat(video.dataset.sourceIn || '0');
            video.pause();
            if (time < absStart || time >= absEnd) return;
            const targetTime = sourceIn + (time - absStart);
            video.currentTime = targetTime;
            videoSeekPromises.push(
              new Promise<void>((r) => {
                if (Math.abs(video.currentTime - targetTime) < 0.1) {
                  r();
                } else {
                  video.addEventListener('seeked', () => r(), { once: true });
                  setTimeout(r, 200);
                }
              }),
            );
          });

          // Wait for video seeks + one more frame for the browser to render
          Promise.all(videoSeekPromises).then(() => {
            requestAnimationFrame(() => resolve());
          });
        });
      });
    };
    const getDuration = () => {
      // The larger of the audio/block timeline and any media that spills
      // past the last block (block-clip spillover or document-spanning
      // media), so frame capture covers the full tail.
      const mediaDuration = getDocPlaybackDuration(doc);
      if (totalDuration > 0) return Math.max(totalDuration, mediaDuration);
      return mediaDuration;
    };
    // Expose block metadata for testing -- allows tests to find specific templates
    const getBlocks = () =>
      expandedBlocks.map((s: Block) => ({
        id: s.id,
        template: (s as DocBlock).template ?? 'raw',
        startTime: s.startTime,
        duration: s.duration,
      }));
    // Audio segment info for video production -- returns the actual files in composition order
    const getAudioSegments = () =>
      doc.audio.segments.map((seg) => ({
        src: seg.src,
        name: seg.name,
        duration: seg.duration,
        startTime: seg.startTime,
      }));
    // Caption phrases for SRT/subtitle export
    const getCaptions = () =>
      doc.captions?.phrases?.map((p) => ({
        text: p.text,
        startTime: p.startTime,
        endTime: p.endTime,
      })) || [];
    // Chapter markers for YouTube timestamps -- uses segment titles from sectionHeader blocks
    const getChapters = () => {
      const titleMap = buildSegmentTitleMap(doc);
      return doc.audio.segments.map((seg, i) => ({
        title: titleMap.get(i) || seg.name,
        startTime: seg.startTime,
        duration: seg.duration,
      }));
    };
    // Cover block control for video pre-roll -- force-show or hide the cover block
    const showCover = () => {
      setCoverForced(true);
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    const hideCover = () => {
      setCoverForced(false);
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    const hasCoverBlock = () => !!coverBlock;

    const api: SquisqRenderAPI = {
      seekTo: renderSeekTo,
      getDuration,
      getBlocks,
      getAudioSegments,
      getCaptions,
      getChapters,
      showCover,
      hideCover,
      hasCoverBlock,
    };
    liveRenderAPIRef.current = api;

    return () => {
      if (liveRenderAPIRef.current === api) liveRenderAPIRef.current = null;
    };
  }, [renderMode, isDebugMode, seekTo, totalDuration, expandedBlocks, coverBlock, doc]);

  // Publish/clean up only when the host callback or API availability changes;
  // ordinary playback state changes update the implementation ref above
  // without replacing the object consumers already hold.
  useEffect(() => {
    if ((!renderMode && !isDebugMode) || !containerRef.current) {
      onRenderAPIReady?.(null);
      return;
    }
    onRenderAPIReady?.(stableRenderAPI);
    return () => onRenderAPIReady?.(null);
  }, [renderMode, isDebugMode, onRenderAPIReady, stableRenderAPI]);

  // Caption mode state: cycles through off → standard → social → off
  // The captionStyle prop sets the default active style; captionsEnabledProp
  // can override the initial on/off state.
  const defaultMode: CaptionMode =
    captionsEnabledProp === false ? 'off' : captionStyle || 'standard';
  const [captionMode, setCaptionMode] = useState<CaptionMode>(defaultMode);

  // Keep the internal caption mode in sync when the controlling props change
  // — e.g. the editor's preview toolbar drives caption style / on-off. Keyed
  // on the derived `defaultMode` string, so it only fires on a real prop
  // change and never disturbs the in-player CC toggle for consumers (the
  // standalone player, video export) that set these props once at mount.
  useEffect(() => {
    setCaptionMode(defaultMode);
  }, [defaultMode]);

  // Derive captionsEnabled and active style from the mode
  const captionsEnabled = captionMode !== 'off';
  const activeCaptionStyle: CaptionStyle = captionMode === 'social' ? 'social' : 'standard';

  const setCaptionsEnabled = useCallback(
    (enabled: boolean) => {
      // When re-enabling, restore the prop-specified style rather than
      // always defaulting to 'standard'
      setCaptionMode(enabled ? captionStyle || 'standard' : 'off');
      onCaptionsToggle?.(enabled);
    },
    [onCaptionsToggle, captionStyle],
  );

  const cycleCaptionMode = useCallback(() => {
    setCaptionMode((prev) => {
      const next: CaptionMode =
        prev === 'off' ? 'standard' : prev === 'standard' ? 'social' : 'off';
      onCaptionsToggle?.(next !== 'off');
      return next;
    });
  }, [onCaptionsToggle]);

  const hasCaptions = doc.captions && doc.captions.phrases.length > 0;

  // Map segment indices to human-readable titles (from sectionHeader blocks)
  const segmentTitleMap = useMemo(() => buildSegmentTitleMap(doc), [doc]);

  // Build shared playback state for extracted controls
  const playbackState: PlaybackState = useMemo(
    () => ({
      isPlaying,
      currentTime,
      totalDuration,
      currentBlockIndex: slideshowSlideIndex,
      totalBlocks: slideshowTotalSlides,
      docProgress,
      hasCaptions: !!hasCaptions,
      captionsEnabled,
      captionMode,
      isFullscreen,
      currentSegmentIndex: currentSegment,
      currentSegmentName:
        segmentTitleMap.get(currentSegment) ?? doc.audio.segments[currentSegment]?.name ?? null,
      currentBlock: showSlideshowCover ? coverBlock : (currentBlock ?? null),
      currentSlideLabel: showSlideshowCover ? 'Cover' : undefined,
      currentSlideNumber:
        slideshowHasCover && !showSlideshowCover ? currentBlockIndex + 1 : undefined,
      totalSlideNumber: slideshowHasCover ? expandedBlocks.length : undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doc.audio.segments is stable within a given doc
    [
      isPlaying,
      currentTime,
      totalDuration,
      slideshowSlideIndex,
      slideshowTotalSlides,
      docProgress,
      hasCaptions,
      captionsEnabled,
      captionMode,
      isFullscreen,
      currentSegment,
      segmentTitleMap,
      currentBlock,
      currentBlockIndex,
      showSlideshowCover,
      coverBlock,
      slideshowHasCover,
      expandedBlocks.length,
    ],
  );

  // Build shared playback actions for extracted controls
  const playbackActions: PlaybackActions = useMemo(
    () => ({
      toggle,
      restart,
      seekTo,
      setCaptionsEnabled,
      cycleCaptionMode,
      toggleFullscreen: onFullscreenToggle,
    }),
    [toggle, restart, seekTo, setCaptionsEnabled, cycleCaptionMode, onFullscreenToggle],
  );

  // Slide navigation actions for slideshow mode
  // These seek to the target block's startTime and keep the player paused.
  const slideNavActions: SlideNavActions = useMemo(
    () => ({
      nextSlide: () => {
        if (slideshowHasCover && slideshowCoverVisible) {
          const target = expandedBlocks[0];
          if (target) {
            setSlideshowCoverVisible(false);
            seekTo(target.startTime);
            pause();
          }
          return;
        }
        if (currentBlockIndex < expandedBlocks.length - 1) {
          const target = expandedBlocks[currentBlockIndex + 1];
          if (target) {
            setSlideshowCoverVisible(false);
            seekTo(target.startTime);
            pause();
          }
        }
      },
      prevSlide: () => {
        if (slideshowHasCover && !slideshowCoverVisible && currentBlockIndex <= 0) {
          setSlideshowCoverVisible(true);
          seekTo(0);
          pause();
          return;
        }
        if (currentBlockIndex > 0) {
          const target = expandedBlocks[currentBlockIndex - 1];
          if (target) {
            setSlideshowCoverVisible(false);
            seekTo(target.startTime);
            pause();
          }
        }
      },
      goToSlide: (index: number) => {
        if (slideshowHasCover) {
          if (index === 0) {
            setSlideshowCoverVisible(true);
            seekTo(0);
            pause();
            return;
          }
          const target = expandedBlocks[index - 1];
          if (target) {
            setSlideshowCoverVisible(false);
            seekTo(target.startTime);
            pause();
          }
          return;
        }
        if (index >= 0 && index < expandedBlocks.length) {
          const target = expandedBlocks[index];
          if (target) {
            seekTo(target.startTime);
            pause();
          }
        }
      },
    }),
    [currentBlockIndex, expandedBlocks, seekTo, pause, slideshowHasCover, slideshowCoverVisible],
  );

  // Drag-to-swipe navigation for slideshow mode. Inert unless in slideshow mode,
  // interactive (not headless), and not overridden off via `enableSwipe`.
  const swipeEnabled = isSlideshowMode && !isLinearMode && !renderMode && enableSwipe;
  const armContextFreeSwipeEntry = useCallback(
    (destinationSlideIndex: number) => {
      const destinationBlockIndex = destinationSlideIndex - (slideshowHasCover ? 1 : 0);
      const destinationBlock = expandedBlocks[destinationBlockIndex];
      if (destinationBlock) suppressOutgoingForNextBlock(destinationBlock.id);
    },
    [expandedBlocks, slideshowHasCover, suppressOutgoingForNextBlock],
  );
  const handleSwipeNext = useCallback(() => {
    armContextFreeSwipeEntry(slideshowSlideIndex + 1);
    slideNavActions.nextSlide();
  }, [armContextFreeSwipeEntry, slideshowSlideIndex, slideNavActions]);
  const handleSwipePrev = useCallback(() => {
    armContextFreeSwipeEntry(slideshowSlideIndex - 1);
    slideNavActions.prevSlide();
  }, [armContextFreeSwipeEntry, slideshowSlideIndex, slideNavActions]);
  const swipe = useSlideSwipe({
    enabled: swipeEnabled,
    containerRef,
    canGoNext: slideshowSlideIndex < slideshowTotalSlides - 1,
    canGoPrev: slideshowSlideIndex > 0,
    onNext: handleSwipeNext,
    onPrev: handleSwipePrev,
  });

  // Callback for playback state changes (for external controls)
  useEffect(() => {
    onPlaybackStateChange?.(playbackState);
  }, [playbackState, onPlaybackStateChange]);

  // Callback when controls are ready (for external controls)
  // Fires every time playbackActions change so the external sidebar always holds
  // fresh function references (toggle closes over isPlaying, so it changes often).
  useEffect(() => {
    onControlsReady?.({ play, pause, ...playbackActions });
  }, [play, pause, playbackActions, onControlsReady]);

  // Extract display title from a block (handles both template and expanded blocks)
  const getBlockTitle = useCallback((block: Block): string => {
    // For template blocks, extract title from template-specific properties first
    const docBlock = block as DocBlock;
    if (isTemplateBlock(docBlock)) {
      const props = docBlock as unknown as Record<string, unknown>;
      if (typeof props.title === 'string') return props.title;
      if (typeof props.stat === 'string') return props.stat;
      if (typeof props.quote === 'string') {
        const firstLine = props.quote.split('\n')[0];
        if (firstLine.length <= 30) return firstLine;
        return firstLine.slice(0, 27) + '...';
      }
      if (typeof props.date === 'string') return props.date;
      if (typeof props.fact === 'string') return props.fact;
    }

    // For expanded blocks with layers, try to find text content
    if (block.layers && Array.isArray(block.layers)) {
      const textLayer = block.layers.find((l): l is TextLayer => l.type === 'text');
      if (textLayer?.content?.text) {
        // Get first line of text, truncate if too long
        const firstLine = textLayer.content.text.split('\n')[0];
        if (firstLine.length <= 30) return firstLine;
        return firstLine.slice(0, 27) + '...';
      }
    }

    // Fallback to formatted id
    return block.id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }, []);

  const slideshowPickerItems = useMemo(() => {
    const blockItems = expandedBlocks.map((block, index) => ({
      id: block.id,
      label: String(index + 1),
      summary: getBlockTitle(block),
    }));

    if (!slideshowHasCover || !coverBlock) return blockItems;
    return [
      {
        id: '__cover__',
        label: 'Cover',
        summary: getBlockTitle(coverBlock),
      },
      ...blockItems,
    ];
  }, [coverBlock, expandedBlocks, getBlockTitle, slideshowHasCover]);

  // Compute block markers for progress bar (using expanded blocks)
  const blockMarkers = useMemo(() => {
    if (!totalDuration || !expandedBlocks.length) return [];
    let prevSegment = -1;
    return expandedBlocks.map((block, index) => {
      const isSectionStart = block.audioSegment !== prevSegment;
      prevSegment = block.audioSegment;
      return {
        block,
        index,
        position: (block.startTime / totalDuration) * 100,
        title: getBlockTitle(block),
        isSectionStart,
      };
    });
  }, [expandedBlocks, totalDuration, getBlockTitle]);

  // Notify parent when block markers are computed
  useEffect(() => {
    if (blockMarkers.length > 0) {
      onBlockMarkers?.(blockMarkers);
    }
  }, [blockMarkers, onBlockMarkers]);

  // Keep expandedBlocks length in a ref so keyboard handler stays stable
  expandedBlocksLenRef.current = isSlideshowMode ? slideshowTotalSlides : expandedBlocks.length;

  // Handle keyboard controls — uses refs for frequently-changing values
  // (currentTime, totalDuration, expandedBlocks.length) to avoid
  // re-registering the event listener on every animation frame.
  const handleKeyboardShortcut = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent<HTMLDivElement>, global: boolean) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

      const target = e.target instanceof Element ? e.target : null;
      const isEditableTarget = !!target?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"], [role="slider"], [role="spinbutton"], .monaco-editor',
      );
      const isOpenInteractionTarget = !!target?.closest(
        '[role="menu"], [role="dialog"], [aria-modal="true"]',
      );
      const isSlideshowToolbarTarget =
        isSlideshowMode &&
        !!target?.closest('.doc-controls-slideshow') &&
        !target.closest('[role="menu"]');
      if (
        isEditableTarget ||
        (global && isOpenInteractionTarget) ||
        (!global &&
          !!target?.closest(
            'input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
          ) &&
          !isSlideshowToolbarTarget)
      ) {
        return;
      }

      // Linear mode: no keyboard shortcuts (native scrolling handles it)
      if (isLinearMode) return;

      if (isSlideshowMode) {
        // Slideshow mode: arrow keys navigate slides
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
          case ' ':
            e.preventDefault();
            slideNavActions.nextSlide();
            break;
          case 'ArrowLeft':
            e.preventDefault();
            slideNavActions.prevSlide();
            break;
          case 'ArrowUp':
            e.preventDefault();
            setIsSlideshowPickerOpen(true);
            break;
          case 'Home':
            e.preventDefault();
            slideNavActions.goToSlide(0);
            break;
          case 'End':
            e.preventDefault();
            slideNavActions.goToSlide(expandedBlocksLenRef.current - 1);
            break;
        }
      } else {
        // Video mode: standard playback controls
        switch (e.key) {
          case ' ':
            e.preventDefault();
            toggle();
            break;
          case 'ArrowRight':
            e.preventDefault();
            seekTo(Math.min(currentTimeRef.current + 10, totalDurationRef.current));
            break;
          case 'ArrowLeft':
            e.preventDefault();
            seekTo(Math.max(currentTimeRef.current - 10, 0));
            break;
        }
      }
    },
    [isSlideshowMode, isLinearMode, toggle, seekTo, slideNavActions],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => handleKeyboardShortcut(e, false),
    [handleKeyboardShortcut],
  );

  useEffect(() => {
    if (!globalKeyboardShortcuts || renderMode || isLinearMode) return;
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      handleKeyboardShortcut(event, true);
    };
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown);
  }, [globalKeyboardShortcuts, handleKeyboardShortcut, isLinearMode, renderMode]);

  // ── Linear mode: render as scrollable document ──────────────────
  if (isLinearMode) {
    return (
      <div
        ref={containerRef}
        data-player-id={playerId}
        className="doc-player doc-player--linear"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <LinearDocView
          doc={doc}
          basePath={basePath}
          viewport={activeViewport}
          theme={theme}
          surface={surface}
          animationsEnabled={animationsEnabled}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-player-id={playerId}
      tabIndex={renderMode ? -1 : 0}
      aria-label="Document player"
      onKeyDown={renderMode ? undefined : handleKeyDown}
      className={`doc-player${swipeEnabled ? ' doc-player--swipe' : ''}${
        swipe.phase === 'dragging' ? ' doc-player--grabbing' : ''
      }`}
      onClick={handleContainerClick}
      onPointerDown={swipe.onPointerDown}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${activeViewport.width} / ${activeViewport.height}`,
        margin: '0 auto',
        overflow: 'hidden',
        // Swipe uses the grab/grabbing cursor via CSS classes; let vertical page
        // scroll through on touch while we own horizontal drags.
        cursor: renderMode || swipeEnabled ? undefined : 'pointer',
        touchAction: swipeEnabled ? 'pan-y' : undefined,
      }}
    >
      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" muted={muted} />

      {/* Timed media clips (per-block + document-spanning audio/video). */}
      <MediaClipLayer
        schedule={mediaSchedule}
        currentTime={currentTime}
        isPlaying={isPlaying}
        basePath={basePath}
        renderMode={renderMode}
        muted={muted}
      />

      {/* Block viewport */}
      <div className="doc-player__viewport">
        {/* Cover block (shown at rest before playback) */}
        {showCoverBlock && coverBlock && (
          <div className="doc-player__block doc-player__block--cover">
            <BlockRenderer
              block={coverBlock}
              blockTime={0}
              basePath={basePath}
              isEntering={false}
              viewport={activeViewport}
              animationsEnabled={animationsEnabled}
            />
          </div>
        )}

        {/* Previous block (during transition) */}
        {animationsEnabled && !showCoverBlock && previousBlock && isExiting && (
          // Keyed by block id so each block is its own DOM subtree: React never
          // reconciles one block's layers onto another's (templates reuse layer
          // ids like `title`/`background`), which would otherwise reuse stale
          // DOM / skip entrance animations mid-transition.
          <div key={previousBlock.id} className="doc-player__block doc-player__block--previous">
            <BlockRenderer
              block={previousBlock}
              blockTime={blockTime}
              basePath={basePath}
              isExiting={true}
              transition={currentBlock?.transition}
              viewport={activeViewport}
              animationsEnabled={animationsEnabled}
            />
          </div>
        )}

        {/* Current block */}
        {!showCoverBlock && currentBlock && (
          <div
            key={currentBlock.id}
            className={`doc-player__block doc-player__block--active${
              swipe.phase !== 'idle' ? ` doc-player__block--${swipe.phase}` : ''
            }`}
            style={
              swipe.phase !== 'idle' ? { transform: `translateX(${swipe.offsetPx}px)` } : undefined
            }
          >
            <BlockRenderer
              block={currentBlock}
              blockTime={blockTime}
              basePath={basePath}
              isEntering={animationsEnabled && isEntering}
              viewport={activeViewport}
              isPlaying={isPlaying}
              animationsEnabled={animationsEnabled}
            />
          </div>
        )}

        {/* Caption overlay -- shown during playback and in render mode when captions are enabled */}
        {hasCaptions && (renderMode ? captionsEnabled : true) && (
          <CaptionOverlay
            captions={doc.captions}
            currentTime={currentTime}
            enabled={captionsEnabled && (renderMode || isPlaying || currentTime > 0)}
            fontSize={16}
            captionStyle={activeCaptionStyle}
            theme={effectiveTheme}
            viewport={activeViewport}
          />
        )}

        {/* Debug overlay (when ?debug=true) */}
        {isDebugMode && (
          <div
            className="doc-player__debug"
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              padding: '8px 12px',
              background: 'rgba(0, 0, 0, 0.85)',
              borderRadius: '6px',
              color: '#00ff00',
              fontFamily: 'monospace',
              fontSize: '11px',
              lineHeight: '1.5',
              zIndex: 200,
              maxWidth: '280px',
              pointerEvents: 'none',
              textAlign: 'left',
            }}
          >
            <div style={{ color: '#ffcc00', fontWeight: 'bold', marginBottom: '4px' }}>
              DEBUG MODE
            </div>
            <div>
              <span style={{ color: '#888' }}>template:</span>{' '}
              <span style={{ color: '#ff6b6b' }}>
                {(currentBlock as DocBlock | null)?.template ?? 'raw'}
              </span>
            </div>
            <div>
              <span style={{ color: '#888' }}>block:</span> {currentBlockIndex + 1}/
              {expandedBlocks.length}{' '}
              <span style={{ color: '#666' }}>({currentBlock?.id || 'none'})</span>
            </div>
            <div>
              <span style={{ color: '#888' }}>time:</span> {currentTime.toFixed(2)}s /{' '}
              {totalDuration.toFixed(1)}s{' '}
              <span style={{ color: '#666' }}>
                (progress: {(docProgress * 100).toFixed(1)}%, scriptDur: {doc.duration.toFixed(1)})
              </span>
            </div>
            <div>
              <span style={{ color: '#888' }}>blockTime:</span> {blockTime.toFixed(2)}s /{' '}
              {(currentBlock?.duration || 0).toFixed(1)}s
            </div>
            <div>
              <span style={{ color: '#888' }}>segment:</span> {currentSegment}/
              {doc.audio.segments.length - 1}{' '}
              <span style={{ color: '#666' }}>
                ({doc.audio.segments[currentSegment]?.name || 'none'})
              </span>
            </div>
            <div>
              <span style={{ color: '#888' }}>viewport:</span>{' '}
              {activeViewport.name || `${activeViewport.width}x${activeViewport.height}`}{' '}
              <span style={{ color: '#666' }}>({orientation})</span>
            </div>
            <div>
              <span style={{ color: '#888' }}>playing:</span>{' '}
              <span style={{ color: isPlaying ? '#4ade80' : '#f87171' }}>
                {isPlaying ? 'yes' : 'no'}
              </span>
              {showCoverBlock && <span style={{ color: '#60a5fa' }}> (cover)</span>}
            </div>
            {hasCaptions &&
              (() => {
                const debugPhrase = getCaptionAtTime(doc.captions!, currentTime);
                const debugEnabled = captionsEnabled && (isPlaying || currentTime > 0);
                return (
                  <Fragment>
                    <div>
                      <span style={{ color: '#888' }}>captions:</span>{' '}
                      {doc.captions?.phrases.length || 0} phrases{' '}
                      <span style={{ color: captionsEnabled ? '#4ade80' : '#666' }}>
                        ({captionsEnabled ? 'on' : 'off'})
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#888' }}>cc.enabled:</span>{' '}
                      <span style={{ color: debugEnabled ? '#4ade80' : '#f87171' }}>
                        {String(debugEnabled)}
                      </span>{' '}
                      <span style={{ color: '#666' }}>
                        (playing={String(isPlaying)} t&gt;0={String(currentTime > 0)})
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#888' }}>cc.phrase:</span>{' '}
                      <span style={{ color: debugPhrase ? '#4ade80' : '#f87171' }}>
                        {debugPhrase ? `"${debugPhrase.text.slice(0, 30)}..."` : 'null'}
                      </span>
                    </div>
                    {debugPhrase && (
                      <div>
                        <span style={{ color: '#888' }}>cc.range:</span>{' '}
                        <span style={{ color: '#60a5fa' }}>
                          {debugPhrase.startTime.toFixed(2)}-{debugPhrase.endTime.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </Fragment>
                );
              })()}
          </div>
        )}
      </div>

      {/* Audio unavailable overlay */}
      {!isAvailable && unavailableMessage && (
        <div
          className="doc-player__unavailable"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '16px',
            background: 'rgba(0, 0, 0, 0.7)',
            color: 'rgba(255, 255, 255, 0.9)',
            fontSize: '14px',
            zIndex: 50,
          }}
        >
          <span style={{ fontSize: '32px' }}>&#x1F50A;</span>
          <span>{unavailableMessage}</span>
        </div>
      )}

      {/* Full overlay controls (default video layout) */}
      {!renderMode && !isSlideshowMode && showControls && (
        <DocControlsOverlay
          state={playbackState}
          actions={playbackActions}
          blockMarkers={blockMarkers}
          expandedBlocks={expandedBlocks}
          getBlockTitle={getBlockTitle}
        />
      )}

      {/* Scrubber-only mode (for sidebar/bottom layouts where other controls are external) */}
      {!renderMode && !isSlideshowMode && !showControls && showScrubber && (
        <div
          className="doc-player__scrubber"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 16px 8px',
            background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
            display: 'flex',
            alignItems: 'center',
            zIndex: 100,
          }}
        >
          <DocProgressBar
            state={playbackState}
            actions={playbackActions}
            blockMarkers={blockMarkers}
            expandedBlocks={expandedBlocks}
            getBlockTitle={getBlockTitle}
          />
        </div>
      )}

      {/* Slideshow controls (prev / counter / next) */}
      {!renderMode && isSlideshowMode && (
        <DocControlsSlideshow
          state={playbackState}
          slideNav={slideNavActions}
          slides={slideshowPickerItems}
          pickerOpen={isSlideshowPickerOpen}
          onPickerOpenChange={setIsSlideshowPickerOpen}
        />
      )}

      {/* Tap feedback animation -- shows play/pause icon briefly on tap (video mode only) */}
      {!isSlideshowMode && tapFeedback && (
        <div className="doc-player__tap-feedback" key={tapFeedback}>
          <svg viewBox="0 0 24 24" fill="white" width="48" height="48">
            {tapFeedback === 'pause' ? (
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </div>
      )}
    </div>
  );
}

export default DocPlayer;

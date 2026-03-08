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
 * - Render mode for video capture (via window.seekTo)
 * - Pluggable audio provider for different environments (browser, EFB)
 * - Multiple control layouts: overlay (default), sidebar, bottom
 *
 * Related Files:
 * - DocControlsOverlay.tsx -- Default overlay controls
 * - DocProgressBar.tsx -- Extracted progress bar
 * - DocControlsSidebar.tsx -- Vertical sidebar controls
 * - DocPlayerWithSidebar.tsx -- Wrapper for sidebar layout
 * - types.ts -- Shared control types
 */

import { Fragment, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { Doc, Block, TextLayer, StartBlockConfig } from '@bendyline/prodcore/schemas';
import { BlockRenderer, VIEWPORT } from './BlockRenderer';
import { CaptionOverlay } from './CaptionOverlay';
import { getCaptionAtTime } from '@bendyline/prodcore/schemas';
import { useAudioSync } from './hooks/useAudioSync';
import { useDocPlayback } from './hooks/useDocPlayback';
import { useViewportOrientation } from './hooks/useViewportOrientation';
import type { AudioProvider } from './hooks/AudioProvider';
import { expandCoverBlock, createTemplateContext, DEFAULT_THEME, VIEWPORT_PRESETS, type ViewportConfig } from '@bendyline/prodcore/doc';
import { DocControlsOverlay } from './DocControlsOverlay';
import { DocControlsSlideshow } from './DocControlsSlideshow';
import { DocProgressBar } from './DocProgressBar';
import { LinearDocView } from './LinearDocView';
import type { PlaybackState, PlaybackActions, BlockMarker, DisplayMode, SlideNavActions } from './types';

/**
 * Build a map of audio segment index -> display-friendly title.
 * Uses sectionHeader blocks to find real titles, with fallbacks
 * for "intro" and slug-based names.
 */
function buildSegmentTitleMap(script: Doc): Map<number, string> {
  const map = new Map<number, string>();

  // Scan blocks for sectionHeader templates which carry the real title
  for (const block of script.blocks) {
    if ((block as any).template === 'sectionHeader' && (block as any).title) {
      const segIdx = (block as any).audioSegment as number;
      if (typeof segIdx === 'number' && !map.has(segIdx)) {
        map.set(segIdx, (block as any).title);
      }
    }
  }

  // Fill in any segments that weren't covered by sectionHeader blocks
  for (let i = 0; i < script.audio.segments.length; i++) {
    if (!map.has(i)) {
      const name = script.audio.segments[i].name;
      if (name === 'intro' || name.includes('intro')) {
        map.set(i, 'Introduction');
      } else if (name === 'flight-context' || name.includes('flight-context')) {
        map.set(i, 'Flight Context');
      } else {
        // Title-case the slug: "hands-on-history" -> "Hands on History"
        const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'in', 'of', 'by', 'is']);
        const words = name.split('-');
        const titled = words.map((w, idx) =>
          idx === 0 || !SMALL_WORDS.has(w)
            ? w.charAt(0).toUpperCase() + w.slice(1)
            : w
        ).join(' ');
        map.set(i, titled);
      }
    }
  }

  return map;
}

interface DocPlayerProps {
  /** Doc script to play */
  script: Doc;
  /** Base path for resolving media URLs */
  basePath: string;
  /** Render mode for video capture (hides controls, exposes seekTo) */
  renderMode?: boolean;
  /** Auto-play when loaded */
  autoPlay?: boolean;
  /** Callback when playback ends */
  onEnded?: () => void;
  /** Callback for time updates */
  onTimeUpdate?: (time: number) => void;
  /** Optional audio provider (if not provided, uses default HTML5 audio) */
  audioProvider?: AudioProvider;
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
  onControlsReady?: (controls: PlaybackActions & {
    play: () => void;
    pause: () => void;
  }) => void;
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
  /**
   * Display mode for the player.
   * - `'video'` (default) — Traditional video playback with play/pause, scrub bar, auto-advance.
   * - `'slideshow'` — PowerPoint-style with prev/next buttons. Blocks are static slides
   *   that only change on user click. No auto-advance, no scrub bar.
   * - `'linear'` — Long-scrolling document view. Renders markdown as readable HTML with
   *   template-annotated sections as inline SVG cards. No audio, no timeline.
   */
  displayMode?: DisplayMode;
}

export function DocPlayer({
  script,
  basePath,
  renderMode = false,
  autoPlay = false,
  onEnded,
  onTimeUpdate,
  audioProvider: externalAudioProvider,
  showControls = true,
  showScrubber = false,
  muted = false,
  captionsEnabled: captionsEnabledProp,
  onCaptionsToggle,
  onPlaybackStateChange,
  onControlsReady,
  isFullscreen = false,
  onFullscreenToggle,
  onBlockMarkers,
  forceViewport,
  displayMode = 'video',
}: DocPlayerProps) {
  const isSlideshowMode = displayMode === 'slideshow';
  const isLinearMode = displayMode === 'linear';
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Use internal HTML5 audio sync if no external provider is given
  const internalAudio = useAudioSync(audioRef, script.audio, basePath);

  // Use external provider if provided, otherwise fall back to internal
  const audio = externalAudioProvider || internalAudio;

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
    skipToSegment,
    restart,
  } = audio;

  // Tap the player surface to toggle play/pause (disabled in slideshow and linear mode)
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (renderMode || isSlideshowMode || isLinearMode) return;
    const target = e.target as HTMLElement;
    // Don't toggle if user clicked a control element
    if (target.closest('button, a, input, .doc-player__controls, .doc-player__scrubber, .doc-controls-sidebar, .doc-controls-slideshow')) return;
    toggle();
    // Show visual feedback (show the state we're transitioning TO)
    const nextState = isPlaying ? 'play' : 'pause';
    setTapFeedback(nextState);
    clearTimeout(tapFeedbackTimer.current);
    tapFeedbackTimer.current = setTimeout(() => setTapFeedback(null), 600);
  }, [renderMode, toggle, isPlaying]);

  // Doc playback hook - pass viewport for responsive template expansion
  const {
    currentBlock,
    currentBlockIndex,
    previousBlock,
    isEntering,
    isExiting,
    blockTime,
    blockProgress,
    docProgress,
    nextBlock,
    prevBlock,
    blocks: expandedBlocks,
  } = useDocPlayback(script, currentTime, activeViewport, renderMode);

  // Expand cover block (startBlock) if present - uses active viewport
  const coverBlock = useMemo((): Block | null => {
    const startBlockConfig = script.startBlock as StartBlockConfig | undefined;
    if (!startBlockConfig) return null;

    const context = createTemplateContext(DEFAULT_THEME, 0, 1, activeViewport);
    const layers = expandCoverBlock(startBlockConfig, context);

    return {
      id: 'cover-block',
      startTime: -1, // Not part of timeline
      duration: 0,   // Static
      audioSegment: -1,
      layers,
    };
  }, [script.startBlock, activeViewport]);

  // Render-mode cover block control: allows Playwright to force-show the cover block
  const [coverForced, setCoverForced] = useState(false);

  // Grace period: keep cover block visible for 3s after first play press
  const [coverGraceActive, setCoverGraceActive] = useState(false);
  const coverGraceTimer = useRef<ReturnType<typeof setTimeout>>();
  const coverWasShowing = useRef(false);

  // Track when cover is showing at rest (before play)
  const atRest = !!(coverBlock && !isPlaying && currentTime === 0 && !renderMode && !autoPlay);
  if (atRest) coverWasShowing.current = true;

  useEffect(() => {
    if (isPlaying && coverWasShowing.current && coverBlock && !renderMode) {
      coverWasShowing.current = false;
      setCoverGraceActive(true);
      coverGraceTimer.current = setTimeout(() => setCoverGraceActive(false), 3000);
      return () => clearTimeout(coverGraceTimer.current);
    }
  }, [isPlaying, coverBlock, renderMode]);

  // Determine if we should show the cover block
  // Show cover when: has cover block, not playing, at time 0, not in render mode
  // OR during the grace period after first play, OR when coverForced (render mode)
  // Cover block is suppressed in slideshow and linear mode — start directly on content
  const showCoverBlock = !isSlideshowMode && !isLinearMode && coverBlock && (coverForced || coverGraceActive || (!isPlaying && currentTime === 0 && !renderMode && !autoPlay));

  // Auto-play if enabled (wait for audio to be ready)
  // Use a ref to track if we've already auto-played to avoid repeating on every render
  const hasAutoPlayed = useRef(false);
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

  // Expose seekTo globally for render mode (Playwright) and debug mode (testing)
  useEffect(() => {
    if ((renderMode || isDebugMode) && typeof window !== 'undefined') {
      (window as any).seekTo = (time: number) => {
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
            document.getAnimations().forEach(anim => {
              const target = (anim.effect as KeyframeEffect)?.target as Element | null;
              if (!target) return;

              // Animations on the active block: use current block elapsed time
              if (target.closest('.doc-player__block--active')) {
                anim.currentTime = Math.max(0, elapsedMs);
              }
              // Animations on the exiting block (during crossfade): use current
              // block elapsed for transition animations, keep Ken Burns at their
              // natural position based on when that block started
              else if (target.closest('.doc-player__block--previous')) {
                anim.currentTime = Math.max(0, elapsedMs);
              }
            });

            // Seek <video> elements in the active block to the correct clip position.
            // Each <video> carries data-clip-start/data-clip-end attributes set by
            // VideoLayer.tsx; we calculate targetTime = clipStart + blockElapsed.
            const blockElapsed = time - blockStartTime;
            const videoSeekPromises: Promise<void>[] = [];
            const activeBlockEl = document.querySelector('.doc-player__block--active');
            if (activeBlockEl) {
              const videos = activeBlockEl.querySelectorAll('video[data-clip-start]');
              videos.forEach((el) => {
                const video = el as HTMLVideoElement;
                const clipStart = parseFloat(video.dataset.clipStart || '0');
                const clipEnd = parseFloat(video.dataset.clipEnd || '0');
                const targetTime = Math.min(clipStart + Math.max(0, blockElapsed), clipEnd);

                video.pause();
                video.currentTime = targetTime;

                videoSeekPromises.push(new Promise<void>((r) => {
                  if (Math.abs(video.currentTime - targetTime) < 0.1) {
                    r();
                  } else {
                    video.addEventListener('seeked', () => r(), { once: true });
                    setTimeout(r, 200); // Fallback if seeked never fires
                  }
                }));
              });
            }

            // Wait for video seeks + one more frame for the browser to render
            Promise.all(videoSeekPromises).then(() => {
              requestAnimationFrame(() => resolve());
            });
          });
        });
      };
      (window as any).getDuration = () => totalDuration;
      // Expose block metadata for testing -- allows tests to find specific templates
      (window as any).getBlocks = () => expandedBlocks.map((s: Block) => ({
        id: s.id,
        template: (s as any).template || 'raw',
        startTime: s.startTime,
        duration: s.duration,
      }));
      // Audio segment info for video production -- returns the actual files in composition order
      (window as any).getAudioSegments = () => script.audio.segments.map(seg => ({
        src: seg.src,
        name: seg.name,
        duration: seg.duration,
        startTime: seg.startTime,
      }));
      // Caption phrases for SRT/subtitle export
      (window as any).getCaptions = () => script.captions?.phrases?.map(p => ({
        text: p.text,
        startTime: p.startTime,
        endTime: p.endTime,
      })) || [];
      // Chapter markers for YouTube timestamps -- uses segment titles from sectionHeader blocks
      (window as any).getChapters = () => {
        const titleMap = buildSegmentTitleMap(script);
        return script.audio.segments.map((seg, i) => ({
          title: titleMap.get(i) || seg.name,
          startTime: seg.startTime,
          duration: seg.duration,
        }));
      };
      // Cover block control for video pre-roll -- force-show or hide the cover block
      (window as any).showCover = () => {
        setCoverForced(true);
        return new Promise((resolve) => requestAnimationFrame(resolve));
      };
      (window as any).hideCover = () => {
        setCoverForced(false);
        return new Promise((resolve) => requestAnimationFrame(resolve));
      };
      (window as any).hasCoverBlock = () => !!coverBlock;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).seekTo;
        delete (window as any).getDuration;
        delete (window as any).getBlocks;
        delete (window as any).getAudioSegments;
        delete (window as any).getCaptions;
        delete (window as any).getChapters;
        delete (window as any).showCover;
        delete (window as any).hideCover;
        delete (window as any).hasCoverBlock;
      }
    };
  }, [renderMode, isDebugMode, seekTo, totalDuration, expandedBlocks, coverBlock]);

  // Captions state: use prop if provided, otherwise default to true
  const captionsEnabled = captionsEnabledProp !== undefined ? captionsEnabledProp : true;
  const setCaptionsEnabled = useCallback((enabled: boolean) => {
    onCaptionsToggle?.(enabled);
  }, [onCaptionsToggle]);
  const hasCaptions = script.captions && script.captions.phrases.length > 0;

  // Map segment indices to human-readable titles (from sectionHeader blocks)
  const segmentTitleMap = useMemo(() => buildSegmentTitleMap(script), [script]);

  // Build shared playback state for extracted controls
  const playbackState: PlaybackState = useMemo(() => ({
    isPlaying,
    currentTime,
    totalDuration,
    currentBlockIndex,
    totalBlocks: expandedBlocks.length,
    docProgress,
    hasCaptions: !!hasCaptions,
    captionsEnabled,
    isFullscreen,
    currentSegmentIndex: currentSegment,
    currentSegmentName: segmentTitleMap.get(currentSegment) ?? script.audio.segments[currentSegment]?.name ?? null,
    currentBlock: currentBlock ?? null,
  }), [isPlaying, currentTime, totalDuration, currentBlockIndex, expandedBlocks.length, docProgress, hasCaptions, captionsEnabled, isFullscreen, currentSegment, segmentTitleMap, currentBlock]);

  // Build shared playback actions for extracted controls
  const playbackActions: PlaybackActions = useMemo(() => ({
    toggle,
    restart,
    seekTo,
    setCaptionsEnabled,
    toggleFullscreen: onFullscreenToggle,
  }), [toggle, restart, seekTo, setCaptionsEnabled, onFullscreenToggle]);

  // Slide navigation actions for slideshow mode
  // These seek to the target block's startTime and keep the player paused.
  const slideNavActions: SlideNavActions = useMemo(() => ({
    nextSlide: () => {
      if (currentBlockIndex < expandedBlocks.length - 1) {
        const target = expandedBlocks[currentBlockIndex + 1];
        if (target) {
          seekTo(target.startTime);
          pause();
        }
      }
    },
    prevSlide: () => {
      if (currentBlockIndex > 0) {
        const target = expandedBlocks[currentBlockIndex - 1];
        if (target) {
          seekTo(target.startTime);
          pause();
        }
      }
    },
    goToSlide: (index: number) => {
      if (index >= 0 && index < expandedBlocks.length) {
        const target = expandedBlocks[index];
        if (target) {
          seekTo(target.startTime);
          pause();
        }
      }
    },
  }), [currentBlockIndex, expandedBlocks, seekTo, pause]);

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
    const templateBlock = block as any;
    if (templateBlock.title) return templateBlock.title;
    if (templateBlock.stat) return templateBlock.stat;
    if (templateBlock.quote) {
      const firstLine = templateBlock.quote.split('\n')[0];
      if (firstLine.length <= 30) return firstLine;
      return firstLine.slice(0, 27) + '...';
    }
    if (templateBlock.date) return templateBlock.date;
    if (templateBlock.fact) return templateBlock.fact;

    // For expanded blocks with layers, try to find text content
    if (block.layers && Array.isArray(block.layers)) {
      const textLayer = block.layers.find((l): l is TextLayer => l.type === 'text');
      if (textLayer) {
        // Get first line of text, truncate if too long
        const firstLine = textLayer.content.text.split('\n')[0];
        if (firstLine.length <= 30) return firstLine;
        return firstLine.slice(0, 27) + '...';
      }
    }

    // Fallback to formatted id
    return block.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }, []);

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

  // Handle keyboard controls
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't capture keyboard events when focus is on an input/textarea
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
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
          case 'ArrowUp':
            e.preventDefault();
            slideNavActions.prevSlide();
            break;
          case 'Home':
            e.preventDefault();
            slideNavActions.goToSlide(0);
            break;
          case 'End':
            e.preventDefault();
            slideNavActions.goToSlide(expandedBlocks.length - 1);
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
            seekTo(Math.min(currentTime + 10, totalDuration));
            break;
          case 'ArrowLeft':
            seekTo(Math.max(currentTime - 10, 0));
            break;
        }
      }
    },
    [isSlideshowMode, isLinearMode, toggle, seekTo, currentTime, totalDuration, slideNavActions, expandedBlocks.length]
  );

  useEffect(() => {
    if (renderMode) return; // No keyboard in render mode
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, renderMode]);

  // ── Linear mode: render as scrollable document ──────────────────
  if (isLinearMode) {
    return (
      <div
        ref={containerRef}
        className="doc-player doc-player--linear"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        <LinearDocView
          doc={script}
          basePath={basePath}
          viewport={activeViewport}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="doc-player"
      onClick={handleContainerClick}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${activeViewport.width} / ${activeViewport.height}`,
        margin: '0 auto',
        overflow: 'hidden',
        cursor: renderMode ? undefined : 'pointer',
      }}
    >

      {/* Hidden audio element */}
      <audio ref={audioRef} preload="auto" muted={muted} />

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
            />
          </div>
        )}

        {/* Previous block (during transition) */}
        {!showCoverBlock && previousBlock && isExiting && (
          <div className="doc-player__block doc-player__block--previous">
            <BlockRenderer
              block={previousBlock}
              blockTime={blockTime}
              basePath={basePath}
              isExiting={true}
              viewport={activeViewport}
            />
          </div>
        )}

        {/* Current block */}
        {!showCoverBlock && currentBlock && (
          <div className="doc-player__block doc-player__block--active">
            <BlockRenderer
              block={currentBlock}
              blockTime={blockTime}
              basePath={basePath}
              isEntering={isEntering}
              viewport={activeViewport}
              isPlaying={isPlaying}
            />
          </div>
        )}

        {/* Caption overlay -- hidden in render mode and when stopped on cover block */}
        {hasCaptions && !renderMode && (
          <CaptionOverlay
            captions={script.captions}
            currentTime={currentTime}
            enabled={captionsEnabled && (isPlaying || currentTime > 0)}
            fontSize={16}
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
                {(currentBlock as any)?.template || 'raw'}
              </span>
            </div>
            <div>
              <span style={{ color: '#888' }}>block:</span>{' '}
              {currentBlockIndex + 1}/{expandedBlocks.length}
              {' '}
              <span style={{ color: '#666' }}>({currentBlock?.id || 'none'})</span>
            </div>
            <div>
              <span style={{ color: '#888' }}>time:</span>{' '}
              {currentTime.toFixed(2)}s / {totalDuration.toFixed(1)}s
            </div>
            <div>
              <span style={{ color: '#888' }}>blockTime:</span>{' '}
              {blockTime.toFixed(2)}s / {(currentBlock?.duration || 0).toFixed(1)}s
            </div>
            <div>
              <span style={{ color: '#888' }}>segment:</span>{' '}
              {currentSegment}/{script.audio.segments.length - 1}
              {' '}
              <span style={{ color: '#666' }}>
                ({script.audio.segments[currentSegment]?.name || 'none'})
              </span>
            </div>
            <div>
              <span style={{ color: '#888' }}>viewport:</span>{' '}
              {activeViewport.name || `${activeViewport.width}x${activeViewport.height}`}
              {' '}
              <span style={{ color: '#666' }}>({orientation})</span>
            </div>
            <div>
              <span style={{ color: '#888' }}>playing:</span>{' '}
              <span style={{ color: isPlaying ? '#4ade80' : '#f87171' }}>
                {isPlaying ? 'yes' : 'no'}
              </span>
              {showCoverBlock && (
                <span style={{ color: '#60a5fa' }}> (cover)</span>
              )}
            </div>
            {hasCaptions && (() => {
              const debugPhrase = getCaptionAtTime(script.captions!, currentTime);
              const debugEnabled = captionsEnabled && (isPlaying || currentTime > 0);
              return (
                <Fragment>
                  <div>
                    <span style={{ color: '#888' }}>captions:</span>{' '}
                    {script.captions?.phrases.length || 0} phrases
                    {' '}
                    <span style={{ color: captionsEnabled ? '#4ade80' : '#666' }}>
                      ({captionsEnabled ? 'on' : 'off'})
                    </span>
                  </div>
                  <div>
                    <span style={{ color: '#888' }}>cc.enabled:</span>{' '}
                    <span style={{ color: debugEnabled ? '#4ade80' : '#f87171' }}>
                      {String(debugEnabled)}
                    </span>
                    {' '}
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
        />
      )}

      {/* Tap feedback animation -- shows play/pause icon briefly on tap (video mode only) */}
      {!isSlideshowMode && tapFeedback && (
        <div className="doc-player__tap-feedback" key={Date.now()}>
          <svg viewBox="0 0 24 24" fill="white" width="48" height="48">
            {tapFeedback === 'pause' ? (
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            ) : (
              <path d="M8 5v14l11-7z"/>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}

export default DocPlayer;

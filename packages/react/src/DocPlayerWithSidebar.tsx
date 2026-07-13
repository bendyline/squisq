/**
 * DocPlayerWithSidebar Component
 *
 * Wrapper that composes DocPlayer + DocControlsSidebar in a horizontal
 * flex layout. The video renders on the left with only a scrubber at the
 * bottom, and playback controls render in a vertical sidebar on the right.
 *
 * This layout eliminates black bars for portrait (9:16) video in portrait
 * viewports by placing controls in the space that would otherwise be unused.
 *
 * Uses refs + forceUpdate pattern to avoid infinite render loops between
 * the DocPlayer's callbacks and this component's state. The DocPlayer
 * fires onPlaybackStateChange frequently (every currentTime tick), so we
 * store state in a ref and only trigger re-renders at controlled intervals.
 *
 * Related Files:
 * - DocPlayer.tsx -- Core player (renders with showControls=false, showScrubber=true)
 * - DocControlsSidebar.tsx -- Vertical sidebar controls
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import type { Doc } from '@bendyline/squisq/schemas';
import type { ViewportConfig, Theme } from '@bendyline/squisq/schemas';
import type { AudioController } from './hooks/AudioController';
import { DocPlayer } from './DocPlayer';
import { DocControlsSidebar } from './DocControlsSidebar';
import type { PlaybackState, PlaybackActions } from './types';

interface DocPlayerWithSidebarProps {
  /** The Doc to play */
  doc: Doc;
  /** Base path for resolving media URLs (default: `'.'`) */
  basePath?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
  onTimeUpdate?: (time: number) => void;
  /** Optional audio controller (if not provided, uses default HTML5 audio) */
  audioController?: AudioController;
  /** Whether to render slide transitions and per-layer animations (default: true). */
  animationsEnabled?: boolean;
  muted?: boolean;
  captionsEnabled?: boolean;
  isFullscreen?: boolean;
  onFullscreenToggle?: () => void;
  /** Force a specific viewport preset, bypassing window-based orientation detection. */
  forceViewport?: ViewportConfig;
  /** Called when playing state changes */
  onPlayingChange?: (isPlaying: boolean) => void;
  /**
   * Theme for rendering. Forwarded to the inner DocPlayer so the sidebar
   * (portrait) layout matches the default (landscape) layout — without it the
   * inner player falls back to DEFAULT_THEME, whose dark text is unreadable
   * over a hero cover image.
   */
  theme?: Theme;
}

const DEFAULT_STATE: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
  totalDuration: 0,
  currentBlockIndex: 0,
  totalBlocks: 0,
  docProgress: 0,
  hasCaptions: false,
  captionsEnabled: false,
  captionMode: 'off',
  currentSegmentIndex: 0,
  currentSegmentName: null,
  currentBlock: null,
};

export function DocPlayerWithSidebar({
  doc,
  basePath,
  autoPlay = false,
  onEnded,
  onTimeUpdate,
  audioController,
  animationsEnabled = true,
  muted,
  captionsEnabled,
  isFullscreen,
  onFullscreenToggle,
  forceViewport,
  onPlayingChange,
  theme,
}: DocPlayerWithSidebarProps) {
  // Store playback state in a ref to avoid triggering re-renders from DocPlayer callbacks
  const stateRef = useRef<PlaybackState>(DEFAULT_STATE);
  const actionsRef = useRef<PlaybackActions | null>(null);
  const wasPlayingRef = useRef(false);

  // Use a counter to force sidebar re-renders at controlled intervals
  const [, setTick] = useState(0);

  // Update ref without triggering re-render
  const handleStateChange = useCallback(
    (state: PlaybackState) => {
      stateRef.current = state;
      if (onPlayingChange && state.isPlaying !== wasPlayingRef.current) {
        wasPlayingRef.current = state.isPlaying;
        onPlayingChange(state.isPlaying);
      }
    },
    [onPlayingChange],
  );

  const handleControlsReady = useCallback(
    (controls: PlaybackActions & { play: () => void; pause: () => void }) => {
      const isFirst = !actionsRef.current;
      actionsRef.current = controls;
      // Force one re-render on first call to show the sidebar
      if (isFirst) setTick((t) => t + 1);
    },
    [],
  );

  // Periodically sync the ref to trigger sidebar UI updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 250); // 4 updates per second is smooth enough for time/progress display
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="doc-player-sidebar-layout">
      <div className="doc-player-sidebar-layout__video">
        <DocPlayer
          doc={doc}
          theme={theme}
          basePath={basePath}
          autoPlay={autoPlay}
          onEnded={onEnded}
          onTimeUpdate={onTimeUpdate}
          audioController={audioController}
          animationsEnabled={animationsEnabled}
          muted={muted}
          captionsEnabled={captionsEnabled}
          showControls={isFullscreen}
          showScrubber={!isFullscreen}
          onPlaybackStateChange={handleStateChange}
          onControlsReady={handleControlsReady}
          isFullscreen={isFullscreen}
          onFullscreenToggle={onFullscreenToggle}
          forceViewport={forceViewport}
        />
      </div>
      {actionsRef.current && (
        <DocControlsSidebar state={stateRef.current} actions={actionsRef.current} />
      )}
    </div>
  );
}

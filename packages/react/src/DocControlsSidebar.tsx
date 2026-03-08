/**
 * DocControlsSidebar Component
 *
 * Vertical control strip that renders alongside the doc player video.
 * Used in portrait orientation to eliminate black bars -- controls sit in a
 * "tab" to the right of the 9:16 video instead of overlaying it.
 *
 * Contains: restart, play/pause, time display, segment indicator, CC toggle.
 * Does NOT contain the scrubber/progress bar (that stays in the video via
 * DocPlayer's showScrubber prop).
 *
 * The sidebar stretches to match the full height of the video and has rounded
 * corners on the right side to create a connected "tab" appearance.
 *
 * Related Files:
 * - DocPlayerWithSidebar.tsx -- Wrapper that composes player + sidebar
 * - DocPlayer.tsx -- Core player (renders with showScrubber=true)
 * - types.ts -- PlaybackState/PlaybackActions interfaces
 */

import type { PlaybackState, PlaybackActions } from './types';
import { formatTime } from './types';

interface DocControlsSidebarProps {
  state: PlaybackState;
  actions: PlaybackActions;
}

export function DocControlsSidebar({ state, actions }: DocControlsSidebarProps) {
  return (
    <div className="doc-controls-sidebar">
      {/* Restart button */}
      <button
        className="sidebar-ctrl-btn"
        onClick={actions.restart}
        title="Restart"
        aria-label="Restart from beginning"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
        </svg>
      </button>

      {/* Play/Pause button */}
      <button
        className="sidebar-ctrl-btn sidebar-play-btn"
        onClick={actions.toggle}
        aria-label={state.isPlaying ? 'Pause' : 'Play'}
      >
        {state.isPlaying ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Time display -- stacked current / total */}
      <div className="sidebar-time">
        <div>{formatTime(state.currentTime)}</div>
        <div className="sidebar-time-total">{formatTime(state.totalDuration)}</div>
      </div>

      {/* Segment indicator */}
      <div className="sidebar-segment">
        {state.currentBlockIndex + 1}/{state.totalBlocks}
      </div>

      {/* Caption toggle */}
      {state.hasCaptions && (
        <button
          className={`sidebar-ctrl-btn ${state.captionsEnabled ? 'sidebar-ctrl-btn--active' : ''}`}
          onClick={() => actions.setCaptionsEnabled(!state.captionsEnabled)}
          title={state.captionsEnabled ? 'Hide captions' : 'Show captions'}
          aria-label={state.captionsEnabled ? 'Hide captions' : 'Show captions'}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 01-1 1h-3a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1z" />
          </svg>
        </button>
      )}

      {/* Fullscreen toggle */}
      {actions.toggleFullscreen && (
        <button
          className={`sidebar-ctrl-btn ${state.isFullscreen ? 'sidebar-ctrl-btn--active' : ''}`}
          onClick={actions.toggleFullscreen}
          title={state.isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
          aria-label={state.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {state.isFullscreen ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

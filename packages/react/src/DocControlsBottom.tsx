/**
 * DocControlsBottom Component
 *
 * Horizontal control strip that renders below the doc player video.
 * An alternative to the overlay for landscape mode -- controls sit in a
 * separate bar below the video instead of overlapping the content.
 *
 * Contains: restart, play/pause, time display, progress bar, segment
 * indicator, CC toggle. Same controls as the overlay but in an external bar.
 *
 * Related Files:
 * - DocControlsOverlay.tsx -- Overlay variant (default landscape)
 * - DocControlsSidebar.tsx -- Sidebar variant (portrait)
 * - DocProgressBar.tsx -- Shared progress bar component
 * - types.ts -- PlaybackState/PlaybackActions interfaces
 */

import { DocProgressBar } from './DocProgressBar';
import type { PlaybackState, PlaybackActions, BlockMarker } from './types';
import { formatTime } from './types';
import type { Block } from '@bendyline/squisq/schemas';

interface DocControlsBottomProps {
  state: PlaybackState;
  actions: PlaybackActions;
  blockMarkers: BlockMarker[];
  expandedBlocks: Block[];
  getBlockTitle?: (block: Block) => string;
}

export function DocControlsBottom({
  state,
  actions,
  blockMarkers,
  expandedBlocks,
  getBlockTitle,
}: DocControlsBottomProps) {
  return (
    <div className="doc-controls-bottom">
      {/* Restart button */}
      <button
        className="bottom-ctrl-btn"
        onClick={actions.restart}
        title="Restart"
        aria-label="Restart from beginning"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
        </svg>
      </button>

      {/* Play/Pause button */}
      <button
        className="bottom-ctrl-btn bottom-play-btn"
        onClick={actions.toggle}
        aria-label={state.isPlaying ? 'Pause' : 'Play'}
      >
        {state.isPlaying ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Time display */}
      <span className="bottom-time">
        {formatTime(state.currentTime)} / {formatTime(state.totalDuration)}
      </span>

      {/* Progress bar */}
      <DocProgressBar
        state={state}
        actions={actions}
        blockMarkers={blockMarkers}
        expandedBlocks={expandedBlocks}
        getBlockTitle={getBlockTitle}
      />

      {/* Segment indicator */}
      <span className="bottom-segment">
        {state.currentBlockIndex + 1}/{state.totalBlocks}
      </span>

      {/* Caption mode cycle */}
      {state.hasCaptions && (
        <button
          className={`bottom-ctrl-btn ${state.captionMode !== 'off' ? 'bottom-ctrl-btn--active' : ''}`}
          onClick={() => actions.cycleCaptionMode()}
          title={
            state.captionMode === 'off'
              ? 'Captions: Off'
              : state.captionMode === 'standard'
                ? 'Captions: Standard'
                : 'Captions: Social'
          }
          aria-label="Cycle caption style"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 01-1 1h-3a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1z" />
          </svg>
        </button>
      )}
    </div>
  );
}

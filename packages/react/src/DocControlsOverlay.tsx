/**
 * DocControlsOverlay Component
 *
 * The default overlay controls that render at the bottom of the doc player
 * video with a gradient background. Contains all playback controls: restart,
 * play/pause, time display, progress bar with block markers, segment indicator,
 * and caption toggle.
 *
 * This is the original control layout extracted from DocPlayer. It's used
 * for the 'overlay' controls layout mode (Flow mode, landscape default).
 *
 * Related Files:
 * - DocPlayer.tsx -- Parent component
 * - DocProgressBar.tsx -- Progress bar sub-component
 * - types.ts -- Shared type definitions
 */

import { DocProgressBar } from './DocProgressBar';
import type { PlaybackState, PlaybackActions, BlockMarker } from './types';
import { formatTime } from './types';
import type { Block } from '@bendyline/prodcore/schemas';

interface DocControlsOverlayProps {
  state: PlaybackState;
  actions: PlaybackActions;
  blockMarkers: BlockMarker[];
  expandedBlocks: Block[];
  getBlockTitle?: (block: Block) => string;
}

export function DocControlsOverlay({
  state,
  actions,
  blockMarkers,
  expandedBlocks,
  getBlockTitle,
}: DocControlsOverlayProps) {
  return (
    <div
      className="doc-player__controls"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '12px 16px',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        zIndex: 100,
      }}
    >
      {/* Restart button */}
      <button
        onClick={actions.restart}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          cursor: 'pointer',
          padding: '8px',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
        }}
        title="Restart"
        aria-label="Restart from beginning"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
        </svg>
      </button>

      {/* Play/Pause button */}
      <button
        onClick={actions.toggle}
        style={{
          background: 'rgba(255,255,255,0.2)',
          border: 'none',
          borderRadius: '50%',
          color: 'white',
          cursor: 'pointer',
          padding: '10px',
          fontSize: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '40px',
          height: '40px',
        }}
        aria-label={state.isPlaying ? 'Pause' : 'Play'}
      >
        {state.isPlaying ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      {/* Time display */}
      <span style={{ color: 'white', fontSize: '12px', minWidth: '80px', fontFamily: 'monospace' }}>
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
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', whiteSpace: 'nowrap' }}>
        {state.currentBlockIndex + 1}/{state.totalBlocks}
      </span>

      {/* Caption toggle button */}
      {state.hasCaptions && (
        <button
          onClick={() => actions.setCaptionsEnabled(!state.captionsEnabled)}
          style={{
            background: state.captionsEnabled ? 'rgba(255,255,255,0.2)' : 'none',
            border: 'none',
            color: state.captionsEnabled ? 'white' : 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            padding: '8px',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            borderRadius: '4px',
          }}
          title={state.captionsEnabled ? 'Hide captions' : 'Show captions'}
          aria-label={state.captionsEnabled ? 'Hide captions' : 'Show captions'}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 01-1 1h-3a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1z"/>
          </svg>
        </button>
      )}

      {/* Fullscreen toggle button */}
      {actions.toggleFullscreen && (
        <button
          onClick={actions.toggleFullscreen}
          style={{
            background: state.isFullscreen ? 'rgba(255,255,255,0.2)' : 'none',
            border: 'none',
            color: state.isFullscreen ? 'white' : 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            padding: '8px',
            display: 'flex',
            alignItems: 'center',
            borderRadius: '4px',
          }}
          title={state.isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
          aria-label={state.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {state.isFullscreen ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
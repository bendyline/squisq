/**
 * DocControlsCompact Component
 *
 * The playback controls in one short row, about 24px tall by default: play/pause,
 * restart, the time, the timeline (DocProgressBar's `inline` variant), the
 * slide counter, captions, and fullscreen when the host wires it.
 *
 * DocControlsOverlay draws in white over the video; this row sits on the
 * host's own surface instead and takes its colors from there — text and icons
 * in `currentColor`, the progress and the play button in
 * `--squisq-player-accent` (with its glyph in `--squisq-player-on-accent`).
 * Hosts restyle it through its classes: `doc-controls-compact`, `__button`,
 * `__play`, `__time`, `__counter`. Its inline styles read custom properties
 * where a host is likely to differ — a hover rule sets
 * `--squisq-player-button-bg` on `__button`, which a selector could not do
 * against an inline `background`. Sizes too: `--squisq-player-control-size`
 * (each button's height, and the play button's diameter; 22px) and
 * `--squisq-player-scrub-height` (the timeline's clickable strip; 16px), so a
 * host can give a finger bigger targets. The row grows to fit them. The
 * editor shows it in its status bar through DocPlayer's
 * `renderPlaybackControls`.
 *
 * The time and the counter are as wide as their longest values, so the
 * timeline neither shifts nor resizes as the clock runs.
 *
 * Related Files:
 * - DocControlsOverlay.tsx -- The overlay variant, and PlaybackControlsProps
 * - DocProgressBar.tsx -- The timeline
 */

import type { CSSProperties } from 'react';
import { DocProgressBar } from './DocProgressBar';
import { PlayPauseIcon } from './PlayPauseIcon';
import type { PlaybackControlsProps } from './DocControlsOverlay';
import { formatTime } from './types';

/** A button's height and the play button's diameter; hosts may enlarge it. */
const CONTROL_SIZE = 'var(--squisq-player-control-size, 22px)';

const BUTTON: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  minWidth: CONTROL_SIZE,
  height: CONTROL_SIZE,
  padding: '0 3px',
  border: 'none',
  borderRadius: 4,
  background: 'var(--squisq-player-button-bg, none)',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

const PLAY: CSSProperties = {
  ...BUTTON,
  width: CONTROL_SIZE,
  padding: 0,
  borderRadius: '50%',
  background: 'var(--squisq-player-accent, #5b9bd5)',
  color: 'var(--squisq-player-on-accent, #fff)',
};

/** A readout as wide as its widest value: an invisible copy shares its cell. */
function Readout({ className, text, widest }: { className: string; text: string; widest: string }) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-grid',
        flex: 'none',
        justifyItems: 'center',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ gridArea: '1 / 1' }}>{text}</span>
      <span aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden' }}>
        {widest}
      </span>
    </span>
  );
}

export function DocControlsCompact({
  state,
  actions,
  blockMarkers,
  expandedBlocks,
  getBlockTitle,
}: PlaybackControlsProps) {
  const total = formatTime(state.totalDuration);
  const buffering = state.isPlaying && state.isBuffering;
  const captionTitle =
    state.captionMode === 'off'
      ? 'Captions: Off (click for Standard)'
      : state.captionMode === 'standard'
        ? 'Captions: Standard (click for Social)'
        : 'Captions: Social (click to turn off)';

  return (
    <div
      className="doc-controls-compact"
      role="group"
      aria-label="Playback controls"
      data-testid="playback-controls-compact"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
        minHeight: 24,
        fontSize: 12,
      }}
    >
      <button
        type="button"
        className="doc-controls-compact__button doc-controls-compact__play"
        onClick={actions.toggle}
        aria-label={state.isPlaying ? 'Pause' : 'Play'}
        aria-busy={buffering ? true : undefined}
        title={buffering ? 'Loading audio…' : state.isPlaying ? 'Pause' : 'Play'}
        style={PLAY}
      >
        <PlayPauseIcon isPlaying={state.isPlaying} isBuffering={state.isBuffering} size={14} />
      </button>
      <button
        type="button"
        className="doc-controls-compact__button"
        onClick={actions.restart}
        aria-label="Restart from beginning"
        title="Restart"
        style={BUTTON}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden="true">
          <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
        </svg>
      </button>

      <Readout
        className="doc-controls-compact__time"
        text={`${formatTime(state.currentTime)} / ${total}`}
        widest={`${total} / ${total}`}
      />

      {/* Padded so the dots at either end, which hang half off the track,
          keep clear of the readouts. */}
      <div style={{ flex: '1 1 auto', minWidth: 48, display: 'flex', padding: '0 6px' }}>
        <DocProgressBar
          variant="inline"
          state={state}
          actions={actions}
          blockMarkers={blockMarkers}
          expandedBlocks={expandedBlocks}
          getBlockTitle={getBlockTitle}
        />
      </div>

      <Readout
        className="doc-controls-compact__counter"
        text={`${state.currentBlockIndex + 1}/${state.totalBlocks}`}
        widest={`${state.totalBlocks}/${state.totalBlocks}`}
      />

      {state.hasCaptions && (
        <button
          type="button"
          className="doc-controls-compact__button"
          onClick={() => actions.cycleCaptionMode()}
          aria-label="Cycle caption style"
          aria-pressed={state.captionMode !== 'off'}
          title={captionTitle}
          style={{ ...BUTTON, opacity: state.captionMode === 'off' ? 0.6 : 1 }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 01-1 1h-3a1 1 0 01-1-1v-4a1 1 0 011-1h3a1 1 0 011 1v1z" />
          </svg>
          {state.captionMode !== 'off' && (
            <span style={{ marginLeft: 2, fontSize: 10, letterSpacing: '0.04em' }}>
              {state.captionMode === 'standard' ? 'CC' : 'SM'}
            </span>
          )}
        </button>
      )}

      {actions.toggleFullscreen && (
        <button
          type="button"
          className="doc-controls-compact__button"
          onClick={actions.toggleFullscreen}
          aria-label={state.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={state.isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
          style={BUTTON}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path
              d={
                state.isFullscreen
                  ? 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'
                  : 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'
              }
            />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * DocProgressBar Component
 *
 * Interactive progress/scrubber bar for doc playback. Shows a track with
 * progress fill, block markers as clickable dots, hover tooltip with time
 * and block title, and a hover line indicator.
 *
 * Markers come in two sizes. A chapter start (`BlockMarker.isSectionStart`,
 * the first block of each audio segment) is a large ringed dot that stays in
 * the tab order and lights up while its chapter plays. Every other slide
 * transition is a small bead inside the track, clickable but skipped by Tab.
 * Each carries `data-marker="chapter" | "slide"` for host styling and tests.
 *
 * The progress fill and the chapter rings use the player accent, a CSS custom
 * property (`--squisq-player-accent`, default a mid blue) so a host can match
 * the controls to its own palette without overriding inline styles.
 *
 * Two variants. `overlay` (the default) is drawn in white over the video, for
 * the overlay controls. `inline` is shorter and takes its colors from the
 * surrounding text (`currentColor`) and the accent, for a control row on the
 * host's own surface, such as DocControlsCompact in an editor's status bar;
 * its chapter dots fill with `--squisq-player-surface` (default `Canvas`).
 *
 * Extracted from DocPlayer to enable reuse across different control layouts
 * (overlay, sidebar, bottom). When used in sidebar/bottom layouts, this
 * component renders at the bottom of the video while other controls are
 * externalized.
 *
 * Related Files:
 * - DocPlayer.tsx -- Parent component
 * - DocControlsOverlay.tsx -- Uses this within the overlay
 * - types.ts -- Shared type definitions
 */

import { useRef, useState, useCallback } from 'react';
import type { PlaybackState, PlaybackActions, BlockMarker } from './types';
import { formatTime } from './types';
import type { Block } from '@bendyline/squisq/schemas';

/** The progress fill and chapter-ring color; hosts set `--squisq-player-accent`. */
const PLAYER_ACCENT = 'var(--squisq-player-accent, #5b9bd5)';

/** Sizes and colors per variant: white over the video, or the host's own. */
const VARIANTS = {
  overlay: {
    height: 24,
    track: 6,
    trackColor: 'rgba(255,255,255,0.2)',
    chapter: 14,
    chapterFill: 'rgba(255,255,255,0.75)',
    chapterActive: '#ffffff',
    chapterShadow: '0 1px 3px rgba(0,0,0,0.5)',
    bead: 12,
    beadFill: 'rgba(255,255,255,0.55)',
    beadActive: '#ffffff',
    hoverLine: 16,
    hoverLineColor: 'rgba(255,255,255,0.6)',
  },
  inline: {
    height: 16,
    track: 4,
    trackColor: 'color-mix(in srgb, currentColor 22%, transparent)',
    chapter: 10,
    chapterFill: 'var(--squisq-player-surface, Canvas)',
    chapterActive: PLAYER_ACCENT,
    chapterShadow: 'none',
    bead: 10,
    beadFill: 'color-mix(in srgb, currentColor 45%, transparent)',
    beadActive: 'currentColor',
    hoverLine: 12,
    hoverLineColor: 'color-mix(in srgb, currentColor 60%, transparent)',
  },
} as const;

interface DocProgressBarProps {
  state: PlaybackState;
  actions: PlaybackActions;
  blockMarkers: BlockMarker[];
  /** All expanded blocks for hover lookup */
  expandedBlocks: Block[];
  /** Optional: get block title for hover tooltip */
  getBlockTitle?: (block: Block) => string;
  /** `overlay` (default): white, over the video. `inline`: compact, in the host's colors. */
  variant?: 'overlay' | 'inline';
}

export function DocProgressBar({
  state,
  actions,
  blockMarkers,
  expandedBlocks,
  getBlockTitle,
  variant = 'overlay',
}: DocProgressBarProps) {
  const look = VARIANTS[variant];
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);

  // Fill position tracks the same timeline as the clock readout and the block
  // marker dots — elapsed playback time over the audio `totalDuration`. (We
  // deliberately don't use `state.docProgress`, which is keyed to the doc's
  // estimated `script.duration`; when that diverges from the actual playback
  // length — e.g. the editor preview's reading-time estimate — the fill would
  // desync from the clock and the dots.)
  const playProgress =
    state.totalDuration > 0 ? Math.max(0, Math.min(1, state.currentTime / state.totalDuration)) : 0;

  const handleProgressHover = useCallback((e: React.MouseEvent) => {
    const bar = progressBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, x / rect.width));
    setHoverPosition(progress);
  }, []);

  const handleProgressLeave = useCallback(() => {
    setHoverPosition(null);
  }, []);

  const handleProgressKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let next: number | null = null;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          next = state.currentTime - 5;
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          next = state.currentTime + 5;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = state.totalDuration;
          break;
      }
      if (next == null) return;
      e.preventDefault();
      actions.seekTo(Math.max(0, Math.min(state.totalDuration, next)));
    },
    [actions, state.currentTime, state.totalDuration],
  );

  const getBlockAtTimeLocal = useCallback(
    (time: number): { block: Block; index: number } | null => {
      for (let i = expandedBlocks.length - 1; i >= 0; i--) {
        const blk = expandedBlocks[i];
        if (time >= blk.startTime) {
          return { block: blk, index: i };
        }
      }
      return expandedBlocks.length > 0 ? { block: expandedBlocks[0], index: 0 } : null;
    },
    [expandedBlocks],
  );

  // The chapter being played: the last chapter start at or before the playhead.
  let currentChapterIndex = -1;
  for (const marker of blockMarkers) {
    if (marker.isSectionStart && marker.block.startTime <= state.currentTime) {
      currentChapterIndex = marker.index;
    }
  }

  return (
    <div
      ref={progressBarRef}
      role="group"
      aria-label="Playback timeline"
      data-variant={variant}
      style={{
        flex: 1,
        // The clickable strip; the track stays centered in it. The inline
        // variant lets its host make it taller for a finger.
        height:
          variant === 'inline'
            ? `var(--squisq-player-scrub-height, ${look.height}px)`
            : `${look.height}px`,
        cursor: 'pointer',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
      }}
      onClick={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - rect.left;
        const progress = x / rect.width;
        actions.seekTo(progress * state.totalDuration);
      }}
      onMouseMove={handleProgressHover}
      onMouseLeave={handleProgressLeave}
    >
      {/* Track background */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={state.totalDuration}
        aria-valuenow={Math.max(0, Math.min(state.totalDuration, state.currentTime))}
        aria-valuetext={`${formatTime(state.currentTime)} of ${formatTime(state.totalDuration)}`}
        onKeyDown={handleProgressKeyDown}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: `${look.track}px`,
          background: look.trackColor,
          borderRadius: `${look.track / 2}px`,
        }}
      />

      {/* Progress fill.
          No CSS `width` transition: the fill is driven by frequent JS updates
          (the synthetic fallback timer runs ~60fps; real audio fires
          `timeupdate` several times/sec), so it's already smooth. A CSS
          transition here actively breaks playback — after a discontinuous
          backward seek, the per-frame inline-width updates on resume keep
          interrupting the in-flight transition before it advances, so the
          *rendered* width latches at the seek position even though the inline
          style (and the clock) keep climbing. The result is a frozen-looking
          bar while time advances. Update width instantly instead. */}
      <div
        data-testid="doc-progress-fill"
        style={{
          position: 'absolute',
          left: 0,
          width: `${playProgress * 100}%`,
          height: `${look.track}px`,
          background: PLAYER_ACCENT,
          borderRadius: `${look.track / 2}px`,
        }}
      />

      {/* Block markers (dots). Chapter starts are large ringed dots and stay in
          the tab order; slide transitions are small beads inside the track,
          clickable through a 12px hit area but skipped by Tab (the slider
          already seeks by keyboard, and a long story has dozens of slides). */}
      {blockMarkers.map((marker, i) => {
        const chapter = marker.isSectionStart;
        const active = chapter
          ? marker.index === currentChapterIndex
          : marker.index === state.currentBlockIndex;
        return (
          <button
            type="button"
            key={`${marker.block.id}-${i}`}
            data-marker={chapter ? 'chapter' : 'slide'}
            tabIndex={chapter ? 0 : -1}
            style={{
              position: 'absolute',
              left: `${marker.position}%`,
              transform: 'translateX(-50%)',
              boxSizing: 'border-box',
              borderRadius: '50%',
              cursor: 'pointer',
              transition: 'transform 0.15s, background-color 0.15s',
              ...(chapter
                ? {
                    width: `${look.chapter}px`,
                    height: `${look.chapter}px`,
                    padding: 0,
                    backgroundColor: active ? look.chapterActive : look.chapterFill,
                    border: `2px solid ${PLAYER_ACCENT}`,
                    boxShadow: look.chapterShadow,
                    zIndex: 3,
                  }
                : {
                    width: `${look.bead}px`,
                    height: `${look.bead}px`,
                    padding: '3px',
                    backgroundClip: 'content-box',
                    backgroundColor: active ? look.beadActive : look.beadFill,
                    border: 'none',
                    zIndex: 2,
                  }),
            }}
            title={marker.title}
            aria-label={`Seek to ${marker.title}`}
            onClick={(e) => {
              e.stopPropagation();
              actions.seekTo(marker.block.startTime);
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'translateX(-50%) scale(1.3)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'translateX(-50%)';
            }}
          />
        );
      })}

      {/* Hover tooltip */}
      {hoverPosition !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${hoverPosition * 100}%`,
            bottom: '100%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '6px 10px',
            background: 'rgba(0,0,0,0.9)',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div style={{ color: 'white', fontSize: '12px', fontFamily: 'monospace' }}>
            {formatTime(hoverPosition * state.totalDuration)}
          </div>
          {(() => {
            const hoverTime = hoverPosition * state.totalDuration;
            const slideInfo = getBlockAtTimeLocal(hoverTime);
            if (slideInfo && getBlockTitle) {
              return (
                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px', marginTop: '2px' }}>
                  {getBlockTitle(slideInfo.block)}
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* Hover line indicator */}
      {hoverPosition !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${hoverPosition * 100}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '2px',
            height: `${look.hoverLine}px`,
            background: look.hoverLineColor,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
}

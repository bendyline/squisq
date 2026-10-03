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

interface DocProgressBarProps {
  state: PlaybackState;
  actions: PlaybackActions;
  blockMarkers: BlockMarker[];
  /** All expanded blocks for hover lookup */
  expandedBlocks: Block[];
  /** Optional: get block title for hover tooltip */
  getBlockTitle?: (block: Block) => string;
}

export function DocProgressBar({
  state,
  actions,
  blockMarkers,
  expandedBlocks,
  getBlockTitle,
}: DocProgressBarProps) {
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
      style={{
        flex: 1,
        height: '24px',
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
          height: '6px',
          background: 'rgba(255,255,255,0.2)',
          borderRadius: '3px',
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
          height: '6px',
          background: '#5b9bd5',
          borderRadius: '3px',
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
                    width: '14px',
                    height: '14px',
                    padding: 0,
                    backgroundColor: active ? '#ffffff' : 'rgba(255,255,255,0.75)',
                    border: '2px solid #5b9bd5',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    zIndex: 3,
                  }
                : {
                    width: '12px',
                    height: '12px',
                    padding: '3px',
                    backgroundClip: 'content-box',
                    backgroundColor: active ? '#ffffff' : 'rgba(255,255,255,0.55)',
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
            height: '16px',
            background: 'rgba(255,255,255,0.6)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
}

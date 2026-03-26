/**
 * DocProgressBar Component
 *
 * Interactive progress/scrubber bar for doc playback. Shows a track with
 * progress fill, block markers as clickable dots, hover tooltip with time
 * and block title, and a hover line indicator.
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

  return (
    <div
      ref={progressBarRef}
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
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: '6px',
          background: 'rgba(255,255,255,0.2)',
          borderRadius: '3px',
        }}
      />

      {/* Progress fill */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          width: `${state.docProgress * 100}%`,
          height: '6px',
          background: '#5b9bd5',
          borderRadius: '3px',
          transition: 'width 0.1s',
        }}
      />

      {/* Block markers (dots) */}
      {blockMarkers.map((marker, i) => (
        <div
          key={`${marker.block.id}-${i}`}
          style={{
            position: 'absolute',
            left: `${marker.position}%`,
            transform: 'translateX(-50%)',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background:
              marker.index === state.currentBlockIndex ? '#ffffff' : 'rgba(255,255,255,0.5)',
            border: '2px solid #5b9bd5',
            cursor: 'pointer',
            zIndex: 2,
            transition: 'transform 0.15s, background 0.15s',
          }}
          title={marker.title}
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
      ))}

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

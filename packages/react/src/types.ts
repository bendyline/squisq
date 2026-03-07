/**
 * Doc Player Control Types
 *
 * Shared type definitions for doc player controls across different
 * layout modes (overlay, sidebar, bottom). These interfaces allow
 * control components to be decoupled from the core DocPlayer.
 *
 * Related Files:
 * - DocPlayer.tsx — Core player component
 * - DocProgressBar.tsx — Extracted progress bar
 * - DocControlsOverlay.tsx — Overlay controls (default)
 * - DocControlsSidebar.tsx — Vertical sidebar controls
 * - DocControlsBottom.tsx — Horizontal bottom strip controls
 */

import type { Block } from '@bendyline/prodcore/schemas';

/** Layout mode for doc player controls */
export type ControlsLayout = 'overlay' | 'sidebar' | 'bottom';

/** Playback state exposed to external control components */
export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  currentBlockIndex: number;
  totalBlocks: number;
  docProgress: number;
  hasCaptions: boolean;
  captionsEnabled: boolean;
  isFullscreen?: boolean;
  /** Current audio segment index (0-based) */
  currentSegmentIndex: number;
  /** Current audio segment name (e.g., 'intro', 'history') */
  currentSegmentName: string | null;
  /** Current block data (for extracting image info, etc.) */
  currentBlock: Block | null;
}

/** Playback actions exposed to external control components */
export interface PlaybackActions {
  toggle: () => void;
  restart: () => void;
  seekTo: (time: number) => void;
  setCaptionsEnabled: (enabled: boolean) => void;
  toggleFullscreen?: () => void;
}

/** Block marker data for the progress bar */
export interface BlockMarker {
  block: Block;
  index: number;
  position: number;
  title: string;
  /** True if this block is the first in a new audio segment (section boundary) */
  isSectionStart: boolean;
}

/** Format time in seconds to MM:SS string */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
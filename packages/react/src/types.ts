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

/**
 * Display mode for DocPlayer.
 *
 * - `'video'` — Traditional video-style playback with play/pause, scrub bar,
 *   and time-based auto-advance. Default mode.
 * - `'slideshow'` — PowerPoint-style presentation with prev/next navigation.
 *   Blocks are treated as static slides that only change on user click.
 *   No auto-advance, no scrub bar.
 * - `'linear'` — Long-scrolling document view. Renders the full markdown as
 *   readable HTML with template-annotated sections shown as inline SVG cards.
 *   No audio, no timeline, no controls — just a scrollable page.
 */
export type DisplayMode = 'video' | 'slideshow' | 'linear';

/** Slide navigation actions for slideshow display mode */
export interface SlideNavActions {
  /** Navigate to the next slide */
  nextSlide: () => void;
  /** Navigate to the previous slide */
  prevSlide: () => void;
  /** Navigate to a specific slide by index (0-based) */
  goToSlide: (index: number) => void;
}

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
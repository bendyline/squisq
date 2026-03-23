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

import type { Block } from '@bendyline/squisq/schemas';

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

/**
 * Caption display style.
 *
 * - `'standard'` — Traditional broadcast-style captions: small white text
 *   on a semi-transparent black badge at the top of the player.
 * - `'social'` — Social media-style (Instagram/TikTok): large centered words
 *   showing 3-5 words at a time with the active word highlighted in the
 *   theme's primary color. Font and colors pulled from the active theme.
 */
export type CaptionStyle = 'standard' | 'social';

/**
 * Caption display mode — combines enable/disable with style selection.
 * The CC button cycles through: off → standard → social → off.
 */
export type CaptionMode = 'off' | 'standard' | 'social';

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
  /** Current caption display mode (off, standard, social). */
  captionMode: CaptionMode;
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
  /** Cycle caption mode: off → standard → social → off */
  cycleCaptionMode: () => void;
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

// ============================================
// Render-mode API (exposed on window for Playwright / debug)
// ============================================

/** Block metadata returned by SquisqRenderAPI.getBlocks() */
export interface RenderBlockInfo {
  id: string;
  template: string;
  startTime: number;
  duration: number;
}

/** Audio segment info returned by SquisqRenderAPI.getAudioSegments() */
export interface RenderAudioSegmentInfo {
  src: string;
  name: string;
  duration: number;
  startTime: number;
}

/** Caption phrase info returned by SquisqRenderAPI.getCaptions() */
export interface RenderCaptionInfo {
  text: string;
  startTime: number;
  endTime: number;
}

/** Chapter marker returned by SquisqRenderAPI.getChapters() */
export interface RenderChapterInfo {
  title: string;
  startTime: number;
  duration: number;
}

/**
 * API surface exposed on `window` in render mode and debug mode.
 * Used by Playwright for video export and by ?debug=true for testing.
 *
 * @example
 * ```ts
 * // In Playwright:
 * const w = window as unknown as SquisqWindow;
 * await w.seekTo!(5.0);
 * const blocks = w.getBlocks!();
 * ```
 */
export interface SquisqRenderAPI {
  seekTo: (time: number) => Promise<void>;
  getDuration: () => number;
  getBlocks: () => RenderBlockInfo[];
  getAudioSegments: () => RenderAudioSegmentInfo[];
  getCaptions: () => RenderCaptionInfo[];
  getChapters: () => RenderChapterInfo[];
  showCover: () => Promise<void>;
  hideCover: () => Promise<void>;
  hasCoverBlock: () => boolean;
}

/**
 * Window augmented with optional SquisqRenderAPI properties.
 * Each property is optional because they're only present in render/debug mode.
 */
export type SquisqWindow = Window & typeof globalThis & Partial<SquisqRenderAPI>;

/** Format time in seconds to MM:SS string */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

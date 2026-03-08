/**
 * AudioProvider - Abstraction for audio playback in DocPlayer
 *
 * This module defines an interface for audio playback operations that can have
 * different implementations depending on the runtime environment:
 *
 * - Site/Browser: Uses HTML5 Audio element directly
 * - EFB/MSFS: Routes through CompanionAPI to Electron app
 *
 * The DocPlayer uses this abstraction instead of directly manipulating audio,
 * allowing the same component code to work in both environments.
 */

import type { AudioTrack, AudioSegment } from '@bendyline/squisq/schemas';

export interface AudioState {
  /** Current time in overall timeline (seconds) */
  currentTime: number;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Index of current audio segment */
  currentSegment: number;
  /** Total duration of all segments */
  totalDuration: number;
  /** Whether audio has finished */
  isEnded: boolean;
  /** Whether audio is loaded and ready to play */
  isReady: boolean;
  /** Whether the audio backend is available/connected */
  isAvailable: boolean;
  /** Message to show when not available */
  unavailableMessage?: string;
}

export interface AudioActions {
  /** Start or resume playback */
  play: () => Promise<void>;
  /** Pause playback */
  pause: () => Promise<void>;
  /** Toggle play/pause */
  toggle: () => Promise<void>;
  /** Seek to specific time in timeline */
  seekTo: (time: number) => Promise<void>;
  /** Skip to specific segment */
  skipToSegment: (index: number) => Promise<void>;
  /** Restart from beginning */
  restart: () => Promise<void>;
}

export type AudioProvider = AudioState & AudioActions;

export interface AudioProviderConfig {
  /** Audio track with segments */
  audioTrack: AudioTrack | undefined;
  /** Base path for resolving audio URLs */
  basePath: string;
  /** Article ID (for EFB companion) */
  articleId?: string;
  /** Tile/geohash (for EFB companion) */
  tile?: string;
}

/**
 * Calculate segment start times and total duration from an audio track
 */
export function calculateSegmentTiming(segments: AudioSegment[] | undefined): {
  segmentStarts: number[];
  totalDuration: number;
} {
  if (!segments?.length) {
    return { segmentStarts: [], totalDuration: 0 };
  }

  let time = 0;
  const segmentStarts = segments.map((seg) => {
    const start = time;
    time += seg.duration;
    return start;
  });

  return { segmentStarts, totalDuration: time };
}

/**
 * Find which segment a given time falls into
 */
export function findSegmentAtTime(
  time: number,
  segments: AudioSegment[] | undefined,
  segmentStarts: number[],
): { segmentIndex: number; segmentStart: number } {
  if (!segments?.length) {
    return { segmentIndex: 0, segmentStart: 0 };
  }

  let segmentIndex = 0;
  let segmentStart = 0;

  for (let i = 0; i < segments.length; i++) {
    const segEnd = segmentStarts[i] + segments[i].duration;
    if (time < segEnd) {
      segmentIndex = i;
      segmentStart = segmentStarts[i];
      break;
    }
    // Handle edge case: time exactly at end goes to last segment
    if (i === segments.length - 1) {
      segmentIndex = i;
      segmentStart = segmentStarts[i];
    }
  }

  return { segmentIndex, segmentStart };
}

/**
 * Pure decision helpers for the Record media dialog's narration mode.
 * Kept DOM/MediaRecorder-free so every branch is unit-testable.
 */

import type { RecorderState } from './hooks/useMediaRecorder.js';
import type { NarrationRecorderState } from '../teleprompter/recording/useNarrationRecorder.js';
import type { PrompterTransport } from '../teleprompter/types.js';

/** Narration recorder states with nothing in flight and no take to lose. */
export function narrationQuiescent(narrationState: NarrationRecorderState): boolean {
  return narrationState === 'idle' || narrationState === 'error';
}

/**
 * Whether the "Show narration mode" checkbox is locked, in either direction:
 * the simple recorder is busy or holds an unsaved take (checking would drop
 * it), or a narration take is in flight/awaiting review (unchecking would
 * lose it).
 */
export function narrationToggleLocked(
  simpleState: RecorderState,
  simpleHasBlob: boolean,
  narrationState: NarrationRecorderState,
): boolean {
  const simpleBusy =
    simpleState === 'recording' ||
    simpleState === 'requesting' ||
    simpleState === 'stopping' ||
    (simpleState === 'stopped' && simpleHasBlob);
  return simpleBusy || !narrationQuiescent(narrationState);
}

/**
 * Whether Escape may close the dialog right now. While the prompter is
 * rolling (or counting down) or a narration take is in flight, Escape is
 * reserved for pausing the prompter instead.
 */
export function escapeClosesDialog(
  narrationOn: boolean,
  narrationState: NarrationRecorderState,
  transport: PrompterTransport,
): boolean {
  if (!narrationOn) return true;
  if (transport === 'rolling' || transport === 'countdown') return false;
  return narrationQuiescent(narrationState);
}

/**
 * Whether Close must confirm before discarding. True whenever a narration
 * take is in flight or sits unsaved in review — closing then would silently
 * drop it (useNarrationRecorder warns and drops on unmount mid-take).
 */
export function closeNeedsConfirm(
  narrationOn: boolean,
  narrationState: NarrationRecorderState,
  hasTake: boolean,
): boolean {
  if (!narrationOn) return false;
  if (narrationState === 'review') return hasTake;
  return !narrationQuiescent(narrationState);
}

/** Left-column capture summary line while narration mode is on. */
export function narrationCaptureSummary(withCamera: boolean): string {
  return withCamera
    ? 'Narration: microphone + camera video, timed to your reading.'
    : 'Narration: microphone audio, timed to your reading.';
}

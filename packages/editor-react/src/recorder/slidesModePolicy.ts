/**
 * Pure decision helpers for the Record media dialog's slides mode — the peer
 * of `narrationModePolicy.ts`, kept DOM/MediaRecorder-free so every branch is
 * unit-testable.
 *
 * Slides mode and narration mode both expand the dialog and both claim its
 * right column, so they are mutually exclusive. That exclusion is STRUCTURAL:
 * the dialog holds one {@link RecorderPanelMode} rather than two booleans, so
 * checking one box cannot leave the other checked. There is deliberately no
 * "are these compatible?" predicate to keep in sync.
 */

import type { RecorderState } from './hooks/useMediaRecorder.js';

/** Which optional panel occupies the dialog's right column. */
export type RecorderPanelMode = 'none' | 'narration' | 'slides';

/** Whether the dialog should render in its full-viewport two-column form. */
export function isExpandedPanel(mode: RecorderPanelMode): boolean {
  return mode !== 'none';
}

/**
 * The mode after toggling one of the two checkboxes. Checking a box selects
 * it (deselecting the other by construction); unchecking returns to 'none'.
 *
 * Unchecking a box that is not the active mode is a no-op rather than a
 * collapse — a stale change event from the box that was just superseded must
 * not close the panel the user actually opened.
 */
export function panelModeAfterToggle(
  current: RecorderPanelMode,
  target: 'narration' | 'slides',
  checked: boolean,
): RecorderPanelMode {
  if (checked) return target;
  return current === target ? 'none' : current;
}

/** Clamp a slide index into `[0, count - 1]`, or 0 for an empty deck. */
export function clampSlideIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(index)));
}

/** Slide step a key implies: +1 forward, -1 back, 0 for keys we do not own. */
export function slideStepForKey(key: string): -1 | 0 | 1 {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'Spacebar':
      return 1;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return -1;
    default:
      return 0;
  }
}

/**
 * Whether the review-state "Update block timings…" checkbox is shown.
 *
 * Only once there is a finished take to save, only while slides mode is the
 * active panel, and only when the host declared it can attach a sidecar
 * (`captureTimings` — true for the Document narration entry, whose take
 * becomes a document-anchored clip, and false for an ordinary block-level
 * recording, where nothing would ever read the sidecar back).
 */
export function showSlideTimingCheckbox(options: {
  slidesOn: boolean;
  captureTimings: boolean;
  recorderState: RecorderState;
  hasBlob: boolean;
}): boolean {
  return (
    options.slidesOn &&
    options.captureTimings &&
    options.recorderState === 'stopped' &&
    options.hasBlob
  );
}

/**
 * Review-panel warning about slides the presenter never reached. They save as
 * zero-length ranges, which playback skips — worth saying out loud, because
 * the alternative reading ("they kept their old duration") is the intuitive one.
 */
export function unshownSlidesWarning(total: number, unshown: number): string | null {
  if (unshown <= 0 || total <= 0) return null;
  const noun = unshown === 1 ? 'slide was' : 'slides were';
  return `${unshown} of ${total} ${noun} never shown — they'll be skipped during playback.`;
}

/** The exact label of the review-state block-timings checkbox. */
export const SLIDE_TIMING_CHECKBOX_LABEL = 'Update block timings when I save this narration';

/**
 * Turn whatever dictation threw into one actionable sentence for the author.
 * Adapted from Gezel's `humanizeNarrationError` (ChatNarrateButton), minus its
 * app-specific settings paths — the host owns its own setup UI.
 */

export function humanizeDictationError(caught: unknown): string {
  const error = caught instanceof Error ? caught : new Error(String(caught));
  const name = error.name;
  const message = error.message || String(caught);
  if (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    /permission|not allowed|denied/i.test(message)
  ) {
    return 'Microphone access was not granted. Allow it in your system settings, then try again.';
  }
  if (name === 'OverconstrainedError' || /constraint|selected microphone/i.test(message)) {
    return 'The selected microphone is unavailable. Choose another microphone, then try again.';
  }
  if (name === 'NotFoundError' || /requested device not found|no microphone/i.test(message)) {
    return 'No microphone is available.';
  }
  if (name === 'NotReadableError' || /could not start audio source/i.test(message)) {
    return 'The microphone is in use by another application.';
  }
  if (/getUserMedia is not available|MediaRecorder is not defined/i.test(message)) {
    return 'Voice input is unavailable in this browser.';
  }
  return `Dictation stopped: ${message}`;
}

/** Shown when a session ends on a long silence that never produced any text. */
export const NO_SPEECH_DETECTED_MESSAGE =
  'No speech was detected, so dictation stopped. Check that the right microphone is selected.';

/** Shown when the host asks for setup but offers no `requestSetup()`. */
export function setupRequiredMessage(reason: string | undefined): string {
  return reason
    ? `Dictation needs a one-time setup first: ${reason}`
    : 'Dictation needs a one-time setup before it can start.';
}

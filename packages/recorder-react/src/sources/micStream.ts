/**
 * Microphone-only capture via `getUserMedia({ audio: true })`.
 */

import { supportsUserMedia } from '../formats.js';

/**
 * Request a microphone-only `MediaStream`. Caller owns the stream and
 * must stop its tracks when done.
 *
 * @param constraints - Optional audio constraints (sample rate, device
 *   id, echo cancellation, etc.). Defaults to `true` — let the browser
 *   pick.
 * @throws When `mediaDevices` is unavailable, or when the user denies
 *   permission (the underlying `getUserMedia` rejection propagates).
 */
export async function requestMicStream(
  constraints?: MediaTrackConstraints,
): Promise<MediaStream> {
  if (!supportsUserMedia()) {
    throw new Error('navigator.mediaDevices.getUserMedia is not available in this environment.');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: constraints ?? true,
    video: false,
  });
}

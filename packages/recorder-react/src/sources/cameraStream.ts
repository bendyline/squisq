/**
 * Camera + microphone capture via `getUserMedia({ video, audio })`.
 */

import { supportsUserMedia } from '../formats.js';

export interface CameraStreamOptions {
  /** Video track constraints (resolution, facing mode, frame rate). Pass `true` for browser default, or `false` to omit video. */
  video?: boolean | MediaTrackConstraints;
  /** Audio track constraints. Pass `true` for browser default, or `false` to omit audio. */
  audio?: boolean | MediaTrackConstraints;
}

/**
 * Request a camera + mic `MediaStream`. Caller owns the stream and must
 * stop its tracks when done.
 *
 * Both tracks are requested by default. To capture video only, pass
 * `audio: false`; to capture audio only use {@link requestMicStream}
 * instead.
 *
 * @throws When `mediaDevices` is unavailable, or when the user denies
 *   permission.
 */
export async function requestCameraStream(
  options?: CameraStreamOptions,
): Promise<MediaStream> {
  if (!supportsUserMedia()) {
    throw new Error('navigator.mediaDevices.getUserMedia is not available in this environment.');
  }
  const video = options?.video ?? true;
  const audio = options?.audio ?? true;
  return navigator.mediaDevices.getUserMedia({ video, audio });
}

/**
 * System-audio capture for mic- and camera-only recordings.
 *
 * System/tab audio is only obtainable through `getDisplayMedia` — `getUserMedia`
 * (microphone / camera) cannot capture it. When the user wants their computer's
 * audio bundled into a recording that ISN'T a screen capture, we run a display
 * capture, discard its video surface, and mix its audio into the base stream.
 * The browser still shows the screen/tab picker (audio-only display capture
 * isn't allowed), we just never keep the picture.
 *
 * The mixing mirrors the screen+mic path in {@link ./screenStream}: the raw
 * source tracks feeding the `AudioContext` are NOT members of the returned
 * stream, so the caller's stream teardown can't reach them — `dispose()` owns
 * stopping them (and closing the context).
 */

import { supportsDisplayMedia } from '../formats.js';

/** A base stream (mic or camera) with system audio mixed into a single track. */
export interface SystemAudioMixHandle {
  stream: MediaStream;
  /**
   * Stops the raw mixer sources (the base's mic/camera audio + the system-audio
   * track) and closes the `AudioContext`. The caller still stops `stream`'s own
   * tracks separately — `dispose()` cleans up everything that isn't `stream`.
   */
  dispose: () => void;
}

/**
 * Capture system audio via a display capture, discarding the video surface.
 * Returns an audio-only stream, or `null` when the user shared no audio
 * (declined "share audio" in the picker). Throws when the picker is cancelled
 * or denied.
 *
 * Call this BEFORE acquiring the mic/camera: `getDisplayMedia` needs transient
 * user activation, which the initiating click still holds on the first await.
 */
export async function requestSystemAudioStream(): Promise<MediaStream | null> {
  if (!supportsDisplayMedia()) {
    throw new Error('navigator.mediaDevices.getDisplayMedia is not available in this environment.');
  }
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  // We only wanted the audio — release the shared surface immediately. The
  // audio track stays live; that alone keeps the browser's share indicator lit
  // until `dispose()` stops it.
  display.getVideoTracks().forEach((t) => t.stop());
  const audio = display.getAudioTracks();
  if (audio.length === 0) return null;
  return new MediaStream(audio);
}

/**
 * Mix `systemAudio` into `base` (a mic or camera stream). Returns a stream
 * carrying base's video (if any) plus a single mixed audio track combining
 * base's own audio with the system audio.
 */
export function mixSystemAudio(base: MediaStream, systemAudio: MediaStream): SystemAudioMixHandle {
  const AC = window.AudioContext;
  if (typeof AC === 'undefined') {
    // No mixer available: we can't fold two audio sources into one track, so
    // drop the system audio rather than emit a second audio track the recorder
    // would ignore.
    console.warn(
      '[squisq-recorder] AudioContext unavailable — system audio could not be mixed into the recording.',
    );
    systemAudio.getTracks().forEach((t) => t.stop());
    return { stream: base, dispose: () => {} };
  }

  const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  const baseAudio = base.getAudioTracks();
  const sources = [...baseAudio, ...systemAudio.getAudioTracks()].filter(
    (t) => t.readyState === 'live',
  );
  for (const track of sources) {
    ctx.createMediaStreamSource(new MediaStream([track])).connect(dest);
  }
  const [mixed] = dest.stream.getAudioTracks();

  // Output: base video (camera; none for mic) + the single mixed audio track.
  const output = new MediaStream();
  base.getVideoTracks().forEach((t) => output.addTrack(t));
  if (mixed) output.addTrack(mixed);
  else baseAudio.forEach((t) => output.addTrack(t)); // mixer produced nothing — keep base audio

  let disposed = false;
  const dispose = () => {
    // Idempotent — useMediaRecorder can reach it from both cancel() and unmount.
    if (disposed) return;
    disposed = true;
    // The raw mic/camera + system-audio tracks feed the mixer and are not in
    // `output`, so the caller's stream teardown can't stop them.
    baseAudio.forEach((t) => t.stop());
    systemAudio.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };
  return { stream: output, dispose };
}

/**
 * Screen capture via `getDisplayMedia`, with optional microphone mixing.
 *
 * The browser-native `getDisplayMedia({ audio: true })` flag only
 * captures *system* audio (and only on Chromium on desktop). For
 * narrated screencasts, hosts usually want the speaker's voice too —
 * we provide an opt-in "include mic" path that pulls a parallel
 * `getUserMedia` audio track and mixes it into the screen stream via
 * `AudioContext`, so the resulting `MediaStream` carries a single audio
 * track and a single video track.
 */

import { supportsDisplayMedia, supportsUserMedia } from '../formats.js';

export interface ScreenStreamOptions {
  /** Video constraints for the screen surface. Pass `true` for browser default. */
  video?: boolean | MediaTrackConstraints;
  /**
   * Whether to attempt to capture the system audio (tab / window / monitor
   * audio). Browser support is limited (desktop Chromium only); when the
   * platform doesn't honor this flag, the resulting stream simply omits
   * the system audio track.
   */
  systemAudio?: boolean;
  /** Constraints for the display stream's system-audio track. */
  systemAudioConstraints?: MediaTrackConstraints;
  /**
   * Whether to also pull the microphone via `getUserMedia` and mix it
   * into the resulting stream's audio track. When both `systemAudio` and
   * `includeMicrophone` produce tracks, they're combined via
   * `AudioContext` into a single output track.
   */
  includeMicrophone?: boolean;
  /** Microphone track constraints, when `includeMicrophone` is true. */
  microphoneConstraints?: MediaTrackConstraints;
}

/**
 * Combine zero-or-more audio source streams into one mixed output track
 * via an `AudioContext`. Returns `null` when no input tracks were
 * supplied so the caller can decide what to do.
 */
function mixAudioTracks(streams: MediaStream[]): {
  track: MediaStreamTrack;
  context: AudioContext;
} | null {
  const sources = streams
    .map((s) => s.getAudioTracks())
    .flat()
    .filter((t) => t.readyState === 'live');
  if (sources.length === 0) return null;

  const AC = window.AudioContext;
  if (typeof AC === 'undefined') return null;
  const ctx = new AC();
  const dest = ctx.createMediaStreamDestination();
  for (const track of sources) {
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    src.connect(dest);
  }
  const [mixed] = dest.stream.getAudioTracks();
  if (!mixed) return null;
  return { track: mixed, context: ctx };
}

/**
 * Handle returned by {@link requestScreenStream}. The `stream` is what
 * gets handed to `MediaRecorder`; the `dispose()` callback shuts down
 * any auxiliary resources (the mic-mix `AudioContext` plus the raw
 * source tracks feeding it). Callers must also stop the stream's tracks
 * via `stream.getTracks().forEach(t => t.stop())` when done —
 * `dispose()` cleans up everything that isn't the stream itself.
 *
 * IMPORTANT for callers: when the microphone is mixed in, the raw
 * system-audio / mic tracks are deliberately NOT members of `stream`
 * (only the single mixed output track is). So stopping `stream`'s tracks
 * alone leaves those captures live — `dispose()` is what releases them,
 * and it must always be called alongside the stream teardown or the
 * screen-share indicator stays lit.
 */
export interface ScreenStreamHandle {
  stream: MediaStream;
  /** Auxiliary cleanup beyond the stream tracks. Safe to call multiple times. */
  dispose: () => void;
}

/**
 * Request a screen-capture `MediaStream`, optionally with a mixed-in
 * microphone track. Caller owns the resulting stream.
 *
 * @throws When `getDisplayMedia` isn't available, or when the user
 *   cancels the picker / denies permission.
 */
export async function requestScreenStream(
  options?: ScreenStreamOptions,
): Promise<ScreenStreamHandle> {
  if (!supportsDisplayMedia()) {
    throw new Error('navigator.mediaDevices.getDisplayMedia is not available in this environment.');
  }
  const video = options?.video ?? true;
  const systemAudio = options?.systemAudio ?? false;
  const includeMic = options?.includeMicrophone ?? false;

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video,
    audio: systemAudio ? (options?.systemAudioConstraints ?? true) : false,
  });

  if (!includeMic) {
    return {
      stream: displayStream,
      dispose: () => {},
    };
  }

  if (!supportsUserMedia()) {
    // Fall back to display-only — the caller asked for mic but the
    // platform can't deliver. Surfacing an error here would be more
    // user-hostile than just dropping the requested addition.
    return {
      stream: displayStream,
      dispose: () => {},
    };
  }

  let micStream: MediaStream | null = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: options?.microphoneConstraints ?? true,
      video: false,
    });
  } catch (err: unknown) {
    // Stop the screen tracks too so the user isn't left with a stranded
    // capture indicator.
    displayStream.getTracks().forEach((t) => t.stop());
    throw err;
  }

  const mix = mixAudioTracks([displayStream, micStream]);

  if (!mix) {
    // No audio at all — just hand back the display stream and shut down
    // the mic acquisition we made.
    micStream.getTracks().forEach((t) => t.stop());
    return {
      stream: displayStream,
      dispose: () => {},
    };
  }

  // Build the output stream: video from display + a single mixed audio
  // track. Replace any system-audio track that came back from
  // getDisplayMedia (it's now folded into the mix).
  const [videoTrack] = displayStream.getVideoTracks();
  const output = new MediaStream();
  if (videoTrack) output.addTrack(videoTrack);
  output.addTrack(mix.track);

  // The system-audio tracks must stay LIVE for the lifetime of the mixed
  // output. `new MediaStream([track])` does not clone the track, so a
  // `MediaStreamAudioSourceNode` whose track has ended outputs pure
  // silence — stopping them here (as this code used to) silently dropped
  // the captured tab/system audio from every screen+mic recording.
  //
  // They aren't members of `output`, so the caller's `stream.getTracks()`
  // teardown can't reach them: `dispose()` owns stopping them, which is
  // what keeps a released capture from leaving the share indicator lit.
  const systemAudioTracks = displayStream.getAudioTracks();

  let disposed = false;
  const dispose = () => {
    // Idempotent — `dispose()` is documented as safe to call repeatedly,
    // and useMediaRecorder can reach it from both cancel() and unmount.
    if (disposed) return;
    disposed = true;
    // Keep mic + system audio alive until disposal so the mix keeps
    // producing audio for as long as the output stream is in use.
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
    systemAudioTracks.forEach((t) => t.stop());
    void mix.context.close().catch(() => {});
  };

  return { stream: output, dispose };
}

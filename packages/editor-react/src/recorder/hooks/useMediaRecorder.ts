/**
 * useMediaRecorder
 *
 * React wrapper around `MediaRecorder` that handles stream acquisition,
 * the recorder lifecycle, and produces a single `Blob` on stop. Selects
 * a browser-supported MIME type via {@link resolveFormat}.
 *
 * Mirrors the shape of `useVideoExport` in `@bendyline/squisq-video-react`
 * (request → start → stop → blob), inverted for capture rather than
 * export.
 *
 * The `'screen+camera'` source is the one exception to "one stream, one
 * blob": it drives TWO `MediaRecorder`s in lockstep (screen + system audio
 * on the primary lane, camera + mic on a secondary lane), because a single
 * recorder can only hold one video track. The secondary lane surfaces as
 * {@link UseMediaRecorderResult.camera}; every other source leaves it null.
 * The two lanes' start skew is measured (`cameraOffsetSec`) so the composed
 * playback can line the presenter bubble up with the screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveFormat,
  supportsMediaRecorder,
  type CaptureKind,
  type ResolvedFormat,
} from '../formats.js';
import { requestMicStream } from '../sources/micStream.js';
import { requestCameraStream } from '../sources/cameraStream.js';
import { requestScreenStream, type ScreenStreamHandle } from '../sources/screenStream.js';
import { requestSystemAudioStream, mixSystemAudio } from '../sources/systemAudioStream.js';

/**
 * Which capture source to use. `screen+mic` mixes the microphone into the
 * screen stream (one file); `screen+camera` records screen and camera as two
 * separate files in lockstep.
 */
export type RecorderSource = 'mic' | 'camera' | 'screen' | 'screen+mic' | 'screen+camera';

/** Discriminated state describing what the recorder is currently doing. */
export type RecorderState =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'recording'
  | 'stopping'
  | 'stopped'
  | 'error';

/**
 * The camera companion lane, present only for `source === 'screen+camera'`
 * (null for every other source). Its `blob` is null until the take stops.
 */
export interface RecorderCameraLane {
  /** Camera stream (video + mic when requested); inactive after stop, null after teardown. */
  stream: MediaStream | null;
  /** Final camera `Blob` after `stop()` resolves, or null while recording. */
  blob: Blob | null;
  /** MIME type of the camera lane (shares the video format with the screen lane). */
  mimeType: string | null;
  /** File extension matching `mimeType` (e.g. `.webm`). */
  extension: string | null;
}

export interface UseMediaRecorderOptions {
  /** Which capture pipeline to use (default: `'mic'`). */
  source?: RecorderSource;
  /**
   * Preferred MIME type override. When the browser supports it, this
   * wins over the default candidate list. When unset (or unsupported),
   * the hook probes a built-in priority list.
   */
  mimeType?: string;
  /** Video track constraints for camera / screen sources. */
  videoConstraints?: MediaTrackConstraints | boolean;
  /** Audio track constraints for mic / camera / screen+mic sources. */
  audioConstraints?: MediaTrackConstraints | boolean;
  /**
   * Bits-per-second hint passed to `MediaRecorder`. Most browsers cap to
   * reasonable defaults internally; leaving this undefined is usually
   * fine.
   */
  bitsPerSecond?: number;
  /**
   * Whether to capture system (tab/monitor) audio. Browser support is limited
   * (desktop Chromium only); when unsupported the resulting stream simply omits
   * it. How it is obtained depends on the source:
   * - `'screen'` / `'screen+mic'` / `'screen+camera'` — folded into the screen
   *   lane's `getDisplayMedia` (rides the SCREEN file for the dual source).
   * - `'mic'` / `'camera'` — captured via a SEPARATE `getDisplayMedia` whose
   *   video is discarded, then mixed into the mic/camera file. The browser still
   *   shows the screen/tab picker (audio-only display capture isn't allowed).
   */
  systemAudio?: boolean;
  /**
   * For `source === 'camera'`, whether to include the microphone track.
   * Defaults to `true` (camera + mic). Set `false` to capture silent
   * video. Ignored for `'mic'`/`'screen'`/`'screen+mic'`, whose mic
   * handling is encoded in the source itself. For `'screen+camera'` this
   * gates the microphone on the CAMERA lane (the screen lane never carries
   * the mic — system audio rides it instead).
   */
  includeMicrophone?: boolean;
}

export interface UseMediaRecorderResult {
  /** Current recorder state. */
  state: RecorderState;
  /** `MediaStream` acquired by `request()`; live during preview/recording and
   * inactive after stop. For `'screen+camera'` this is the SCREEN stream (see
   * `camera` for the other). */
  stream: MediaStream | null;
  /** Final `Blob` after `stop()` resolves, or `null` while recording. For
   * `'screen+camera'` this is the SCREEN file. */
  blob: Blob | null;
  /** MIME type the recorder actually used (after `request()`). */
  mimeType: string | null;
  /** File extension matching `mimeType` (e.g. `.webm`). */
  extension: string | null;
  /** Suggested container directory (`'audio'` for mic, `'video'` for camera/screen). */
  directory: 'audio' | 'video' | null;
  /** Milliseconds elapsed since `start()` was called. Updates ~10× per second while recording. */
  durationMs: number;
  /** Most recent error, if any. */
  error: Error | null;
  /**
   * The camera companion lane for `source === 'screen+camera'`, else null.
   * Its `blob` lands together with the primary `blob` when `stop()` resolves.
   */
  camera: RecorderCameraLane | null;
  /**
   * Camera onstart minus screen onstart, in seconds (positive = camera
   * started later). Null until both lanes have reported `onstart`, and for
   * every non-dual source.
   */
  cameraOffsetSec: number | null;
  /**
   * Acquire the stream and prepare a `MediaRecorder`. After this resolves
   * the hook is in `'ready'` state and a `<video>`/`<audio>` element can
   * preview `stream`. Call `start()` to begin recording.
   */
  request: () => Promise<void>;
  /** Start recording. Must be called from `'ready'`. */
  start: () => void;
  /**
   * Stop recording and resolve with the resulting `Blob`. Safe to call
   * from `'recording'`; a no-op from any other state (resolves with the
   * existing `blob`, or `null`). Once the take has flushed, all capture
   * tracks are stopped so browser sharing / camera / microphone indicators
   * do not remain active during review.
   */
  stop: () => Promise<Blob | null>;
  /**
   * Tear everything down — stops the recorder if running, releases all
   * tracks, disposes the AudioContext mixer (if any), and returns to
   * `'idle'`. Always safe to call.
   */
  cancel: () => void;
  /** Clear the current take. A new permission request may be needed before re-recording. */
  reset: () => void;
}

/** The screen + camera pair acquired for a `'screen+camera'` take. */
interface DualStreams {
  screen: ScreenStreamHandle;
  camera: MediaStream;
}

/**
 * A live secondary (camera) recorder lane. Only populated for
 * `'screen+camera'`; nulled by {@link useMediaRecorder}'s teardown paths.
 */
interface SecondaryLane {
  recorder: MediaRecorder;
  chunks: Blob[];
  stream: MediaStream;
  format: ResolvedFormat;
}

/**
 * Acquire the right stream for a single-stream source. Returns the stream
 * plus an optional `dispose` callback for sources that own auxiliary
 * resources (e.g. the screen+mic AudioContext mixer).
 */
async function acquireStream(
  source: Exclude<RecorderSource, 'screen+camera'>,
  opts: UseMediaRecorderOptions,
): Promise<{ stream: MediaStream; dispose: () => void }> {
  switch (source) {
    case 'mic': {
      const audio = typeof opts.audioConstraints === 'object' ? opts.audioConstraints : undefined;
      if (opts.systemAudio) {
        // System audio only comes from a display capture — take it FIRST (it
        // needs the click's transient activation), then the mic, then mix.
        const systemAudio = await requestSystemAudioStream();
        let base: MediaStream;
        try {
          base = await requestMicStream(audio);
        } catch (err: unknown) {
          systemAudio?.getTracks().forEach((t) => t.stop());
          throw err;
        }
        if (!systemAudio) return { stream: base, dispose: () => {} };
        return mixSystemAudio(base, systemAudio);
      }
      const stream = await requestMicStream(audio);
      return { stream, dispose: () => {} };
    }
    case 'camera': {
      const video = opts.videoConstraints ?? true;
      const audio = opts.includeMicrophone === false ? false : (opts.audioConstraints ?? true);
      if (opts.systemAudio) {
        const systemAudio = await requestSystemAudioStream();
        let base: MediaStream;
        try {
          base = await requestCameraStream({ video, audio });
        } catch (err: unknown) {
          systemAudio?.getTracks().forEach((t) => t.stop());
          throw err;
        }
        if (!systemAudio) return { stream: base, dispose: () => {} };
        return mixSystemAudio(base, systemAudio);
      }
      const stream = await requestCameraStream({ video, audio });
      return { stream, dispose: () => {} };
    }
    case 'screen':
    case 'screen+mic': {
      const handle: ScreenStreamHandle = await requestScreenStream({
        video: opts.videoConstraints ?? true,
        systemAudio: opts.systemAudio ?? false,
        includeMicrophone: source === 'screen+mic',
        microphoneConstraints:
          typeof opts.audioConstraints === 'object' ? opts.audioConstraints : undefined,
      });
      return { stream: handle.stream, dispose: handle.dispose };
    }
  }
}

/**
 * Acquire the screen + camera pair for `'screen+camera'`. Screen is taken
 * FIRST — `getDisplayMedia` needs transient user activation, which the
 * Start-preview click still holds on the first await — then the camera via
 * `getUserMedia` (no activation needed). The screen lane never mixes the mic
 * (`includeMicrophone: false`): the microphone rides the camera lane, system
 * audio rides the screen lane, so no AudioContext mix is involved.
 *
 * `isStale()` is checked after each await so a superseded request releases
 * whatever it took. A camera denial after the screen was granted releases the
 * screen capture before rethrowing, so the user isn't left with a stranded
 * screen-share indicator.
 */
async function acquireDualStreams(
  opts: UseMediaRecorderOptions,
  isStale: () => boolean,
): Promise<DualStreams | null> {
  const screen = await requestScreenStream({
    video: opts.videoConstraints ?? true,
    systemAudio: opts.systemAudio ?? false,
    includeMicrophone: false,
  });
  const releaseScreen = () => {
    screen.stream.getTracks().forEach((t) => t.stop());
    screen.dispose();
  };
  if (isStale()) {
    releaseScreen();
    return null;
  }

  let camera: MediaStream;
  try {
    camera = await requestCameraStream({
      video: true,
      audio: opts.includeMicrophone === false ? false : (opts.audioConstraints ?? true),
    });
  } catch (err: unknown) {
    releaseScreen();
    throw err;
  }
  if (isStale()) {
    releaseScreen();
    camera.getTracks().forEach((t) => t.stop());
    return null;
  }
  return { screen, camera };
}

/** Whether the chosen source records video (vs. audio-only). */
function captureKindFor(source: RecorderSource): CaptureKind {
  return source === 'mic' ? 'audio' : 'video';
}

/**
 * Returns the kind of capture that the given source produces. Exposed
 * separately from {@link useMediaRecorder} so non-React callers
 * (e.g. headless tests) can resolve a format up front.
 */
export function getCaptureKind(source: RecorderSource): CaptureKind {
  return captureKindFor(source);
}

export function useMediaRecorder(options: UseMediaRecorderOptions = {}): UseMediaRecorderResult {
  const [state, setState] = useState<RecorderState>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [format, setFormat] = useState<ResolvedFormat | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [camera, setCamera] = useState<RecorderCameraLane | null>(null);
  const [cameraOffsetSec, setCameraOffsetSec] = useState<number | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const disposeStreamRef = useRef<(() => void) | null>(null);
  const startTimestampRef = useRef<number | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopResolversRef = useRef<Array<(blob: Blob | null) => void>>([]);
  const stopPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const requestPromiseRef = useRef<Promise<void> | null>(null);
  const lifecycleRef = useRef(0);

  // Dual-lane (screen+camera) machinery. `secondaryRef` holds the camera
  // recorder; `pendingLanesRef` is the onstop join counter (1 for a single
  // source, 2 for a dual take) so the finalize step runs only once both lanes
  // have flushed. The start-ms refs measure the lanes' skew (`cameraOffsetSec`).
  const secondaryRef = useRef<SecondaryLane | null>(null);
  const pendingLanesRef = useRef(0);
  const primaryStartMsRef = useRef<number | null>(null);
  const secondaryStartMsRef = useRef<number | null>(null);

  // `stateRef` mirrors `state` synchronously so the screen-track `ended`
  // handler (fired by the browser's "Stop sharing" button, between renders)
  // can read the current state; `stopFnRef`/`cancelFnRef` give it the latest
  // callbacks without re-binding the track listener each render.
  const stateRef = useRef<RecorderState>('idle');
  const stopFnRef = useRef<(() => Promise<Blob | null>) | null>(null);
  const cancelFnRef = useRef<(() => void) | null>(null);

  const transition = useCallback((next: RecorderState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Stable copy of options for callbacks that read them late. Re-evaluated
  // each render, but each callback closes over the ref so we don't have
  // to recreate them on every options change.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearTicker = useCallback(() => {
    if (tickerRef.current !== null) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  // End every live capture without discarding the completed take or the
  // stream objects that describe it. Keeping those inactive stream objects
  // lets review/save code inspect which tracks were recorded, while stopping
  // the tracks themselves dismisses the browser's screen-sharing banner and
  // camera/microphone indicators.
  const deactivateCapture = useCallback(() => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    secondaryRef.current?.stream.getTracks().forEach((track) => track.stop());
    disposeStreamRef.current?.();
    disposeStreamRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    const s = recorderRef.current?.stream;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
    }
    // Also stop whatever we last handed to setStream — it may differ
    // from recorderRef.current.stream when stream/recorder lifecycles
    // diverged (e.g. cancel before start).
    setStream((current) => {
      current?.getTracks().forEach((t) => t.stop());
      return null;
    });
    disposeStreamRef.current?.();
    disposeStreamRef.current = null;
  }, []);

  // Release the camera lane: detach handlers, stop the recorder, stop the
  // camera tracks (they are NOT members of the primary stream, so
  // releaseStream() can't reach them), and reset the join/skew state.
  const releaseSecondary = useCallback(() => {
    const lane = secondaryRef.current;
    secondaryRef.current = null;
    if (lane) {
      if (lane.recorder.state !== 'inactive') {
        try {
          lane.recorder.ondataavailable = null;
          lane.recorder.onstart = null;
          lane.recorder.onstop = null;
          lane.recorder.onerror = null;
          lane.recorder.stop();
        } catch {
          // Already stopping — we're tearing down anyway.
        }
      }
      lane.stream.getTracks().forEach((t) => t.stop());
    }
    pendingLanesRef.current = 0;
    primaryStartMsRef.current = null;
    secondaryStartMsRef.current = null;
    setCamera(null);
    setCameraOffsetSec(null);
  }, []);

  const reset = useCallback(() => {
    setBlob(null);
    setDurationMs(0);
    setError(null);
    chunksRef.current = [];
    startTimestampRef.current = null;
    clearTicker();
    // Clear a prior take's camera blob but keep the live lane so "record
    // again" doesn't have to re-acquire the camera.
    setCamera((prev) => (prev ? { ...prev, blob: null } : null));
    setCameraOffsetSec(null);
    // If a stream is still live from a prior `request()`, hop back to
    // `'ready'` so the UI can offer "record again" without the caller
    // having to re-acquire permissions. Otherwise drop to `'idle'`. For a
    // dual take the camera lane must ALSO still be live — a "Stop sharing"
    // that killed the screen would otherwise strand the camera indicator.
    const rec = recorderRef.current;
    const secondaryLive = !secondaryRef.current || secondaryRef.current.stream.active;
    if (rec && rec.state === 'inactive' && rec.stream.active && secondaryLive) {
      transition('ready');
    } else {
      cancelFnRef.current?.();
    }
  }, [clearTicker, transition]);

  const cancel = useCallback(() => {
    lifecycleRef.current += 1;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.ondataavailable = null;
        rec.onstart = null;
        rec.onstop = null;
        rec.onerror = null;
        rec.stop();
      } catch {
        // Ignore — we're tearing down anyway.
      }
    }
    recorderRef.current = null;
    releaseStream();
    releaseSecondary();
    clearTicker();
    chunksRef.current = [];
    startTimestampRef.current = null;
    // Any in-flight stop() promises won't get a blob.
    stopResolversRef.current.splice(0).forEach((resolve) => resolve(null));
    stopPromiseRef.current = null;
    requestPromiseRef.current = null;
    setBlob(null);
    setDurationMs(0);
    setError(null);
    transition('idle');
  }, [clearTicker, releaseStream, releaseSecondary, transition]);

  const request = useCallback(async () => {
    if (requestPromiseRef.current) return requestPromiseRef.current;
    if (recorderRef.current?.stream.active) return;
    if (!supportsMediaRecorder()) {
      const err = new Error('MediaRecorder is not supported in this environment.');
      setError(err);
      transition('error');
      throw err;
    }
    const lifecycle = ++lifecycleRef.current;
    const requestPromise = (async () => {
      setError(null);
      transition('requesting');
      let acquired: { stream: MediaStream; dispose: () => void } | null = null;
      let dual: DualStreams | null = null;
      try {
        const source = optionsRef.current.source ?? 'mic';
        const resolved = resolveFormat(captureKindFor(source), optionsRef.current.mimeType);
        const recorderOptions: MediaRecorderOptions = {};
        if (resolved.mimeType) recorderOptions.mimeType = resolved.mimeType;
        if (optionsRef.current.bitsPerSecond) {
          recorderOptions.bitsPerSecond = optionsRef.current.bitsPerSecond;
        }

        if (source === 'screen+camera') {
          dual = await acquireDualStreams(
            optionsRef.current,
            () => lifecycle !== lifecycleRef.current,
          );
          if (!dual) return; // stale — acquireDualStreams already released everything
          const { screen, camera: cameraStream } = dual;

          const primary = new MediaRecorder(screen.stream, recorderOptions);
          const secondary = new MediaRecorder(cameraStream, recorderOptions);

          // Both lanes flush through the same join. When the pending counter
          // hits 0 (both onstops seen), assemble both blobs, measure the skew,
          // and land in 'stopped'.
          const finalizeJoin = () => {
            const primaryType = primary.mimeType || resolved.mimeType || 'application/octet-stream';
            const primaryBlob = new Blob(chunksRef.current, { type: primaryType });
            chunksRef.current = [];
            setBlob(primaryBlob);
            const lane = secondaryRef.current;
            if (lane) {
              const camType =
                lane.recorder.mimeType || resolved.mimeType || 'application/octet-stream';
              const camBlob = new Blob(lane.chunks, { type: camType });
              lane.chunks = [];
              setCamera({
                stream: lane.stream,
                blob: camBlob,
                mimeType: resolved.mimeType || null,
                extension: resolved.extension,
              });
            }
            const p = primaryStartMsRef.current;
            const c = secondaryStartMsRef.current;
            setCameraOffsetSec(p != null && c != null ? (c - p) / 1000 : null);
            deactivateCapture();
            transition('stopped');
            clearTicker();
            stopResolversRef.current.splice(0).forEach((resolve) => resolve(primaryBlob));
            stopPromiseRef.current = null;
          };
          const laneStopped = (rec: MediaRecorder) => {
            if (lifecycle !== lifecycleRef.current) return;
            if (recorderRef.current !== rec && secondaryRef.current?.recorder !== rec) return;
            if (pendingLanesRef.current === 0) return;
            pendingLanesRef.current -= 1;
            if (pendingLanesRef.current > 0) return;
            finalizeJoin();
          };
          const laneError = (rec: MediaRecorder, event: Event) => {
            if (lifecycle !== lifecycleRef.current) return;
            const isPrimary = recorderRef.current === rec;
            const isSecondary = secondaryRef.current?.recorder === rec;
            if (!isPrimary && !isSecondary) return;
            // Stop/detach the sibling so it doesn't keep encoding a file we'll
            // never surface.
            const sibling = isPrimary ? secondaryRef.current?.recorder : primary;
            if (sibling && sibling.state !== 'inactive') {
              try {
                sibling.ondataavailable = null;
                sibling.onstart = null;
                sibling.onstop = null;
                sibling.onerror = null;
                sibling.stop();
              } catch {
                // Already stopping.
              }
            }
            const detail = (event as unknown as { error?: DOMException }).error;
            const err = detail instanceof Error ? detail : new Error('Recorder error');
            setError(err);
            deactivateCapture();
            transition('error');
            clearTicker();
            pendingLanesRef.current = 0;
            stopResolversRef.current.splice(0).forEach((resolve) => resolve(null));
            stopPromiseRef.current = null;
          };

          primary.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
          };
          primary.onstart = () => {
            primaryStartMsRef.current = performance.now();
          };
          primary.onstop = () => laneStopped(primary);
          primary.onerror = (e) => laneError(primary, e);

          secondary.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) secondaryRef.current?.chunks.push(e.data);
          };
          secondary.onstart = () => {
            secondaryStartMsRef.current = performance.now();
          };
          secondary.onstop = () => laneStopped(secondary);
          secondary.onerror = (e) => laneError(secondary, e);

          recorderRef.current = primary;
          disposeStreamRef.current = screen.dispose;
          secondaryRef.current = {
            recorder: secondary,
            chunks: [],
            stream: cameraStream,
            format: resolved,
          };

          // Auto-stop the whole take when the user ends the screen share via
          // the browser's own "Stop sharing" affordance (fires `ended` on the
          // display video track — never for our own `track.stop()`).
          const [screenTrack] = screen.stream.getVideoTracks();
          if (screenTrack) {
            screenTrack.onended = () => {
              if (lifecycle !== lifecycleRef.current) return;
              if (stateRef.current === 'recording') void stopFnRef.current?.();
              else if (stateRef.current === 'ready') cancelFnRef.current?.();
            };
          }

          setStream(screen.stream);
          setCamera({
            stream: cameraStream,
            blob: null,
            mimeType: resolved.mimeType || null,
            extension: resolved.extension,
          });
          setFormat(resolved);
          setBlob(null);
          setDurationMs(0);
          setCameraOffsetSec(null);
          transition('ready');
          dual = null; // ownership transferred to the refs
          return;
        }

        acquired = await acquireStream(source, optionsRef.current);
        const { stream: nextStream, dispose } = acquired;
        if (lifecycle !== lifecycleRef.current) {
          nextStream.getTracks().forEach((track) => track.stop());
          dispose();
          return;
        }
        const recorder = new MediaRecorder(nextStream, recorderOptions);

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          if (recorderRef.current !== recorder || lifecycle !== lifecycleRef.current) return;
          if (pendingLanesRef.current === 0) return;
          pendingLanesRef.current -= 1;
          if (pendingLanesRef.current > 0) return;
          // The recorded MIME type is authoritative once data is in hand —
          // some browsers down-negotiate the format (e.g. drop codec hint).
          const recordedType = recorder.mimeType || resolved.mimeType || 'application/octet-stream';
          const finalBlob = new Blob(chunksRef.current, { type: recordedType });
          chunksRef.current = [];
          setBlob(finalBlob);
          deactivateCapture();
          transition('stopped');
          clearTicker();
          stopResolversRef.current.splice(0).forEach((resolve) => resolve(finalBlob));
          stopPromiseRef.current = null;
        };
        recorder.onerror = (event) => {
          if (recorderRef.current !== recorder || lifecycle !== lifecycleRef.current) return;
          const detail = (event as unknown as { error?: DOMException }).error;
          const err = detail instanceof Error ? detail : new Error('Recorder error');
          setError(err);
          deactivateCapture();
          transition('error');
          clearTicker();
          pendingLanesRef.current = 0;
          stopResolversRef.current.splice(0).forEach((resolve) => resolve(null));
          stopPromiseRef.current = null;
        };

        recorderRef.current = recorder;
        disposeStreamRef.current = dispose;
        setStream(nextStream);
        setFormat(resolved);
        setBlob(null);
        setDurationMs(0);
        transition('ready');
        acquired = null;
      } catch (err: unknown) {
        if (acquired) {
          acquired.stream.getTracks().forEach((track) => track.stop());
          acquired.dispose();
        }
        if (dual) {
          dual.screen.stream.getTracks().forEach((track) => track.stop());
          dual.screen.dispose();
          dual.camera.getTracks().forEach((track) => track.stop());
        }
        const normalized = err instanceof Error ? err : new Error('Stream acquisition failed');
        if (lifecycle === lifecycleRef.current) {
          setError(normalized);
          transition('error');
        }
        throw normalized;
      } finally {
        if (lifecycle === lifecycleRef.current) requestPromiseRef.current = null;
      }
    })();
    requestPromiseRef.current = requestPromise;
    return requestPromise;
  }, [clearTicker, deactivateCapture, transition]);

  const start = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) {
      const err = new Error('Recorder is not ready. Call request() first.');
      setError(err);
      transition('error');
      return;
    }
    if (rec.state === 'recording') return;
    chunksRef.current = [];
    if (secondaryRef.current) secondaryRef.current.chunks = [];
    setBlob(null);
    setDurationMs(0);
    setCamera((prev) => (prev ? { ...prev, blob: null } : null));
    setCameraOffsetSec(null);
    primaryStartMsRef.current = null;
    secondaryStartMsRef.current = null;
    startTimestampRef.current = Date.now();
    try {
      rec.start(1000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error('Failed to start recorder'));
      deactivateCapture();
      transition('error');
      return;
    }
    const secondary = secondaryRef.current;
    if (secondary) {
      try {
        secondary.recorder.start(1000);
      } catch (err: unknown) {
        // Primary is already recording; unwind it so we don't strand a
        // half-started dual take.
        try {
          rec.stop();
        } catch {
          // ignore
        }
        setError(err instanceof Error ? err : new Error('Failed to start camera recorder'));
        deactivateCapture();
        transition('error');
        return;
      }
    }
    transition('recording');
    clearTicker();
    tickerRef.current = setInterval(() => {
      if (startTimestampRef.current !== null) {
        setDurationMs(Date.now() - startTimestampRef.current);
      }
    }, 100);
  }, [clearTicker, deactivateCapture, transition]);

  const stop = useCallback((): Promise<Blob | null> => {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') {
      return Promise.resolve(blob);
    }
    transition('stopping');
    const secondary = secondaryRef.current;
    const secondaryActive = secondary != null && secondary.recorder.state !== 'inactive';
    pendingLanesRef.current = secondaryActive ? 2 : 1;
    const stopPromise = new Promise<Blob | null>((resolve) => {
      stopResolversRef.current.push(resolve);
      try {
        rec.stop();
      } catch (err: unknown) {
        const normalized = err instanceof Error ? err : new Error('Failed to stop recorder');
        setError(normalized);
        deactivateCapture();
        transition('error');
        clearTicker();
        pendingLanesRef.current = 0;
        stopResolversRef.current.splice(0).forEach((r) => r(null));
        return;
      }
      if (secondaryActive) {
        try {
          secondary!.recorder.stop();
        } catch {
          // Secondary won't fire its onstop — drop its lane from the join so
          // the primary's onstop still finalizes the take.
          pendingLanesRef.current = Math.max(0, pendingLanesRef.current - 1);
        }
      }
    });
    stopPromiseRef.current = stopPromise;
    void stopPromise.finally(() => {
      if (stopPromiseRef.current === stopPromise) stopPromiseRef.current = null;
    });
    return stopPromise;
  }, [blob, clearTicker, deactivateCapture, transition]);

  // Keep the latest stop/cancel callbacks reachable from the screen-track
  // `ended` handler, which is bound once at request() time.
  useEffect(() => {
    stopFnRef.current = stop;
    cancelFnRef.current = cancel;
  });

  // Final unmount cleanup — make sure we don't leak the camera light /
  // screen-capture indicator if the component disappears mid-recording.
  //
  // `stopResolversRef.current` is captured at effect-run time into a
  // local. That ref is initialized once at construction and never
  // reassigned, so the local handle stays a live view onto the same
  // mutable array — entries pushed by later `stop()` calls still
  // appear here on cleanup. Capturing keeps `react-hooks/exhaustive-deps`
  // satisfied without changing the runtime behavior.
  useEffect(() => {
    const pendingResolvers = stopResolversRef.current;
    return () => {
      lifecycleRef.current += 1;
      requestPromiseRef.current = null;
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.ondataavailable = null;
          rec.onstart = null;
          rec.onstop = null;
          rec.onerror = null;
          rec.stop();
        } catch {
          // ignore
        }
      }
      releaseStream();
      releaseSecondary();
      clearTicker();
      pendingResolvers.splice(0).forEach((resolve) => resolve(null));
      stopPromiseRef.current = null;
    };
  }, [releaseStream, releaseSecondary, clearTicker]);

  return {
    state,
    stream,
    blob,
    mimeType: format?.mimeType ?? null,
    extension: format?.extension ?? null,
    directory: format?.directory ?? null,
    durationMs,
    error,
    camera,
    cameraOffsetSec,
    request,
    start,
    stop,
    cancel,
    reset,
  };
}

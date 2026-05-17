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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveFormat, supportsMediaRecorder, type CaptureKind, type ResolvedFormat } from '../formats.js';
import { requestMicStream } from '../sources/micStream.js';
import { requestCameraStream } from '../sources/cameraStream.js';
import { requestScreenStream, type ScreenStreamHandle } from '../sources/screenStream.js';

/** Which capture source to use. `screen+mic` mixes the microphone into the screen stream. */
export type RecorderSource = 'mic' | 'camera' | 'screen' | 'screen+mic';

/** Discriminated state describing what the recorder is currently doing. */
export type RecorderState =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'recording'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface UseMediaRecorderOptions {
  /** Which capture pipeline to use. */
  source: RecorderSource;
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
   * Whether to attempt to capture system audio when `source === 'screen'`
   * or `'screen+mic'`. Browser support is limited (desktop Chromium
   * only); when unsupported the resulting stream simply omits it.
   */
  systemAudio?: boolean;
}

export interface UseMediaRecorderResult {
  /** Current recorder state. */
  state: RecorderState;
  /** Live `MediaStream` after `request()` succeeds; useful for preview. */
  stream: MediaStream | null;
  /** Final `Blob` after `stop()` resolves, or `null` while recording. */
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
   * existing `blob`, or `null`).
   */
  stop: () => Promise<Blob | null>;
  /**
   * Tear everything down — stops the recorder if running, releases all
   * tracks, disposes the AudioContext mixer (if any), and returns to
   * `'idle'`. Always safe to call.
   */
  cancel: () => void;
  /** Reset state without releasing the stream. Useful for re-recording. */
  reset: () => void;
}

/**
 * Acquire the right stream for the chosen source. Returns the stream
 * plus an optional `dispose` callback for sources that own auxiliary
 * resources (e.g. the screen+mic AudioContext mixer).
 */
async function acquireStream(
  opts: UseMediaRecorderOptions,
): Promise<{ stream: MediaStream; dispose: () => void }> {
  switch (opts.source) {
    case 'mic': {
      const audio =
        typeof opts.audioConstraints === 'object' ? opts.audioConstraints : undefined;
      const stream = await requestMicStream(audio);
      return { stream, dispose: () => {} };
    }
    case 'camera': {
      const stream = await requestCameraStream({
        video: opts.videoConstraints ?? true,
        audio: opts.audioConstraints ?? true,
      });
      return { stream, dispose: () => {} };
    }
    case 'screen':
    case 'screen+mic': {
      const handle: ScreenStreamHandle = await requestScreenStream({
        video: opts.videoConstraints ?? true,
        systemAudio: opts.systemAudio ?? false,
        includeMicrophone: opts.source === 'screen+mic',
        microphoneConstraints:
          typeof opts.audioConstraints === 'object' ? opts.audioConstraints : undefined,
      });
      return { stream: handle.stream, dispose: handle.dispose };
    }
  }
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

export function useMediaRecorder(options: UseMediaRecorderOptions): UseMediaRecorderResult {
  const [state, setState] = useState<RecorderState>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [format, setFormat] = useState<ResolvedFormat | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const disposeStreamRef = useRef<(() => void) | null>(null);
  const startTimestampRef = useRef<number | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopResolversRef = useRef<Array<(blob: Blob | null) => void>>([]);

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

  const reset = useCallback(() => {
    setBlob(null);
    setDurationMs(0);
    setError(null);
    chunksRef.current = [];
    startTimestampRef.current = null;
    clearTicker();
    // If a stream is still live from a prior `request()`, hop back to
    // `'ready'` so the UI can offer "record again" without the caller
    // having to re-acquire permissions. Otherwise drop to `'idle'`.
    const rec = recorderRef.current;
    if (rec && rec.state === 'inactive' && rec.stream.active) {
      setState('ready');
    } else {
      setState('idle');
    }
  }, [clearTicker]);

  const cancel = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        // Ignore — we're tearing down anyway.
      }
    }
    recorderRef.current = null;
    releaseStream();
    clearTicker();
    chunksRef.current = [];
    startTimestampRef.current = null;
    // Any in-flight stop() promises won't get a blob.
    stopResolversRef.current.splice(0).forEach((resolve) => resolve(null));
    setBlob(null);
    setDurationMs(0);
    setError(null);
    setState('idle');
  }, [clearTicker, releaseStream]);

  const request = useCallback(async () => {
    if (!supportsMediaRecorder()) {
      const err = new Error('MediaRecorder is not supported in this environment.');
      setError(err);
      setState('error');
      throw err;
    }
    if (state === 'recording' || state === 'stopping') {
      // Don't start a parallel acquisition while one is in flight.
      return;
    }
    setError(null);
    setState('requesting');
    try {
      const { stream: nextStream, dispose } = await acquireStream(optionsRef.current);
      const resolved = resolveFormat(
        captureKindFor(optionsRef.current.source),
        optionsRef.current.mimeType,
      );
      const recorderOptions: MediaRecorderOptions = {};
      if (resolved.mimeType) recorderOptions.mimeType = resolved.mimeType;
      if (optionsRef.current.bitsPerSecond) {
        recorderOptions.bitsPerSecond = optionsRef.current.bitsPerSecond;
      }
      const recorder = new MediaRecorder(nextStream, recorderOptions);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // The recorded MIME type is authoritative once data is in hand —
        // some browsers down-negotiate the format (e.g. drop codec hint).
        const recordedType = recorder.mimeType || resolved.mimeType || 'application/octet-stream';
        const finalBlob = new Blob(chunksRef.current, { type: recordedType });
        chunksRef.current = [];
        setBlob(finalBlob);
        setState('stopped');
        clearTicker();
        stopResolversRef.current.splice(0).forEach((resolve) => resolve(finalBlob));
      };
      recorder.onerror = (event) => {
        const detail = (event as unknown as { error?: DOMException }).error;
        const err = detail instanceof Error ? detail : new Error('Recorder error');
        setError(err);
        setState('error');
        clearTicker();
        stopResolversRef.current.splice(0).forEach((resolve) => resolve(null));
      };

      recorderRef.current = recorder;
      disposeStreamRef.current = dispose;
      setStream(nextStream);
      setFormat(resolved);
      setBlob(null);
      setDurationMs(0);
      setState('ready');
    } catch (err: unknown) {
      const normalized = err instanceof Error ? err : new Error('Stream acquisition failed');
      setError(normalized);
      setState('error');
      throw normalized;
    }
  }, [state, clearTicker]);

  const start = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) {
      const err = new Error('Recorder is not ready. Call request() first.');
      setError(err);
      setState('error');
      return;
    }
    if (rec.state === 'recording') return;
    chunksRef.current = [];
    setBlob(null);
    setDurationMs(0);
    startTimestampRef.current = Date.now();
    rec.start(1000);
    setState('recording');
    clearTicker();
    tickerRef.current = setInterval(() => {
      if (startTimestampRef.current !== null) {
        setDurationMs(Date.now() - startTimestampRef.current);
      }
    }, 100);
  }, [clearTicker]);

  const stop = useCallback((): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') {
      return Promise.resolve(blob);
    }
    setState('stopping');
    return new Promise<Blob | null>((resolve) => {
      stopResolversRef.current.push(resolve);
      try {
        rec.stop();
      } catch (err: unknown) {
        const normalized = err instanceof Error ? err : new Error('Failed to stop recorder');
        setError(normalized);
        setState('error');
        clearTicker();
        stopResolversRef.current.splice(0).forEach((r) => r(null));
      }
    });
  }, [blob, clearTicker]);

  // Final unmount cleanup — make sure we don't leak the camera light /
  // screen-capture indicator if the component disappears mid-recording.
  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }
      releaseStream();
      clearTicker();
      stopResolversRef.current.splice(0).forEach((resolve) => resolve(null));
    };
  }, [releaseStream, clearTicker]);

  return {
    state,
    stream,
    blob,
    mimeType: format?.mimeType ?? null,
    extension: format?.extension ?? null,
    directory: format?.directory ?? null,
    durationMs,
    error,
    request,
    start,
    stop,
    cancel,
    reset,
  };
}

/**
 * Narration recorder for the teleprompter — an in-place (no modal)
 * capture flow.
 *
 * Audio records THE MIC ANALYSIS STREAM (what paces the prompter is
 * exactly what lands in the take); the optional camera is a separate
 * video-only capture whose start skew vs the audio recorder is measured
 * and persisted (`cameraOffsetSec`) — the audio file is the doc clock,
 * so camera skew never affects narration timing. While recording, a
 * sparse live trace of the prompter position is sampled; after stop,
 * the take is decoded and run through core's offline aligner
 * (`alignNarration`) to produce word/block timestamps for the sidecar.
 * Decode/alignment failure degrades gracefully: saving still works,
 * just without re-timing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  alignNarration,
  type NarrationAlignment,
  type NarrationScript,
  type NarrationTrace,
} from '@bendyline/squisq/narration';
import { resolveFormat } from '../../recorder/formats';
import { requestCameraStream } from '../../recorder/sources/cameraStream';
import type { MicAnalysisHandle } from '../useMicAnalysis';

export type NarrationRecorderState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'processing'
  | 'review'
  | 'saving'
  | 'error';

export interface NarrationTake {
  audioBlob: Blob;
  audioMime: string;
  audioExt: string;
  cameraBlob: Blob | null;
  cameraMime: string | null;
  cameraExt: string | null;
  durationSec: number;
  cameraOffsetSec: number | undefined;
  trace: NarrationTrace;
  alignment: NarrationAlignment | null;
  script: NarrationScript;
}

export interface UseNarrationRecorderOptions {
  mic: MicAnalysisHandle;
  getScript: () => NarrationScript | null;
  /** Live prompter position, sampled into the trace while recording. */
  getWordPos: () => number;
  getMicDeviceId: () => string | null;
  /** Fired when capture actually starts (View starts the prompter). */
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
}

export interface NarrationRecorderController {
  state: NarrationRecorderState;
  error: Error | null;
  withCamera: boolean;
  setWithCamera: (on: boolean) => void;
  /** Live camera stream for the self-view while recording. */
  cameraStream: MediaStream | null;
  take: NarrationTake | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  retake: () => void;
  discard: () => void;
  /** Transition into/out of 'saving'; the View owns the actual I/O. */
  beginSave: () => void;
  finishSave: (ok: boolean, error?: Error) => void;
}

const TRACE_INTERVAL_MS = 250;

interface ActiveCapture {
  audioRecorder: MediaRecorder;
  audioChunks: Blob[];
  audioMime: string;
  audioExt: string;
  cameraRecorder: MediaRecorder | null;
  cameraChunks: Blob[];
  cameraMime: string | null;
  cameraExt: string | null;
  cameraStream: MediaStream | null;
  traceSamples: { tMs: number; wordPos: number }[];
  traceTimer: ReturnType<typeof setInterval> | null;
  startedAtMs: number;
  audioStartMs: number | null;
  cameraStartMs: number | null;
}

/** Average all channels into a mono Float32Array. */
function mixdownToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / channels;
  }
  return out;
}

function stopRecorder(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === 'inactive') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    recorder.addEventListener('stop', done, { once: true });
    try {
      recorder.stop();
    } catch {
      recorder.removeEventListener('stop', done);
      resolve();
    }
  });
}

export function useNarrationRecorder(
  options: UseNarrationRecorderOptions,
): NarrationRecorderController {
  const [state, setState] = useState<NarrationRecorderState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [withCamera, setWithCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [take, setTake] = useState<NarrationTake | null>(null);

  const captureRef = useRef<ActiveCapture | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const teardownCapture = useCallback(() => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (!capture) return;
    if (capture.traceTimer !== null) clearInterval(capture.traceTimer);
    if (capture.audioRecorder.state !== 'inactive') {
      try {
        capture.audioRecorder.stop();
      } catch {
        // Already stopping.
      }
    }
    if (capture.cameraRecorder && capture.cameraRecorder.state !== 'inactive') {
      try {
        capture.cameraRecorder.stop();
      } catch {
        // Already stopping.
      }
    }
    for (const track of capture.cameraStream?.getTracks() ?? []) track.stop();
    setCameraStream(null);
  }, []);

  const start = useCallback(async () => {
    if (captureRef.current) return;
    const opts = optionsRef.current;
    setError(null);
    setTake(null);
    setState('starting');
    try {
      // Recording always needs the mic — voice pacing or not. Use the
      // stream `start()` resolves with; the handle's `stream` FIELD is a
      // state snapshot that only updates on the next render.
      const micStream =
        opts.mic.status === 'live' && opts.mic.stream
          ? opts.mic.stream
          : await opts.mic.start(opts.getMicDeviceId());
      if (!micStream) throw opts.mic.error ?? new Error('Microphone unavailable');

      const audioFormat = resolveFormat('audio');
      const audioRecorder = new MediaRecorder(
        micStream,
        audioFormat.mimeType ? { mimeType: audioFormat.mimeType } : undefined,
      );

      let cameraRecorder: MediaRecorder | null = null;
      let camera: MediaStream | null = null;
      let cameraMime: string | null = null;
      let cameraExt: string | null = null;
      if (withCamera) {
        camera = await requestCameraStream({ video: true, audio: false });
        const videoFormat = resolveFormat('video');
        cameraRecorder = new MediaRecorder(
          camera,
          videoFormat.mimeType ? { mimeType: videoFormat.mimeType } : undefined,
        );
        cameraMime = videoFormat.mimeType;
        cameraExt = videoFormat.extension;
      }

      const capture: ActiveCapture = {
        audioRecorder,
        audioChunks: [],
        audioMime: audioFormat.mimeType,
        audioExt: audioFormat.extension,
        cameraRecorder,
        cameraChunks: [],
        cameraMime,
        cameraExt,
        cameraStream: camera,
        traceSamples: [],
        traceTimer: null,
        startedAtMs: performance.now(),
        audioStartMs: null,
        cameraStartMs: null,
      };
      audioRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) capture.audioChunks.push(e.data);
      };
      audioRecorder.onstart = () => {
        capture.audioStartMs = performance.now();
      };
      if (cameraRecorder) {
        cameraRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) capture.cameraChunks.push(e.data);
        };
        cameraRecorder.onstart = () => {
          capture.cameraStartMs = performance.now();
        };
      }

      audioRecorder.start(1000);
      cameraRecorder?.start(1000);
      capture.traceTimer = setInterval(() => {
        const base = capture.audioStartMs ?? capture.startedAtMs;
        capture.traceSamples.push({
          tMs: performance.now() - base,
          wordPos: optionsRef.current.getWordPos(),
        });
      }, TRACE_INTERVAL_MS);

      captureRef.current = capture;
      setCameraStream(camera);
      setState('recording');
      opts.onRecordingStart?.();
    } catch (err: unknown) {
      teardownCapture();
      setError(err instanceof Error ? err : new Error(String(err)));
      setState('error');
    }
  }, [teardownCapture, withCamera]);

  const stop = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture) return;
    captureRef.current = null;
    if (capture.traceTimer !== null) clearInterval(capture.traceTimer);
    optionsRef.current.onRecordingStop?.();
    setState('processing');

    await stopRecorder(capture.audioRecorder);
    if (capture.cameraRecorder) await stopRecorder(capture.cameraRecorder);
    for (const track of capture.cameraStream?.getTracks() ?? []) track.stop();
    setCameraStream(null);

    const audioMime = capture.audioRecorder.mimeType || capture.audioMime;
    const audioBlob = new Blob(capture.audioChunks, { type: audioMime });
    const cameraBlob =
      capture.cameraRecorder && capture.cameraChunks.length > 0
        ? new Blob(capture.cameraChunks, {
            type: capture.cameraRecorder.mimeType || capture.cameraMime || 'video/webm',
          })
        : null;

    const wallClockSec = (performance.now() - (capture.audioStartMs ?? capture.startedAtMs)) / 1000;
    const script = optionsRef.current.getScript();
    const trace: NarrationTrace = { samples: capture.traceSamples };

    let alignment: NarrationAlignment | null = null;
    let durationSec = wallClockSec;
    if (script) {
      try {
        const decodeCtx = new AudioContext();
        try {
          const decoded = await decodeCtx.decodeAudioData(await audioBlob.arrayBuffer());
          durationSec = decoded.duration;
          alignment = alignNarration({
            pcm: mixdownToMono(decoded),
            sampleRate: decoded.sampleRate,
            script,
            trace,
          });
        } finally {
          void decodeCtx.close().catch(() => undefined);
        }
      } catch {
        // Exotic recorder output the decoder can't read: save proceeds
        // without word/block timing (the sidecar is still valid).
        alignment = null;
      }
    }

    setTake({
      audioBlob,
      audioMime,
      audioExt: capture.audioExt,
      cameraBlob,
      cameraMime: cameraBlob ? (capture.cameraMime ?? 'video/webm') : null,
      cameraExt: cameraBlob ? capture.cameraExt : null,
      durationSec,
      cameraOffsetSec:
        capture.cameraStartMs !== null && capture.audioStartMs !== null
          ? (capture.cameraStartMs - capture.audioStartMs) / 1000
          : undefined,
      trace,
      alignment,
      script: script ?? {
        sourceText: '',
        tokens: [],
        blocks: [],
        totalSyllables: 0,
        cumulativeSyllables: [0],
      },
    });
    setState('review');
  }, []);

  const retake = useCallback(() => {
    teardownCapture();
    setTake(null);
    setError(null);
    setState('idle');
  }, [teardownCapture]);

  const discard = useCallback(() => {
    teardownCapture();
    setTake(null);
    setError(null);
    setState('idle');
  }, [teardownCapture]);

  const beginSave = useCallback(() => setState('saving'), []);
  const finishSave = useCallback((ok: boolean, saveError?: Error) => {
    if (ok) {
      setTake(null);
      setError(null);
      setState('idle');
    } else {
      setError(saveError ?? new Error('Save failed'));
      setState('review');
    }
  }, []);

  // Hard stop on unmount (mode switch, shell teardown).
  useEffect(() => teardownCapture, [teardownCapture]);

  return {
    state,
    error,
    withCamera,
    setWithCamera,
    cameraStream,
    take,
    start,
    stop,
    retake,
    discard,
    beginSave,
    finishSave,
  };
}

/**
 * One dictation session: microphone → progressive takes → 16 kHz WAV → the
 * host's provider → transcript callbacks.
 *
 * This module (with the engine, the activity gate and the WAV encoder it pulls
 * in) is only ever reached through a dynamic `import()` from the dictation
 * controller, so a shell without a `speechInput` capability loads none of it.
 */

import { requestMicStream } from '../recorder/sources/micStream.js';
import { resolveFormat, supportsMediaRecorder } from '../recorder/formats.js';
import {
  DEFAULT_RECORDER_DEVICE_SETTINGS,
  buildRecorderAudioConstraints,
  type RecorderDeviceSettings,
} from '../recorder/deviceSettings.js';
import { ProgressiveSpeechToText } from './progressiveSpeechToText.js';
import { microphoneTakeAsWav } from './speechAudioWav.js';
import type { SpeechInputProvider } from './types.js';

export interface DictationSessionOptions {
  provider: SpeechInputProvider;
  /** Aborted when the controller cancels the session (or unmounts). */
  signal: AbortSignal;
  /**
   * Recorder device settings to honour (the chosen microphone and its
   * constraints). Echo cancellation, noise suppression and auto gain are
   * always on for dictation regardless.
   */
  deviceSettings?: RecorderDeviceSettings;
  onTranscript: (text: string) => void;
  onAudioLevel: (level: number) => void;
  onPendingChange: (pending: number) => void;
  onLongPause: (hadTranscript: boolean) => void;
  onError: (error: Error) => void;
}

export interface DictationSessionHandle {
  /** Stop listening, transcribe and deliver every captured take, then resolve. */
  stop(): Promise<void>;
  /** Drop everything immediately — no further callbacks. */
  cancel(): void;
}

/** Microphone constraints for dictation: the recorder's device choice, speech-tuned DSP. */
export function dictationAudioConstraints(
  settings: RecorderDeviceSettings = DEFAULT_RECORDER_DEVICE_SETTINGS,
): MediaTrackConstraints {
  return {
    ...buildRecorderAudioConstraints(settings),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

function abortError(): Error {
  const error = new Error('Dictation was cancelled.');
  error.name = 'AbortError';
  return error;
}

/**
 * Acquire the microphone and start capturing. Resolves once listening has
 * begun; rejects when the microphone cannot be opened (permission denied, no
 * device, …) or the signal aborted first.
 *
 * `provider.prepare` runs concurrently with the microphone request — the
 * engine warms while the author starts speaking — and every transcription
 * waits for it. A prepare rejection ends the session through `onError`.
 */
export async function startDictationSession(
  options: DictationSessionOptions,
): Promise<DictationSessionHandle> {
  const { provider, signal } = options;
  if (!supportsMediaRecorder()) {
    throw new Error('MediaRecorder is not defined in this environment.');
  }
  const ready: Promise<void> = provider.prepare
    ? Promise.resolve().then(() => provider.prepare?.(signal))
    : Promise.resolve();
  // Observed below once the engine exists; this keeps an early rejection
  // (before the microphone resolves) from surfacing as unhandled.
  ready.catch(() => undefined);

  const stream = await requestMicStream(dictationAudioConstraints(options.deviceSettings));
  if (signal.aborted) {
    for (const track of stream.getTracks()) track.stop();
    throw abortError();
  }

  const format = resolveFormat('audio');
  const engine = new ProgressiveSpeechToText({
    stream,
    ...(format.mimeType ? { mimeType: format.mimeType } : {}),
    transcribe: async (blob, _mimeType, takeSignal, prompt) => {
      await ready;
      const wav = await microphoneTakeAsWav(blob);
      const result = await provider.transcribe(wav, {
        signal: takeSignal,
        ...(prompt ? { prompt } : {}),
      });
      return typeof result?.text === 'string' ? result.text : '';
    },
    onTranscript: options.onTranscript,
    onAudioLevel: options.onAudioLevel,
    onPendingChange: options.onPendingChange,
    onLongPause: options.onLongPause,
    onError: (error) => {
      // A failed take will not become more useful by keeping the microphone
      // open and sending another one: release it and surface one error.
      engine.cancel();
      options.onError(error);
    },
  });
  ready.catch((caught: unknown) => {
    if (signal.aborted) return;
    engine.cancel();
    options.onError(caught instanceof Error ? caught : new Error(String(caught)));
  });
  const onAbort = () => engine.cancel();
  signal.addEventListener('abort', onAbort, { once: true });
  engine.start();

  return {
    stop: () => engine.stop(),
    cancel: () => {
      signal.removeEventListener('abort', onAbort);
      engine.cancel();
    },
  };
}

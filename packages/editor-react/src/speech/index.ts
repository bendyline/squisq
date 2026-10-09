/**
 * Public speech-input (dictation) API: the provider contract a host
 * implements and the resolver. The capture engine, toolbar button, caret
 * indicator and insertion are wired by `EditorShell` (prop `speechInput`) and
 * are not part of this surface; a host drives dictation imperatively through
 * `useEditorContext().dictation`.
 */

export type {
  DictationControl,
  SpeechInputCapability,
  SpeechInputProvider,
  SpeechInputProviderFactory,
  SpeechInputReadiness,
  SpeechInputReadinessState,
  SpeechInputTranscribeOptions,
  SpeechInputTranscript,
} from './types.js';
export {
  SPEECH_INPUT_SAMPLE_RATE,
  isSpeechInputProviderFactory,
  resolveSpeechInputProvider,
} from './types.js';

export type { DictationSessionOptions, DictationSessionHandle } from './dictationSession.js';
/** Capture into a host-owned transcript without editing the document. Loaded only on a gesture. */
export async function startDictationSession(
  options: import('./dictationSession.js').DictationSessionOptions,
): Promise<import('./dictationSession.js').DictationSessionHandle> {
  const session = await import('./dictationSession.js');
  if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return session.startDictationSession(options);
}
/** Encode an uploaded audio take using the same wire format as microphone capture. */
export async function encodeMonoPcm16Wav(
  channels: readonly Float32Array[],
  sampleRate: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const audio = await import('./speechAudioWav.js');
  return audio.encodeMonoPcm16Wav(channels, sampleRate);
}

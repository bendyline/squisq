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

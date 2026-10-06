/**
 * The speech-input (dictation) capability contract between an editor host and
 * the shell.
 *
 * A host that can turn speech into text passes a {@link SpeechInputProvider}
 * (or a factory) to `EditorShell`'s `speechInput` prop — the same
 * capability-injection semantics as `proofing`: absent means the feature is
 * off, no dictation code loads, and no microphone button renders.
 *
 * The editor owns everything up to the recognizer: microphone capture, phrase
 * segmentation, WAV encoding, the toolbar button, the caret indicator and the
 * literal-text insertion. The provider owns only recognition. Audio crosses
 * the boundary as one self-contained mono 16-bit PCM WAV at 16 kHz per take,
 * which every whisper.cpp build accepts and which keeps IPC payloads small.
 * The surface is plain data end to end, so a provider can be a local engine
 * behind IPC, a call to a service, or a test fake.
 */

/** Sample rate (Hz) of every WAV take handed to {@link SpeechInputProvider.transcribe}. */
export const SPEECH_INPUT_SAMPLE_RATE = 16_000;

/** Coarse readiness of a provider, as the editor's button presents it. */
export type SpeechInputReadinessState =
  /** Dictation can start now. */
  | 'ready'
  /**
   * The host needs a one-time setup (typically a model download) first.
   * Clicking the microphone calls {@link SpeechInputProvider.requestSetup}
   * instead of starting.
   */
  | 'download-required'
  /** Dictation can never work in this host/session. The button is hidden. */
  | 'unavailable'
  /**
   * The host still needs a permission (e.g. the OS microphone grant).
   * Starting proceeds — the microphone request is what prompts for it.
   */
  | 'permission-required';

export interface SpeechInputReadiness {
  readonly state: SpeechInputReadinessState;
  /** Optional human-readable detail, shown in the button's tooltip/errors. */
  readonly reason?: string;
}

export interface SpeechInputTranscribeOptions {
  /**
   * The recent dictated text of this session (a word-aligned tail of at most
   * 1,000 characters), for engines that accept a priming prompt — Whisper's
   * `prompt`. Absent on the first take.
   */
  readonly prompt?: string;
  /** BCP-47-ish language hint. The editor does not currently set it. */
  readonly language?: string;
  /**
   * Aborted when the user cancels dictation or the editor unmounts. A
   * provider should stop promptly; a rejection after abort is ignored.
   */
  readonly signal: AbortSignal;
}

export interface SpeechInputTranscript {
  /** Recognized text. Blank (or Whisper's `[BLANK_AUDIO]`) means silence. */
  readonly text: string;
}

export interface SpeechInputProvider {
  /** Stable identifier, e.g. `whisper-local`. */
  readonly id: string;
  /** Human-readable name, e.g. `On-device speech recognition`. */
  readonly label: string;
  /**
   * Current readiness. Called once when the editor mounts with the
   * capability (to decide whether to render the microphone at all) and again
   * each time the user starts dictation. Must be cheap.
   */
  status(): Promise<SpeechInputReadiness>;
  /** Optional readiness push (e.g. a model finished downloading). Returns unsubscribe. */
  onStatus?(listener: (readiness: SpeechInputReadiness) => void): () => void;
  /** Called when the user starts dictation so the host can warm its engine; may reject. */
  prepare?(signal: AbortSignal): Promise<void>;
  /** Called when the user clicks the mic while readiness is 'download-required'; the host shows its own setup UI. */
  requestSetup?(): void;
  /** Transcribe one self-contained take: mono 16-bit PCM WAV at 16 kHz. */
  transcribe(
    wav: ArrayBuffer,
    options: SpeechInputTranscribeOptions,
  ): Promise<SpeechInputTranscript>;
  /** Release resources. Called by the editor only for a provider it created from a factory. */
  dispose?(): void;
}

/**
 * Deferred construction. The shell creates the provider when it mounts with
 * the capability (it needs `status()` to decide whether to render the
 * microphone) and disposes it on unmount or when the capability changes. A
 * host that passes an instance owns its lifetime — which is what lets one warm
 * engine survive shell remounts.
 */
export type SpeechInputProviderFactory = () => SpeechInputProvider;

/** What the `speechInput` shell prop accepts. */
export type SpeechInputCapability = SpeechInputProvider | SpeechInputProviderFactory;

/**
 * Resolve a capability to a provider instance. A factory is invoked (and the
 * caller then owns — must dispose — what it returns); an instance is returned
 * as-is and stays host-owned.
 */
export function resolveSpeechInputProvider(capability: SpeechInputCapability): SpeechInputProvider {
  return typeof capability === 'function' ? capability() : capability;
}

/**
 * Whether a capability is a factory, i.e. whether the provider resolved from
 * it is owned (and must be disposed) by the resolver's caller.
 */
export function isSpeechInputProviderFactory(
  capability: SpeechInputCapability,
): capability is SpeechInputProviderFactory {
  return typeof capability === 'function';
}

/**
 * Imperative dictation control on the editor context
 * (`useEditorContext().dictation`), for a host component rendered inside the
 * shell's slots — e.g. to drive dictation from a native menu command. `null`
 * when the host injected no `speechInput` capability.
 */
export interface DictationControl {
  /** True from the moment dictation starts until its last take is inserted. */
  readonly active: boolean;
  /**
   * True when `toggle()` would do something: the provider is not
   * `unavailable` and a text-editing view (Write or Source) is showing.
   */
  readonly available: boolean;
  /**
   * Start dictation when idle (or ask the host to set up when readiness is
   * `download-required`); finish and stop when listening; cancel while the
   * microphone is still starting.
   */
  toggle(): void;
}

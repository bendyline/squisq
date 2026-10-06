# Speech input (dictation) — host integration guide

Squisq's editor can take dictation: a microphone button in the toolbar of the
Write (Tiptap) and Source (Monaco) views that listens, cuts speech into short
phrases at natural pauses, and inserts each recognized phrase at the caret as
it arrives — while the author keeps talking.

**Squisq ships no recognizer.** Recognition is a host-injected capability with
the same semantics as [`proofing`](proofing.md): the host passes a provider to
`EditorShell`, and without one there is no microphone button and no capture
code is ever loaded. Squisq owns everything up to the recognizer — microphone
capture, phrase segmentation, audio encoding, the button, the caret indicator
and the insertion. The provider owns only "audio in, text out", which is why a
provider can be a whisper.cpp server behind Electron IPC, a cloud service, or a
test fake.

## Wiring it up

```tsx
import { EditorShell } from '@bendyline/squisq-editor-react';
import type { SpeechInputProvider } from '@bendyline/squisq-editor-react/speech';

const speech: SpeechInputProvider = {
  id: 'whisper-local',
  label: 'On-device speech recognition',
  async status() {
    return (await host.speech.modelInstalled())
      ? { state: 'ready' }
      : { state: 'download-required', reason: 'The speech model is not installed.' };
  },
  onStatus: (listener) => host.speech.onStatus(listener), // optional push
  prepare: (signal) => host.speech.warmUp(signal), // optional
  requestSetup: () => host.openSpeechSettings(), // optional
  async transcribe(wav, { prompt, language, signal }) {
    return { text: await host.speech.transcribe(wav, { prompt, language, signal }) };
  },
};

<EditorShell speechInput={speech} … />;
```

The types and `resolveSpeechInputProvider` are exported from the narrow
`@bendyline/squisq-editor-react/speech` entry and re-exported from the root.

`speechInput` accepts a **provider instance** or a **factory**:

- **Instance** — the host owns its lifetime; Squisq never calls `dispose`. A
  module-scope singleton keeps a warm engine alive across shell remounts.
- **Factory** (`() => createProvider()`) — the shell creates the provider when
  it mounts (it needs `status()` to decide whether to render the microphone)
  and **disposes it** on unmount or when the capability changes.

Either way, pass a **stable reference**. A capability whose identity changes
on every render (an inline arrow) is re-resolved each time, which cancels any
session in flight. `speechInput` is ignored when the shell is `readOnly`.

## The contract

```ts
type SpeechInputReadinessState =
  | 'ready'
  | 'download-required'
  | 'unavailable'
  | 'permission-required';

interface SpeechInputProvider {
  readonly id: string;
  readonly label: string;
  status(): Promise<SpeechInputReadiness>; // { state, reason? }
  onStatus?(listener: (readiness: SpeechInputReadiness) => void): () => void;
  prepare?(signal: AbortSignal): Promise<void>;
  requestSetup?(): void;
  transcribe(
    wav: ArrayBuffer,
    options: { prompt?: string; language?: string; signal: AbortSignal },
  ): Promise<{ text: string }>;
  dispose?(): void;
}
```

### Readiness

| State                 | Button                       | Clicking it                                                      |
| --------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `ready`               | shown                        | starts dictation                                                 |
| `permission-required` | shown                        | starts dictation — the microphone request is what prompts for it |
| `download-required`   | shown, tooltip from `reason` | calls `requestSetup()` (synchronously, inside the click) instead |
| `unavailable`         | **hidden**                   | —                                                                |

`status()` is called once when the shell mounts with the capability, again
each time the author starts dictating, and after each `requestSetup()` call, so
a provider without `onStatus` still picks up a finished download on the next
click (pushing through `onStatus` updates the button immediately). Until the first `status()`
resolves the button is not rendered, so an unavailable provider never flashes
a microphone. A `status()` rejection counts as `unavailable`. Without a
`requestSetup`, a `download-required` click shows the `reason` as a message.

### Audio

Every call to `transcribe` carries **one self-contained take**: a RIFF/WAVE
file, **mono, 16-bit signed little-endian PCM, 16 kHz**
(`SPEECH_INPUT_SAMPLE_RATE`). That is the rate Whisper models are trained on,
every whisper.cpp build accepts it without ffmpeg, and it keeps an IPC payload
to about 32 KB per second of speech.

The browser records WebM/Opus (MP4/AAC on Safari); Squisq decodes each take
through an `OfflineAudioContext` at 16 kHz and re-encodes it. A take is cut
when the speaker pauses for 350 ms after at least 650 ms of audio, or at
2.5 s of continuous speech. Takes are transcribed **serially, in capture
order** — a provider never sees two calls in flight from one session — while
the microphone keeps capturing the next take.

`prompt` is the session's recent recognized text — a word-aligned tail of at
most 1,000 characters — for engines that accept a priming prompt (Whisper's
`prompt`). It is absent on the first take. `language` is reserved; the editor
does not currently set it.

Return `{ text: '' }` for silence. Whisper's `[BLANK_AUDIO]` sentinel is also
treated as silence. About ten seconds of consecutive silent takes ends the
session on its own.

### Lifecycle and cancellation

When the author starts dictating, `prepare(signal)` and the microphone request
run **concurrently** — the engine warms while the author begins to speak — and
every `transcribe` waits for `prepare` to settle. A `prepare` rejection ends
the session with its message.

The `signal` passed to `prepare` aborts when the session ends for any reason;
the `signal` passed to `transcribe` aborts when the author cancels or the
editor unmounts. Stop promptly when it does: a rejection after abort is
ignored, and a result after abort is discarded. A `transcribe` rejection
otherwise ends the session (the microphone is released at once — a failed take
will not get better by sending another) and shows its message.

## What the editor does with the text

A transcript is inserted as **literal text, never markdown**. A recognizer that
renders "star" as `*`, or begins a phrase with `#`, produces those characters —
not emphasis, not a heading. Both views use the same insertion paths as
proofing's "apply suggestion": a Tiptap `tr.insertText`, or Monaco
`executeEdits` between undo stops.

- **One undo step per phrase**, even when phrases arrive inside ProseMirror's
  history-grouping window, and the author's next keystroke starts its own step.
- **At the caret when the phrase arrives.** The author may move the caret, or
  switch between Write and Source, mid-session; each phrase lands wherever the
  caret is then. A non-empty selection is never replaced — the phrase goes at
  its end — because a phrase can arrive seconds after it was spoken.
- **Spacing:** whitespace runs collapse to one space and the phrase is trimmed;
  a single space is prepended unless the caret is at the start of a block or
  line, or right after whitespace (or the phrase starts with closing
  punctuation); a space is appended when the caret sits right before a word,
  with the caret left before it. Blank transcripts insert nothing.
- Leaving the text views (the Use tab) finishes the session; a phrase that
  arrives while no text view is mounted is held and inserted when one is.

## UI

- **States:** idle → preparing (status check + microphone) → listening →
  transcribing (stop was requested; the last takes are finishing) → idle.
- **Stopping:** click the button again or press **Esc** (unless a menu or
  dialog consumed the Esc first). Clicking while the microphone is still
  starting cancels.
- **Focus:** when a session ends — Stop, Esc, a long silence, an error —
  focus returns to the editor with the caret after the last phrase, so the
  next keystroke or Cmd/Ctrl+Z reaches the document rather than the Stop
  button. Focus is only reclaimed from the page or the dictation control,
  never from another input the author has moved to.
- **Level meter:** a 12-bar meter in the button while listening, driven by a
  local Web Audio analyser.
- **Caret indicator:** while listening or transcribing, a small "Listening…" /
  "Transcribing…" marker sits at the caret — a ProseMirror widget decoration in
  Write, injected `after:` text in Source. It is never document content: it
  does not change the markdown, fire `onChange`, or enter undo history.
- **Errors** (microphone denied, no device, device busy, a provider failure)
  show as a dismissible alert under the button.
- **Accessibility:** `aria-pressed`, `aria-label` "Start dictation" / "Stop
  dictation", and a polite live region announcing each state change.
- Styling uses the chrome palette tokens (light and dark) and honours
  `prefers-reduced-motion`.

## Driving it from host menus

`useEditorContext().dictation` exposes the same toggle for a host component
rendered inside the shell (any of its slots), e.g. to back a native menu item:

```tsx
function DictationMenuBridge() {
  const { dictation } = useEditorContext();
  useEffect(
    () => host.menu.on('edit:toggleDictation', () => dictation?.toggle()),
    [dictation],
  );
  useEffect(
    () =>
      host.menu.setItemState('edit:toggleDictation', {
        enabled: dictation?.available ?? false,
        checked: dictation?.active ?? false,
      }),
    [dictation],
  );
  return null;
}

<EditorShell speechInput={speech} toolbarSlotRight={<DictationMenuBridge />} … />;
```

`dictation` is `null` without a capability. `available` is true when the
provider is not `unavailable` and a text view is showing; `active` is true from
the moment dictation starts until its last phrase is inserted. `toggle()`
starts (or calls `requestSetup()` when a download is required), stops, or
cancels a start in progress. On macOS, label such an item "Dictate…" rather
than "Start Dictation…", which the system adds to Edit menus on its own.

## Microphone

Capture uses the recorder's `requestMicStream` with echo cancellation, noise
suppression and automatic gain control on, on the system default input. The
recorder dialog's per-take device choice is not persisted anywhere the editor
can read, so dictation does not follow it. Hosts own microphone permission:
in Electron, allow `media` in the session's permission handler and declare
`NSMicrophoneUsageDescription` on macOS.

## Privacy

Audio never leaves the page except through your provider. Squisq captures the
microphone in the renderer, encodes each take locally, and hands the bytes to
`transcribe` — it makes no network requests, persists no audio, and keeps
nothing after a take is transcribed. The level meter and pause detection are
computed locally and are not sent anywhere. Where the audio goes from there is
entirely the host's decision, and worth stating to your users.

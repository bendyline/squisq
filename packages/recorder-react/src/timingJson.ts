/**
 * Build the `.timing.json` sidecar that pairs with a narration recording.
 *
 * The shape matches what `resolveAudioMapping()` in
 * `@bendyline/squisq` reads at runtime: `sourceText`, `duration`, and
 * `bookmarks[]`. Sidecars are stored at `<audio-path>.timing.json`
 * inside the same `ContentContainer`, so the recorder can drop them
 * alongside its audio file and have the existing audio-mapping pipeline
 * pick them up with no schema changes.
 */

/**
 * Word-level timing bookmark — same shape as `AudioBookmark` in
 * `@bendyline/squisq`. Recorder output produces an empty `bookmarks`
 * array; word-level timing is the domain of TTS pipelines, not
 * browser-side dictation.
 */
export interface RecordedBookmark {
  id: string;
  time: number;
  charOffset: number;
  textFragment?: string;
}

export interface TimingJson {
  /** Plain text the user said (or intended to say) during the recording. */
  sourceText: string;
  /** Recording length in seconds. */
  duration: number;
  /** Word-level timing data. Empty by default — populated only when a downstream tool aligns the audio. */
  bookmarks: RecordedBookmark[];
}

/**
 * Build a `TimingJson` payload from a user-typed script and the
 * recording's measured duration. Both fields are required by the
 * downstream `parseTimingJson()` validator; missing them produces a
 * sidecar that gets silently dropped by the audio-mapping pipeline.
 */
export function buildTimingJson(sourceText: string, durationSec: number): TimingJson {
  return {
    sourceText: sourceText ?? '',
    duration: Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : 0,
    bookmarks: [],
  };
}

/**
 * Serialize a `TimingJson` payload to a `Uint8Array` ready to hand to
 * `ContentContainer.writeFile()`. Pretty-printed so authors can hand-
 * edit the sidecar if they ever want to.
 */
export function encodeTimingJson(timing: TimingJson): Uint8Array {
  const text = JSON.stringify(timing, null, 2);
  return new TextEncoder().encode(text);
}

/**
 * The container path convention `resolveAudioMapping()` expects:
 * `<audio-path>.timing.json`. Pass the audio file's relative path
 * (e.g. `'audio/narration-001.webm'`) and the matching sidecar path is
 * returned (`'audio/narration-001.webm.timing.json'`).
 */
export function timingPathFor(audioRelativePath: string): string {
  return `${audioRelativePath}.timing.json`;
}

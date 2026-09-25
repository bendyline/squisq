# Media edits

Non-destructive edits on audio and video references: trims, cuts, gain, fades,
crop, and a signal chain (high-pass, denoise, de-breath, loudness). The source
file is never modified. This page is the contract between the markdown, the
player/export pipeline, and hosts that render processed audio.

Code: `@bendyline/squisq/mediaEdit` (recipe grammar, time map, render store
layout), `resolveMediaSchedule` / `scheduleMediaClip` in
`@bendyline/squisq/schemas`, and the writers in `@bendyline/squisq-editor-react`.

## The recipe lives in the markdown

Edits are parameters on the media reference. All three authoring forms carry
the same fields:

```md
{[audio src=audio/take.webm anchor=document fx="highpass:80 denoise:0.8 debreath:-15 loudness:-16" cuts="12.4-13.1 40.2-41" gain=-2 fadeIn=0.3 fadeOut=0.5]}

<video src="video/screen.webm" data-squisq-video-placement="overlay" data-squisq-video-fx="loudness:-16" data-squisq-video-crop="0.1 0.05 0.8 0.9" data-squisq-video-group="rec-screen-20260924"></video>

<audio src="audio/note.webm" controls data-squisq-audio-gain="-3"></audio>
```

| Parameter | HTML attribute suffix | Meaning                                                                        |
| --------- | --------------------- | ------------------------------------------------------------------------------ |
| `fx`      | `-fx`                 | Signal chain, see below. Rendered into a derived audio file.                   |
| `cuts`    | `-cuts`               | Removed **source-time** ranges, `start-end` pairs (`12.4`, `1:02.5`, `450ms`). |
| `gain`    | `-gain`               | Clip gain in dB (−60…+24).                                                     |
| `fadeIn`  | `-fade-in`            | Fade-in seconds at the start of the played clip.                               |
| `fadeOut` | `-fade-out`           | Fade-out seconds at the end of the played clip.                                |
| `crop`    | `-crop`               | Video only. Normalized `x y w h` of the source frame.                          |
| `group`   | `-group`              | Links companion clips (screen + camera). Editors propagate edits across it.    |

The HTML attribute is the per-kind prefix plus the suffix:
`data-squisq-video-fade-in`, `data-squisq-audio-cuts`.

Parsing is forgiving and never guesses: invalid fields are dropped, neutral
values (`gain=0`, a full-frame crop) are dropped, and out-of-range values are
clamped. Undo is the editor's ordinary undo — a recipe edit is a markdown edit.

### The signal chain (`fx`)

Space-separated `op` or `op:value` tokens. The chain always runs in this fixed
order, whatever order the tokens are written in:

| Op         | Value                      | Default |
| ---------- | -------------------------- | ------- |
| `highpass` | corner frequency, Hz       | 80      |
| `denoise`  | wet/dry strength, 0…1      | 0.8     |
| `debreath` | breath attenuation, dB ≤ 0 | −15     |
| `loudness` | integrated target, LUFS    | −16     |

Unknown tokens are preserved verbatim (so a recipe written by a newer engine
survives an older one) and are not rendered.

## Timeline ops are metadata; signal ops are rendered

- **Timeline ops** (`clipStart`/`clipEnd`, `cuts`, `gain`, fades, `crop`) apply
  at playback and export. Nothing is rendered. `resolveMediaSchedule` expands a
  clip with cuts into contiguous entries, one per kept source range, sharing a
  `segment.groupId`; each carries `gain`, and the outer entries carry the fades.
  Every consumer of the schedule — player, browser export mix, CLI mix — gets
  cuts for free.
- **Signal ops** (`fx`) are rendered once into an audio-only file.

`createMediaTimeMap(clip)` is the one definition of what trims and cuts do to
time. Anything indexed against a source file goes through it: the narration
sidecar's block ranges (`applyNarrationTiming`), a companion clip's cuts, and
cut markers on the timeline.

## Renders

A render is an **audio-only** file, **sample-aligned with the source's audio
track** — same start, same length, never cut. That invariant is what lets cuts
and trims apply identically to a video's picture and its processed sound, and
it keeps renders small (Opus, ~7 MB per 10 minutes).

Renders live beside the rest of the document's media and travel with it:

```
<media root>/.mediaEdits/<stem>.<key>.webm   the rendered audio (or .wav)
<media root>/.mediaEdits/<stem>.<key>.json   its manifest
```

`<key>` is `mediaRenderKey(src, fx)` — 12 hex digits over the source path and
the canonical known ops. Availability is readable from a listing alone
(`buildMediaRenderIndex`); manifests (`MediaRenderManifest`) record the source
size and duration for staleness (`mediaRenderStaleness`), analysis results,
and any recipe tokens the engine skipped. Renders are a cache: the recipe is
the source of truth, and any render can be deleted and regenerated.
`selectMediaRendersForGc` picks renders no current recipe references that are
older than 7 days; undo within a session never loses a render.

## What a host provides

Playback and export substitute processed audio through one option:

```ts
resolveMediaSchedule(doc, {
  processedAudio: (clip) => renderIndex.get(mediaClipRenderKey(clip) ?? '')?.path,
});
```

When it returns a path, an audio clip plays the render instead of its source,
and a video clip keeps its picture but is marked `audioMuted` while a companion
audio entry (`derivedFrom: clip.id`) plays the render with identical timing.
When it returns `undefined` — no render yet, or no lookup wired — the clip
plays its original audio. `computeAudioTimeline(doc, preRoll, { processedAudio })`
forwards the same lookup to the export mix, and the CLI builds it from the
container's listing automatically.

Body-embedded `<audio>` / `<video>` tags are not part of `resolveMediaSchedule`;
hosts that schedule them (the editor timeline) call `scheduleMediaClip` so
edits behave identically there.

## Rendering in the browser

`@bendyline/squisq-video-react/media-edit` holds the engine and its bindings:

- `createMediaEditRenderer()` — runs renders, previews, analyses and pause
  detection in `workers/mediaEdit.worker.js` (demux + decode with mediabunny,
  the chain, Opus/WebM or WAV encode). If the worker cannot start, jobs run on
  the main thread with identical results. The worker bundles RNNoise
  statically: hosts may build workers as IIFE (Vite's default), which cannot
  code-split. The main-thread fallback loads the engine and RNNoise lazily.
- `createMediaEditRenderManager({ mediaProvider })` — one per media scope.
  `sync(doc, extraClips?)` indexes `.mediaEdits/`, queues missing or stale
  renders and writes them (render + manifest) through the provider;
  `processedAudio(clip)` answers only with renders that exist; `whenReady(doc)`
  settles once every needed render is ready or failed; `collectGarbage(doc)`
  removes old renders of the document's own sources only (a media folder can
  be shared).
- Hooks: `useProcessedAudio(manager)` changes identity only when renders
  appear or vanish — pass it to `DocPlayer`'s `processedAudio` prop; progress
  ticks never re-resolve a schedule. `useMediaEditStatus(manager)` tracks
  progress. Keep fast-changing manager state out of broad React contexts.

Host wiring:

- `EditorShell` `mediaEditRenders` prop: omitted → the shell owns a manager
  for its media provider; a host-owned manager → shared with the host's export
  flow; `null` → media edits off. The editor syncs body-embedded
  `<audio>`/`<video>` tags as `extraClips` (the document model does not
  schedule them).
- `VideoExportModal` `mediaEditRenders` prop: export waits for pending renders
  ("Processing audio edits…") and mixes processed audio.
- CSP: `'wasm-unsafe-eval'` (RNNoise), `worker-src` for the worker, and
  `connect-src data: blob:` when the provider resolves media as data/blob URLs
  (the manager `fetch`es sources and manifests).

## Playback

- Gain and fades set each element's `volume`; boosts above unity route that
  element through a shared Web Audio `GainNode`.
- A clip with cuts mounts two elements that alternate between segments; the
  idle one parks on the next segment's in-point ~0.75 s ahead, so a cut does
  not wait on a seek.
- Crop uses CSS `object-view-box` (Chromium; other browsers show the full
  frame) and tags the element `data-crop`, which video export reads to draw
  only the cropped region in every browser.
- Inline Write-view `<audio>` players play the processed render once it
  exists.

## Pause tightening

`detectPauseCuts(frames, { maxPauseSec, keepSec, minCutSec })` proposes cuts
for every quiet run longer than `maxPauseSec`, keeping `keepSec` of silence.
Breaths and consonants count as activity, so a cut never lands inside a sound.
The editor's Timing section runs it through the renderer (`pauses()`), and
propagates the cuts to grouped companions in each companion's own source time.

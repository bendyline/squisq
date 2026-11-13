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

## Baked clips

The player, the video export and the CLI apply a recipe as they play. A
script-free HTML page or another app cannot: it plays the file it is given.
For those, a clip is **baked** — its source with trim, cuts, processed audio,
gain, fades and crop applied, encoded as one ordinary file.

A baked clip is a cache, like a render, and it is made **only on demand**: by
an export that needs it, or by "Save edited copy" in the editor. Changing a
recipe never bakes anything. It lives in the same folder, told apart by a
`.baked` segment so neither index sees the other's files:

```
<media root>/.mediaEdits/<stem>.<key>.baked.<ext>    the baked clip
<media root>/.mediaEdits/<stem>.<key>.baked.json    its manifest
```

`<key>` is `mediaBakeKey(clip)` — 12 hex digits over `mediaBakeSpec(clip)`:
the engine version, the source path, the kind, the trim, the cuts inside the
trim, the canonical known `fx` ops, gain, fades, and (video) the crop. Fields
that do not change the result (`group`, unknown `fx` tokens, a crop on audio)
are left out. `needsMediaBake(clip)` says whether a recipe-unaware player
would play the clip wrongly; a trim alone does not count, since a plain player
honors it as a `#t=` fragment. A manifest (`MediaBakeManifest`) records the
spec and the source size; a baked clip is stale when the source changed size.
Baked clips a document's recipes no longer ask for are removed at once
(`selectSupersededMediaBakes`) — a baked video is large and is made again on
demand, and playback never depends on it.

The output is the most widely playable file the browser can encode: audio as
M4A (AAC), else Opus in WebM, else WAV; video as MP4 (H.264 + AAC), else WebM
(VP9 or VP8 + Opus). Video is re-encoded, so baking a long recording takes
real time and the result is a second large file. The sound is taken from the
clip's processed-audio render when the recipe has a signal chain, so the chain
is never run twice; the audio stage (`createMediaBakeAudioStage`) applies the
same gain, fades and 10 ms cut-edge fades the player and the export mix do.

- `renderer.bake(request)` runs the bake in the media-edit worker (main
  thread as a fallback). It rejects where the browser cannot encode video.
- `manager.bake(clip, { signal, onProgress })` returns the path of a current
  baked clip or makes one — first waiting for the processed-audio render the
  recipe needs, queued there if missing — and writes file and manifest
  through the provider. `manager.bakedMedia(clip)` answers only with a
  current baked clip. `sync` and `whenReady` never bake.
- `bakeMarkdownMedia(markdown, manager, options)` (from
  `@bendyline/squisq-editor-react`) is the one call an exporter needs: it bakes
  every clip that needs it and returns the source with those clips pointing
  at their baked files and the recipe and trim taken off, plus the list of
  baked files and of clips that could not be baked (left as they were).
  `reference: 'store'` writes the stored path — right when the output is read
  beside the document's media folder. `reference: 'copy'` writes a visible
  name beside the source (`video/take-edited.mp4`) for an export that carries
  its own files: the store is a dot-folder, which many static hosts do not
  serve. The exporter reads `baked[n].path` and writes it at
  `baked[n].reference`.
- The media-edit dialog's **Save edited copy…** bakes the recipe on screen,
  applied or not, and hands the file (`<stem>-edited.<ext>`) to the host.

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

- `createMediaEditRenderer()` — runs renders, previews, analyses, pause
  detection and waveform reads in `workers/mediaEdit.worker.js` (demux +
  decode with mediabunny, the chain, Opus/WebM or WAV encode). If the worker cannot start, jobs run on
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
- `EditorShell` `saveMediaEditOutput` prop: where "Save edited copy" puts its
  file — the same contract as `saveCoverImageOutput` (`(blob, filename)`,
  `false` when the user cancels). Omitted, the copy is downloaded.
- An export that cannot apply a recipe (a plain Web page) calls
  `bakeMarkdownMedia` with the document's manager before rendering, and ships
  or references the baked files it reports.
- Vite hosts: add `rnnoiseWasmPlugin()` from
  `@bendyline/squisq-video-react/vite` to both `plugins` and `worker.plugins`.
  RNNoise's 3.6 MB WASM then ships once, as an emitted `rnnoise-*.wasm`
  fetched on first use, instead of twice as base64 (in the worker and in the
  fallback chunk; about 3.6 MB gzipped saved). It works for ES and IIFE
  workers and follows `base` the way Vite's own asset URLs do. Without it the
  self-contained modules still work.
- CSP: `'wasm-unsafe-eval'` (RNNoise), `worker-src` for the worker, and
  `connect-src data: blob:` when the provider resolves media as data/blob URLs
  (the manager `fetch`es sources and manifests). With the Vite plugin, RNNoise
  `fetch`es its WASM too, so `connect-src` must allow where it is served.

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

The bullets above are the SCHEDULED clips: `{[audio|video …]}` annotations and
placed `<video>` tags, which `MediaClipLayer` plays at the player level. A
plain `<video>` in a slide's body — what the recorder inserts — is not
scheduled: it is laid out with the slide's content and played by `VideoLayer`.
Nothing hands that layer a schedule entry, so it carries the recipe itself
and applies it:

- `materializeBlockLayers` puts the clip's cuts on the layer (`content.cuts`,
  clamped to its window) and the rest of the recipe beside them
  (`content.edits`: `fx`, `gain`, fades, `crop`). With cuts it also moves the
  out-point far enough into the source to fill the block's length once they
  are skipped (the block's length already counted them, see `videoTiming`).
- **Cuts.** `VideoLayer` maps the doc clock to source time through the cuts,
  and moves a playing element out of a cut it runs into on the next animation
  frame — so a cut is skipped whether the clock ticks finely or four times a
  second, and also when the viewer drives the clip with native controls. The
  element carries `data-cuts`; `DocPlayer`'s seek handler (frame capture for
  video export) maps through it the same way.
- **Crop.** `object-view-box` live and `data-crop` for frame capture, as on a
  scheduled clip.
- **Gain and fades.** Set as the element's level, the fades measured across
  the PLAYED clip. A viewer-driven clip (`mode="player"`) gets its gain once
  and its volume is then the viewer's.
- **Processed audio.** `DocPlayer` provides its `processedAudio` lookup as
  `ProcessedAudioContext`. In timed playback the layer mutes the picture and
  plays the clip's render in an `<audio>` beside it, held to the same source
  instant (the render is sample-aligned with the source) and skipping the
  same cuts. A viewer-driven clip keeps its own sound, so its native volume
  and mute controls mean what they say.
- **Export sound.** `computeAudioTimeline` emits one entry per kept range for
  such a clip — the processed render when the lookup has one, else the
  video's own sound — with the clip's gain, its fades at the two ends, and
  the 10 ms join fades between.

The inline players — the Write view's `<video>` / `<audio>` nodes and the
document tray, and `InlineVideoPlayer` / `InlineAudioPlayer` in the Document
view — skip a clip's cuts as it plays and show a video's crop
(`useCutTimeMap`, `useSkipCuts`, `mediaCropStyle` from
`@bendyline/squisq-react`). They do not change the sound: gain, fades and (for
video) the processed track are heard in Slideshow and in exports. The inline
`<audio>` player already plays the processed render.

## Cutting on a timeline

The editor's Cuts tab is where `cuts` are authored. It shows the clip's trim
window as a waveform (`renderer.waveform({ source })` → 100 peaks per second
of the audio track, read once per source and kept for the session; no peaks
for a silent video, which can still be cut by time). The same call returns
the file's length — its longest track — which is where the timeline gets it
for a recorder's WebM: such a file states no duration, so a media element
reports `Infinity`. A video clip's dialog fills the editor, and the Cuts tab
gives the spare height to the picture. Dragging across the timeline —
or marking a start and an end at the playhead — selects a section, **Cut
selection** removes it, and each cut's edges drag to adjust it. Cuts that
touch or overlap merge (`normalizeMediaCuts`), and every cut stays inside the
trim window.

"Result" playback there is the same rule the player applies — skip each cut,
stop at the trim window's end — over the SOURCE file, so what is heard is what
Apply writes. Nothing is rendered for a cut: reopening the tab reads the
recipe back as the same editable sections, and restoring one is deleting its
range. The tab keeps its own undo for cut edits; once applied, a set of cuts
is one step of the editor's undo.

## Pause tightening

`detectPauseCuts(frames, { maxPauseSec, keepSec, minCutSec })` proposes cuts
for every quiet run longer than `maxPauseSec`, keeping `keepSec` of silence.
Breaths and consonants count as activity, so a cut never lands inside a sound.
The editor's Cuts tab runs it through the renderer (`pauses()`), adds what it
finds to the cuts already made (each can then be adjusted or restored on the
timeline), and propagates the cuts to grouped companions in each companion's
own source time.

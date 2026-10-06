# Generated narration and audio export — host integration guide

Squisq plays, re-times and exports narration that a person **records**
(Narrate mode, Insert → Document narration). Hosts that **generate** narration
— text-to-speech — reuse the same pipeline: write an audio file plus a v3
`.timing.json` sidecar, insert the `{[audio … anchor=document]}` preamble, and
Play mode, block timing, captions and video export follow with no new playback
code. The same building blocks export a document's audio on its own.

**Squisq ships no speech synthesizer.** The host owns synthesis; Squisq owns the
sidecar format, the save, the encoding and the mix.

## Saving generated narration

Build the take's timings as a `NarrationAlignment` (one entry per script token
in `words`, contiguous per-block ranges in `blocks`) against the script from
`buildNarrationScript(doc)`, then save it through the teleprompter's own save
path — naming yourself as the generator:

```ts
import { buildNarrationScript } from '@bendyline/squisq/narration';
import {
  buildNarrationSavePlan,
  executeNarrationSave,
  type ExecuteNarrationSaveDeps,
} from '@bendyline/squisq-editor-react/teleprompter';

const script = buildNarrationScript(doc);
const plan = buildNarrationSavePlan({
  script,
  alignment, // built from the synthesized chunks
  durationSec,
  audioExt: '.webm',
  cameraExt: null,
  generator: { name: 'my-tts', method: 'tts' },
});

const { mediaProvider, workspaceContainer, setMarkdownSource, bumpMediaRevision } =
  useEditorContext();
if (!mediaProvider) return; // saving narration needs somewhere to put the audio
const deps: ExecuteNarrationSaveDeps = {
  mediaProvider,
  container: workspaceContainer,
  getMarkdownSource: () => sourceRef.current, // read LIVE, not a render snapshot
  setMarkdownSource,
  bumpMediaRevision,
};
await executeNarrationSave(
  plan,
  { audioBlob, audioMime: 'audio/webm', cameraBlob: null, cameraMime: null },
  deps,
);
```

This writes `audio/narration-….webm`, the sidecar beside it, and replaces the
narration preamble in **one** undoable source write. A retry may pass the same
`NarrationSaveProgress` object back in so audio already written is reused.

`generator.method: 'tts'` marks the timings as synthesized: **block and
sentence boundaries are exact** because each was synthesized separately, and
**word times are interpolated** (by syllables within a sentence, say). The
other methods are `'dsp-align'` (the teleprompter's aligner, the default) and
`'presenter-advance'` (slide advances observed while recording). Hosts calling
`buildNarrationTimingJson` directly pass the same `generator` option.

When the sidecar carries word bookmarks, `applyNarrationTiming` (run by
`resolveAudioMapping`) also rebuilds `doc.captions` from them, mapped through
the clip's trim and cuts, so captions follow the voice.

## Encoding audio files

`@bendyline/squisq-video-react/encoder` ships a streaming encoder. Feed it
planar float32 PCM at whatever rate you have; it resamples in-stream when the
codec needs it (WebCodecs AAC accepts only 44.1/48 kHz, while TTS often emits
24 kHz):

```ts
import {
  createAudioFileEncoder,
  supportedAudioFileFormats,
} from '@bendyline/squisq-video-react/encoder';

const formats = await supportedAudioFileFormats(); // e.g. ['m4a', 'opus-webm', 'wav']
const encoder = await createAudioFileEncoder({
  format: 'opus-webm',
  sampleRate: 24_000,
  channels: 1,
});
for await (const chunk of synthesize(text)) await encoder.append([chunk]);
const blob = await encoder.finish(); // encoder.mimeType, encoder.extension
```

| Format      | Container           | Availability                             |
| ----------- | ------------------- | ---------------------------------------- |
| `m4a`       | Audio-only MP4, AAC | WebCodecs AAC — macOS/Windows, not Linux |
| `opus-webm` | WebM, Opus          | WebCodecs Opus (all desktop Chromium)    |
| `wav`       | 16-bit PCM          | Always                                   |

Rules worth knowing:

- `createAudioFileEncoder` **rejects** a format the runtime cannot encode; it
  never switches format behind your back. Probe first.
- Append in chunks as audio arrives. The encoder slices large appends and keeps
  only encoded bytes, so a long document never sits in memory as float32.
- Await each `append` to respect encoder backpressure. `cancel()` abandons the
  file; a lossy file with no samples cannot be finished.
- WAV caps at 4 GiB (about 6 hours of 48 kHz stereo).

## Exporting a document's audio

`renderDocumentAudio` mixes everything the document schedules — narration
segments, document- and block-anchored clips, the audio of scheduled video —
on the document's timeline, exactly as MP4 export does (the two share one
pipeline):

```ts
import { createAudioFileEncoder, renderDocumentAudio } from '@bendyline/squisq-video-react/encoder';

const mixed = await renderDocumentAudio(preparedDoc, {
  readMedia: (src) => container.readFile(src), // null when missing
  processedAudio: renders?.processedAudio, // media-edit renders, as video export
  signal,
});
if (mixed) {
  const encoder = await createAudioFileEncoder({
    format: 'm4a',
    sampleRate: mixed.sampleRate,
    channels: 2,
  });
  await encoder.append([mixed.getChannelData(0), mixed.getChannelData(1)]);
  const file = await encoder.finish();
}
```

- Pass the doc video export would get: narration timing and audio mapping
  resolved (`resolveAudioMapping`). The mix spans the doc's duration.
- It returns `null` when the doc has no audio. A scheduled file `readMedia`
  cannot find rejects with its name, unless `missingMedia: 'skip'`.
- The mix is an `OfflineAudioContext` render, so the whole mix is one
  `AudioBuffer` (about 23 MB per minute of 48 kHz stereo). Pass
  `sampleRate: 24_000` for speech-only documents to halve that.
- `renderAudioTimeline` (the mixer) is exported too, for hosts that schedule
  their own clips.

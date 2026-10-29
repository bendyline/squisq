---
title: Video and images
description: Export Squisq documents as MP4 video, animated GIF, dashboard and cover images, and audio files, in the browser with React components or in Node with the CLI API.
---

# Video and images

A Squisq document plays as a slideshow, so it can also be recorded: as an MP4 with its narration, a
silent animated GIF, a single image of its dashboard or cover, or an audio file of everything it
schedules. You can produce each one in the browser or in Node.

| Output          | In the browser (React)                                    | In Node                                       |
| --------------- | --------------------------------------------------------- | --------------------------------------------- |
| MP4 video       | `VideoExportButton`, `VideoExportModal`, `useVideoExport` | `renderDocToMp4`, `squisq video`              |
| Animated GIF    | The same, with `outputFormat: 'gif'`                      | `renderDocToGif`, `squisq video --format gif` |
| Dashboard image | `DashboardImageExportModal`                               | `renderDocToDashboardPng`, `squisq image`     |
| Cover image     | `CoverImageExportModal`                                   | `renderDocCoverToPng`                         |
| Audio file      | `renderDocumentAudio` + `createAudioFileEncoder`          | —                                             |

Three packages are involved:

- **`@bendyline/squisq-video-react`** — the browser export dialogs and hooks. It captures frames from
  a hidden, in-page `DocPlayer` and encodes them with WebCodecs, falling back to ffmpeg.wasm.
- **`@bendyline/squisq-video`** — the shared, browser-pure foundation: quality and resolution
  presets, the render-HTML generator for headless capture, FFmpeg argument builders, and a
  browser-only ffmpeg.wasm encoder.
- **`@bendyline/squisq-cli`** — the Node path: headless Chromium (Playwright) for capture and a
  native FFmpeg for encoding, as the `squisq` command or the `@bendyline/squisq-cli/api` module.

## Prepare the document

Export renders a `Doc`, the parsed form of a document, the way the slideshow plays it. Build it with
`markdownToDoc`, and when the document has recorded narration, run `resolveAudioMapping` so audio
files and their timing sidecars are linked to the blocks they voice. A media provider resolves the
document's relative image and audio paths.

```ts
import { markdownToDoc, resolveAudioMapping } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { createMediaProviderFromContainer, type ContentContainer } from '@bendyline/squisq/storage';

export async function prepareForExport(markdown: string, container: ContentContainer) {
  const doc = await resolveAudioMapping(markdownToDoc(parseMarkdown(markdown)), container);
  const media = createMediaProviderFromContainer(container);
  return { doc, media };
}
```

A theme set on the document (`squisq-theme` frontmatter, or `doc.themeId`) applies to the export.
See [Storage](../concepts/storage.md) for containers and media providers.

## Add a video export button

```tsx
import { VideoExportButton } from '@bendyline/squisq-video-react';
import type { FfmpegWasmLoadConfig } from '@bendyline/squisq-video';
import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';

// Same-origin copies of @ffmpeg/core's ESM build (see "Hosting requirements").
const FFMPEG_WASM: FfmpegWasmLoadConfig = {
  coreURL: '/ffmpeg-core/ffmpeg-core.js',
  wasmURL: '/ffmpeg-core/ffmpeg-core.wasm',
};

export function ExportVideo({ doc, media }: { doc: Doc; media: MediaProvider }) {
  return (
    <VideoExportButton
      doc={doc}
      mediaProvider={media}
      defaultConfig={{ ffmpegWasm: FFMPEG_WASM }}
    />
  );
}
```

The button opens `VideoExportModal` in a portal on `document.body`. The dialog offers presets
(Presentation, Social portrait, Small file) and settings for format, quality, frame rate,
orientation, captions, and animations; it shows progress with frame previews, then saves the file.

To open the dialog from your own control, render `VideoExportModal` yourself, in a portal as the
button does:

```tsx
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { VideoExportModal } from '@bendyline/squisq-video-react';

export function ExportMenuItem({ doc, media }: { doc: Doc; media: MediaProvider }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Export video…</button>
      {open &&
        createPortal(
          <VideoExportModal
            doc={doc}
            mediaProvider={media}
            defaultConfig={{ ffmpegWasm: FFMPEG_WASM }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
```

| Prop                         | Purpose                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `doc`                        | The document to export. Required.                                                                                 |
| `mediaProvider`              | Resolves relative image and audio paths.                                                                          |
| `images`, `audio`            | Pre-loaded media as `Map<path, ArrayBuffer>`, an alternative to a provider.                                       |
| `defaultConfig`              | A partial `VideoExportConfig` that seeds the dialog and is merged into every export — the place for `ffmpegWasm`. |
| `colorScheme`                | `'light'` (default) or `'dark'` for the dialog.                                                                   |
| `uiPalette`                  | Overrides for the dialog's surfaces, controls, and accent colors.                                                 |
| `saveOutput`                 | Your own save flow: `(blob, filename)`; return `false` when the user cancels a picker.                            |
| `saveActionLabel`            | Label for the finished export's save button, per format.                                                          |
| `onClose`                    | Modal only, required: called when the dialog should close.                                                        |
| `saveOptions`                | Modal only: your controls above the Save button.                                                                  |
| `mediaEditRenders`           | Modal only: a media-edit render manager, so edited clips export processed audio.                                  |
| `label`, `style`, `disabled` | Button only.                                                                                                      |

`playerScript` is accepted but unused by the browser path; frames come from an in-page player.

## Build your own export UI

`useVideoExport()` runs the same pipeline without the dialog. Call `startExport(doc, config)` and
render from the state it returns:

```tsx
import { useVideoExport } from '@bendyline/squisq-video-react';

export function SocialClipExport({ doc, media }: { doc: Doc; media: MediaProvider }) {
  const video = useVideoExport();

  const start = () =>
    video.startExport(doc, {
      outputFormat: 'mp4',
      orientation: 'portrait',
      captionMode: 'social',
      quality: 'high',
      mediaProvider: media,
      ffmpegWasm: FFMPEG_WASM,
    });

  if (video.state === 'complete' && video.downloadUrl) {
    return (
      <a href={video.downloadUrl} download="harbor-survey.mp4">
        Download ({Math.round(video.fileSize / 1024)} KB)
      </a>
    );
  }
  if (video.state === 'error') return <p role="alert">{video.error}</p>;
  if (video.state !== 'idle') {
    return (
      <p>
        {video.phase} {video.progress}% <button onClick={video.cancel}>Cancel</button>
      </p>
    );
  }
  return <button onClick={start}>Export portrait clip</button>;
}
```

The result also reports `backend` (`'webcodecs'` or `'ffmpeg-wasm'`), `outputBlob` for your own save
flow, `elapsed` and `estimatedRemaining` seconds, `audioIncluded`, `audioSkippedReason`, and
`reset()`. Pass `{ onFramePreview, previewEveryNFrames }` to `useVideoExport` to show frames as they
are captured.

### Export settings

| `VideoExportConfig` field                                 | Default                            | Notes                                                                                                                                        |
| --------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `outputFormat`                                            | `'mp4'`                            | `'mp4'` or `'gif'`.                                                                                                                          |
| `quality`                                                 | `'normal'`                         | `'draft'`, `'normal'`, `'high'` (`QUALITY_PRESETS`).                                                                                         |
| `fps`                                                     | 30 (MP4), 10 (GIF)                 | 1–120.                                                                                                                                       |
| `orientation`                                             | `'landscape'`                      | `'landscape'` or `'portrait'`.                                                                                                               |
| `width`, `height`                                         | 1920 × 1080 (MP4), 960 × 540 (GIF) | Swapped for portrait. Must be even.                                                                                                          |
| `captionMode`                                             | `'off'` (MP4), `'standard'` (GIF)  | `'off'`, `'standard'`, or `'social'`.                                                                                                        |
| `animationsEnabled`                                       | `true` (MP4), `false` (GIF)        | Layer animations and slide transitions. Media and timing are unaffected.                                                                     |
| `audioPolicy`                                             | `'require'`                        | `'require'` fails the export when audio cannot be included; `'best-effort'` allows a silent video; `'omit'` skips audio.                     |
| `mediaProvider`, `images`, `audio`                        | —                                  | Where media comes from. `resourcePolicy` limits provider URLs.                                                                               |
| `theme`                                                   | the document's                     | A `Theme` override.                                                                                                                          |
| `showCoverSlide`, `coverDuration`, `coverPlayback`        | the document's frontmatter         | The managed cover: whether it shows, for how long (2 s fallback), and whether the story waits (`'preroll'`) or plays under it (`'overlay'`). |
| `videoPresentation`, `pipSize`, `pipShape`, `pipPosition` | the document's frontmatter         | Placement of embedded video clips.                                                                                                           |
| `processedAudio`                                          | —                                  | Media-edit renders to mix instead of original clips.                                                                                         |
| `ffmpegWasm`                                              | —                                  | Same-origin ffmpeg.wasm core URLs. Required whenever ffmpeg.wasm runs.                                                                       |

## How encoding works

- **MP4 video** encodes on the main thread with WebCodecs H.264 when the browser supports it for
  the requested size. Otherwise it falls back to an encoder worker running ffmpeg.wasm, which needs
  `SharedArrayBuffer`. Linux Chromium is the common fallback case: it has `VideoEncoder` but no
  H.264.
- **MP4 audio** mixes narration, document and block clips, and the audio of scheduled video on the
  document's timeline. It is encoded as AAC inside the muxer when WebCodecs AAC is available,
  otherwise muxed in a second ffmpeg.wasm pass. Under the default `audioPolicy: 'require'`, audio
  that cannot be loaded or encoded fails the export instead of producing a silent video.
- **GIF** captures a compact video-only MP4 first, then always runs an ffmpeg.wasm palette pass. GIFs
  have no audio.

## Hosting requirements

The WebCodecs path needs nothing special. Everything that touches ffmpeg.wasm — the MP4 fallback,
the second-pass audio mux, and every GIF — needs three things from your host.

**1. Cross-origin isolation.** `SharedArrayBuffer` exists only on cross-origin-isolated pages, so
serve the app with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Use `credentialless` rather than `require-corp`: frame capture uses `blob:` URL frames, which
`require-corp` blocks. A GIF export on a page without `SharedArrayBuffer` fails before capturing any
frames.

**2. A same-origin ffmpeg.wasm core.** Squisq never fetches ffmpeg from a CDN. Copy
`node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js` and `ffmpeg-core.wasm` into your static assets
and pass their URLs as `ffmpegWasm`. Without `coreURL`, the export throws an explanatory error (for a
GIF, before capture starts). `@ffmpeg/core` is GPL-licensed; ship its license notice with the files.

**3. Bundler settings for the encoder worker.** The worker is spawned with
`new URL('./workers/encode.worker.js', import.meta.url)` and lazy-loads ffmpeg.wasm. In Vite:

```ts
// vite.config.ts
import { defineConfig } from 'vite';

const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  // Pre-bundling would break the worker's URL.
  optimizeDeps: { exclude: ['@bendyline/squisq-video-react'] },
  // The worker code-splits, which Vite's default IIFE worker format cannot.
  worker: { format: 'es' },
});
```

Your production server must send the same two headers. The demo site is a complete worked example:
[`vite.config.ts`](../../../packages/site/vite.config.ts) serves and publishes the core files (with
their GPL notice) and sets the headers, and
[`ffmpegWasmConfig.ts`](../../../packages/site/src/ffmpegWasmConfig.ts) builds the `ffmpegWasm`
config from the app's base URL.

If you also use media edits (noise reduction and other processed audio), add the `/vite` entry's
`rnnoiseWasmPlugin` as described in [Media edits](../../media-edits.md).

## Export images

Two dialogs export a single frame as PNG, JPEG, or WebP. Each lives in its own entry point that
leaves out the MP4 and GIF encoder graph, so a surface that only exports images pays nothing for
video. The editor's preview controls already offer both; video export is left to the host.

```tsx
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DashboardImageExportModal } from '@bendyline/squisq-video-react/dashboard-image';
import { CoverImageExportModal } from '@bendyline/squisq-video-react/cover-image';
import type { Doc, MediaProvider } from '@bendyline/squisq/schemas';

export function ImageExports({ doc, media }: { doc: Doc; media: MediaProvider }) {
  const [open, setOpen] = useState<'dashboard' | 'cover' | null>(null);
  return (
    <>
      <button onClick={() => setOpen('dashboard')}>Dashboard as image</button>
      <button onClick={() => setOpen('cover')} disabled={!doc.startBlock}>
        Cover as image
      </button>
      {open === 'dashboard' &&
        createPortal(
          <DashboardImageExportModal
            doc={doc}
            mediaProvider={media}
            defaultResolution="4k"
            defaultStyle="card"
            defaultFileName="quarterly-review.png"
            onClose={() => setOpen(null)}
          />,
          document.body,
        )}
      {open === 'cover' &&
        createPortal(
          <CoverImageExportModal
            doc={doc}
            mediaProvider={media}
            defaultWidth={1280}
            defaultHeight={720}
            onClose={() => setOpen(null)}
          />,
          document.body,
        )}
    </>
  );
}
```

### Dashboard images

`DashboardImageExportModal` renders the document's [dashboard](../../guide/dashboards.md) — every
block on one canvas — and offers named resolutions, custom pixel sizes, the layout picker, the cell
style, and the title band. Its `default*` props seed those choices: `defaultResolution` (`'fhd'`),
`defaultLayout` (`'auto'`), `defaultStyle` (`'basic'`, `'card'`, `'panel'`, or `'accent'`), and
`defaultShowTitle` (`true`). It also takes `theme`, `defaultFileName`, `colorScheme`, `saveOutput`,
and `onClose`.

The named resolutions are `DASHBOARD_RESOLUTIONS`, shared with `squisq image`:

| Id            | Size        | Shape     |
| ------------- | ----------- | --------- |
| `hd`          | 1280 × 720  | landscape |
| `fhd`         | 1920 × 1080 | landscape |
| `4k`          | 3840 × 2160 | landscape |
| `square`      | 1080 × 1080 | square    |
| `square-2k`   | 2160 × 2160 | square    |
| `portrait`    | 1080 × 1920 | portrait  |
| `portrait-4k` | 2160 × 3840 | portrait  |
| `standard`    | 1440 × 1080 | standard  |

Custom sizes must be whole pixels, 64–7,680 per side, and at most 33,177,600 pixels in all. Odd
sizes are fine: images don't have video's even-dimension rule. `resolveDashboardDimensions` and
`validateDashboardImageDimensions` from `@bendyline/squisq-video` apply the same rules in your own
UI.

### Cover images

`CoverImageExportModal` captures the document's managed cover (`doc.startBlock`). It takes `theme`,
`coverSlideTemplate`, `defaultWidth` and `defaultHeight` (64–7,680 per side, at most 33 megapixels),
`defaultFileName`, `colorScheme`, `saveOutput`, and `onClose`.

## Export audio

`renderDocumentAudio` mixes every clip a document schedules into one `AudioBuffer`, exactly as MP4
export does, and `createAudioFileEncoder` streams it into an M4A, Opus (WebM), or WAV file. Both come
from `@bendyline/squisq-video-react/encoder`:

```ts
import {
  createAudioFileEncoder,
  renderDocumentAudio,
  supportedAudioFileFormats,
} from '@bendyline/squisq-video-react/encoder';

export async function exportNarration(doc: Doc, container: ContentContainer): Promise<Blob | null> {
  const mix = await renderDocumentAudio(doc, {
    readMedia: (src) => container.readFile(src), // null when missing
  });
  if (!mix) return null; // the document schedules no audio
  const formats = await supportedAudioFileFormats(); // WAV is always available
  const encoder = await createAudioFileEncoder({
    format: formats.includes('m4a') ? 'm4a' : 'wav',
    sampleRate: mix.sampleRate,
    channels: 2,
  });
  await encoder.append([mix.getChannelData(0), mix.getChannelData(1)]);
  return encoder.finish();
}
```

[Narration and audio export](../../narration-and-audio-export.md) covers the details: missing files,
sample rates, resampling, and memory.

## Capture with your own headless browser

`generateRenderHtml(doc, options)` from `@bendyline/squisq-video` returns a self-contained HTML page
that mounts the standalone player in render mode, with images and audio inlined as data URIs. The
CLI captures frames from exactly this page; use it when you drive your own headless browser.

```ts
import { generateRenderHtml, resolveDashboardDimensions } from '@bendyline/squisq-video';
import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';

const { width, height } = resolveDashboardDimensions({ resolution: 'square' });
const html = generateRenderHtml(doc, {
  playerScript: PLAYER_BUNDLE,
  images, // Map<path, ArrayBuffer>
  width,
  height,
  displayMode: 'dashboard',
  dashboard: { layout: 'auto', style: 'panel' },
});
```

| Option                                                    | Default        | Notes                                                         |
| --------------------------------------------------------- | -------------- | ------------------------------------------------------------- |
| `playerScript`                                            | —              | Required: `PLAYER_BUNDLE`.                                    |
| `images`, `audio`                                         | —              | `Map<path, ArrayBuffer>`, inlined as data URIs.               |
| `width`, `height`                                         | 1920 × 1080    | Viewport in CSS pixels.                                       |
| `captionStyle`                                            | none           | `'standard'` or `'social'`.                                   |
| `theme`, `motion`                                         | the document's | Theme and motion-profile overrides.                           |
| `animationsEnabled`, `buildsEnabled`                      | `true`         | `buildsEnabled: false` captures each block's finished build.  |
| `displayMode`                                             | `'slideshow'`  | `'dashboard'` for a single-frame dashboard capture.           |
| `dashboard`                                               | —              | `{ layout, title, style, documentTitle }` for dashboard mode. |
| `videoPresentation`, `pipSize`, `pipShape`, `pipPosition` | the document's | Embedded-video placement.                                     |

The page mounts the player into `#squisq-root`. Get its handle with `SquisqPlayer.getHandle(root)`
and await `handle.renderAPI`, whose `seekTo(time)` resolves once that frame is ready to capture; see
[Standalone player](standalone-player.md). To encode captured PNG frames in a browser,
`framesToMp4Wasm(frames, audio, options)` runs ffmpeg.wasm with the same `ffmpegWasm` requirement.

## Render in Node

The `squisq` command renders from the terminal. It needs Playwright's Chromium for capture, plus a
native FFmpeg for video and GIF (found through the `SQUISQ_FFMPEG` environment variable, then your
`PATH`, then an optional `ffmpeg-static` install). Dashboard images need Chromium only.

```bash
npx playwright install chromium
squisq doctor                                   # what is ready, and how to fix what isn't
squisq video harbor-survey.md                   # → harbor-survey.mp4
squisq video harbor-survey.md --format gif     # → harbor-survey.gif
squisq image harbor-survey.md --resolution 4k --style card
```

See [the CLI guide](../../guide/cli.md) for every flag. From a script, the same renderers are in
`@bendyline/squisq-cli/api`:

```ts
import { readInput, renderDocToDashboardPng, renderDocToMp4 } from '@bendyline/squisq-cli/api';

const { doc, container } = await readInput('talks/harbor-survey.md');

await renderDocToMp4(doc, container, {
  outputPath: 'out/harbor-survey.mp4',
  quality: 'high',
  captionStyle: 'standard',
  onProgress: (phase, percent) => console.error(`${phase} ${percent}%`),
});

const { bytes, width, height } = await renderDocToDashboardPng(
  { ...doc, themeId: 'documentary' },
  container,
  { resolution: '4k', style: 'card', outputPath: 'out/harbor-survey.png' },
);
```

`readInput` reads Markdown, a JSON `Doc`, a `.zip` or `.dbk` container, a folder, or an importable
file such as a `.docx`, and resolves narration and data sidecars. Apply a theme by setting
`themeId` on the doc, as above. One default differs from the command line: `coverPreRoll` is 0 in
the API but 2 seconds in `squisq video`. [CLI API](cli-api.md) documents every function and option,
including `renderDocToGif`,
`renderDocCoverToPng`, frame spooling with `framesDir` and `resume`, and the native frame encoders.

## Pitfalls

- **Odd video dimensions.** MP4 and GIF exports reject an odd `width` or `height` before capturing
  (H.264's `yuv420p` cannot encode them, and GIF export goes through an H.264 intermediate). The
  error names the nearest legal sizes.
- **A missing `ffmpegWasm`.** WebCodecs exports succeed without it, so the gap shows up only on
  browsers that need the fallback, and on every GIF. Configure it from the start.
- **Silent narration.** With the default `audioPolicy: 'require'`, a document whose audio cannot be
  loaded fails to export. Check that the media provider resolves the audio paths; use
  `'best-effort'` only when a silent video is acceptable, and show `audioSkippedReason` when
  `audioIncluded` is false.
- **No isolation headers in production.** Dev servers are easy to configure and production hosts are
  easy to forget. Check `self.crossOriginIsolated` in the deployed app.

## Related

- API reference: [`@bendyline/squisq-video`](../../API.md#bendylinesquisq-video),
  [`@bendyline/squisq-video-react`](../../API.md#bendylinesquisq-video-react),
  [audio export](../../API.md#audio-export), and the
  [CLI programmatic API](../../API.md#programmatic-api)
- [Display modes: video](../../guide/display-modes.md#video) and
  [Dashboards](../../guide/dashboards.md) — what authors see
- [Narration](../../guide/narration.md) — recording the audio that video export mixes in
- [Rendering documents in React](rendering.md) and [Standalone player](standalone-player.md)

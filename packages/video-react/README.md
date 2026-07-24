# @bendyline/squisq-video-react

React components and hooks for exporting Squisq documents to MP4 video or animated GIF directly in the browser. MP4 uses WebCodecs for hardware-accelerated H.264 encoding (with an ffmpeg.wasm worker fallback); GIF uses that compact video as an intermediate for an ffmpeg.wasm global-palette pass. html2canvas provides deterministic frame capture. MP4 carries an **audio** track (narration + timed media); GIF is silent by design.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-video-react)](https://www.npmjs.com/package/@bendyline/squisq-video-react)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq-video-react @bendyline/squisq-video @bendyline/squisq-react @bendyline/squisq
```

**Peer dependencies:** `react` and `react-dom` (v18 or v19).

## Quick Start

### Drop-in Export Button

```tsx
import { VideoExportButton } from '@bendyline/squisq-video-react';

function App() {
  return <VideoExportButton doc={myDoc} images={imageMap} audio={audioMap} />;
}
```

To open directly in the compact GIF preset:

```tsx
<VideoExportButton doc={myDoc} defaultConfig={{ outputFormat: 'gif' }} />
```

Animated GIF export defaults to standard captions when the document has a
caption track. Pass `captionMode: 'off'` in `defaultConfig` to disable them, or
choose None in the export modal. MP4 continues to default to captions off.

**v1.5:** `playerScript` is now **optional** — the browser export captures frames
from a live in-page `DocPlayer`, so the standalone bundle is only needed for
CLI/Playwright-style pipelines. A new `defaultConfig?: Partial<VideoExportConfig>`
prop seeds the modal's initial quality/fps/orientation/caption selections.
Both components also accept `colorScheme="light" | "dark"` so their portaled
modal can match the host application; the default remains `light`. Hosts with
their own theme tokens can pass `uiPalette?: Partial<VideoExportPalette>` to
override dialog surfaces, controls, status colors, and the shared primary color
used by the export action and progress bar. By default the completed action is
labelled **Save MP4/GIF to Downloads** and uses the browser download directory.
Hosts with a native or File System Access picker can provide `saveOutput` and
`saveActionLabel` to offer a **Save … as...** flow instead.

### Full Export Modal

```tsx
import { VideoExportModal } from '@bendyline/squisq-video-react';

function App() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Export Video</button>
      {open && (
        <VideoExportModal
          doc={myDoc}
          images={imageMap}
          audio={audioMap}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
```

## Components

| Component           | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `VideoExportModal`  | Full modal UI — configure MP4/GIF, captions, motion, quality, fps, and orientation |
| `VideoExportButton` | Drop-in button that opens the export modal via portal                              |

## Hooks

| Hook              | Description                                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| `useVideoExport`  | Orchestrates the full export lifecycle — capture, encode, download            |
| `useFrameCapture` | Mounts a hidden DocPlayer and captures frames as ImageBitmaps via html2canvas |

## Export Options

The `VideoExportModal` lets users configure:

- **Format:** MP4 video or animated GIF
- **Quality:** draft, normal, or high
- **FPS:** 10, 15, 24, or 30; MP4 defaults to 30 fps and GIF to 10 fps
- **Orientation:** MP4 defaults to 1920x1080/1080x1920; GIF defaults to 960x540/540x960
- **Captions:** off, standard, or social
- **Animations & transitions:** enabled by default for MP4 and disabled by default for GIF

## Using the Hook Directly

For custom export UIs, use `useVideoExport` directly:

```tsx
import { useVideoExport } from '@bendyline/squisq-video-react';

function CustomExport({ doc, images, audio }) {
  const {
    state, // 'idle' | 'preparing' | 'capturing' | 'encoding' | 'complete' | 'error'
    progress, // 0–100
    outputFormat, // 'mp4' | 'gif'
    backend, // 'webcodecs' | 'ffmpeg-wasm' | null
    elapsed,
    estimatedRemaining,
    downloadUrl,
    outputBlob, // completed Blob for host-provided save flows
    fileSize,
    audioIncluded, // whether an audio track was muxed in
    audioSkippedReason, // null when the doc had no audio; a string explains a shortfall
    error,
    startExport,
    cancel,
    reset,
  } = useVideoExport();

  return (
    <div>
      <button
        onClick={() =>
          startExport(doc, {
            outputFormat: 'gif',
            images,
            animationsEnabled: false,
          })
        }
      >
        Export GIF
      </button>
      {state === 'capturing' && <p>Progress: {progress}%</p>}
      {downloadUrl && (
        <a href={downloadUrl} download={`document.${outputFormat}`}>
          Download
        </a>
      )}
    </div>
  );
}
```

## Browser Requirements

WebCodecs H.264 encoding requires Chrome 94+ or Edge 94+. When WebCodecs H.264
is unavailable, the export automatically falls back to an ffmpeg.wasm worker —
which requires `SharedArrayBuffer` (i.e. Cross-Origin-Isolation headers on the
host page). Animated GIF always performs an ffmpeg.wasm palette pass and therefore
also requires `SharedArrayBuffer`. The packaged class worker is bundler-safe.

Video dimensions must be **even**: an odd `width`/`height` is rejected before
capture starts rather than rounded (H.264's `yuv420p` cannot encode odd
dimensions, and GIF export muxes an H.264 intermediate).

### ffmpeg.wasm runtime assets (required)

`@ffmpeg/core` is pinned as a runtime dependency. Hosts **must** publish its ESM
`ffmpeg-core.js` and `ffmpeg-core.wasm` files from the same origin and pass their
URLs. Every ffmpeg.wasm path — the encoder fallback, the GIF palette pass, and
tier-2 audio muxing — throws an actionable error when `coreURL` is absent:

```ts
const config = {
  ffmpegWasm: {
    // Copy from node_modules/@ffmpeg/core/dist/esm/ during your build.
    coreURL: '/ffmpeg-core/ffmpeg-core.js',
    wasmURL: '/ffmpeg-core/ffmpeg-core.wasm',
    workerURL: '/vendor/ffmpeg-core.worker.js', // for a multithread core
  },
};
```

This is not merely recommended for offline/CSP deployments — it is required.
`@ffmpeg/ffmpeg`'s `load()` otherwise falls back to a hard-coded
`https://unpkg.com/@ffmpeg/core@<version>/…` URL, silently fetching and executing
unpinned third-party code mid-export. Squisq refuses to trigger that fallback; a
GIF export with no `ffmpegWasm` now fails immediately instead of after capturing
every frame. `packages/site/vite.config.ts` + `packages/site/src/ffmpegWasmConfig.ts`
are a complete worked example for Vite (including the GPL notice that must travel
with the core files). To deliberately use a remote core, name that URL as
`coreURL` explicitly.

Use `supportsWebCodecs()` to probe at runtime:

```ts
import {
  supportsWebCodecs,
  supportsWebCodecsH264,
  supportsWebCodecsAac,
} from '@bendyline/squisq-video-react';

if (!supportsWebCodecs()) {
  // ffmpeg.wasm fallback will be used (needs Cross-Origin-Isolation)
}
```

**Audio tiers.** MP4 audio is muxed via WebCodecs AAC when available
(`supportsWebCodecsAac()`), then via ffmpeg.wasm when cross-origin isolation is
available, and otherwise skipped with `audioIncluded: false` plus an
`audioSkippedReason`. Audio problems never fail the export — the video always
completes. GIF skips audio preparation entirely. `supportsWebCodecsH264(config)` probes a specific encoder
configuration; `EncoderConfig` and `FfmpegWasmLoadConfig` are also exported.

## Full API Reference

See [docs/API.md](https://github.com/bendyline/squisq/blob/main/docs/API.md)
for complete prop tables, `VideoExportConfig`, and the encoder utilities.

## Related Packages

| Package                                                                          | Description                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------- |
| [@bendyline/squisq-video](https://www.npmjs.com/package/@bendyline/squisq-video) | Headless video/GIF rendering and WASM helpers     |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)             | Headless core — schemas, templates, markdown      |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react) | React components for rendering docs               |
| [@bendyline/squisq-cli](https://www.npmjs.com/package/@bendyline/squisq-cli)     | CLI for document conversion and MP4/GIF rendering |

## License

Squisq-authored code in this package is
[MIT licensed](https://github.com/bendyline/squisq/blob/main/LICENSE).

The separately distributed `@ffmpeg/core` WebAssembly runtime has an upstream
dependency on FFmpeg and external libraries. The 0.12.9 package declares
GPL-2.0-or-later and is distributed under those terms. This package ships
[`NOTICE.md`](./NOTICE.md) and the complete
[`COPYING.GPL-2.0.txt`](./COPYING.GPL-2.0.txt). Hosts that publish
`ffmpeg-core.js` or `ffmpeg-core.wasm` must publish those materials with the
runtime and preserve equivalent access to the exact corresponding source
identified in the notice.

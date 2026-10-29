---
title: Installation
description: Install the Squisq packages, satisfy their peer dependencies, and set up TypeScript, styles, your bundler, and a Content-Security-Policy.
---

# Installation

Squisq ships as ESM-only npm packages with TypeScript declarations. Install the packages your app
needs (see [Which packages do I need?](index.md#which-packages-do-i-need)), add their stylesheets
once, and — if you use the editor or browser video export — serve a few WebAssembly and worker
assets from your own origin.

## Install

A React viewer needs the core and the React package:

```bash
npm install @bendyline/squisq @bendyline/squisq-react react react-dom
```

The editor brings the React, formats, grid, calc, and video-react packages with it as regular
dependencies. Monaco is a required peer:

```bash
npm install @bendyline/squisq-editor-react @bendyline/squisq @bendyline/squisq-react monaco-editor react react-dom
```

A converter needs only the formats package (it depends on the core):

```bash
npm install @bendyline/squisq-formats
```

The command-line tool installs a `squisq` binary:

```bash
npm install --global @bendyline/squisq-cli
squisq doctor   # reports whether video and image export can run here
```

Every package declares `"engines": { "node": "^22.22.2 || ^24.15.0 || >=26.0.0" }`. That matters
for Node scripts, the CLI, and your build tooling; in the browser the packages need only a modern
ES2020 engine.

### Peer dependencies

| Package                          | Peer                 | Version                | Required?                                                                   |
| -------------------------------- | -------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `@bendyline/squisq-react`        | `react`, `react-dom` | `^18.0.0 \|\| ^19.0.0` | Yes                                                                         |
| `@bendyline/squisq-grid-react`   | `react`, `react-dom` | `^18.0.0 \|\| ^19.0.0` | Yes                                                                         |
| `@bendyline/squisq-video-react`  | `react`, `react-dom` | `^18.0.0 \|\| ^19.0.0` | Yes                                                                         |
| `@bendyline/squisq-editor-react` | `react`, `react-dom` | `^18.0.0 \|\| ^19.0.0` | Yes                                                                         |
| `@bendyline/squisq-editor-react` | `monaco-editor`      | `~0.50.0`              | Yes — loaded lazily, but its types appear in the public API                 |
| `@bendyline/squisq-editor-react` | `harper.js`          | `^2.7.0`               | Optional — only for grammar and spell checking ([proofing](../proofing.md)) |
| `@bendyline/squisq-calc`         | `@ironcalc/wasm`     | `^0.8.4`               | Optional — only for the `/ironcalc` engine                                  |
| `@bendyline/squisq-formats`      | `hyparquet`          | `^1.29.1`              | Optional — only for reading `.parquet` data files                           |

Tiptap is a regular dependency of the editor, not a peer; you don't install it yourself. The
optional peers are reached only through dynamic `import()`, so an app that never enables the
feature never bundles the library.

## ESM and TypeScript

The packages publish `exports` maps with `import` and `types` conditions and no CommonJS build.
Use them from ES modules — a bundler, a `"type": "module"` Node project, or `.mjs` files.
`require()` is not supported.

Any strict TypeScript setup that understands `exports` maps works. For a bundled app:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  }
}
```

For a Node project, use `"module": "nodenext"` and `"moduleResolution": "nodenext"` with
`"type": "module"` in `package.json`. Both setups typecheck the [quick start](quick-start.md)
without `skipLibCheck`.

## Styles

The React components draw with class names and CSS custom properties, so import each package's
stylesheet once, at your app's entry point:

```ts
import '@bendyline/squisq-react/styles'; // DocPlayer, LinearDocView, DashboardView, JsonView
```

The editor's stylesheet covers the editor chrome only. An editor host imports both:

```ts
import '@bendyline/squisq-react/styles';
import '@bendyline/squisq-editor-react/styles';
```

If you mount `DataGrid` yourself, add `@bendyline/squisq-grid-react/styles`. The stylesheets bundle
the Font Awesome icon fonts as sibling `.woff2` files referenced by relative URL, which every
bundler resolves. In development, `DocPlayer` logs a console warning when
`@bendyline/squisq-react/styles` is missing.

To retheme the editor's toolbar, menus, and dialogs to match your app, see
[Editor chrome theming](../theming.md); that palette is separate from document
[themes](concepts/themes.md).

## Subpath imports

Most packages split their surface into subpaths so you import only what you use. The core, for
example, exposes `@bendyline/squisq/markdown`, `/doc`, `/schemas`, `/storage`, `/versions`, and
more; the formats package exposes one subpath per format plus `/registry`.

```ts
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc, buildPreviewDoc } from '@bendyline/squisq/doc';
import type { Doc, Theme } from '@bendyline/squisq/schemas';
import { convert } from '@bendyline/squisq-formats/registry';
```

The root entry of each package re-exports most of its subpaths, so
`import { markdownToDoc } from '@bendyline/squisq'` also works. Prefer the subpaths: the format
registry loads each converter lazily, and a few subpaths are deliberately tiny —
`@bendyline/squisq-formats/outside-in-layout` imports nothing at all. The
[API reference](../API.md) lists every subpath.

## Bundler setup

Plain rendering needs no bundler configuration. The editor, browser video export, and the optional
engines load workers and WebAssembly, and those assets must be served from your origin. The demo
site's [`vite.config.ts`](../../packages/site/vite.config.ts) is the worked example; the pieces are
below.

### Monaco workers

Monaco's language services run in workers your bundler builds. Wire them once, before the editor
mounts — with Vite's `?worker` imports:

```ts
import { configureMonacoWorkers } from '@bendyline/squisq-editor-react/monaco-workers';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

configureMonacoWorkers({
  editor: EditorWorker,
  json: JsonWorker,
  css: CssWorker,
  html: HtmlWorker,
  ts: TsWorker,
});
```

Syntax highlighting and Squisq's own completions work without these workers; the richer
JSON/CSS/HTML/TypeScript services need them.

### Vite options the site uses

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rnnoiseWasmPlugin } from '@bendyline/squisq-video-react/vite';

export default defineConfig({
  plugins: [react(), rnnoiseWasmPlugin()],
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: {
    include: ['monaco-editor/esm/vs/editor/editor.api.js'],
    // These packages spawn workers or load wasm by URL relative to their own files;
    // pre-bundling would break those URLs.
    exclude: ['@bendyline/squisq-video-react', '@bendyline/squisq-calc', '@ironcalc/wasm'],
  },
  // The video encode worker dynamically imports ffmpeg.wasm, which needs ES-module workers.
  worker: { format: 'es', plugins: () => [rnnoiseWasmPlugin()] },
});
```

- **`rnnoiseWasmPlugin()`** (from `@bendyline/squisq-video-react/vite`) emits the RNNoise noise
  suppressor's WebAssembly as one file instead of embedding it twice as base64. Add it to both
  `plugins` and `worker.plugins`. Without it, media edits still work; the bundle is larger. See
  [Media edits](../media-edits.md).
- **`worker.format: 'es'`** is needed because the browser video encoder worker loads ffmpeg.wasm
  with a dynamic `import()`, which Vite's default IIFE worker format cannot split.
- The site also excludes its own workspace packages from pre-bundling and sets
  `build.modulePreload: false` so Monaco's on-demand chunks stay on demand. Those are tuning
  choices for that app, not requirements.

### Self-hosted WebAssembly and workers

| Asset            | Needed for                                    | How the demo site serves it                                                                                                                                                   |
| ---------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ffmpeg.wasm core | Animated GIF export and the MP4 fallback path | Copies `@ffmpeg/core/dist/esm/ffmpeg-core.js` and `ffmpeg-core.wasm` to `/ffmpeg-core/` and passes `ffmpegWasm: { coreURL, wasmURL }` in `VideoExportModal`'s `defaultConfig` |
| harper.js wasm   | Proofing (grammar and spelling)               | Serves `harper_wasm_bg.wasm` and `harper_wasm_slim_bg.wasm` side by side as `application/wasm` and calls `createHarperProofingProvider({ wasmUrl })`                          |
| IronCalc wasm    | The optional IronCalc formula engine          | `import wasmUrl from '@ironcalc/wasm/wasm_bg.wasm?url'`, then `createIronCalcEngine({ ...config, wasmSource: wasmUrl })` inside the editor's `calcEngineFactory`              |
| Calc worker      | Formula editing off the main thread           | `import CalcWorker from '@bendyline/squisq-calc/worker?worker'`, then `createWorkerCalcEngine({ ...config, workerFactory: () => new CalcWorker() })`                          |
| pdfjs worker     | Importing PDF files in the browser            | `import url from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'`, then `configurePdfWorker(url)` from `@bendyline/squisq-formats/pdf` before the first PDF import               |

`pdfjs-dist` is a dependency of the formats package; if your package manager doesn't hoist it
where your app can import it, add it to your own dependencies at the same version.

Squisq never falls back to a CDN for ffmpeg.wasm. Without a `coreURL`, GIF export fails with an
error that explains how to configure one. The host guides cover each feature in depth:
[proofing](../proofing.md), [data and calculation](../data-and-calc.md),
[media edits](../media-edits.md), and [narration and audio export](../narration-and-audio-export.md).

The demo site also serves every page with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` for its ffmpeg.wasm export paths;
`credentialless` rather than `require-corp` so the `blob:` iframes used for frame capture still
load.

## Content-Security-Policy

If your app sets a CSP, start from the demo site's policy in
[`packages/site/index.html`](../../packages/site/index.html):

```text
default-src 'self';
script-src  'self' blob: 'unsafe-inline' 'wasm-unsafe-eval';
style-src   'self' 'unsafe-inline';
img-src     'self' blob: data: https://i.ytimg.com;
media-src   'self' blob:;
font-src    'self' data:;
connect-src 'self' blob: ws://localhost:* http://localhost:*;
worker-src  'self' blob:;
frame-src   'self' blob: data:
            https://www.youtube-nocookie.com https://player.vimeo.com
            https://www.loom.com https://fast.wistia.net;
child-src   'self' blob:;
object-src  'none';
base-uri    'self';
form-action 'self';
```

What each permission is for:

| Directive and source                        | Why                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `script-src 'wasm-unsafe-eval'`             | Compiling WebAssembly: harper.js, RNNoise, ffmpeg.wasm, IronCalc                                                               |
| `worker-src blob:`                          | harper.js and the data grid's column store run in workers created from `blob:` URLs                                            |
| `img-src blob: data:` and `media-src blob:` | `createMediaProviderFromContainer` serves stored images, audio, and video as `blob:` URLs; SVG pictures render as `data:` URLs |
| `img-src https://i.ytimg.com`               | YouTube poster thumbnails for [hosted videos](../guide/media.md#hosted-videos)                                                 |
| `frame-src` provider hosts                  | Hosted-video players: YouTube (privacy-enhanced host), Vimeo, Loom, Wistia                                                     |
| `frame-src blob:`                           | Browser video and image export capture frames from a `blob:` iframe                                                            |
| `connect-src blob:`                         | Media edits `fetch` sources the provider resolved to `blob:` URLs                                                              |

Remove the entries for features you don't use. A viewer with no hosted videos, no recording, and no
editor needs little beyond `'self'` plus `blob:` and `data:` images.

## Running in Node

The core and the formats package run unchanged in Node, so a script can parse, convert, and
validate documents with no browser:

```ts
import { convert } from '@bendyline/squisq-formats/registry';

const result = await convert({ kind: 'markdown', markdown: '# Harbor Survey\n' }, 'docx');
```

Every built-in importer and exporter runs in Node. The two HTML exports (`html` and `htmlzip`)
need the standalone player script, which you pass as
`resolvePlayerScript: () => import('@bendyline/squisq-react/standalone-source').then((m) => m.PLAYER_BUNDLE)`.
See [Formats](concepts/formats.md) and the [Conversion guide](guides/conversion.md).

MP4, GIF, and PNG output from Node goes through the CLI, which drives a headless Chromium through
`playwright-core` and encodes with a native FFmpeg. Run `squisq doctor` to see what is available,
and see [Command line](../guide/cli.md) and the [CLI API guide](guides/cli-api.md).

## Browser support

The libraries target modern evergreen browsers (they are compiled for ES2020). Capture and export
features are detected at runtime and fall back where they can:

- **Video export** encodes with WebCodecs when `VideoEncoder` is available and falls back to
  ffmpeg.wasm otherwise.
- **Audio export** always offers WAV; M4A and Opus depend on the browser's encoders, so probe with
  `supportedAudioFileFormats()` from `@bendyline/squisq-video-react/encoder`. M4A needs WebCodecs'
  AAC encoder, which Linux Chromium lacks.
- **Recording** uses `MediaRecorder` with the browser's native format: WebM in Chromium and
  Firefox, MP4 in Safari. Recording system audio is offered only on desktop Chromium.
- **The teleprompter's floating window** uses Document Picture-in-Picture where it exists, then a
  video picture-in-picture rendition, then a popup window.
- **Video crop** in media edits uses CSS `object-view-box`, which only Chromium supports; other
  browsers show the full frame during playback (exports still crop).

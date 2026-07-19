# @bendyline/squisq-cli

Command-line tool and programmatic API for converting Squisq documents between DOCX, PPTX, PDF, XLSX, CSV, HTML, EPUB, Markdown, and container ZIP — and rendering them to MP4 video or animated GIF. Reads Markdown, binary documents (`.docx`/`.pptx`/`.pdf`/`.xlsx`/`.csv`/`.html`), ZIP/`.dbk` containers, folders, or pre-built Doc JSON as input.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-cli)](https://www.npmjs.com/package/@bendyline/squisq-cli)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install -g @bendyline/squisq-cli
```

For `squisq video` (and `convert` to `mp4` or `gif`) you also need:

- ffmpeg — resolved from the `SQUISQ_FFMPEG` env var, then your `PATH` (`brew install ffmpeg` / `apt install ffmpeg` / `winget install ffmpeg`), then an optionally-installed `ffmpeg-static` package.
- A Playwright-managed Chromium for headless frame capture (e.g. `npx playwright install chromium`)

Run `squisq doctor` to check the video toolchain. Document conversion to non-video formats has no native requirements.

## Commands

### `squisq convert <input>`

Convert a document to one or more formats. Input can be Markdown or a binary document (`.docx`, `.pptx`, `.pdf`, `.xlsx`, `.csv`, `.html`), a `.zip`/`.dbk` container, or a folder. Conversion goes through Squisq's `MarkdownDocument` pivot model and preserves most of the flavor of the document (structure, formatting, tables, images) — it is not a lossless round-trip.

```bash
squisq convert input.md -o report.docx           # single file; format inferred from extension
squisq convert report.docx -o report.md           # binary input → markdown
squisq convert input.md --formats pptx             # single format to the default output dir
squisq convert input.md --formats docx,pptx,pdf    # multiple formats
squisq convert project.dbk --output-dir ./out --formats html,docx
squisq convert input.md --theme cinematic --transform magazine --formats pptx
```

| Option                | Description                                                                                                 | Default       |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------- |
| `-o, --output <file>` | **Single** output file; format inferred from its extension (cannot combine with `--formats`)                | —             |
| `-d, --output-dir`    | Output directory (multi-format mode)                                                                        | same as input |
| `-f, --formats`       | Comma-separated: `docx`, `pptx`, `pdf`, `html`, `htmlzip`, `epub`, `dbk`, `md`, `xlsx`, `csv`, `mp4`, `gif` | default set   |
| `--overwrite`         | Replace existing output files (otherwise the run refuses and exits non-zero)                                | off           |
| `-t, --theme`         | Squisq theme id — built-in or a custom theme inlined in the doc's frontmatter                               | none          |
| `--transform`         | Transform style applied before export (e.g. `documentary`, `magazine`, `minimal`)                           | none          |
| `--no-auto-templates` | Disable content-aware template auto-picking for unannotated headings                                        | (auto on)     |

> **v1.5 breaking flag change:** `-o` is now a **single-file** destination (format inferred from the extension). The old `-o` output-**directory** behavior is now `-d, --output-dir`. A bare `convert <input>` with no `-o`/`--formats` writes a default set that deliberately excludes `md`/`xlsx`/`csv`/`mp4`/`gif`.

Notes:

- **Existing files are never overwritten by default.** A bare `convert report.md` writes several files next to the input; if any already exists the run refuses up front (before converting anything) and exits 1. Pass `--overwrite` to replace them. The flag is `--overwrite`, not `-f`, because `-f` is `--formats`. There is no prompt — this stays scriptable.
- **An unknown `--formats` id is a hard error.** `-f docx,pfd` fails with `Unknown format: "pfd" (did you mean "pdf"?)` and produces nothing, rather than warning and exiting 0 with the PDF silently missing.
- `html` produces a single self-contained file with the standalone player inlined (static mode); `htmlzip` produces a `<name>.html.zip` archive with external assets and optional audio.
- `epub` embeds images from the input container and, when the doc has narration segments, generates EPUB 3 Media Overlays.
- `xlsx` export is tables-only; `csv` export emits the first table; `mp4` and `gif` require the render toolchain (see Install).
- `dbk` re-serializes the input container as a ZIP.

### `squisq video <input> [output]`

Render a document to MP4 or animated GIF. Playwright captures deterministic frames from a headless player page; native ffmpeg encodes H.264 + AAC for MP4 or a generated global palette for GIF. GIF has no audio track.

```bash
squisq video input.md output.mp4
squisq video input.md output.gif
squisq video input.md --format gif --no-animations
squisq video project.dbk --quality high --fps 30
squisq video ./my-folder --orientation portrait --captions social
squisq video input.md -t documentary --transform magazine --cover-preroll 1.5
squisq video doc.json -o out.mp4
```

| Option                             | Description                                                          | Default                   |
| ---------------------------------- | -------------------------------------------------------------------- | ------------------------- |
| `-o, --output`                     | Output `.mp4` or `.gif` path; extension selects the format           | `<input>.mp4`             |
| `--format`                         | `mp4` or `gif`                                                       | inferred, otherwise `mp4` |
| `--fps`                            | Frames per second (MP4 1–120; GIF 1–100)                             | MP4 30; GIF 10            |
| `--quality`                        | MP4-only quality: `draft`, `normal`, or `high`                       | normal                    |
| `--orientation`                    | `landscape` or `portrait`                                            | landscape                 |
| `--captions`                       | `off`, `standard`, or `social`                                       | MP4 off; GIF standard     |
| `--animations` / `--no-animations` | Enable/disable layer animations and block transitions                | MP4 enabled; GIF disabled |
| `--loop`                           | GIF repeat count (`0` forever, `-1` no loop)                         | 0                         |
| `--max-colors`                     | GIF palette size, 2–256                                              | 256                       |
| `--dither`                         | GIF dithering: `bayer`, `sierra2_4a`, or `none`                      | `sierra2_4a`              |
| `--bayer-scale`                    | Ordered Bayer strength, 0–5                                          | 3                         |
| `-t, --theme`                      | Squisq theme id to apply                                             | none                      |
| `--transform`                      | Transform style to apply before rendering                            | none                      |
| `--cover-preroll`                  | Seconds of cover-slide pre-roll before the story starts              | 2                         |
| `--width` / `--height`             | Dimension overrides in pixels — **must be even**                     | MP4 1080p; GIF 960×540    |
| `--overwrite`                      | Replace an existing output file (otherwise refuse and exit non-zero) | off                       |
| `--no-auto-templates`              | Disable content-aware template auto-picking for unannotated headings | (auto on)                 |

Notes:

- **Dimensions must be even.** `--width 851` is rejected immediately — before the document is read or a browser launches — with `Video width must be an even number of pixels (got 851) … Use 850 or 852.` Odd values are rejected rather than rounded, so a render never silently ships at a size you did not ask for. The rule is the same for MP4 and GIF, and matches browser export.
- **An existing output file is never overwritten by default.** The check runs before rendering, so a colliding path costs you a second rather than a full capture. Pass `--overwrite` to replace.
- FFmpeg failures report the one relevant line (e.g. `[libx264] width not divisible by 2 (851x480) (exit code 1)`) rather than dumping the whole command line and stderr buffer.

### `squisq doctor`

Preflight the video toolchain: reports the resolved ffmpeg path, version, and which source it came from (`SQUISQ_FFMPEG` env / `PATH` / `ffmpeg-static`) with an install hint when missing, attempts a headless Chromium launch, and reports the Node version.

```bash
squisq doctor
```

### `squisq validate <input>`

Structurally validate a `.md` file, `.zip`/`.dbk` container, or folder. Reports unknown templates (with did-you-mean), unparsed `{[…]}` annotations, malformed heading attributes, unresolved connections, duplicate ids, bad data fences, and missing asset references — with line numbers.

```bash
squisq validate input.md
squisq validate project.dbk --json
squisq validate ./my-folder --strict
```

| Option     | Description                               |
| ---------- | ----------------------------------------- |
| `--json`   | Emit diagnostics as machine-readable JSON |
| `--strict` | Exit non-zero on warnings too             |

Diagnostics are reported at three severities — `error`, `warning`, and `info` (info is counted and shown separately). Exit codes depend on **errors** only: `0` clean, warnings-only, or info-only; `1` errors (or any warning with `--strict`); `2` input unreadable.

### `squisq transform <input>`

Apply one-time markdown **source** transforms to a `.md` file, in the order given: `unwrap` (remove forced line wrapping so each paragraph is one line — hard breaks kept), `wrap` (hard-wrap paragraph prose at a column width on word boundaries — code, tables, and headings untouched), and `cleanup` (canonical house-style normalization: bullets, emphasis, headings, table padding, spacing; annotations and frontmatter preserved). Not to be confused with the `--transform <style>` slideshow-style flag on `convert`/`video` — this command rewrites the markdown text itself.

The transformed markdown goes to stdout by default (status messages go to stderr, so it pipes cleanly).

```bash
squisq transform doc.md --ops unwrap
squisq transform doc.md --ops unwrap,cleanup > cleaned.md
squisq transform doc.md --ops wrap --width 100 --in-place
squisq transform doc.md --ops cleanup -o cleaned.md
```

| Option         | Description                                                                |
| -------------- | -------------------------------------------------------------------------- |
| `--ops <list>` | Comma-separated transforms, applied in order (`unwrap`, `wrap`, `cleanup`) |
| `--width <n>`  | Column width for `wrap` (20–500, default 80)                               |
| `-o <file>`    | Write the result to a file (refuses to overwrite without `--overwrite`)    |
| `--in-place`   | Rewrite the input file (conflicts with `-o`)                               |
| `--overwrite`  | Allow `-o` to replace an existing file                                     |

Transforms run in strict mode: each one reparses its output and structurally compares it against the input document; if equivalence cannot be proven, the command exits `1` without emitting anything. Exit codes: `0` success, `1` transform/output failure, `2` input unreadable.

## Input Formats

All commands accept:

| Input         | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `.md` file    | Plain Markdown file                                            |
| Binary docs   | `.docx`, `.pptx`, `.pdf`, `.xlsx`, `.csv`, `.html` (`convert`) |
| `.zip`/`.dbk` | Container archive with document + embedded media               |
| Folder        | Directory with a Markdown file and associated media files      |
| `.json` file  | Pre-built Doc JSON (`video` only)                              |

## Programmatic API

Import `@bendyline/squisq-cli/api` to use the same pipeline as a library from Node.js — no shell-out required. Like the CLI, `renderDocToMp4` and `renderDocToGif` require ffmpeg and a Playwright-managed Chromium.

### `convert()`

A pre-bound wrapper over `@bendyline/squisq-formats`' `convert()` that injects the CLI's format registry (every built-in exporter plus the CLI-only `mp4` and `gif` formats) and a default `resolvePlayerScript` (so HTML/player-embedding exports work out of the box). Both are overridable via `options`. `createCliRegistry()` returns that same registry for direct use.

```ts
import { convert, createCliRegistry, ConversionError } from '@bendyline/squisq-cli/api';

const result = await convert({ kind: 'markdown', markdown: '# Hello' }, 'docx');
// result.bytes (Uint8Array), result.mimeType, result.suggestedFilename, result.warnings
```

`ConversionError` (with a stable `code`) and the `ConvertSource` / `ConvertOptions` / `ConversionResult` / `FormatRegistry` types are re-exported for convenience.

### `renderDocToMp4`

```ts
import { renderDocToMp4, readInput } from '@bendyline/squisq-cli/api';
import { markdownToDoc } from '@bendyline/squisq/doc';

// Load a document from disk (.md, .zip/.dbk, folder, or Doc .json)
const input = await readInput('./my-article.md');

// readInput returns { container, markdownDoc, doc? } — doc is only set for
// JSON input, so build the Doc from markdown when needed:
const doc = input.doc ?? markdownToDoc(input.markdownDoc!);

// Render to MP4
const result = await renderDocToMp4(doc, input.container, {
  outputPath: './output.mp4',
  fps: 30, // default 30
  quality: 'high', // 'draft' | 'normal' | 'high' (default 'normal')
  orientation: 'landscape', // 'landscape' | 'portrait' (default 'landscape')
  captionStyle: 'social', // 'off' | 'standard' | 'social' (default 'off')
  animationsEnabled: false, // static slide changes; media/timing remain active
  coverPreRoll: 2, // seconds of cover-slide pre-roll (default 0)
  onProgress: (phase, pct) => console.log(`${phase}: ${pct}%`),
});

console.log(`Rendered ${result.frameCount} frames (${result.duration}s) → ${result.outputPath}`);
```

The container's audio segments become the MP4's audio track; timed media clips and block videos found in the doc are embedded and mixed at their scheduled positions.

### `renderDocToGif`

```ts
import { renderDocToGif } from '@bendyline/squisq-cli/api';

const result = await renderDocToGif(doc, input.container, {
  outputPath: './output.gif',
  fps: 10,
  captionStyle: 'off', // override the default 'standard' captions
  animationsEnabled: false,
  maxColors: 256,
  loop: 0,
});
```

GIF defaults to 960×540 landscape (540×960 portrait), 10 fps, standard
captions, an infinite loop, and disabled slide animations/transitions. Set
`captionStyle: 'off'` to omit captions. Embedded video still advances, but all
audio is omitted and reported through `result.warnings`.

### Native frame encoding

For callers that already have PNG frames and do not need Playwright capture,
the API exposes the native FFmpeg layer directly:

```ts
import { framesToGifNativeBytes, framesToMp4NativeBytes } from '@bendyline/squisq-cli/api';

const mp4 = await framesToMp4NativeBytes('/usr/bin/ffmpeg', pngFrames, audioBytes, {
  fps: 30,
  quality: 'high',
});

const gif = await framesToGifNativeBytes('/usr/bin/ffmpeg', pngFrames, {
  fps: 10,
  width: 960,
  height: 540,
});
```

The path variants write to a caller-supplied output; each `Bytes` variant returns
a `Uint8Array`. MP4 pads short audio with silence so narration cannot truncate
the timeline. GIF uses a compression-friendly diff palette and changed-rectangle
application.

### `extractThumbnails`

Extract JPEG thumbnails from the first frame of a rendered video:

```ts
import { extractThumbnails } from '@bendyline/squisq-cli/api';

await extractThumbnails({
  videoPath: './output.mp4',
  outputDir: './thumbs',
  slug: 'my-article', // filenames: {slug}-{width}x{height}.jpg
  sizes: [
    { name: 'og', width: 1200, height: 630, filter: 'scale=1200:630' },
    { name: 'thumb', width: 480, height: 270, filter: 'scale=480:270' },
  ],
  force: false, // overwrite existing files (default false)
});
```

### Other exports

- `readInput(inputPath)` → `{ container: MemoryContentContainer, markdownDoc: MarkdownDocument | null, doc?: Doc }`
- `MemoryContentContainer` (re-export from `@bendyline/squisq/storage`)
- `VideoQuality`, `VideoOrientation` types (re-exports from `@bendyline/squisq-video`)

See the full [API Reference](https://github.com/bendyline/squisq/blob/main/docs/API.md#bendylinesquisq-cli) for all types and options.

## Related Packages

| Package                                                                              | Description                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)                 | Headless core — schemas, templates, markdown           |
| [@bendyline/squisq-formats](https://www.npmjs.com/package/@bendyline/squisq-formats) | DOCX/PDF/HTML/EPUB/PPTX converters (used by `convert`) |
| [@bendyline/squisq-video](https://www.npmjs.com/package/@bendyline/squisq-video)     | Headless video rendering foundation (used by `video`)  |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)     | React components + standalone player bundle            |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

---
title: CLI programmatic API
description: Call the squisq command's conversion and rendering pipeline — documents, MP4, GIF, and PNG — from your own Node scripts.
---

# CLI programmatic API

`@bendyline/squisq-cli` installs the `squisq` command, and it exports the same pipeline as
functions. Use them when a build script, a server job, or a test needs to read documents, convert
them, or render video and images without spawning a process.

```ts
import { writeFile } from 'node:fs/promises';
import { readInput, convert, renderDocToMp4 } from '@bendyline/squisq-cli/api';

const { doc, container, markdownDoc } = await readInput('launch-review.md');

// A document format, through the same registry as `squisq convert`
const docx = await convert(
  { kind: 'markdown', markdown: markdownDoc!, container, baseName: 'launch-review' },
  'docx',
);
await writeFile(docx.suggestedFilename, docx.bytes);

// A video, rendered like `squisq video`
const video = await renderDocToMp4({ ...doc, themeId: 'bold' }, container, {
  outputPath: 'launch-review.mp4',
  onProgress: (phase, percent) => console.log(`${phase} ${percent}%`),
});
console.log(`${video.frameCount} frames, ${video.duration}s`);
```

The package root, `@bendyline/squisq-cli`, exports the same API.

## Requirements

The API is Node-only: it reads files, launches a headless browser, and runs FFmpeg. It needs
Node 22.22.2 or later on the 22 line, 24.15.0 or later on the 24 line, or 26 and above.

| Function                                                             | Needs                          |
| -------------------------------------------------------------------- | ------------------------------ |
| `readInput`, and `convert` / `prepareConversion` to document formats | Nothing beyond Node            |
| `renderDocToDashboardPng`, `renderDocCoverToPng`, the `png` format   | Playwright Chromium            |
| `renderDocToMp4`, `renderDocToGif`, the `mp4` and `gif` formats      | Playwright Chromium and FFmpeg |
| `extractThumbnails`, the `framesTo…Native` encoders                  | FFmpeg                         |

Install Chromium with `npx playwright install chromium`. FFmpeg is found through the
`SQUISQ_FFMPEG` environment variable, then your `PATH`, then the optional `ffmpeg-static` package.
Run `squisq doctor` to check both.

## Read a document: `readInput`

```ts
readInput(inputPath: string, options?): Promise<ReadInputResult>
```

`readInput` accepts everything the command line does: a Markdown file, a Doc `.json` file, a
`.zip` or `.dbk` container, a folder, or a `.docx`, `.pptx`, `.pdf`, `.xlsx`, `.csv`, `.html`, or
`.htm` file. It returns:

| Field          | Type               | Meaning                                                   |
| -------------- | ------------------ | --------------------------------------------------------- |
| `doc`          | `Doc`              | The document, ready to render                             |
| `container`    | `ContentContainer` | The document plus its media and data files                |
| `markdownDoc`  | `MarkdownDocument` | The parsed Markdown; absent for Doc JSON input            |
| `sourceFormat` | `string`           | A registry format id, or `md`, `json`, `dbk`, or `folder` |

For a bare Markdown file, the container holds only what the document references, a `timing.json`
and per-file `<audio>.timing.json` sidecars if present, and audio files sitting beside it — not the
whole folder. The returned `doc` already has narration timing and data-file previews resolved, the
same way the editor's preview does. A Doc JSON file that doesn't match the schema throws.

| Option         | Default | Effect                                                             |
| -------------- | ------- | ------------------------------------------------------------------ |
| `inferTheme`   | `true`  | Carry a PowerPoint deck's theme into frontmatter                   |
| `inferLayouts` | `true`  | Derive custom templates from a deck's slide layouts                |
| `xlsxRegions`  | `true`  | Split each worksheet into its data islands, one block each         |
| `xlsxFormulas` | `true`  | Add the companion formulas table for regions that contain formulas |
| `signal`       | —       | Cancels reading                                                    |

## Convert: `convert` and `prepareConversion`

```ts
convert(source: ConvertSource, to: string, options?: CliConvertOptions): Promise<ConversionResult>
prepareConversion(source: ConvertSource, options?: CliConvertOptions): Promise<PreparedConversion>
```

These are the formats package's [`convert()` and `prepareConversion()`](conversion.md) with two
defaults filled in: the CLI's registry, which adds `mp4`, `gif`, and `png` to the built-in
formats, and a `resolvePlayerScript` that loads the bundled player, so `html` and `htmlzip` work
without setup. Every other option, source shape, and error behaves as described in
[Converting formats](conversion.md), and you can override either default through `options`.

When `readInput` gave you a `markdownDoc`, pass it as a `markdown` source, as `squisq convert`
does. For video and images, call the render functions below with `doc` instead: `convert()` parses
a `markdown` source again, so the data-file previews `readInput` resolved don't reach the `mp4`,
`gif`, or `png` export.

The extra formats take their settings through `formatOptions`:

```ts
const png = await convert(source, 'png', {
  formatOptions: { png: { resolution: 'square', style: 'card' } },
});
```

| Key   | Options                                                                                                                                                                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mp4` | `fps` (30), `quality` (`'normal'`), `orientation` (`'landscape'`), `width`, `height`, `captionStyle`, `coverPreRoll` (0), `animationsEnabled` (true), `onProgress`                                              |
| `gif` | `fps` (10), `orientation`, `width` (960), `height` (540), `captionStyle`, `coverPreRoll` (0), `animationsEnabled` (false), `loop` (0), `maxColors` (256), `dither` (`'sierra2_4a'`), `bayerScale`, `onProgress` |
| `png` | `resolution` (`'fhd'`), `width`, `height`, `layout`, `style`, `title`, `onProgress`                                                                                                                             |

The `mp4` format doesn't expose the render functions' advanced options (`motion`,
`frameTransport`, `captureFormat`, frame spooling); call `renderDocToMp4` for those.

The default player script is the light player, which can't draw Mermaid diagrams. For HTML exports
of documents with ` ```mermaid ` fences, supply the full player from `@bendyline/squisq-react`
(add it to your project; the render functions choose the full player on their own):

```ts
const html = await convert(source, 'html', {
  resolvePlayerScript: () =>
    import('@bendyline/squisq-react/standalone-source/full').then((m) => m.PLAYER_BUNDLE_FULL),
});
```

`createCliRegistry()` returns the registry `convert` uses — `defaultRegistry()` plus the `mp4`,
`gif`, and `png` formats — if you want to add your own formats to it.

## Render a video: `renderDocToMp4`

```ts
renderDocToMp4(
  doc: Doc,
  container: ContentContainer,
  options: RenderDocToMp4Options,
): Promise<RenderDocToMp4Result>
```

The player renders each frame in headless Chromium, and FFmpeg encodes H.264 video, with the
document's narration and audio clips mixed into an AAC track.

| Option              | Default                          | Effect                                                                           |
| ------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `outputPath`        | required                         | Where to write the MP4                                                           |
| `fps`               | `30`                             | Frames per second                                                                |
| `quality`           | `'normal'`                       | `'draft'`, `'normal'`, or `'high'`                                               |
| `orientation`       | `'landscape'`                    | `'landscape'` (1920×1080) or `'portrait'` (1080×1920)                            |
| `width`, `height`   | from `orientation`               | Explicit pixel size                                                              |
| `captionStyle`      | `'off'`                          | `'off'`, `'standard'`, or `'social'` (a few large words at a time)               |
| `motion`            | the document's, then the theme's | Motion profile: `'calm'`, `'documentary'`, `'vibrant'`, or a profile object      |
| `animationsEnabled` | `true`                           | Layer animations and block transitions                                           |
| `coverPreRoll`      | `0`                              | Seconds of cover slide before the story, when the document has a cover           |
| `frameTransport`    | `'pipe'`                         | `'pipe'` streams frames into FFmpeg; `'memory'` holds them all first             |
| `captureFormat`     | `'png'` for high, else `'jpeg'`  | Still format captured per frame (pipe transport)                                 |
| `framesDir`         | —                                | Keep every captured still in this folder (pipe transport)                        |
| `resume`            | `false`                          | Reuse stills in `framesDir` from an identical earlier render                     |
| `onFrame`           | —                                | Called per frame with `{ index, time, isCover, totalFrames, reused, captureMs }` |
| `onProgress`        | —                                | Called with `(phase, percent)`                                                   |
| `signal`            | —                                | Cancels the render and stops the browser and FFmpeg                              |

It resolves to `{ duration, frameCount, outputPath, reusedFrameCount?, framesDir? }`, where
`duration` includes the pre-roll.

To theme the video, set the theme on the doc you pass: `{ ...doc, themeId: 'documentary' }`.

> [!TIP]
> The `squisq video` command defaults `--cover-preroll` to 2 seconds; this function defaults to 0,
> so you get exactly the duration you ask for.

Keep `'pipe'` unless you depend on the older in-memory behavior: `'memory'` holds every frame
until capture ends and fails with a `CapturedFrameBudgetError` past `MAX_CAPTURED_FRAME_BYTES`
(256 MiB). `framesDir` and `resume` make a long render restartable — a resumed render is
identical to a fresh one, because each frame depends only on its time.

## Render a GIF: `renderDocToGif`

```ts
renderDocToGif(
  doc: Doc,
  container: ContentContainer,
  options: RenderDocToGifOptions,
): Promise<RenderDocToGifResult>
```

Renders the document to an animated GIF with a shared palette tuned for slides. GIF has no audio.

| Option              | Default                             | Effect                                             |
| ------------------- | ----------------------------------- | -------------------------------------------------- |
| `outputPath`        | required                            | Where to write the GIF                             |
| `fps`               | `10`                                | Frames per second, up to 100                       |
| `orientation`       | `'landscape'`                       | Picks the default size                             |
| `width`, `height`   | 960×540 landscape, 540×960 portrait | Explicit pixel size                                |
| `captionStyle`      | `'standard'`                        | `'off'`, `'standard'`, or `'social'`               |
| `motion`            | the document's, then the theme's    | As for MP4                                         |
| `animationsEnabled` | `false`                             | Layer animations and block transitions             |
| `coverPreRoll`      | `0`                                 | Seconds of cover slide before the story            |
| `loop`              | `0`                                 | Repeats; `0` loops forever, `-1` plays once        |
| `maxColors`         | `256`                               | Palette size, 2 to 256                             |
| `dither`            | `'sierra2_4a'`                      | `'sierra2_4a'`, `'bayer'`, or `'none'`             |
| `bayerScale`        | `3`                                 | Bayer strength, 0 to 5, when `dither` is `'bayer'` |
| `onProgress`        | —                                   | Called with `(phase, percent)`                     |
| `signal`            | —                                   | Cancels the render                                 |

The result adds `warnings` to the MP4 result's fields; it notes when the document had audio that
the GIF left out.

## Render images: `renderDocToDashboardPng` and `renderDocCoverToPng`

```ts
renderDocToDashboardPng(doc, container, options?): Promise<RenderDashboardPngResult>
renderDocCoverToPng(doc, container, options?): Promise<RenderCoverPngResult>
```

`renderDocToDashboardPng` captures the document's [dashboard](../../guide/dashboards.md) — every
block on one canvas — as a single PNG. It needs Chromium only, no FFmpeg.

```ts
import { readInput, renderDocToDashboardPng } from '@bendyline/squisq-cli/api';

const { doc, container } = await readInput('launch-review.md');
const image = await renderDocToDashboardPng(doc, container, {
  resolution: 'hd',
  style: 'card',
  outputPath: 'launch-review.png',
});
console.log(image.width, image.height); // 1280 720
```

| Option                 | Default                       | Effect                                                                                             |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `resolution`           | `'fhd'`                       | A preset from `DASHBOARD_RESOLUTIONS`                                                              |
| `width`, `height`      | —                             | Custom size: 64 to 7680 pixels a side, 33 megapixels at most; both together, not with `resolution` |
| `layout`               | the document's, else `'auto'` | A dashboard layout id, or `'auto'` to pick by block count                                          |
| `style`                | the document's setting        | `'basic'`, `'card'`, `'panel'`, or `'accent'`                                                      |
| `title`                | the document's setting        | Show the title band                                                                                |
| `documentTitle`        | —                             | Title to use when the document has none                                                            |
| `outputPath`           | —                             | Also write the file                                                                                |
| `onProgress`, `signal` | —                             | As for the video renderers                                                                         |

| Preset        | Size      |
| ------------- | --------- |
| `hd`          | 1280×720  |
| `fhd`         | 1920×1080 |
| `4k`          | 3840×2160 |
| `square`      | 1080×1080 |
| `square-2k`   | 2160×2160 |
| `portrait`    | 1080×1920 |
| `portrait-4k` | 2160×3840 |
| `standard`    | 1440×1080 |

`renderDocCoverToPng` captures the document's cover slide instead. It takes `width` and `height`
(1920×1080 by default, at least 64 each), `animationsEnabled` (default `false`), `outputPath`,
`onProgress`, and `signal`, and throws when the document has no cover.

Both resolve to `{ bytes, width, height, outputPath? }`; `bytes` is the PNG whether or not you
asked for a file.

## Thumbnails: `extractThumbnails`

```ts
import { mkdir } from 'node:fs/promises';
import { extractThumbnails } from '@bendyline/squisq-cli/api';

await mkdir('thumbs', { recursive: true });
await extractThumbnails({
  videoPath: 'launch-review.mp4',
  outputDir: 'thumbs',
  slug: 'launch-review',
  sizes: [
    { name: 'card', width: 640, height: 360, filter: 'scale=640:360' },
    {
      name: 'social',
      width: 1200,
      height: 630,
      filter: 'scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630',
    },
  ],
});
// thumbs/launch-review-640x360.jpg, thumbs/launch-review-1200x630.jpg
```

Each size becomes `<slug>-<width>x<height>.jpg`, made from the first frame of an MP4 or GIF with
`filter` as the FFmpeg video filter. The output folder must already exist. Existing files are left
alone unless you pass `force: true`, and `signal` cancels.

## Encode frames yourself

If you capture frames another way, the native encoders turn them into files. Each takes the path
to an FFmpeg binary first.

| Function                                                             | Produces                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| `framesToMp4Native(ffmpegPath, frames, audio, outputPath, options?)` | An MP4 file from PNG frames and optional audio bytes |
| `framesToMp4NativeBytes(ffmpegPath, frames, audio, options?)`        | The same MP4 as a `Uint8Array`                       |
| `framesToGifNative(ffmpegPath, frames, outputPath, options?)`        | An animated GIF file                                 |
| `framesToGifNativeBytes(ffmpegPath, frames, options?)`               | The same GIF as a `Uint8Array`                       |

MP4 options are `fps`, `quality`, `orientation`, `width`, `height`, `onProgress`, and `signal`.
GIF options match `renderDocToGif`'s encoding options, with `GIF_EXPORT_DEFAULTS` holding the
defaults. `ffmpegPipeArgs(options)` returns the FFmpeg arguments the streaming MP4 path uses, if you
want to run the encode yourself.

## Other exports

| Export                                                           | What it is                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `MemoryContentContainer`                                         | The in-memory container, re-exported from core               |
| `ConversionError`                                                | The error `convert` throws, with a stable `code`             |
| `DASHBOARD_RESOLUTIONS`, `DEFAULT_DASHBOARD_RESOLUTION`          | The image presets above, and `'fhd'`                         |
| `resolveDashboardDimensions`, `validateDashboardImageDimensions` | Turn a preset or custom size into pixels, or explain why not |
| `CapturedFrameBudgetError`, `MAX_CAPTURED_FRAME_BYTES`           | The in-memory frame limit                                    |

The option and result types are exported too (`RenderDocToMp4Options`, `RenderDashboardPngResult`,
`ReadInputResult`, and so on), along with `VideoQuality`, `VideoOrientation`, `GifDither`, and the
registry types.

## Errors and cancellation

`convert` and `prepareConversion` throw `ConversionError`; see
[Converting formats](conversion.md#errors-and-warnings). The render functions throw ordinary
errors with actionable messages — FFmpeg not found, Chromium not installed, the player failing to
start — and a `RangeError` for impossible sizes or palette settings, before any browser work starts.
Every long-running function takes a `signal`; aborting stops the browser and FFmpeg and rejects with
the signal's reason.

## The `squisq` command

The command line wraps these same functions:

| Command                    | Does                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `squisq convert <input>`   | Converts to DOCX, PPTX, PDF, HTML, EPUB, XLSX, CSV, Markdown, DBK, MP4, GIF, or PNG |
| `squisq video <input>`     | Renders an MP4 or animated GIF                                                      |
| `squisq image <input>`     | Renders the dashboard to a PNG                                                      |
| `squisq validate <input>`  | Reports structural problems in a document                                           |
| `squisq transform <input>` | Rewrites Markdown source: unwrap, wrap, cleanup, condense                           |
| `squisq doctor`            | Checks for FFmpeg and Chromium                                                      |

Every flag is in the [command-line guide](../../guide/cli.md).

## Related

- [Converting formats](conversion.md) — `convert()` in depth
- [Video and images](video-and-images.md) — rendering in the browser instead
- [Node converter sample](../samples/node-converter.md)
- API reference: [`@bendyline/squisq-cli`](../../API.md#bendylinesquisq-cli)

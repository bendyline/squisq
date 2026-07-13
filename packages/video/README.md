# @bendyline/squisq-video

Video and animated-GIF rendering foundation for Squisq documents. Its pure timeline, quality, palette, and render-HTML helpers work in Node.js and browsers; `framesToMp4Wasm` encodes frames in browser runtimes without native dependencies.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-video)](https://www.npmjs.com/package/@bendyline/squisq-video)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq-video
```

## What's Inside

| Export                                                                                                  | Description                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `generateRenderHtml(doc, options)`                                                                      | Self-contained HTML page with embedded media for headless frame capture                                         |
| `framesToMp4Wasm(frames, audio, options)`                                                               | Encode PNG frames (+ optional audio) to MP4 via ffmpeg.wasm                                                     |
| `computeAudioTimeline(doc, coverPreRoll?)`                                                              | Flatten a doc's narration + timed media into absolute-timed audio clips (browser export and CLI mix share this) |
| `bitrateForQuality(quality, width, height)`                                                             | Target H.264 bitrate (`w*h*bitsPerPixel`) — the single source of truth for WebCodecs bitrate                    |
| `ffmpegVideoQualityArgs`, `audioBitrateArg`, `ffmpegAudioMuxArgs`                                       | Shared FFmpeg flags; audio muxing pads short narration so it cannot truncate the video                          |
| `ffmpegGifFilterGraph`, `ffmpegGifOutputArgs`                                                           | Shared global-palette GIF filters and muxer flags used by native and browser exporters                          |
| `QUALITY_PRESETS`, `ORIENTATION_DIMENSIONS`, `resolveDimensions`                                        | Quality/dimension presets and helpers                                                                           |
| `validateVideoExportOptions(options)`                                                                   | Fail-fast runtime validation for FPS, dimensions, quality, and orientation                                      |
| `VideoExportOptions`, `VideoQuality`, `VideoOrientation`, `GifDither`, `QualityPreset`, `EncoderResult` | Shared video and GIF types                                                                                      |
| `fetchFile`                                                                                             | Re-export of `@ffmpeg/util`'s `fetchFile` for preparing audio bytes                                             |

This package is the shared foundation under [@bendyline/squisq-video-react](https://www.npmjs.com/package/@bendyline/squisq-video-react) (in-browser export UI) and [@bendyline/squisq-cli](https://www.npmjs.com/package/@bendyline/squisq-cli) (`squisq video`, which pairs the render HTML with Playwright capture and native ffmpeg encoding).

## Quick Start

### Generate Render HTML

Create a self-contained HTML page that mounts the standalone Squisq player in render mode, with all images and audio embedded as base64 data URIs. A headless browser (Playwright, Puppeteer) obtains the player-specific handle with `SquisqPlayer.getHandle(root)` and uses its render API to step through frames and screenshot each one:

Render methods are deliberately instance-scoped; generated pages do not expose
legacy top-level `window.seekTo` or `window.getDuration` functions.

```ts
import { generateRenderHtml } from '@bendyline/squisq-video';
import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';

const html = generateRenderHtml(doc, {
  playerScript: PLAYER_BUNDLE, // the IIFE player bundle source string
  images, // Map<string, ArrayBuffer> — embedded as data URIs
  audio, // Map<string, ArrayBuffer> — embedded as data URIs
  width: 1920, // default 1920
  height: 1080, // default 1080
  captionStyle: 'standard', // 'standard' | 'social' — omit for no captions
});
```

### Encode Frames to MP4

```ts
import { framesToMp4Wasm } from '@bendyline/squisq-video';

const { data, duration } = await framesToMp4Wasm(
  frames, // Uint8Array[] — PNG frame bytes, in order
  audioBytes, // Uint8Array | null — optional WAV/MP3/AAC track (muxed as AAC)
  {
    fps: 30, // default 30
    quality: 'normal', // 'draft' | 'normal' | 'high' (default 'normal')
    orientation: 'landscape', // 'landscape' | 'portrait' (default 'landscape')
    // width / height override the orientation defaults
    // Optional for offline/CSP-controlled hosting:
    ffmpegWasm: {
      coreURL: '/vendor/ffmpeg-core.js',
      wasmURL: '/vendor/ffmpeg-core.wasm',
    },
    onProgress: (percent, phase) => console.log(`${phase}: ${percent}%`),
  },
);
// data: Uint8Array of MP4 bytes; duration: seconds (frames.length / fps)
```

Encoding is H.264 (`libx264`, `yuv420p`) with optional AAC audio; frames are scaled/padded to the target dimensions preserving aspect ratio. ffmpeg.wasm needs `SharedArrayBuffer`, which normally means serving COOP/COEP headers. `framesToMp4Wasm` is browser-only; Node callers can use `framesToMp4Native` or `framesToMp4NativeBytes` from `@bendyline/squisq-cli/api`.

### Schedule a Doc's Audio

`computeAudioTimeline(doc, coverPreRoll?)` turns a doc's narration segments and timed media clips into a flat list of absolute-timed `AudioTimelineClip`s. It's pure and Node-testable, and is the single source of truth both the browser MP4 export and the CLI mix path use to place audio (so the two never drift). Narration segments are laid sequentially; timed media clips are placed at their absolute positions; every start is shifted by `coverPreRoll` (default 0) to stay in sync with a silent cover pre-roll.

```ts
import { computeAudioTimeline } from '@bendyline/squisq-video';

const clips = computeAudioTimeline(doc, 2); // [{ src, startSec, sourceInSec, durationSec }, …]
```

## Quality Presets

Each `QualityPreset` also carries `bitsPerPixel` (for WebCodecs bitrate
targeting via `bitrateForQuality`) and `audioBitrate` (target AAC bits/sec):

| Preset   | FFmpeg preset | CRF | bits/pixel | AAC bitrate | Use Case               |
| -------- | ------------- | --- | ---------- | ----------- | ---------------------- |
| `draft`  | ultrafast     | 28  | 2          | 96 kbps     | Quick previews         |
| `normal` | medium        | 23  | 4          | 128 kbps    | General-purpose export |
| `high`   | slow          | 18  | 8          | 192 kbps    | Final output           |

## Orientation Dimensions

| Orientation | Width | Height |
| ----------- | ----- | ------ |
| `landscape` | 1920  | 1080   |
| `portrait`  | 1080  | 1920   |

`resolveDimensions(options)` applies these defaults, honoring explicit `width`/`height` overrides.

See the full [API Reference](../../docs/API.md#bendylinesquisq-video) for all types.

## Related Packages

| Package                                                                                      | Description                                     |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)                         | Headless core — schemas, templates, markdown    |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)             | React components + standalone player bundle     |
| [@bendyline/squisq-video-react](https://www.npmjs.com/package/@bendyline/squisq-video-react) | React UI for in-browser video export            |
| [@bendyline/squisq-cli](https://www.npmjs.com/package/@bendyline/squisq-cli)                 | CLI for document conversion and video rendering |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

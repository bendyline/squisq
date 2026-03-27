# @bendyline/squisq-video

Headless video rendering foundation for Squisq documents. Generates self-contained render HTML for frame capture and encodes frames to MP4 via ffmpeg.wasm. Browser-pure — works in Node.js and the browser with no native dependencies.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-video)](https://www.npmjs.com/package/@bendyline/squisq-video)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq-video
```

## What's Inside

| Module          | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| **renderHtml**  | Generate self-contained HTML with embedded media for headless capture  |
| **wasmEncoder** | Encode PNG frames + audio to MP4 using ffmpeg.wasm                     |
| **types**       | Quality presets, orientation dimensions, and shared video export types |

## Quick Start

### Generate Render HTML

Create a self-contained HTML page that mounts a Squisq player with a seekable API — suitable for headless frame capture with Playwright or Puppeteer:

```ts
import { generateRenderHtml } from '@bendyline/squisq-video';

const html = generateRenderHtml({
  doc,
  playerScript, // URL or inline script for squisq-player.global.js
  images, // Map<string, ArrayBuffer> of embedded images
  audio, // Map<string, ArrayBuffer> of audio segments
});

// The rendered page exposes window.seekTo(time) and window.getDuration()
```

### Encode Frames to MP4

```ts
import { framesToMp4Wasm } from '@bendyline/squisq-video';

const mp4Bytes = await framesToMp4Wasm({
  frames, // Uint8Array[] of PNG frame data
  audio, // optional audio ArrayBuffer
  fps: 30,
  width: 1920,
  height: 1080,
  quality: 'normal',
  onProgress: (pct) => console.log(`${pct}% done`),
});
```

## Quality Presets

| Preset   | CRF | Speed     | Use Case               |
| -------- | --- | --------- | ---------------------- |
| `draft`  | 28  | ultrafast | Quick previews         |
| `normal` | 23  | medium    | General-purpose export |
| `high`   | 18  | slow      | Final output           |

## Orientation Dimensions

| Orientation | Width | Height |
| ----------- | ----- | ------ |
| `landscape` | 1920  | 1080   |
| `portrait`  | 1080  | 1920   |

## Related Packages

| Package                                                                                      | Description                                     |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)                         | Headless core — schemas, templates, markdown    |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)             | React components for rendering docs             |
| [@bendyline/squisq-video-react](https://www.npmjs.com/package/@bendyline/squisq-video-react) | React UI for in-browser video export            |
| [@bendyline/squisq-cli](https://www.npmjs.com/package/@bendyline/squisq-cli)                 | CLI for document conversion and video rendering |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

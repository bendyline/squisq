# @bendyline/squisq-video-react

React components and hooks for exporting Squisq documents to MP4 video directly in the browser. Uses WebCodecs for hardware-accelerated H.264 encoding with html2canvas for frame capture.

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

| Component           | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| `VideoExportModal`  | Full modal UI — configure quality/fps/orientation, export, and download |
| `VideoExportButton` | Drop-in button that opens the export modal via portal                   |

## Hooks

| Hook              | Description                                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| `useVideoExport`  | Orchestrates the full export lifecycle — capture, encode, download            |
| `useFrameCapture` | Mounts a hidden DocPlayer and captures frames as ImageBitmaps via html2canvas |

## Export Options

The `VideoExportModal` lets users configure:

- **Quality:** draft, normal, or high
- **FPS:** 15, 24, or 30
- **Orientation:** landscape (1920x1080) or portrait (1080x1920)
- **Captions:** off, standard, or social

## Using the Hook Directly

For custom export UIs, use `useVideoExport` directly:

```tsx
import { useVideoExport } from '@bendyline/squisq-video-react';

function CustomExport({ doc, images, audio }) {
  const {
    state, // 'idle' | 'preparing' | 'capturing' | 'encoding' | 'complete' | 'error'
    progress, // 0–100
    elapsed,
    estimatedRemaining,
    downloadUrl,
    fileSize,
    error,
    startExport,
    cancel,
    reset,
  } = useVideoExport();

  return (
    <div>
      <button onClick={() => startExport({ doc, images, audio, quality: 'normal', fps: 30 })}>
        Export
      </button>
      {state === 'capturing' && <p>Progress: {progress}%</p>}
      {downloadUrl && (
        <a href={downloadUrl} download="video.mp4">
          Download
        </a>
      )}
    </div>
  );
}
```

## Browser Requirements

WebCodecs H.264 encoding requires Chrome 94+ or Edge 94+. Use `supportsWebCodecs()` to check at runtime:

```ts
import { supportsWebCodecs } from '@bendyline/squisq-video-react';

if (!supportsWebCodecs()) {
  // Fall back or show unsupported message
}
```

## Related Packages

| Package                                                                          | Description                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| [@bendyline/squisq-video](https://www.npmjs.com/package/@bendyline/squisq-video) | Headless video rendering and WASM encoding      |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)             | Headless core — schemas, templates, markdown    |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react) | React components for rendering docs             |
| [@bendyline/squisq-cli](https://www.npmjs.com/package/@bendyline/squisq-cli)     | CLI for document conversion and video rendering |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

# @bendyline/squisq-react

React component library for playing, rendering, and interacting with Squisq documents. Includes a full-featured doc player, SVG-based block renderer, media layers, and playback hooks.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-react)](https://www.npmjs.com/package/@bendyline/squisq-react)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq-react @bendyline/squisq
```

**Peer dependencies:** `react` and `react-dom` (v18 or v19).

## Quick Start

```tsx
import { DocPlayer } from '@bendyline/squisq-react';
import '@bendyline/squisq-react/styles';

function App() {
  return <DocPlayer doc={myDoc} />;
}
```

## Components

| Component | Description |
|---|---|
| `DocPlayer` | Main document player with timed playback, audio sync, and controls |
| `LinearDocView` | Scroll-based linear rendering of all blocks |
| `BlockRenderer` | SVG-based renderer for a single block |
| `MarkdownRenderer` | Renders Squisq markdown as a visual document |
| `DocPlayerWithSidebar` | DocPlayer with a sidebar navigation panel |
| `CaptionOverlay` | Timed caption/subtitle overlay |
| `DocProgressBar` | Playback progress indicator |
| `DocControlsOverlay` | Floating playback controls |
| `DocControlsBottom` | Bottom-bar playback controls |
| `DocControlsSidebar` | Sidebar navigation controls |
| `DocControlsSlideshow` | Slideshow-style navigation controls |

## Layers

Blocks are composed of typed layers rendered as SVG:

| Layer | Description |
|---|---|
| `ImageLayer` | Background and foreground images |
| `TextLayer` | Styled text with positioning and animation |
| `ShapeLayer` | SVG shapes (rectangles, circles, lines) |
| `VideoLayer` | Embedded video with playback sync |
| `MapLayer` | Tile-based map rendering |

## Hooks

| Hook | Description |
|---|---|
| `useDocPlayback` | Core playback state machine — timing, block transitions, scripting |
| `useAudioSync` | Synchronizes audio playback with doc timeline |
| `useViewportOrientation` | Tracks viewport orientation for responsive layouts |
| `useMediaProvider` / `useMediaUrl` | Media URL resolution via `MediaContext` |

## Standalone Player

A self-contained global build is available for non-React environments:

```html
<script src="https://unpkg.com/@bendyline/squisq-react/dist/squisq-player.global.js"></script>
<div id="player"></div>
<script>
  SquisqPlayer.render(document.getElementById('player'), { markdown: '# Hello' });
</script>
```

## Styles

Import the animation CSS for block transitions:

```ts
import '@bendyline/squisq-react/styles';
```

## Related Packages

| Package | Description |
|---|---|
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq) | Headless core — schemas, templates, spatial, markdown, storage |
| [@bendyline/squisq-formats](https://www.npmjs.com/package/@bendyline/squisq-formats) | DOCX, PDF, HTML import/export |
| [@bendyline/squisq-editor-react](https://www.npmjs.com/package/@bendyline/squisq-editor-react) | React editor with raw/WYSIWYG/preview modes |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

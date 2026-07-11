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
  return <DocPlayer markdown={'# Hello\n\nWelcome to Squisq.'} />;
}
```

`DocPlayer` accepts **either** raw `markdown` (parsed and converted internally)
**or** a parsed `doc`; if you already have a `Doc`, pass `<DocPlayer doc={doc} />`.
`basePath` is optional (default `'.'`) and is the base URL for resolving relative
media paths. With neither `markdown` nor `doc`, the player renders a themed empty
state rather than crashing.

> **v1.5 breaking changes:** the old `script` prop is now `doc`, and the
> `audioProvider` prop is now `audioController` (its type `AudioProvider` was
> renamed to `AudioController`). `LinearDocView` gained the same `markdown` prop.

## Components

| Component              | Description                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| `DocPlayer`            | Main document player with timed playback, audio sync, and controls  |
| `LinearDocView`        | Scroll-based linear rendering of all blocks                         |
| `BlockRenderer`        | SVG-based renderer for a single block                               |
| `MarkdownRenderer`     | Renders Squisq markdown as a visual document                        |
| `DocPlayerWithSidebar` | DocPlayer with a sidebar navigation panel                           |
| `CaptionOverlay`       | Timed caption/subtitle overlay                                      |
| `DocProgressBar`       | Playback progress indicator                                         |
| `DocControlsOverlay`   | Floating playback controls                                          |
| `DocControlsBottom`    | Bottom-bar playback controls                                        |
| `DocControlsSidebar`   | Sidebar navigation controls                                         |
| `DocControlsSlideshow` | Slideshow-style navigation controls                                 |
| `SocialCaptionOverlay` | Large centered word-by-word (TikTok/Reels-style) captions           |
| `InlineVideoPlayer`    | Native `<video>` wrapper resolving `src`/`poster` via MediaContext  |
| `InlineAudioPlayer`    | Native `<audio>` wrapper resolving `src` via MediaContext           |
| `MediaClipLayer`       | Hidden `<audio>`/`<video>` elements for timed media clips           |
| `JsonView`             | Read-only viewer for JSON values bound to a Squisq-annotated schema |

## Layers

Blocks are composed of typed layers rendered as SVG:

| Layer        | Description                                   |
| ------------ | --------------------------------------------- |
| `ImageLayer` | Background and foreground images              |
| `TextLayer`  | Styled text with positioning and animation    |
| `ShapeLayer` | SVG shapes (rectangles, circles, lines)       |
| `PathLayer`  | Freeform SVG path drawing                     |
| `VideoLayer` | Embedded video with playback sync             |
| `TableLayer` | HTML table embedded via SVG `<foreignObject>` |
| `MapLayer`   | Tile-based map rendering                      |
| `TreeLayer`  | Interactive filesystem/outline tree           |

## Hooks

| Hook                               | Description                                                        |
| ---------------------------------- | ------------------------------------------------------------------ |
| `useDocPlayback`                   | Core playback state machine — timing, block transitions, scripting |
| `useAudioSync`                     | Synchronizes audio playback with doc timeline                      |
| `useMediaSchedule`                 | Resolves which timed media clips are active at the current time    |
| `useViewportOrientation`           | Tracks viewport orientation for responsive layouts                 |
| `useAutoSurface`                   | Live light/dark surface detection via `prefers-color-scheme`       |
| `useMediaProvider` / `useMediaUrl` | Media URL resolution via `MediaContext`                            |

`useDocPlayback` takes configuration as an options object:

```ts
useDocPlayback(doc, currentTime, { viewport, theme, onSeek });
```

## Standalone Player

A self-contained global build is available for non-React environments. It
exposes a `SquisqPlayer` global with `mount`, `getHandle`, `unmount`, and
`version`. `mount` returns an instance handle.

The former `mountStatic()` shortcut was removed; pass `mode: 'static'` to
`mount()`. Render methods are instance-scoped and are no longer copied to
top-level `window.seekTo` / `window.getDuration` properties.

Interactive mount:

```html
<script src="https://unpkg.com/@bendyline/squisq-react/dist/squisq-player.global.js"></script>
<div id="player"></div>
<script>
  // docJson is a Doc (e.g. produced by markdownToDoc and serialized)
  const root = document.getElementById('player');
  const handle = SquisqPlayer.mount(root, docJson, {
    mode: 'slideshow', // or 'static' for a scrollable document view
    basePath: '/',
  });

  // In render mode: const api = await handle.renderAPI;
  // The same handle is available later as SquisqPlayer.getHandle(root).
</script>
```

For headless capture, add `renderMode: true`, then await
`handle.renderAPI` before calling `seekTo()` or reading render metadata.
TypeScript hosts can import `MountOptions` and `SquisqPlayerHandle` from the
package root.

Set `animationsEnabled: false` on `DocPlayer`, `BlockRenderer`, or standalone
`mount()` to render authored layer animations and block transitions as static
content. Embedded video, timed media, captions, audio, and document timing stay
active; this makes the option suitable for compact MP4 and animated-GIF export.

For build-time embedding, `@bendyline/squisq-react/standalone-source` exports
the same bundle as a string constant (`PLAYER_BUNDLE`) — used by
`@bendyline/squisq-formats` and the CLI to produce single-file HTML exports.

## Styles

Import the animation CSS for block transitions:

```ts
import '@bendyline/squisq-react/styles';
```

## Full API Reference

See [docs/API.md](https://github.com/bendyline/squisq/blob/main/docs/API.md)
for the complete prop tables, hook signatures, and types.

## Related Packages

| Package                                                                                        | Description                                                    |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)                           | Headless core — schemas, templates, spatial, markdown, storage |
| [@bendyline/squisq-formats](https://www.npmjs.com/package/@bendyline/squisq-formats)           | DOCX, PDF, HTML import/export                                  |
| [@bendyline/squisq-editor-react](https://www.npmjs.com/package/@bendyline/squisq-editor-react) | React editor with raw/WYSIWYG/preview modes                    |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

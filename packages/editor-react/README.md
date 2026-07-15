# @bendyline/squisq-editor-react

React editor shell for Squisq documents with three integrated views: a Monaco-powered raw Markdown editor, a Tiptap WYSIWYG rich text editor, and a live block preview. Switching between views keeps the document in sync automatically.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-editor-react)](https://www.npmjs.com/package/@bendyline/squisq-editor-react)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq-editor-react @bendyline/squisq @bendyline/squisq-react monaco-editor
```

**Peer dependencies:** `react` and `react-dom` (v18 or v19), plus
`monaco-editor` (>=0.50.0). Monaco is loaded lazily at runtime, but it is a
required peer because the package's public TypeScript declarations expose
Monaco editor types. Tiptap is bundled as a regular dependency — you don't
need to install it yourself.

## Quick Start

```tsx
import { EditorShell } from '@bendyline/squisq-editor-react';
import '@bendyline/squisq-editor-react/styles';

function App() {
  return <EditorShell initialMarkdown="# Hello World" />;
}
```

## Editor Views

| View        | Powered By    | Description                                           |
| ----------- | ------------- | ----------------------------------------------------- |
| **Raw**     | Monaco Editor | Full Markdown source editing with syntax highlighting |
| **WYSIWYG** | Tiptap        | Rich text editing with a formatting toolbar           |
| **Preview** | DocPlayer     | Live rendered block preview with theme selection      |

## Components

| Component                                            | Description                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `EditorShell`                                        | Top-level editor — combines all three views with a view switcher |
| `EditorProvider`                                     | Context provider for editor state management                     |
| `RawEditor` / `WysiwygEditor` / `PreviewPanel`       | The individual views, exported for custom layouts                |
| `JsonEditor`                                         | Editable form for JSON values bound to a Squisq-annotated schema |
| `ImageEditor` / `ImageViewer`                        | Layered raster authoring surface + read-only viewer              |
| `RecorderPanel` / `RecorderButton` / `RecorderModal` | Browser audio/camera/screen recording (MediaRecorder)            |
| `FolderView`                                         | Standalone folder browser surface                                |

Beyond components, the package also exports Tiptap extensions for authored
ASCII diagrams, trees, and timelines. Timeline fences become a shared-scale
rail canvas in WYSIWYG mode: click the line or a keyboard-accessible Add button
to add a point, select any dot to edit its label/callout, and keep multiple
tracks and branches visible. Every safe edit is written back as regenerated,
verified fence text, so Raw Markdown stays the source of truth; visual mutation
pauses if unmodeled source would be lost. The package also exports heading template annotations, the markdown ↔ Tiptap bridge
(`markdownToTiptap` / `tiptapToMarkdown`), drag-and-drop helpers
(`useFileDrop`, `processMediaFiles`), file-kind detection (`resolveFileKind`),
and block-at-a-time / timeline editing primitives (`useBlockNavigator`,
`BlockCardView`, `TimelineTrack`).

## Notable `EditorShell` features

- **Versioning** — pass `allowVersioning` + `workspaceContainer` to auto-save
  snapshots on idle (`versioningAutoSaveIdleMs`, default 5000ms) with pruning
  (`versioningPrunePolicy`, default keep-last-50); a Version History panel
  appears in the toolbar.
- **Recording** — with a `mediaProvider` wired, a record button appears in the
  toolbar (`allowRecording`, default `true`).
- **Presentation mode** — every Use view can fill the Squisq control, open a
  synchronized audience window, or enter browser full screen. Slideshow/video
  playback, Page/Document scrolling, and the Narrate surface remain linked to
  the main view.
- **Panels** — `outline` (heading outline pane) and `inlinePreview` (per-block
  SVG preview gutter, `inlinePreviewWidth` default 320).
- **Code & image modes** — pass `fileName` / `language` to get a Monaco-only
  code editor, or `imageSrc` (+ `imageMode: 'edit'`) for the image surface.
- **Host-triggered Find mode** — control `findMode` and
  `onFindModeChange` (or call `setFindMode` from context) to replace the
  toolbar's editing actions with live search, previous/next navigation, and
  highlighted matches. No Find trigger button is added unless the host supplies
  one.
- **Embedding** — `readOnly`, `placeholder`, `submitOnEnter`, `fullWidth`,
  `thinMargins`, `minHeight`/`maxHeight` auto-grow for chat-composer use, plus
  host-controlled Write typography through `writeCanvasSettings` (`textSize`
  and `lineSpacing`).
- **Color scheme** — pass `colorScheme="light" | "dark"` for the editor chrome
  (**v1.5:** renamed from the old `theme` prop; `RawEditor`'s own `theme` prop is
  now `monacoTheme`).

Also exported (v1.5): `useMonacoLoader` (share the load-once Monaco bootstrap),
and the custom theme / template provider stacks — `CustomThemeProvider` /
`useCustomThemes` / `useDocCustomThemes` and `CustomTemplateProvider` /
`useCustomTemplates` / `useDocCustomTemplates`.

## Context API

Use `useEditorContext()` to access editor state and actions from child
components. The context value is flat — state fields and action methods live
side by side:

```tsx
import { useEditorContext } from '@bendyline/squisq-editor-react';

function MyComponent() {
  const { markdownSource, doc, activeView, setMarkdownSource, setActiveView, setFindMode } =
    useEditorContext();
  // markdownSource: string, doc: Doc | null, activeView: 'raw' | 'wysiwyg' | 'preview'
}
```

## Styles

Import the editor CSS:

```ts
import '@bendyline/squisq-editor-react/styles';
```

## Full API Reference

See [docs/API.md](https://github.com/bendyline/squisq/blob/main/docs/API.md)
for the complete `EditorShellProps` reference, context API, and every exported
component, hook, and helper.

## Related Packages

| Package                                                                              | Description                                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)                 | Headless core — schemas, templates, spatial, markdown, storage |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)     | React components for rendering docs                            |
| [@bendyline/squisq-formats](https://www.npmjs.com/package/@bendyline/squisq-formats) | DOCX, PDF, HTML import/export                                  |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

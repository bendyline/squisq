---
title: Introduction
description: What you can build with the Squisq libraries, what each of the ten packages does, and which ones your app needs.
---

# Build with Squisq

Squisq is the family of open-source TypeScript libraries behind Squiggly Square. It reads ordinary
Markdown — headings, paragraphs, lists, tables, and short `{[template]}` tags — into a typed
document model, and renders that one model as slides, scrolling pages, dashboards, video, and
office files. Everything an author sees in the [editor](../guide/editor.md) is available to your
own app as a package.

## What you can build

- **Viewers.** Drop `DocPlayer` into a React app to present a document as a slideshow or a timed
  video, `LinearDocView` to show it as a scrolling page, or `DashboardView` to put every block on
  one canvas.
- **Editors.** `EditorShell` is the complete editor — a Monaco source view, a Tiptap WYSIWYG view,
  live previews, theme and template pickers, version history, recording, and proofing.
- **Converters.** `convert()` turns Markdown into DOCX, PPTX, PDF, HTML, EPUB, XLSX, or CSV, and
  imports most of those formats back into Markdown. It runs in the browser and in Node.
- **Static sites.** The HTML exporters render one document, or a whole folder of them, to plain
  HTML pages or self-contained player files, optionally placed inside your own page template.
- **Video and image pipelines.** Export MP4, animated GIF, and still images in the browser with
  `@bendyline/squisq-video-react`, or from the terminal and Node scripts with `@bendyline/squisq-cli`.

## The packages

Ten packages are published to npm. All of them are ESM-only TypeScript with type declarations.

| Package                          | What it's for                                                                                                                                       | Depends on                                                                                                                                 | Runs in                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `@bendyline/squisq`              | The headless core: Markdown parsing, the `Doc` model, templates, themes, projections, storage, version history, narration timing                    | `@bendyline/squisq-graph`, the unified/remark Markdown stack                                                                               | Browser and Node                                           |
| `@bendyline/squisq-react`        | React components: `DocPlayer`, `LinearDocView`, `DashboardView`, `BlockRenderer`, `MarkdownRenderer`, layers, hooks, and a standalone player bundle | Core, graph, Mermaid; peers `react` and `react-dom`                                                                                        | Browser                                                    |
| `@bendyline/squisq-formats`      | Format converters and the `convert()` front door; ZIP containers; theme and layout inference from Office files                                      | Core, JSZip, pdf-lib, pdfjs-dist, xmldom; optional peer `hyparquet`                                                                        | Browser and Node                                           |
| `@bendyline/squisq-editor-react` | The editor shell and its parts: source, WYSIWYG, previews, pickers, recorder, teleprompter, proofing, dictation                                     | Core, squisq-react, formats, calc, grid-react, video-react, Tiptap; peers `react`, `react-dom`, `monaco-editor`; optional peer `harper.js` | Browser                                                    |
| `@bendyline/squisq-grid-react`   | A virtualized data grid for large tables, with sorting, filtering, and cell editing                                                                 | Core, TanStack Virtual; peers `react` and `react-dom`                                                                                      | Browser                                                    |
| `@bendyline/squisq-graph`        | Layered graph layout with orthogonal edge routing (used for diagrams)                                                                               | Nothing                                                                                                                                    | Browser and Node                                           |
| `@bendyline/squisq-calc`         | Spreadsheet formula parsing and evaluation behind one engine contract                                                                               | Nothing; optional peer `@ironcalc/wasm`                                                                                                    | Browser and Node                                           |
| `@bendyline/squisq-video`        | Render-page generation, quality presets, and dimension rules shared by every video and image export                                                 | Core, `@ffmpeg/ffmpeg`                                                                                                                     | Browser and Node (its ffmpeg.wasm encoder is browser-only) |
| `@bendyline/squisq-video-react`  | Browser MP4, GIF, cover-image, dashboard-image, and audio export, with React dialogs                                                                | Core, video, squisq-react, ffmpeg.wasm, RNNoise; peers `react` and `react-dom`                                                             | Browser                                                    |
| `@bendyline/squisq-cli`          | The `squisq` command and its programmatic API: convert, video, image, validate, transform, doctor                                                   | Core, formats, video, commander, playwright-core                                                                                           | Node                                                       |

The [API reference](../API.md) lists every subpath and export.

## How the layers fit

```text
                        ┌──────────────────────────────────────────────┐
  your app              │  squisq-editor-react     squisq-video-react  │  React, browser
                        │  squisq-react            squisq-grid-react   │
                        └───────────────┬──────────────────────────────┘
                                        │
                        ┌───────────────┴───────────┐   ┌─────────────┐
                        │  squisq-formats           │   │ squisq-cli  │  Node only
                        │  squisq-video             │   └──────┬──────┘
                        └───────────────┬───────────┘          │
                                        │                      │
                        ┌───────────────┴──────────────────────┴──────┐
                        │  @bendyline/squisq (core)                   │  browser + Node
                        │  squisq-graph            squisq-calc        │  no framework
                        └─────────────────────────────────────────────┘
```

The core is deliberately framework-free and has no Node-specific dependencies: the same code
parses, lays out, and materializes a document in a browser tab, a Web Worker, a Node script, or a
server. Everything visual is data first — a block becomes an array of typed layers before any
React renders it — so the React packages are thin, and exporters such as PPTX reuse exactly the
layers the player draws. Only the CLI needs Node, and only the React packages need a DOM.

## Which packages do I need?

| You want to…                                         | Install                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Show documents as slides, pages, or dashboards       | `@bendyline/squisq` and `@bendyline/squisq-react`                                                                                   |
| Embed the full editor                                | `@bendyline/squisq-editor-react` (it brings the React, formats, grid, calc, and video-react packages with it), plus `monaco-editor` |
| Convert files in a browser or a Node service         | `@bendyline/squisq-formats` (and `@bendyline/squisq-react` if you export single-file HTML)                                          |
| Export MP4, GIF, or images in the browser            | `@bendyline/squisq-video-react`                                                                                                     |
| Convert, render video, or validate from a terminal   | `@bendyline/squisq-cli`                                                                                                             |
| Parse, inspect, or generate documents without any UI | `@bendyline/squisq`                                                                                                                 |
| Lay out a graph or evaluate spreadsheet formulas     | `@bendyline/squisq-graph` or `@bendyline/squisq-calc` on their own                                                                  |

## Where to go next

- [Installation](installation.md) — peer dependencies, TypeScript, styles, bundler and CSP setup.
- [Quick start](quick-start.md) — a slideshow, a page, and a Node converter in a few minutes.
- [Architecture](concepts/architecture.md) and the other concept pages — the pipeline from
  Markdown to every rendition, the [document model](concepts/document-model.md),
  [templates](concepts/templates.md), [projections](concepts/projections.md),
  [themes](concepts/themes.md), [storage](concepts/storage.md), and
  [formats](concepts/formats.md).
- Task guides — [rendering](guides/rendering.md), [the editor](guides/editor.md),
  [conversion](guides/conversion.md), [static sites](guides/static-sites.md), and
  [video and images](guides/video-and-images.md).
- [Sample apps](samples/index.md) — complete projects you can copy.
- [API reference](../API.md) — every package, subpath, and export.

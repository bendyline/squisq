---
title: Sample apps
description: Six small, complete projects you can copy to start a Squisq app in the browser or in Node.
---

# Sample apps

Each sample is a complete project: every file is listed in full, so you can copy them into an empty folder, run `npm install`, and have something working in a few minutes. Pick the one closest to what you are building and grow it from there.

| Sample                                | What it shows                                                                                                                                       | Packages                                                                                            | Runs in                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------- |
| [React viewer](react-viewer.md)       | A Markdown textarea beside a live preview, with a switch between the slideshow, page, and dashboard renditions and a picker for the built-in themes | `squisq`, `squisq-react`                                                                            | Browser (Vite + React)          |
| [No-build player](no-build-player.md) | The standalone player loaded from a CDN by a plain HTML page, plus a one-file HTML export that needs no server at all                               | `squisq`, `squisq-formats`, `squisq-react` (for the Node scripts; the page itself installs nothing) | Browser page, prepared in Node  |
| [Editor app](editor-app.md)           | The full `EditorShell` with Monaco workers, an in-memory workspace for images, saving to localStorage, version history, and DOCX/PDF/HTML export    | `squisq`, `squisq-editor-react`, `squisq-formats`, `squisq-react`, `squisq-video-react`             | Browser (Vite + React)          |
| [Node converter](node-converter.md)   | A script that converts every Markdown file in a folder to DOCX, PPTX, PDF, HTML, or EPUB with `convert()`, reporting failures by error code         | `squisq`, `squisq-formats`, `squisq-react`                                                          | Node                            |
| [Static blog](static-blog.md)         | A blog generator: Markdown posts with frontmatter become pages inside your own HTML template, plus an index page                                    | `squisq`, `squisq-formats`                                                                          | Node                            |
| [Branded deck](branded-deck.md)       | A custom theme built with `compileTheme` from brand colors and fonts, shown in `DocPlayer` and exported to a PowerPoint file in the same theme      | `squisq`, `squisq-react`, `squisq-formats`                                                          | Browser (Vite + React) and Node |

Every package name above is in the `@bendyline` scope: `squisq-react` means `@bendyline/squisq-react`.

## Before you start

- **Node.js** `^22.22.2`, `^24.15.0`, or `26.0.0` and later. That is the `engines` range of every Squisq package; check yours with `node --version`.
- **npm**, which comes with Node. Any package manager works, but the commands on these pages use npm.
- For the browser samples, a current Chrome, Edge, Firefox, or Safari.

## How the samples are written

- Each `package.json` pins exact versions, the ones these pages were tested with: `@bendyline/squisq` 2.13.6, `@bendyline/squisq-react` 2.12.18, `@bendyline/squisq-formats` 2.8.7, `@bendyline/squisq-editor-react` 2.13.11, and `@bendyline/squisq-video-react` 2.5.19, with React 18.3.1, Vite 8.3.4, and TypeScript 5.9.3. Newer releases should work too; if one doesn't, these versions are the known-good starting point.
- The TypeScript samples use `strict` mode and `"moduleResolution": "bundler"`, and every one passes `tsc --noEmit`.
- Node scripts are TypeScript run directly with [tsx](https://tsx.is), so there is no build step. The no-build player's scripts are plain JavaScript modules you run with `node`.
- A label line above each code block gives the file's path inside the project.

## Where to go next

- [Installation](../installation.md) explains which packages you need for what.
- [Rendering documents in React](../guides/rendering.md), [Embedding the editor](../guides/editor.md), [Standalone player](../guides/standalone-player.md), [Converting formats](../guides/conversion.md), and [Static sites](../guides/static-sites.md) cover the APIs these samples use in more depth.
- The [API reference](../../API.md) lists every export.

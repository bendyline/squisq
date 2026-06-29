# Agent Guidelines for Squisq

## Project Overview

Squisq is an open-source monorepo providing reusable libraries for doc/block
rendering and spatial utilities. It is designed to be framework-agnostic at the core, with a React component layer on top. It is also designed to be pure JavaScript that can run in a browser or in NodeJS (**it should have no NodeJS-specific dependencies**)

**npm packages** (7 published + 1 dev-only):

- `@bendyline/squisq` — Headless utilities (schemas, themes, templates, spatial math, markdown, storage, versions, jsonForm, icons, image-edit, transform, recommend)
- `@bendyline/squisq-react` — React component library (DocPlayer, BlockRenderer, layers, hooks, LinearDocView, MarkdownRenderer, JsonView, inline media players, standalone IIFE bundle)
- `@bendyline/squisq-formats` — Document format converters (DOCX, PDF, HTML, EPUB, PPTX export; shared OOXML infrastructure; ContentContainer ZIP serialization)
- `@bendyline/squisq-editor-react` — React editor shell (Monaco raw, Tiptap WYSIWYG, block preview, toolbar, theme/template pickers, version history, image editor, JsonEditor) + browser-based audio/camera/screen recording (MediaRecorder + getUserMedia + getDisplayMedia, persists into a `ContentContainer`)
- `@bendyline/squisq-video` — Browser-pure foundation for MP4 export (render-HTML generator, ffmpeg.wasm encoder, quality presets). Runs in both browser and Node.
- `@bendyline/squisq-video-react` — React components for browser-based video export (WebCodecs primary, ffmpeg.wasm fallback)
- `@bendyline/squisq-cli` — `squisq` bin command for converting markdown documents to DOCX/PDF/HTML/EPUB/PPTX/MP4 from the terminal
- `squisq-site` — Dev/demo site (not published)

## Repository Structure

```
squisq/
  package.json              # npm workspaces root
  tsconfig.base.json        # Shared TS settings (strict mode, ES2020, ESNext modules)
  packages/
    core/                   # @bendyline/squisq
      src/
        schemas/            # Doc, BlockTemplates, Viewport, LayoutStrategy, Theme, themeLibrary,
                            #   themeCompile, themeValidator, colorUtils, fontStacks, Types,
                            #   MediaProvider, ImageEditDoc
        doc/
          templates/        # 23 block templates (title, sectionHeader, statHighlight, quote,
                            #   factCard, twoColumn, dateEvent, imageWithCaption, leftFeature,
                            #   rightFeature, map, fullBleedQuote, list, photoGrid,
                            #   definitionCard, comparisonBar, pullQuote, videoWithCaption,
                            #   videoPullQuote, dataTable, diagram, layout, drawing) +
                            #   coverBlock (start block, not in registry) + accentImage /
                            #   persistentLayers / captionUtils
                            #   shared utilities
          utils/            # animationUtils, themeUtils
          getLayers.ts      # Layer dispatch with persistent layer injection
          markdownToDoc.ts  # Markdown AST → Doc
          docToMarkdown.ts  # Doc → Markdown AST
          audioMapping.ts   # resolveAudioMapping, narration linking
        spatial/            # Haversine distance, Geohash encode/decode
        storage/            # StorageAdapter, Memory + LocalStorage + LocalForage adapters,
                            #   ContentContainer, MemoryContentContainer, ScopedContentContainer,
                            #   createMediaProviderFromContainer
        markdown/           # parseMarkdown, stringifyMarkdown, 30+ AST node types, tree utilities,
                            #   inferDocumentTitle, parseFrontmatter, hast HTML sub-DOM
        timing/             # Narration/reading time estimation
        random/             # SeededRandom (Mulberry32 PRNG)
        generate/           # Content extraction + slideshow generator
        transform/          # Slideshow transform pipeline: block analysis + 5 transform styles
                            #   (dataDriven, documentary, magazine, minimal, narrative)
        versions/           # Document version history (snapshots in .versions/, prune/coalesce,
                            #   DocumentVersionManager)
        jsonForm/           # JSON Form headless logic (hint vocabulary, control picker,
                            #   conditional rules, schema inference)
        imageEdit/          # Layered raster authoring schema + sidecar persistence + version
                            #   history (mirrors versions/ shape over ImageEditDoc JSON)
        icons/              # FontAwesome Free catalog (ICONS) + resolveIcon, suggestIcons
        recommend/          # Block-content profiler + template recommendations
    react/                  # @bendyline/squisq-react
      src/
        layers/             # ImageLayer, TextLayer, ShapeLayer, VideoLayer, MapLayer, TableLayer
        hooks/              # useAudioSync, useDocPlayback, useViewportOrientation, useAutoSurface,
                            #   MediaContext, AudioProvider
        styles/             # doc-animations.css + JsonView styles
        utils/              # animationUtils (re-exports from core), layerUtils, mapTileUtils
        DocPlayer.tsx       # Main player component
        BlockRenderer.tsx   # SVG-based block renderer
        LinearDocView.tsx   # Markdown-based scrolling/printable view
        MarkdownRenderer.tsx # AST-to-React renderer
        CaptionOverlay.tsx
        SocialCaptionOverlay.tsx
        DocProgressBar.tsx
        DocControls*.tsx    # Overlay, Bottom, Sidebar, Slideshow variants
        DocPlayerWithSidebar.tsx
        InlineVideoPlayer.tsx
        InlineAudioPlayer.tsx
        jsonView/           # <JsonView> read-only renderer for JSON values bound to a schema
        standalone-entry.tsx # IIFE bundle entry — used by formats/html and squisq-cli
    formats/                # @bendyline/squisq-formats
      src/
        ooxml/              # Shared OOXML infrastructure (reader, writer, XML utils, namespaces)
        docx/               # DOCX import + export (WordprocessingML)
        pdf/                # PDF import + export (pdf-lib, pdfjs-dist)
        html/               # HTML export — single-file (data URIs) and ZIP (external assets);
                            #   plus plainHtml / plainHtmlBundle / docsHtmlBundle modes
        epub/               # EPUB 3 e-book export
        pptx/               # PPTX export + import (PresentationML; import covers text/lists/tables)
        xlsx/               # XLSX stubs (SpreadsheetML, not yet implemented)
        container/          # ContentContainer ZIP serialization (containerToZip, zipToContainer)
    editor-react/           # @bendyline/squisq-editor-react
      src/
        EditorShell.tsx     # Top-level editor component (layout, keyboard shortcuts, theming)
        EditorContext.tsx   # State management (markdown, parsed doc, mention/link providers,
                            #   versioning hooks, debounced parse pipeline)
        RawEditor.tsx       # Monaco code editor
        WysiwygEditor.tsx   # Tiptap rich text editor
        PreviewPanel.tsx    # Rendered block preview via DocPlayer (thin shell)
        buildPreviewDoc.ts  # Pure logic extracted from PreviewPanel (block flattening + defaults)
        Toolbar.tsx         # Formatting toolbar (bold, italic, headings, lists, tables, icons, etc.)
        PreviewControls.tsx # Preview settings provider + toolbar controls
        ViewMenuPanel.tsx   # View-mode switcher menu
        ViewSwitcher.tsx    # Tab-style mode switcher
        StatusBar.tsx       # Bottom status / stats bar
        TemplatePicker.tsx  # Template selection UI
        ThemePicker.tsx     # Theme selection UI
        ThemeCustomizerPanel.tsx # <JsonEditor> over the theme schema
        DocumentSettingsDialog.tsx # Frontmatter + doc-level settings
        EmojiPicker.tsx     # Emoji insertion (uses emojiData.ts)
        emojiData.ts        # Emoji catalog (pure data)
        LinkDialog.tsx      # Link editor
        OutlinePanel.tsx    # Heading outline / doc structure panel
        MediaBin.tsx        # Asset library panel
        MentionExtension.tsx # @-mention Tiptap extension
        PlainHtmlPreview.tsx # Markdown → static HTML preview (no doc model)
        DropZoneOverlay.tsx # Drag-and-drop file overlay
        VersionHistoryPanel.tsx # Toolbar popover listing snapshots + revert
        InlinePreviewGutter.tsx # Side gutter showing one mini SVG card per templated block (Edit mode)
        ImageEditor.tsx     # Layered raster authoring surface
        ImageViewer.tsx     # Read-only image viewer (sidecar-aware)
        ImageNodeView.tsx   # Tiptap node view for inline images
        RecorderEntry.tsx   # Toolbar slot wiring recorder/RecorderPanel into the editor
        tiptapBridge.ts     # Bidirectional markdown ↔ Tiptap conversion
        TemplateAnnotation.ts # Tiptap extension for heading template annotations
        detectMarkdown.ts   # Heuristic markdown-vs-plaintext detector
        fileKind.ts         # resolveFileKind + language detection (markdown/code/binary)
        useHeadingLayout.ts # Headings → flat outline + active-heading tracking
        useMonacoLoader.ts  # Monaco lazy loader
        hooks/              # useFileDrop (HTML5 drag/drop classification)
        imageEditor/        # ImageEditor sub-panels + useImageEditor + reducer + state types
        jsonEditor/         # <JsonEditor> editable form (text/multiline/richtext, color, slider,
                            #   toggle, chip-bin, card-stack, tabs, …) — uses chooseControl from core
        recorder/           # MediaRecorder UI + helpers (RecorderModal, RecorderButton,
                            #   RecorderPanel, hooks, sources, formats, timingJson)
        diagram/            # React Flow-backed diagram editor extension and command helpers
        tiptap/             # TiptapAudio, TiptapVideo, useResolvedMediaSrc — media node views
        utils/              # collectInlineFontAwesomeCss, dropUtils, normalizeMalformedAssetUrl
    video/                  # @bendyline/squisq-video
      src/
        renderHtml.ts       # Generates standalone player HTML for headless frame capture
        wasmEncoder.ts      # ffmpeg.wasm frame → MP4 encoder
        types.ts            # VideoQuality, QualityPreset, orientation/dimension helpers
    video-react/            # @bendyline/squisq-video-react
      src/
        VideoExportModal.tsx  # Modal dialog for export config + progress
        VideoExportButton.tsx # Drop-in button wrapper
        hooks/              # useVideoExport, useFrameCapture
        workers/            # Web Worker for encoding (WebCodecs primary, ffmpeg.wasm fallback)
        mp4Mux.ts           # mp4-muxer wrapper for WebCodecs path
    cli/                    # @bendyline/squisq-cli
      src/
        index.ts            # `squisq` bin entry point (commander-based)
        commands/           # convert (markdown → DOCX/PDF/HTML/EPUB/PPTX), video (markdown → MP4)
        api.ts              # Programmatic API surface (exported as `@bendyline/squisq-cli/api`)
    site/                   # squisq-site (dev/demo, not published)
      src/
        App.tsx             # Sample picker + view switching
        samples.ts          # Sample documents for testing
```

## Installing Dependencies

**Always install via `npm run install:safe`. Do not use a bare `npm install`.**

```bash
npm run install:safe       # Install all deps + run trusted install scripts (esbuild)
```

`.npmrc` sets `ignore-scripts=true`, so a bare `npm install` will succeed but
**leave esbuild's native binary missing** — the next `npm run build` will fail
with "Cannot find module @esbuild/<platform>".

The reason for this posture: every third-party install / preinstall / postinstall
script is disabled by default. An attacker who compromises a transitive dep
cannot ship a malicious postinstall and have it execute. The only install scripts
that run are the ones in the **explicit allowlist** at
[`scripts/run-install-allowlist.mjs`](scripts/run-install-allowlist.mjs). Today
that allowlist contains exactly one entry — `esbuild`, because tsup needs the
native binary it downloads in its postinstall.

**Adding a package to the allowlist:** read its install script, confirm what it
does matches the package's docs, then add an entry to the `ALLOWLIST` array in
`scripts/run-install-allowlist.mjs` with a one-line `reason` for the next
reviewer.

Dependency versions are pinned exactly (no `^` or `~` ranges) via
`.npmrc`'s `save-exact=true`. PeerDependencies remain explicit ranges (e.g.
`react ^18.0.0 || ^19.0.0`) because libraries need to be flexible about the
versions their consumers bring.

## Build System

- **Build tool:** tsup (esbuild-based, generates ESM + .d.ts)
- **Monorepo:** npm workspaces
- **Output:** `packages/*/dist/`

```bash
npm run install:safe       # Install deps + run allowlisted install scripts (read this section ↑)
npm run build              # Build all packages in dep order: core → formats → react → video
                           #   → video-react → editor → cli → site
npm run build:core         # Build core only
npm run build:formats      # Build formats only
npm run build:react        # Build react only
npm run build:video        # Build video only
npm run build:video-react  # Build video-react only
npm run build:editor       # Build editor-react only
npm run build:cli          # Build cli only
npm test                   # Run vitest unit tests (75 files, 1000+ tests)
npm run test:cli           # Run cli mocha tests
npm run test:published     # Run vitest against published-shape outputs
npm run test:e2e           # Build all + run Playwright E2E tests against Vite preview
npm run test:e2e:built     # Run Playwright E2E tests when dist/ is already current
npm run typecheck          # tsc -b across all packages (no emit)
npm run site               # Build all + start dev site
npm run dev                # Build all + watch all packages + start dev site (Vite, port 5199)
npm run lint               # ESLint
npm run format             # Prettier format
npm run all                # install:safe + build + lint + format:check + typecheck + test +
                           #   test:published + test:cli + test:e2e:built (the full pre-release sweep)
```

For CI / clean reproducible installs, run `npm ci && node scripts/run-install-allowlist.mjs`
(equivalent to `install:safe` but using `npm ci` instead of `npm install`).

## Subpath Exports

`@bendyline/squisq` exposes 16 subpath entries (canonical list — every entry matches a tsup
build entry and a `package.json` export):

- `@bendyline/squisq/schemas` — Type definitions (Doc, BlockTemplates, Viewport, LayoutStrategy, Theme, themeLibrary, themeCompile, themeValidator, colorUtils, fontStacks, Types, MediaProvider, ImageEditDoc)
- `@bendyline/squisq/doc` — Template registry + all 23 templates (`title`, `sectionHeader`, `statHighlight`, `quote`, `factCard`, `twoColumn`, `dateEvent`, `imageWithCaption`, `leftFeature`, `rightFeature`, `map`, `fullBleedQuote`, `list`, `photoGrid`, `definitionCard`, `comparisonBar`, `pullQuote`, `videoWithCaption`, `videoPullQuote`, `dataTable`, `diagram`, `layout`, `drawing`) + animationUtils + themeUtils + markdownToDoc + docToMarkdown + getLayers + resolveAudioMapping
- `@bendyline/squisq/spatial` — Haversine, Geohash utilities
- `@bendyline/squisq/storage` — StorageAdapter, MemoryStorageAdapter, LocalStorageAdapter, LocalForageAdapter, ContentContainer, MemoryContentContainer, ScopedContentContainer, createMediaProviderFromContainer
- `@bendyline/squisq/markdown` — Markdown parsing, stringifying, AST types (MarkdownDocument), tree utilities, frontmatter helpers, HTML sub-DOM
- `@bendyline/squisq/story` — Alias for `@bendyline/squisq/doc` (legacy compatibility)
- `@bendyline/squisq/timing` — Narration/reading time estimation (estimateNarrationTime, estimateReadingTime, countSpokenWords)
- `@bendyline/squisq/random` — SeededRandom PRNG, hashString
- `@bendyline/squisq/generate` — Content extraction (extractContent, stripMarkdown) + slideshow generator (generateSlideshow)
- `@bendyline/squisq/transform` — Slideshow transform pipeline: `applyTransform`, `resolveTransformStyle`, transform-style registry (5 built-in styles: `dataDriven`, `documentary`, `magazine`, `minimal`, `narrative`), block analyzer, doc-image extractor
- `@bendyline/squisq/versions` — Document version history: `DocumentVersionManager` plus `saveVersion` / `listVersions` / `readVersion` / `revertToVersion` / `pruneVersions` / `coalesceVersions`, `PrunePolicy`, `Version` types, sortable-timestamp + path helpers. Snapshots live inside the same `ContentContainer` as the doc at `.versions/<basename>.<timestamp>.md`, so they ride along through ZIP serialization.
- `@bendyline/squisq/jsonForm` — JSON Form headless logic. Exports the `SquisqAnnotatedSchema` / `SquisqHints` / `SquisqWhen` / `ControlKind` types, `chooseControl()` (the dispatcher both `<JsonView>` and `<JsonEditor>` use), `evaluateWhen()` / `resolveFlag()` (conditional visibility / disabled rules), `inferSchema()` (sample → JSON Schema via genson-js), and JSON Pointer helpers (`getByPointer`, `setByPointer`, `resolveRef`).
- `@bendyline/squisq/imageEdit` — Layered raster authoring: `ImageEditDoc` schema re-exports, state helpers (`addLayer`, `removeLayer`, `reorderLayer`, `updateLayer`, `setCanvas`), persistence (`readImageEditDoc`, `writeImageEditDoc`), version operations (`saveImageEditVersion`, `listImageEditVersions`, etc. — parallels `versions/` over JSON state), `ImageEditVersionManager`, and the SVG → raster export.
- `@bendyline/squisq/icons` — FontAwesome Free catalog (`ICONS`, `IconEntry`, `IconFamily`) and lookup helpers (`resolveIcon`, `canonicalIconToken`, `looksLikeIconToken`, `suggestIcons`, `iconGlyph`).
- `@bendyline/squisq/recommend` — Block-content profiler + template recommendations for the editor's block template picker: `profileBlockContents`, `recommendTemplatesForBlock`.

`@bendyline/squisq-react` exports everything from the root plus a standalone IIFE bundle:

- Components: DocPlayer, BlockRenderer, CaptionOverlay, SocialCaptionOverlay, DocProgressBar, DocControlsOverlay/Bottom/Sidebar/Slideshow, DocPlayerWithSidebar, LinearDocView, MarkdownRenderer, InlineVideoPlayer, InlineAudioPlayer, JsonView (read-only viewer for JSON values bound to a Squisq-annotated schema)
- Hooks: useAudioSync, useDocPlayback, useViewportOrientation, useAutoSurface (light/dark surface detection), MediaContext/useMediaProvider/useMediaUrl
- Layers: ImageLayer, TextLayer, ShapeLayer, VideoLayer, MapLayer, TableLayer (HTML table embedded via `<foreignObject>`)
- Styles: `@bendyline/squisq-react/styles` for CSS (covers DocPlayer animations + `<JsonView>`)
- Standalone bundle: `@bendyline/squisq-react/standalone` and `/standalone-source` — IIFE bundle (`PLAYER_BUNDLE`) used by `formats/html` and `cli` to embed a complete player in a single HTML file

`@bendyline/squisq-formats` exposes 9 subpath entries:

- `@bendyline/squisq-formats/docx` — DOCX import/export (markdownDocToDocx, docxToMarkdownDoc, docToDocx, docxToDoc)
- `@bendyline/squisq-formats/ooxml` — Shared OOXML package reader/writer, XML utilities, namespace constants
- `@bendyline/squisq-formats/pdf` — PDF import/export (markdownDocToPdf, pdfToMarkdownDoc, configurePdfWorker)
- `@bendyline/squisq-formats/html` — HTML export: `docToHtml` (single self-contained file with inlined player + data-URI images), `docToHtmlZip` (multi-file ZIP with external assets + optional audio), `collectImagePaths`, `inferMimeType`, plus the `markdownDocToPlainHtml` / `markdownDocsToPlainHtmlBundle` / `markdownDocsToHtmlBundle` static-rendering paths. Needs `PLAYER_BUNDLE` from `@bendyline/squisq-react/standalone-source`.
- `@bendyline/squisq-formats/epub` — EPUB 3 e-book export (markdownDocToEpub, docToEpub)
- `@bendyline/squisq-formats/pptx` — PPTX export (markdownDocToPptx, docToPptx) + import (pptxToMarkdownDoc, pptxToDoc; covers slide text/lists/tables — embedded-image extraction not yet wired)
- `@bendyline/squisq-formats/xlsx` — XLSX stubs (not yet implemented)
- `@bendyline/squisq-formats/container` — ContentContainer ZIP serialization (containerToZip, zipToContainer)

`@bendyline/squisq-editor-react` exports everything from the root (single `.` entry, no subpaths beyond `/styles`):

- Components: EditorShell, RawEditor, WysiwygEditor, PreviewPanel, PlainHtmlPreview, Toolbar, StatusBar, ViewSwitcher, ViewMenuPanel, OutlinePanel, PreviewControls (+ PreviewSettingsProvider + PreviewToolbarControls + usePreviewSettings), VersionHistoryPanel, InlinePreviewGutter, ThemePicker, ThemeCustomizerPanel, TemplatePicker, templateLabel, DocumentSettingsDialog, EmojiPicker (+ EMOJI_CATEGORIES, ALL_EMOJIS, searchEmojis), LinkDialog, MediaBin, ImageEditor, ImageViewer, ImageNodeView, TooltipLayer, DropZoneOverlay, JsonEditor (editable form for JSON values bound to a Squisq-annotated schema; embeds `WysiwygEditor` for `richtext` controls)
- Context: EditorProvider, useEditorContext
- File-kind detection: `resolveFileKind`, `detectLanguageFromFileName` — useful for hosts that want to pre-decide chrome around the editor based on whether a file is markdown or code
- Drag-and-drop: `useFileDrop` (HTML5 drop classification), `classifyFile`, `partitionFiles`, `processMediaFiles`, `processTextFile`, `processTextFiles`
- Bridge: `markdownToTiptap`, `tiptapToMarkdown` (bidirectional conversion in `tiptapBridge.ts`)
- Tiptap extension: `HeadingWithTemplate` (heading-template annotation)
- Diagram editor: `DiagramExtension`, `DiagramCanvas`, `DiagramWidget`, `useDiagramData`, `DiagramCommand`, `DiagramData`, `DiagramRFNode`, `DiagramRFEdge`, and command helpers (`moveNode`, `addConnection`, `removeConnection`, `renameNode`, `addNode`, `removeNode`, `listDiagramChildren`)
- Mention provider: `MentionCandidate`, `MentionProvider` (host wires its directory through `EditorContext`)
- Versioning: pass `allowVersioning` + `container` to `EditorShell` to enable; the toolbar surfaces a `VersionHistoryPanel` and the editor auto-saves snapshots on idle (configurable via `versioningAutoSaveIdleMs`, default 5s; `versioningPrunePolicy` defaults to keep-last-50). Hosts can also call `useEditorContext().versioning.saveVersion()` from their own save pipeline.
- Inline preview gutter: pass `inlinePreview` (and optional `inlinePreviewWidth`, default 320px) to `EditorShell` to render an `InlinePreviewGutter` next to the WYSIWYG surface. The gutter shows one small SVG card per template-annotated block in the document, auto-hides via container query below ~720px, and reuses the same template-resolution path as `LinearDocView`.
- Image editor (in `src/imageEditor/` + `ImageEditor.tsx` + `ImageViewer.tsx`): `useImageEditor`, `imageEditorReducer`, `initialImageEditorState`, `ImageEditorState`, `ImageEditorAction`, `ImageEditorTool`, `CanvasRect`. Pairs with the `<basename>_files/` sidecar convention and `core/imageEdit/`.
- Recorder (in `src/recorder/`): `RecorderModal`, `RecorderButton`, `RecorderPanel` — configure-and-capture dialog plus two trigger affordances (drop-in button and toolbar-shaped popover trigger). Recording is captured via `MediaRecorder` and written to a `MediaProvider`; narration mode also emits a `.timing.json` sidecar so `resolveAudioMapping()` auto-links the recording to a block.
  - Hooks: `useMediaRecorder` (state machine wrapping `MediaRecorder`), `useStreamPreview` (`MediaStream` → `<video>.srcObject`).
  - Source helpers: `requestMicStream`, `requestCameraStream`, `requestScreenStream` (the last one optionally mixes a mic track into the screen capture via `AudioContext`).
  - Format probe: `resolveFormat`, `supportsMediaRecorder` / `supportsUserMedia` / `supportsDisplayMedia`, `buildFilename`.
  - Sidecar builder: `buildTimingJson`, `encodeTimingJson`, `timingPathFor`.
  - Output strategy: browser-native. Chromium/Firefox produce WebM (VP9/Opus or VP8/Opus); Safari produces MP4 (H.264/AAC). No transcoding pass. `audioMapping.ts` was extended so `.webm`/`.mp4` audio under `audio/*` participates in the same auto-mapping pipeline `.mp3` files always did.
  - Editor wiring: `RecorderEntry` (`src/RecorderEntry.tsx`) renders the `RecorderPanel` into the toolbar next to `VersionHistoryPanel`. Reads `useEditorContext()` for `mediaProvider`, `workspaceContainer`, and the markdown insertion helpers. The shell's `allowRecording` prop (default true) gates visibility. (Recorder previously shipped as the standalone `@bendyline/squisq-recorder-react`; folded in to avoid first-publish friction on trusted publishing.)
- Styles: `@bendyline/squisq-editor-react/styles` for CSS

`@bendyline/squisq-video-react` exports everything from the root:

- Components: VideoExportModal, VideoExportButton
- Hooks: useVideoExport, useFrameCapture
- Worker: the encoding worker is built from `src/workers/encode.worker.ts` for internal use by the exported hooks/components; there is no public `/worker` subpath today
- Encoding backends: WebCodecs (preferred, streaming H.264) with ffmpeg.wasm fallback (batched)
- Depends on `@bendyline/squisq-video` for shared types/encoder + `@bendyline/squisq-react` + `mp4-muxer` + `html2canvas`

`@bendyline/squisq-video` (browser-pure, no Node deps) is the underlying foundation:

- `generateRenderHtml(options)` — produces standalone HTML that loads a doc into the player for headless frame capture (used by `cli video`)
- `framesToMp4Wasm(frames, options)` — ffmpeg.wasm encoder for frame sequences → MP4
- Types: `VideoExportOptions`, `VideoQuality`, `VideoOrientation`, `QualityPreset`, `EncoderResult`; helpers `QUALITY_PRESETS`, `ORIENTATION_DIMENSIONS`, `resolveDimensions`

`@bendyline/squisq-cli` ships a `squisq` bin command:

- `squisq convert <input> [--format docx|pdf|html|epub|pptx] [options]` — markdown → format conversion
- `squisq video <input> [options]` — markdown → MP4 via headless render + WASM encode
- Programmatic API at the `@bendyline/squisq-cli/api` subpath for consumers who want to invoke the same conversion pipeline without spawning a process

## Code Style

- TypeScript strict mode
- ESM only (no CJS)
- React packages use `react` imports (consumed via preact/compat in Qualla)
- Core package has zero framework dependencies and no NodeJS-specific dependencies — must run in browser and Node
- Formats package depends on jszip (ZIP archives), pdf-lib, pdfjs-dist, and core's MarkdownDocument as pivot format
- Editor-react depends on @tiptap and monaco-editor as peer dependencies
- Video-react depends on `@bendyline/squisq-video` (browser-pure), `mp4-muxer`, and `html2canvas`
- CLI depends on commander + playwright-core + vite (consumed for the dev-server-as-renderer pattern in `cli video`)
- All block templates are pure functions: `(input, context) => Layer[]`
- Use `catch (err: unknown)` with `instanceof Error` narrowing, never `catch (err: any)`
- Use `isTemplateBlock()` type guard instead of `(block as any).template` patterns
- Discriminated union: `DocBlock = Block | TemplateBlock` — use the guard to narrow
- **No `console.log` in production code** — remove all debug logging before committing. Use `console.warn` for degraded-but-functional scenarios, `console.error` for failures that affect output.
- **Test files should maintain type safety** — use typed test helpers instead of `as any` casts. Provide all required fields in test data.

### Accepted `any` exceptions

Only these boundaries are allowed to use `any` (each is documented with an `eslint-disable` comment at the site):

- **Unified/remark processor chain** in `core/src/markdown/parse.ts` and `core/src/markdown/stringify.ts` — the chained `.use()` builder has no usable static type, so the processor variable is typed `any`.
- **Tiptap editor view internals** in `editor-react/src/WysiwygEditor.tsx` (4 sites) and `MentionExtension.tsx` (2 sites) — Tiptap's `view`, `selection.constructor`, and mention `props` aren't typed in the public API surface squisq uses.
- **ffmpeg.wasm runtime instance** in `video-react/src/workers/encode.worker.ts` (2 sites) — `@ffmpeg/ffmpeg`'s `FFmpeg` instance is loosely typed once instantiated.
- **SVG `xmlns` attribute on `<foreignObject>` children** in `react/src/layers/TableLayer.tsx` (1 site) — React's JSX types don't accept `xmlns` on HTML children even though the runtime requires it for embedded HTML inside SVG to render correctly.

If you need an `any` outside these boundaries, find a different solution. Use `as unknown as X` for genuinely necessary runtime-shape casts (not `as any`).

## Key Design Decisions

- **Templates are pure functions** — no side effects, no state, just data in → layers out
- **SVG-based rendering** — blocks render as SVG foreignObject for resolution independence
- **React, not Preact** — the react package targets standard React; Qualla aliases via preact/compat
- **Subpath exports** — consumers import only what they need via granular entry points
- **No app-specific code** — everything here must be generic and reusable
- **MarkdownDocument as pivot format** — every format converter (DOCX, PDF, HTML, EPUB, PPTX) uses core's markdown AST as the intermediate representation
- **`ContentContainer` + `.versions/` sidecar pattern** — document-like assets that need history use the `.versions/<basename>.<timestamp>.<ext>` convention inside their `ContentContainer`. The markdown doc uses `core/versions/`; image-edit state uses `core/imageEdit/versions/` over the same shape. Both share `PrunePolicy`, `Version`, and `CoalesceOptions` from `versions/types.ts` so hosts can configure pruning once.
- **Editor isolation** — heavy editor dependencies (Monaco, Tiptap) are isolated in editor-react, separate from the lighter react package
- **Standalone player bundle** — `@bendyline/squisq-react/standalone-source` exports `PLAYER_BUNDLE`, an IIFE-wrapped string that boots a complete player into a host page. `formats/html` and `squisq-cli` inline this to produce single-file HTML exports.
- **`<JsonView>` and `<JsonEditor>` share `chooseControl()` from core** — read-only viewer and editable form always agree on what each schema field _is_; only their rendering differs.

## Adding a New Block Template

This is the single most error-prone mechanical change in the codebase. **All seven steps are required** — skipping any one breaks the build, the runtime, or makes the template silently invisible in the editor:

1. Add the input interface `XxxInput extends BaseTemplateBlock` in `core/src/schemas/BlockTemplates.ts`.
2. Add it to the `TemplateBlock` discriminated union in the same file.
3. Create the template function in `core/src/doc/templates/xxxBlock.ts` — a pure `(input, context) => Layer[]`.
4. Import + register in `core/src/doc/templates/index.ts` under its canonical short id (e.g. `xxx: xxxBlock`).
5. Add a `TEMPLATE_METADATA` entry (label + description) in `core/src/doc/templates/metadata.ts` — this is the canonical UI metadata that drives the editor's template picker. **Skipping this fails `templateMetadata.test.ts`** (metadata must stay 1:1 with the registry).
6. Add a matching preview icon to `TEMPLATE_ENTRIES` in `editor-react/src/TemplatePicker.tsx` (same id/order; label + description must equal the core metadata). **Skipping this fails `templatePickerMetadata.test.ts`** — without it the template never shows up in the gallery.
7. Add tests in `core/src/__tests__/templates.test.ts` covering representative inputs.

If the template replaces an older name, add it to `TEMPLATE_ALIASES` in `templates/index.ts` so legacy documents still resolve. After adding, update the template count in this file's "Subpath Exports" → `@bendyline/squisq/doc` line.

## Theme System

The Theme system provides unified visual styling for rendered docs. A `Theme` bundles colors, typography, visual style, and render-style algorithms into a single JSON-serializable object.

**Architecture:**

- `Theme` type in `schemas/Theme.ts` — defines `ThemeColorPalette`, `ThemeTypography`, `ThemeStyle`, `RenderStyle`, and per-theme `colorSchemes`
- `themeLibrary.ts` — 8 built-in themes: documentary, minimalist, bold, morning-light, tech-dark, magazine, cinematic, warm-earth
- `themeUtils.ts` — template-facing helpers: `resolveColorScheme()`, `themedFontSize()`, `getTemplateHint()`, etc.
- `Doc.themeId` — optional pointer to a theme; resolved at render time via `resolveTheme()`
- `createTheme(base, overrides)` — deep-merge utility for customizing a built-in theme

**How templates use themes:**

- Colors: `theme.colors.background`, `theme.colors.text`, `theme.colors.primary`, etc.
- Color schemes: `resolveColorScheme(context, 'blue')` (not `COLOR_SCHEMES[name]`)
- Font scaling: `themedFontSize(basePx, context, isTitle)` respects `theme.typography.fontScale`
- Render hints: `getTemplateHint(context, 'templateName', 'key', fallback)`

**Key rules:**

- Templates access `theme.colors.*` (not `theme.background` directly)
- Color scheme names are strings; each theme defines its own set via `theme.colorSchemes`
- `DEFAULT_THEME` is the documentary theme and ships as the fallback
- `RenderStyle` controls layout overrides, default animations, ambient motion, and per-template hints

## JSON Form System

Squisq ships a friendly editor + viewer for arbitrary JSON values bound to a JSON Schema. The schema author drops a `squisq` key on any node to add UI hints; without hints, sensible defaults pick a control from type/format/enum cardinality. The same dispatcher (`chooseControl()` in core) drives both the read-only `<JsonView>` (in `react`) and the editable `<JsonEditor>` (in `editor-react`), so view and edit modes always agree on what each field _is_.

**Architecture:**

- `core/src/jsonForm/` — types, `chooseControl()`, `evaluateWhen()`, `inferSchema()` (via `genson-js`), JSON Pointer helpers. Zero React deps. Subpath: `@bendyline/squisq/jsonForm`.
- `react/src/jsonView/` — `<JsonView>` read-only viewer; presents data like a polished settings summary.
- `editor-react/src/jsonEditor/` — `<JsonEditor>` editable form; embeds `WysiwygEditor` for `richtext` controls.

**Hint vocabulary** (squisq-native, deliberately not tied to JSON Forms / RJSF):

```ts
{ control?, label?, help?, placeholder?, width?,
  hidden?, disabled?,        // boolean | { field, equals|oneOf|matches|truthy }
  required?, itemLabel?,     // string | { fromField }
  addLabel?, removeLabel?, step?, enumLabels? }
```

**Control kinds:** `text`, `multiline`, `richtext`, `color`, `date`, `time`, `datetime`, `slider`, `stepper`, `segmented`, `radio`, `combobox`, `toggle`, `checkbox`, `card`, `card-stack`, `chip-bin`, `tabs`, `group`.

**Auto-default mapping** (no hints supplied):

- array of object → `card-stack`; array of primitive → `chip-bin`
- string + `format: color|date|time|date-time|markdown|textarea` → matching control
- string + `enum` ≤4 → `segmented`; >4 → `combobox`
- string with `maxLength > 200` → `multiline`; otherwise `text`
- number/integer with both `minimum` and `maximum` → `slider`; otherwise `stepper`
- boolean → `toggle`; object → `group`; oneOf/anyOf → `tabs`

**Theming:** Both components accept `theme?: Theme` + `surface?: SurfaceScheme | 'auto'` and inject scoped `--squisq-json-*` (viewer) / `--squisq-jsonform-*` (editor) CSS custom properties on their root, mirroring the `LinearDocView` pattern. All built-in renderers consume only those tokens — never hard-code colors.

**Validation:** Opt-in via the `validate?: (value, schema) => ValidationError[]` prop on `<JsonEditor>`. No bundled validator — consumers wire their own (recommended: `ajv` + `ajv-formats`).

**Schema inference:** `inferSchema(sample, { additionalSamples? })` from `@bendyline/squisq/jsonForm` produces a JSON Schema from one or more example values via `genson-js`.

## Type Safety Conventions

- **Zero `any` in published production code** (except the unified processor exception above)
- **`isTemplateBlock()` guard** — always use this to narrow `DocBlock` to `TemplateBlock`, never cast with `as any`
- **`SquisqWindow` type** — use `window as SquisqWindow` for render-mode API access, never `window as any`
- **`catch (err: unknown)`** — always narrow with `instanceof Error`, never use `catch (err: any)`
- **`as unknown as X`** — when a cast is truly necessary (e.g., runtime data shapes), use double-cast through `unknown`, not `as any`

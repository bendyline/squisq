<!--
  AGENTS.md is the canonical agent-guidance file. CLAUDE.md is a byte-for-byte
  copy of it (Claude Code reads CLAUDE.md; other agents read AGENTS.md). Edit
  this file, then run `cp AGENTS.md CLAUDE.md`. The `tests/docs-sync.test.ts`
  check fails if the two drift.
-->

# Agent Guidelines for Squisq

## Project Overview

Squisq is an open-source monorepo providing reusable libraries for doc/block
rendering and spatial utilities. It is designed to be framework-agnostic at the core, with a React component layer on top. It is also designed to be pure JavaScript that can run in a browser or in NodeJS (**it should have no NodeJS-specific dependencies**)

**npm packages** (7 published + 1 dev-only):

- `@bendyline/squisq` — Headless utilities (schemas, themes, templates, spatial math, markdown, storage, versions, jsonForm, icons, image-edit, transform, recommend)
- `@bendyline/squisq-react` — React component library (DocPlayer, BlockRenderer, layers, hooks, LinearDocView, MarkdownRenderer, JsonView, inline media players, standalone IIFE bundle)
- `@bendyline/squisq-formats` — Document format converters (DOCX, PDF, HTML, EPUB, PPTX, XLSX, CSV import/export; shared OOXML infrastructure; format registry + `convert()`; ContentContainer ZIP serialization; theme + layout inference from office files via `/infer`)
- `@bendyline/squisq-editor-react` — React editor shell (Monaco raw, Tiptap WYSIWYG, block preview, toolbar, theme/template pickers, version history, image editor, JsonEditor) + browser-based audio/camera/screen recording (MediaRecorder + getUserMedia + getDisplayMedia, persists into a `ContentContainer`)
- `@bendyline/squisq-video` — Browser-pure foundation for MP4 export (render-HTML generator, ffmpeg.wasm encoder, quality presets). Runs in both browser and Node.
- `@bendyline/squisq-video-react` — React components for browser-based video export (WebCodecs primary, ffmpeg.wasm fallback; MP4 export now muxes narration audio)
- `@bendyline/squisq-cli` — `squisq` bin command for converting documents (markdown **or** binary DOCX/PPTX/PDF/XLSX/CSV/HTML inputs) to DOCX/PDF/HTML/EPUB/PPTX/XLSX/CSV/MP4 from the terminal, plus `squisq doctor` (environment readiness) — built on the shared format registry `convert()`
- `squisq-site` — Dev/demo site (not published)

## Git & Version Control (Agent Boundaries)

**All git/version-control management is handled by the user.** Agents must **not**:

- Create pull requests.
- Create new branches.
- Create git worktrees.

Stay on whatever branch the user has checked out and make your changes there.
Do not commit, push, branch, or open PRs unless the user explicitly asks for that
specific action in the current request — and even then, only the action they named.
If a task seems to need a new branch, worktree, or PR, surface that to the user and
let them handle the git operation.

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
          markdownToDoc.ts  # Markdown AST → Doc (content-aware auto templates ON by default:
                            #   unannotated headings with strong signals — table/images/quote/
                            #   list/stat — get matching templates + derived inputs; ephemeral
                            #   via block.autoTemplate so round-trips stay lossless; disable
                            #   with { autoTemplates: false } or frontmatter
                            #   squisq-auto-templates: false, CLI --no-auto-templates)
        templateInputs.ts # deriveTemplateInputs + body extractors (images/list/table/quote)
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
        generate/           # Content extraction (slideshow generator removed in v1.5 → use transform/)
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
        ooxml/              # Shared OOXML infrastructure (reader, writer, XML utils, namespaces,
                            #   readUtils DOM helpers, themeReader for theme1.xml clrScheme/fontScheme)
        docx/               # DOCX import + export (WordprocessingML)
        pdf/                # PDF import + export (pdf-lib, pdfjs-dist)
        html/               # HTML import (htmlToMarkdownDoc) + export — single-file (data URIs)
                            #   and ZIP (external assets); plus plainHtml / plainHtmlBundle /
                            #   docsHtmlBundle modes
        epub/               # EPUB 3 e-book export
        pptx/               # PPTX export + import (PresentationML; import covers text/lists/tables +
                            #   slide-level embedded images via pptxToContainer) + layout inference
                            #   (layouts.ts: slide layouts/masters → built-in template match or
                            #   CustomTemplateDefinition; analyzePptxLayouts / inspectPptxLayouts)
        xlsx/               # XLSX import + export (SpreadsheetML; export is tables-only → ArrayBuffer)
        registry/           # Format registry + convert() front door (FormatDefinition per format id,
                            #   ConversionResult, ConversionError)
        csv/                # CSV import + export (parseCsv, csvToMarkdownDoc, markdownDocToCsv)
        container/          # ContentContainer ZIP serialization (containerToZip, zipToContainer)
        infer/              # Theme inference from file imports: inferThemeFromFile (DOCX/PPTX/XLSX
                            #   theme1.xml → compiled Squisq Theme; PPTX optionally + custom layouts)
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
        commands/           # convert (markdown/binary → DOCX/PDF/HTML/EPUB/PPTX/XLSX/CSV via registry),
                            #   video (markdown → MP4), doctor (environment readiness), validate
        registry.ts         # createCliRegistry — wires the formats registry + CLI-only mp4
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
- `@bendyline/squisq/doc` — Template registry + all 23 templates (`title`, `sectionHeader`, `statHighlight`, `quote`, `factCard`, `twoColumn`, `dateEvent`, `imageWithCaption`, `leftFeature`, `rightFeature`, `map`, `fullBleedQuote`, `list`, `photoGrid`, `definitionCard`, `comparisonBar`, `pullQuote`, `videoWithCaption`, `videoPullQuote`, `dataTable`, `diagram`, `layout`, `drawing`) + animationUtils + themeUtils + markdownToDoc + docToMarkdown + getLayers + resolveAudioMapping + custom-templates frontmatter codec + custom-themes frontmatter codec (`readCustomThemesFromFrontmatter` / `writeCustomThemesToFrontmatter`) + `resolveThemeForDoc` (pure doc-scoped theme resolution) + template-param tooling (`TEMPLATE_INPUT_DESCRIPTORS`, `coerceTemplateParams`, `lintTemplateParams`) + `replaceDataFence` (data-fence rewriter)
- `@bendyline/squisq/spatial` — Haversine, Geohash utilities
- `@bendyline/squisq/storage` — StorageAdapter, MemoryStorageAdapter, LocalStorageAdapter, LocalForageAdapter, ContentContainer, MemoryContentContainer, ScopedContentContainer, createMediaProviderFromContainer
- `@bendyline/squisq/markdown` — Markdown parsing, stringifying, AST types (MarkdownDocument), tree utilities, frontmatter helpers, HTML sub-DOM
- `@bendyline/squisq/story` — Alias for `@bendyline/squisq/doc` (legacy compatibility)
- `@bendyline/squisq/timing` — Narration/reading time estimation (estimateNarrationTime, estimateReadingTime, countSpokenWords)
- `@bendyline/squisq/random` — SeededRandom PRNG, hashString
- `@bendyline/squisq/generate` — Content extraction only (`extractContent`, `stripMarkdown`, `mapElementToBlock`). The legacy `generateSlideshow` was **removed** in v1.5 — use `markdownToDoc` + `applyTransform` instead. `extractContent`/`stripMarkdown` output shapes are a frozen external contract (Qualla's story pipeline calls them directly).
- `@bendyline/squisq/transform` — Slideshow transform pipeline: `applyTransform`, `resolveTransformStyle`, `registerTransformStyle`/`unregisterTransformStyle`, transform-style registry (5 built-in styles: `data-driven` [alias `dataDriven`], `documentary`, `magazine`, `minimal`, `narrative`), block analyzer, doc-image extractor. Style contract v2: `templateMap` (per-style extraction→template remap, translated via `translateTemplateBlock`), `suggestedThemeId` (applied when neither caller nor doc declares a theme), `pacing` (intro/outro bookends), `budget.slidesPerMinute` (duration-based promotion cap).
- `@bendyline/squisq/versions` — Document version history: `DocumentVersionManager` plus `saveVersion` / `listVersions` / `readVersion` / `revertToVersion` / `pruneVersions` / `coalesceVersions`, `PrunePolicy`, `Version` types, sortable-timestamp + path helpers. Snapshots live inside the same `ContentContainer` as the doc at `.versions/<basename>.<timestamp>.md`, so they ride along through ZIP serialization. Saving history also maintains a container-root `.gitignore` rule for `.versions/`, which keeps snapshots out of Git when the container is persisted as a `*_files/` sidecar folder.
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

`@bendyline/squisq-formats` exposes 10 subpath entries:

- `@bendyline/squisq-formats/docx` — DOCX import/export (markdownDocToDocx, docxToMarkdownDoc, docToDocx, docxToDoc)
- `@bendyline/squisq-formats/ooxml` — Shared OOXML package reader/writer, XML utilities, namespace constants, shared DOM-read helpers (`attrNS`, `resolveTarget`, `baseDirOf`, `findRelByType`), and the theme reader (`parseThemeXml`, `readThemePart` — `theme1.xml` clrScheme/fontScheme with sysClr fallbacks)
- `@bendyline/squisq-formats/pdf` — PDF import/export (markdownDocToPdf, pdfToMarkdownDoc, configurePdfWorker)
- `@bendyline/squisq-formats/html` — HTML export: `docToHtml` (single self-contained file with inlined player + data-URI images), `docToHtmlZip` (multi-file ZIP with external assets + optional audio), `collectImagePaths`, `inferMimeType`, plus the `markdownDocToPlainHtml` / `markdownDocsToPlainHtmlBundle` / `markdownDocsToHtmlBundle` static-rendering paths and HTML import (`htmlToMarkdown`, `htmlToMarkdownDoc`, `htmlToMarkdownDocSync`). Export needs `PLAYER_BUNDLE` from `@bendyline/squisq-react/standalone-source`.
- `@bendyline/squisq-formats/epub` — EPUB 3 e-book export (markdownDocToEpub, docToEpub)
- `@bendyline/squisq-formats/pptx` — PPTX export (markdownDocToPptx, docToPptx) + import (pptxToMarkdownDoc, pptxToDoc; covers slide text/lists/tables + slide-level embedded images via `pptxToContainer`). Import infers the deck's theme and slide layouts **by default** (`inferTheme` / `inferLayouts` options, pass `false` to opt out): the theme rides as `squisq-custom-themes` + `squisq-theme` frontmatter, slide headings get `{[template]}` annotations matched to built-ins (title, sectionHeader, twoColumn, leftFeature/rightFeature, imageWithCaption, photoGrid), and distinctive layouts become `squisq-custom-templates` definitions. Layout inference is also exposed directly: `analyzePptxLayouts(pkg, opts)` and `inspectPptxLayouts(bytes, opts)` (per-layout verdict summaries for UI confirmation).
- `@bendyline/squisq-formats/xlsx` — XLSX import (xlsxToMarkdownDoc, xlsxToDoc) + export (markdownDocToXlsx, docToXlsx — tables-only, one worksheet per markdown table; both return `Promise<ArrayBuffer>`)
- `@bendyline/squisq-formats/csv` — CSV import/export (parseCsv, csvToMarkdownDoc, csvToDoc, markdownDocToCsv)
- `@bendyline/squisq-formats/container` — ContentContainer ZIP serialization (containerToZip, zipToContainer)
- `@bendyline/squisq-formats/registry` — Format registry + programmatic `convert()` front door: `convert(source, targetFormatId, opts?)`, `createRegistry` / `defaultRegistry` / `defaultFormats`, `FormatRegistry` / `FormatDefinition` / `ConversionResult` / `ConvertSource` types, `BUILTIN_FORMAT_IDS`, and structured `ConversionError` (+ `ConversionErrorCode`). PPTX import inference threads through `ConvertOptions.formatOptions.pptx.{inferTheme,inferLayouts}` (default on; `false` disables)
- `@bendyline/squisq-formats/infer` — "Infer theme from a file import": `inferThemeFromFile(bytes, { format?, inferLayouts?, nameHint? })` sniffs DOCX/PPTX/XLSX, reads the OOXML theme part, and returns `{ theme, extraction, layouts?, warnings }` — a compiled, validated Squisq `Theme` (seeds from clrScheme via the master `clrMap`, so dark decks invert correctly; fonts via core `matchFontFamily`) plus, for PPTX with `inferLayouts`, `CustomTemplateDefinition`s from distinctive slide layouts. PDF is rejected (`unsupported-input` — no theme tables). Also exports the per-format extractors (`extractDocxTheme` / `extractPptxTheme` / `extractXlsxTheme`), `compileExtractedTheme`, and `colorHintsFromExtraction`

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
- Audio: MP4 export muxes narration audio (WebCodecs path); the result reports `VideoExportResult.audioIncluded` / `audioSkippedReason`. `useVideoExport().startExport(doc, config)` takes the doc first. `playerScript` is optional on `VideoExportButton` / `VideoExportModal` (falls back to the bundled standalone player).
- Depends on `@bendyline/squisq-video` for shared types/encoder + `@bendyline/squisq-react` + `mp4-muxer` + `html2canvas`

`@bendyline/squisq-video` (browser-pure, no Node deps) is the underlying foundation:

- `generateRenderHtml(options)` — produces standalone HTML that loads a doc into the player for headless frame capture (used by `cli video`)
- `framesToMp4Wasm(frames, options)` — ffmpeg.wasm encoder for frame sequences → MP4
- Types: `VideoExportOptions`, `VideoQuality`, `VideoOrientation`, `QualityPreset`, `EncoderResult`; helpers `QUALITY_PRESETS`, `ORIENTATION_DIMENSIONS`, `resolveDimensions`

`@bendyline/squisq-cli` ships a `squisq` bin command:

- `squisq convert <input> [--format docx|pdf|html|epub|pptx|xlsx|csv] [options]` — converts any supported input (markdown/JSON Doc/`.zip`/`.dbk`/folder **or** an importable binary `.docx`/`.pptx`/`.pdf`/`.xlsx`/`.csv`/`.html`) via the shared registry `convert()`. **`-o, --output <file>` is a single output file (format inferred from extension); `-d, --output-dir <dir>` is the multi-file/output-directory flag** (the old `-o`-as-directory behavior moved to `-d`). PPTX inputs infer the deck's theme + slide layouts **by default** (theme/custom-template frontmatter + heading annotations in the converted output); opt out with `--no-infer-theme` / `--no-infer-layouts`. An explicit `--theme <id>` still wins over an inferred theme.
- `squisq video <input> [options]` — markdown → MP4 via headless render + WASM encode
- `squisq doctor` — reports environment/runtime readiness for the conversion + video pipelines
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
- **`ContentContainer` + `.versions/` sidecar pattern** — document-like assets that need history use the `.versions/<basename>.<timestamp>.<ext>` convention inside their `ContentContainer`. The markdown doc uses `core/versions/`; image-edit state uses `core/imageEdit/versions/` over the same shape. Both maintain `.versions/` in the container-root `.gitignore`, preserving existing rules, and share `PrunePolicy`, `Version`, and `CoalesceOptions` from `versions/types.ts` so hosts can configure pruning once.
- **Editor isolation** — heavy editor dependencies (Monaco, Tiptap) are isolated in editor-react, separate from the lighter react package
- **Standalone player bundle** — `@bendyline/squisq-react/standalone-source` exports `PLAYER_BUNDLE`, an IIFE-wrapped string that boots a complete player into a host page. `formats/html` and `squisq-cli` inline this to produce single-file HTML exports.
- **`<JsonView>` and `<JsonEditor>` share `chooseControl()` from core** — read-only viewer and editable form always agree on what each schema field _is_; only their rendering differs.

## Adding a New Block Template

This is the single most error-prone mechanical change in the codebase. **All eight steps are required** — skipping any one breaks the build, the runtime, or makes the template silently invisible in the editor:

1. Add the input interface `XxxInput extends BaseTemplateBlock` in `core/src/schemas/BlockTemplates.ts`.
2. Add it to the `TemplateBlock` discriminated union in the same file.
3. Create the template function in `core/src/doc/templates/xxxBlock.ts` — a pure `(input, context) => Layer[]`.
4. Import + register in `core/src/doc/templates/index.ts` under its canonical short id (e.g. `xxx: xxxBlock`).
5. Add a `TEMPLATE_METADATA` entry (label + description) in `core/src/doc/templates/metadata.ts` — this is the canonical UI metadata that drives the editor's template picker. **Skipping this fails `templateMetadata.test.ts`** (metadata must stay 1:1 with the registry).
6. Add a matching preview icon to `TEMPLATE_ENTRIES` in `editor-react/src/TemplatePicker.tsx` (same id/order; label + description must equal the core metadata). **Skipping this fails `templatePickerMetadata.test.ts`** — without it the template never shows up in the gallery.
7. Add tests in `core/src/__tests__/templates.test.ts` covering representative inputs.
8. Add input descriptors for the template's `{[…]}` params in `core/src/doc/templates/inputDescriptors.ts` — a `TEMPLATE_INPUT_DESCRIPTORS[<id>]` entry listing each param key (with `coerce` kind, closed-enum `values`, and `required` flags). This is what makes inline attribute coercion (`{[xxx key=value]}` → typed input) and param linting (`lintTemplateParams`) cover the new template. Without it the template still renders, but its annotation params stay untyped strings and are exempt from lint.

If the template replaces an older name, add it to `TEMPLATE_ALIASES` in `templates/index.ts` so legacy documents still resolve. After adding, update the template count in this file's "Subpath Exports" → `@bendyline/squisq/doc` line.

## Theme System

The Theme system provides unified visual styling for rendered docs. A `Theme` bundles colors, typography, visual style, and render-style algorithms into a single JSON-serializable object.

**Architecture:**

- `Theme` type in `schemas/Theme.ts` — defines `ThemeColorPalette`, `ThemeTypography`, `ThemeStyle`, `RenderStyle`, and per-theme `colorSchemes`
- `themeLibrary.ts` — 11 built-in themes: standard (the default, `DEFAULT_THEME_ID`), standard-dark, documentary, minimalist, bold, morning-light, tech-dark, magazine, cinematic, warm-earth, gezellig (JSON files in `schemas/themes/`)
- `themeUtils.ts` — template-facing helpers: `resolveColorScheme()`, `themedFontSize()`, `getTemplateHint()`, etc.
- `Doc.themeId` — optional pointer to a theme; resolved at render time via `resolveTheme()`
- `createTheme(base, overrides)` — deep-merge utility for customizing a built-in theme
- `compileTheme(partial, { base?, contrast? })` — fills a partial/seed theme into a full validated Theme, inheriting from a chosen `base` built-in (render style / color schemes / typography / persistentLayers) when given, else the neutral `STARTER_THEME`; records `basedOn`. `colorSchemes` is replaced wholesale when the partial supplies it.
- `resolveThemeForDoc(doc, id?)` (`doc/resolveDocTheme.ts`) — **pure, doc-scoped** theme resolution: resolves an id against the doc's own `customThemes` first, then built-ins. The theme analog of `buildRegistry` for custom templates; used by the editor preview and every export path so inline custom themes resolve without any global `registerTheme`.

**How templates use themes:**

- Colors: `theme.colors.background`, `theme.colors.text`, `theme.colors.primary`, etc.
- Color schemes: `resolveColorScheme(context, 'blue')` (not `COLOR_SCHEMES[name]`)
- Font scaling: `themedFontSize(basePx, context, isTitle)` respects `theme.typography` scales
- Surfaces/scrims: `themedSurfaceGradient(context)` / `themedScrim(context)` — never hard-code dark gradient endpoints or black scrims (they break light/warm themes)
- Shadows: `shouldUseShadow(context)` (never hard-code `shadow: true` on plain surfaces)
- Entrances: `animation: themedEntrance(context, 'text', { type: 'fadeIn', duration: 2 })` lets the theme's `renderStyle.defaultTextAnimation` override the entrance _type_ while keeping template timing
- Image grades: `themedImageTreatment(context, input.imageTreatment)` → `ImageLayer.content.treatment` (mono/duotone/warm/cool CSS-filter grades; block-level `imageTreatment: 'none'` opts out)
- Render hints: `getTemplateHint(context, 'templateName', 'key', fallback)` — consumed today by `statHighlight`/`fullBleedQuote` (`entrance: 'dramatic'|'subtle'`) and `title` (`showAccentLine`)

**Theme motion (renderStyle is live at render time):**

- `applyRenderStyleToLayers()` (`doc/utils/applyRenderStyle.ts`) runs on template-generated layers in `expandDocBlocks` and `getLayers`: scales animation durations by `style.animationSpeed`, and — when `renderStyle.ambientMotion` is true — gives full-bleed cover imagery with no authored animation a deterministic gentle Ken Burns (seeded from block+layer id). Explicit animations (including `{ type: 'none' }`) always win; raw authored `block.layers` are never restyled.
- `resolveBlockTransition(block, theme, blockIndex)` fills `renderStyle.defaultTransition` on blocks with no authored transition (never block 0).
- `theme.persistentLayers` renders: docs with their own persistent layers win **wholesale** (`resolvePersistentLayers`); docs without any inherit the theme's atmosphere. Atmosphere layer kinds: `patternBackground` (dots/grid/diagonal as SVG patterns; `noise` = static feTurbulence film grain), `vignette`, `ambientGradient` (slow drift), plus the original solid/gradient/image kinds (`imageBackground.blur` now works).
- `renderStyle.layoutOverrides` merges onto the orientation LayoutHints in `createTemplateContext`.
- Reduced motion: `doc-animations.css` freezes ambient loops under `prefers-reduced-motion` (player only; exports are unaffected).

**Key rules:**

- Templates access `theme.colors.*` (not `theme.background` directly)
- Color scheme names are strings; each theme defines its own set via `theme.colorSchemes`
- `DEFAULT_THEME` is the standard theme and ships as the fallback; the two `standard` themes are deliberately motion-conservative (`ambientMotion: false`)
- `RenderStyle` controls layout overrides, default animations/transitions, ambient motion, and per-template hints — all consumed at render time (see above)

**Custom themes (in-document, parallel to custom layouts):**

Users author their own themes in the editor (ThemePicker → "＋ Create custom theme"). A custom theme is a full `Theme` stored **in the document's frontmatter** under `squisq-custom-themes` (codec: `doc/customThemesFrontmatter.ts`) and surfaced as `Doc.customThemes: Theme[]` — the exact theme analog of `squisq-custom-templates` / `Doc.customTemplates`. Exactly one is active at a time via the `squisq-theme` selector (the doc-level counterpart of a block's `{[name]}` annotation). The editor mirrors the custom-templates lifecycle file-for-file in `editor-react/src/customThemes/`: a browser-local library (`customThemeLibrary.ts`, key `squisq:custom-theme-library`), a dual-catalog `CustomThemeContext` (doc + library, `applyTheme` copies library→doc for self-sufficiency), a `useDocCustomThemes` hook, and the `CustomThemeDialog` designer (base-theme picker + seed colors + N accents→`colorSchemes` + fonts + style presets, `saveTarget: 'doc' | 'library'`). The shared draft model + form rows live in `customThemes/themeDraft.ts` + `themeControls.tsx` (also used by the lighter `ThemeCustomizerPanel` popover). Both surfaces include an **"Import from file" section** (`customThemes/ImportThemeSection.tsx`): upload or drop a `.docx`/`.pptx`/`.xlsx` and its theme colors/fonts populate the draft via `@bendyline/squisq-formats/infer` (lazy-loaded) + `draftPatchFromImportedTheme`; in the `CustomThemeDialog`, a PPTX also yields inferred slide-layout custom templates that ride the save as `onSave(theme, target, extras)` and land in `squisq-custom-templates` in the **same** frontmatter write as the theme (single-write rule — see `PreviewControls.handleDesignerSave`). Resolution stays doc-scoped via `resolveThemeForDoc` — no global registry on the critical path.

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

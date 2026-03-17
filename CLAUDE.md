# Claude Code Guidelines for Squisq

## Project Overview

Squisq is an open-source monorepo providing reusable libraries for doc/block
rendering and spatial utilities. It is designed to be framework-agnostic at the core, with a React component layer on top. It is also designed to be pure JavaScript that can run in a browser or in NodeJS (**it should have no NodeJS-specific dependencies**)

**npm packages:**

- `@bendyline/squisq` — Headless utilities (schemas, templates, spatial math, markdown, storage)
- `@bendyline/squisq-react` — React component library (doc player, block renderer, controls)
- `@bendyline/squisq-formats` — Document format converters (DOCX, PDF, OOXML infrastructure)
- `@bendyline/squisq-editor-react` — React editor shell (Monaco raw, Tiptap WYSIWYG, block preview)

## Repository Structure

```
squisq/
  package.json              # npm workspaces root
  tsconfig.base.json        # Shared TS settings
  packages/
    core/                   # @bendyline/squisq
      src/
        schemas/            # Doc, BlockTemplates, Viewport, LayoutStrategy, Theme, themeLibrary
        doc/
          templates/        # 17 block templates (titleBlock, statHighlight, etc.)
          utils/            # animationUtils, themeUtils
        spatial/            # Haversine distance, Geohash encode/decode
        storage/            # StorageAdapter interface, Memory + LocalStorage adapters
        timing/             # Narration/reading time estimation
        random/             # SeededRandom (Mulberry32 PRNG)
        generate/           # Content extraction + slideshow generator
    react/                  # @bendyline/squisq-react
      src/
        layers/             # ImageLayer, TextLayer, ShapeLayer, VideoLayer, MapLayer
        hooks/              # useAudioSync, useDocPlayback, useViewportOrientation
        styles/             # doc-animations.css
        utils/              # animationUtils (re-exports from core), mapTileUtils
        DocPlayer.tsx       # Main player component
        BlockRenderer.tsx   # SVG-based block renderer
        CaptionOverlay.tsx
        DocProgressBar.tsx
        DocControls*.tsx    # Overlay, Bottom, Sidebar variants
        DocPlayerWithSidebar.tsx
    formats/                # @bendyline/squisq-formats
      src/
        ooxml/              # Shared OOXML infrastructure (reader, writer, XML utils)
        docx/               # DOCX import + export (WordprocessingML)
        pdf/                # PDF import + export (pdf-lib, pdfjs-dist)
        pptx/               # PPTX stubs (PresentationML, not yet implemented)
        xlsx/               # XLSX stubs (SpreadsheetML, not yet implemented)
    editor-react/           # @bendyline/squisq-editor-react
      src/
        EditorShell.tsx     # Top-level editor component
        EditorContext.tsx    # State management (markdown, parsed doc, editor refs)
        RawEditor.tsx       # Monaco code editor
        WysiwygEditor.tsx   # Tiptap rich text editor
        PreviewPanel.tsx    # Rendered block preview via DocPlayer
        Toolbar.tsx         # Formatting toolbar (bold, italic, headings, lists, etc.)
        tiptapBridge.ts     # Bidirectional markdown ↔ Tiptap conversion
        TemplateAnnotation.ts # Tiptap extension for heading template annotations
    site/                   # squisq-site (dev/demo, not published)
      src/
        App.tsx             # Sample picker + view switching
        samples.ts          # Sample documents for testing
```

## Build System

- **Build tool:** tsup (esbuild-based, generates ESM + .d.ts)
- **Monorepo:** npm workspaces
- **Output:** `packages/*/dist/`

```bash
npm run build              # Build all packages (core → formats → react → editor)
npm run build:core         # Build core only
npm run build:react        # Build react only
npm run build:formats      # Build formats only
npm run build:editor       # Build editor-react only
npm test                   # Run vitest unit tests
npm run test:e2e           # Run Playwright E2E tests
npm run typecheck          # Type-check all packages (no emit)
npm run site               # Build all + start dev site
npm run dev                # Start dev site only (Vite, port 5199)
npm run lint               # ESLint
npm run format             # Prettier format
```

## Subpath Exports

`@bendyline/squisq` exposes subpath entries:

- `@bendyline/squisq/schemas` — Type definitions (Doc, BlockTemplates, Viewport, Theme, themeLibrary)
- `@bendyline/squisq/doc` — Template registry + all 17 templates + animationUtils + themeUtils
- `@bendyline/squisq/spatial` — Haversine, Geohash utilities
- `@bendyline/squisq/storage` — StorageAdapter, MemoryStorageAdapter, LocalStorageAdapter
- `@bendyline/squisq/markdown` — Markdown parsing, stringifying, AST types (MarkdownDocument), tree utilities
- `@bendyline/squisq/story` — Alias for `@bendyline/squisq/doc` (legacy compatibility)
- `@bendyline/squisq/timing` — Narration/reading time estimation (estimateNarrationTime, estimateReadingTime, countSpokenWords)
- `@bendyline/squisq/random` — SeededRandom PRNG, hashString
- `@bendyline/squisq/generate` — Content extraction (extractContent, stripMarkdown) + slideshow generator (generateSlideshow)

`@bendyline/squisq-react` exports everything from the root:

- Components: DocPlayer, BlockRenderer, CaptionOverlay, DocProgressBar, etc.
- Hooks: useAudioSync, useDocPlayback, useViewportOrientation
- Layers: ImageLayer, TextLayer, ShapeLayer, VideoLayer, MapLayer
- Styles: `@bendyline/squisq-react/styles` for CSS

`@bendyline/squisq-formats` exposes subpath entries:

- `@bendyline/squisq-formats/docx` — DOCX import/export (markdownDocToDocx, docxToMarkdownDoc, docToDocx, docxToDoc)
- `@bendyline/squisq-formats/ooxml` — Shared OOXML package reader/writer, XML utilities, namespace constants
- `@bendyline/squisq-formats/pdf` — PDF import/export (markdownDocToPdf, pdfToMarkdownDoc, configurePdfWorker)
- `@bendyline/squisq-formats/pptx` — PPTX stubs (not yet implemented)
- `@bendyline/squisq-formats/xlsx` — XLSX stubs (not yet implemented)

`@bendyline/squisq-editor-react` exports everything from the root:

- Components: EditorShell, RawEditor, WysiwygEditor, PreviewPanel, Toolbar, StatusBar, ViewSwitcher
- Context: EditorProvider, useEditor
- Styles: `@bendyline/squisq-editor-react/styles` for CSS

## Code Style

- TypeScript strict mode
- ESM only (no CJS)
- React packages use `react` imports (consumed via preact/compat in Qualla)
- Core package has zero framework dependencies
- Formats package depends on jszip (ZIP archives), pdf-lib, pdfjs-dist, and core's MarkdownDocument as pivot format
- Editor-react depends on @tiptap and monaco-editor as peer dependencies
- All block templates are pure functions: `(input, context) => Layer[]`
- Use `catch (err: unknown)` with `instanceof Error` narrowing, never `catch (err: any)`
- Use `isTemplateBlock()` type guard instead of `(block as any).template` patterns
- Discriminated union: `DocBlock = Block | TemplateBlock` — use the guard to narrow
- **No `console.log` in production code** — remove all debug logging before committing. Use `console.warn` for degraded-but-functional scenarios, `console.error` for failures that affect output.
- **Test files should maintain type safety** — use typed test helpers instead of `as any` casts. Provide all required fields in test data.

## Key Design Decisions

- **Templates are pure functions** — no side effects, no state, just data in → layers out
- **SVG-based rendering** — blocks render as SVG foreignObject for resolution independence
- **React, not Preact** — the react package targets standard React; Qualla aliases via preact/compat
- **Subpath exports** — consumers import only what they need via granular entry points
- **No app-specific code** — everything here must be generic and reusable
- **MarkdownDocument as pivot format** — format converters (DOCX, PDF) use core's markdown AST as the intermediate representation
- **Unified/remark processor typing** — the chained `.use()` pattern requires `any` for the processor variable; this is documented with eslint-disable comments and is the one accepted `any` exception
- **Editor isolation** — heavy editor dependencies (Monaco, Tiptap) are isolated in editor-react, separate from the lighter react package

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

## Type Safety Conventions

- **Zero `any` in published production code** (except the unified processor exception above)
- **`isTemplateBlock()` guard** — always use this to narrow `DocBlock` to `TemplateBlock`, never cast with `as any`
- **`SquisqWindow` type** — use `window as SquisqWindow` for render-mode API access, never `window as any`
- **`catch (err: unknown)`** — always narrow with `instanceof Error`, never use `catch (err: any)`
- **`as unknown as X`** — when a cast is truly necessary (e.g., runtime data shapes), use double-cast through `unknown`, not `as any`

# Claude Code Guidelines for Prodcore

## Project Overview

Prodcore is an open-source monorepo providing reusable libraries for doc/block
rendering and spatial utilities. It was extracted from the Qualla project and is
designed to be framework-agnostic at the core, with a React component layer on top.

**npm packages:**
- `@bendyline/prodcore` — Headless utilities (schemas, templates, spatial math, storage)
- `@bendyline/prodcore-react` — React component library (doc player, block renderer, controls)
- `@bendyline/prodcore-formats` — Document format converters (DOCX import/export, OOXML infrastructure)

## Repository Structure

```
prodcore/
  package.json              # npm workspaces root
  tsconfig.base.json        # Shared TS settings
  packages/
    core/                   # @bendyline/prodcore
      src/
        schemas/            # Doc, BlockTemplates, Viewport, LayoutStrategy, Types
        doc/
          templates/        # 17 block templates (titleBlock, statHighlight, etc.)
          utils/            # animationUtils
        spatial/            # Haversine distance, Geohash encode/decode
        storage/            # StorageAdapter interface, Memory + LocalStorage adapters
    react/                  # @bendyline/prodcore-react
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
    formats/                # @bendyline/prodcore-formats
      src/
        ooxml/              # Shared OOXML infrastructure (reader, writer, XML utils)
        docx/               # DOCX import + export (WordprocessingML)
        pptx/               # PPTX stubs (PresentationML, not yet implemented)
        xlsx/               # XLSX stubs (SpreadsheetML, not yet implemented)
```

## Build System

- **Build tool:** tsup (esbuild-based, generates ESM + .d.ts)
- **Monorepo:** npm workspaces
- **Output:** `packages/*/dist/`

```bash
npm run build              # Build all packages
npm run build -w @bendyline/prodcore        # Build core only
npm run build -w @bendyline/prodcore-react  # Build react only
npm run build -w @bendyline/prodcore-formats # Build formats only
```

## Relationship to Qualla

Qualla (`c:\gh\qualla-internal`) consumes prodcore via checked-in tarballs:
- `qualla-internal/lib/bendyline-prodcore-*.tgz`
- Referenced as `"file:lib/bendyline-prodcore-*.tgz"` in qualla's package.json

### After making changes to prodcore:

1. Build: `cd c:\gh\prodcore && npm run build`
2. Pack: run `npm run pack-prodcore` from qualla-internal (rebuilds tarballs)
3. Install: `cd c:\gh\qualla-internal && npm install`

The code in prodcore was extracted from qualla's `shared/doc/templates/`,
`schemas/`, `shared/spatial/`, and `site/src/components/doc/`. Qualla currently
has both its own copies and the prodcore copies — the re-export shims to make
Qualla import exclusively from prodcore are a future step.

## Subpath Exports

`@bendyline/prodcore` exposes subpath entries:
- `@bendyline/prodcore/schemas` — Type definitions (Doc, BlockTemplates, Viewport)
- `@bendyline/prodcore/doc` — Template registry + all 17 templates + animationUtils
- `@bendyline/prodcore/spatial` — Haversine, Geohash utilities
- `@bendyline/prodcore/storage` — StorageAdapter, MemoryStorageAdapter, LocalStorageAdapter

`@bendyline/prodcore-react` exports everything from the root:
- Components: DocPlayer, BlockRenderer, CaptionOverlay, DocProgressBar, etc.
- Hooks: useAudioSync, useDocPlayback, useViewportOrientation
- Layers: ImageLayer, TextLayer, ShapeLayer, VideoLayer, MapLayer
- Styles: `@bendyline/prodcore-react/styles` for CSS

`@bendyline/prodcore-formats` exposes subpath entries:
- `@bendyline/prodcore-formats/docx` — DOCX import/export (markdownDocToDocx, docxToMarkdownDoc, docToDocx, docxToDoc)
- `@bendyline/prodcore-formats/ooxml` — Shared OOXML package reader/writer, XML utilities, namespace constants
- `@bendyline/prodcore-formats/pptx` — PPTX stubs (not yet implemented)
- `@bendyline/prodcore-formats/xlsx` — XLSX stubs (not yet implemented)

## Code Style

- TypeScript strict mode
- ESM only (no CJS)
- React package uses `react` imports (consumed via preact/compat in Qualla)
- Core package has zero framework dependencies
- Formats package depends on jszip (ZIP archives) and core's MarkdownDocument as pivot format
- All block templates are pure functions: `(input, context) => Layer[]`

## Key Design Decisions

- **Templates are pure functions** — no side effects, no state, just data in → layers out
- **SVG-based rendering** — blocks render as SVG for resolution independence
- **React, not Preact** — the react package targets standard React; Qualla aliases via preact/compat
- **Subpath exports** — consumers import only what they need
- **No Qualla-specific code** — everything here must be generic and reusable
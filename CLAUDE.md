# Claude Code Guidelines for Squisq

## Project Overview

Squisq is an open-source monorepo providing reusable libraries for doc/block
rendering and spatial utilities. It was extracted from the Qualla project and is
designed to be framework-agnostic at the core, with a React component layer on top.

**npm packages:**
- `@bendyline/squisq` — Headless utilities (schemas, templates, spatial math, storage)
- `@bendyline/squisq-react` — React component library (doc player, block renderer, controls)
- `@bendyline/squisq-formats` — Document format converters (DOCX import/export, OOXML infrastructure)

## Repository Structure

```
squisq/
  package.json              # npm workspaces root
  tsconfig.base.json        # Shared TS settings
  packages/
    core/                   # @bendyline/squisq
      src/
        schemas/            # Doc, BlockTemplates, Viewport, LayoutStrategy, Types
        doc/
          templates/        # 17 block templates (titleBlock, statHighlight, etc.)
          utils/            # animationUtils
        spatial/            # Haversine distance, Geohash encode/decode
        storage/            # StorageAdapter interface, Memory + LocalStorage adapters
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
        pptx/               # PPTX stubs (PresentationML, not yet implemented)
        xlsx/               # XLSX stubs (SpreadsheetML, not yet implemented)
```

## Build System

- **Build tool:** tsup (esbuild-based, generates ESM + .d.ts)
- **Monorepo:** npm workspaces
- **Output:** `packages/*/dist/`

```bash
npm run build              # Build all packages
npm run build -w @bendyline/squisq        # Build core only
npm run build -w @bendyline/squisq-react  # Build react only
npm run build -w @bendyline/squisq-formats # Build formats only
```

## Relationship to Qualla

Qualla (`c:\gh\qualla-internal`) consumes squisq via checked-in tarballs:
- `qualla-internal/lib/bendyline-squisq-*.tgz`
- Referenced as `"file:lib/bendyline-squisq-*.tgz"` in qualla's package.json

### After making changes to squisq:

1. Build: `cd c:\gh\squisq && npm run build`
2. Pack: run `npm run pack-squisq` from qualla-internal (rebuilds tarballs)
3. Install: `cd c:\gh\qualla-internal && npm install`

The code in squisq was extracted from qualla's `shared/doc/templates/`,
`schemas/`, `shared/spatial/`, and `site/src/components/doc/`. Qualla currently
has both its own copies and the squisq copies — the re-export shims to make
Qualla import exclusively from squisq are a future step.

## Subpath Exports

`@bendyline/squisq` exposes subpath entries:
- `@bendyline/squisq/schemas` — Type definitions (Doc, BlockTemplates, Viewport)
- `@bendyline/squisq/doc` — Template registry + all 17 templates + animationUtils
- `@bendyline/squisq/spatial` — Haversine, Geohash utilities
- `@bendyline/squisq/storage` — StorageAdapter, MemoryStorageAdapter, LocalStorageAdapter

`@bendyline/squisq-react` exports everything from the root:
- Components: DocPlayer, BlockRenderer, CaptionOverlay, DocProgressBar, etc.
- Hooks: useAudioSync, useDocPlayback, useViewportOrientation
- Layers: ImageLayer, TextLayer, ShapeLayer, VideoLayer, MapLayer
- Styles: `@bendyline/squisq-react/styles` for CSS

`@bendyline/squisq-formats` exposes subpath entries:
- `@bendyline/squisq-formats/docx` — DOCX import/export (markdownDocToDocx, docxToMarkdownDoc, docToDocx, docxToDoc)
- `@bendyline/squisq-formats/ooxml` — Shared OOXML package reader/writer, XML utilities, namespace constants
- `@bendyline/squisq-formats/pptx` — PPTX stubs (not yet implemented)
- `@bendyline/squisq-formats/xlsx` — XLSX stubs (not yet implemented)

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
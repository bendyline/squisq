<!--
  AGENTS.md is the canonical agent-guidance file. CLAUDE.md is a byte-for-byte
  compatibility copy for tools that read that filename. Edit this file, then
  run `cp AGENTS.md CLAUDE.md`. The `tests/docs-sync.test.ts` check fails if the
  two drift.
-->

# Agent Guidelines for Squisq

## Project Overview

Squisq is an open-source monorepo providing reusable libraries for doc/block
rendering and spatial utilities. It is designed to be framework-agnostic at the core, with a React component layer on top. It is also designed to be pure JavaScript that can run in a browser or in NodeJS (**it should have no NodeJS-specific dependencies**)

**npm packages** (9 published + 1 dev-only):

- `@bendyline/squisq` — Headless utilities (schemas, themes, templates, spatial math, markdown, storage, versions, jsonForm, icons, image-edit, transform, recommend)
- `@bendyline/squisq-react` — React component library (DocPlayer, BlockRenderer, layers, hooks, LinearDocView, MarkdownRenderer, JsonView, inline media players, standalone IIFE bundle)
- `@bendyline/squisq-formats` — Document format converters (DOCX, PDF, HTML, EPUB, PPTX, XLSX, CSV import/export; shared OOXML infrastructure; format registry + `convert()`; outside-in rendered-file/companion-Markdown contract via `/outside-in`; ContentContainer ZIP serialization; theme + layout inference from office files via `/infer`)
- `@bendyline/squisq-grid-react` — Virtualized data grid for sidecar tables (TanStack-Virtual DOM renderer + in-house columnar Web-Worker store implementing core's `TableQueryProvider`; sortable/filterable/editable with per-cell locks + a `FormulaSupport` seam for engine-backed `=formula` editing; the editor's data card mounts it lazily)
- `@bendyline/squisq-calc` — Spreadsheet calculation: the engine adapter contract (`CalcEngine` — staleness, spill roles, evaluation budgets, cycle policy, Formualizer vocabulary), an Excel formula parser, and the pure-TS in-house evaluator tier (`createInHouseEngine`, ~85 functions prioritized by the corpus census: INDEX/MATCH/SUM/VLOOKUP/IF dominate real documents). Zero runtime dependencies at the root; the IronCalc wasm backend lives behind the `/ironcalc` SUBPATH (`createIronCalcEngine`; `@ironcalc/wasm` is an OPTIONAL peer via dynamic import — guardrail-tested, and the root entry never references it, so contract+in-house consumers pay zero adapter bytes). Formula EDITING in the data-card grid runs on the in-house tier
- `@bendyline/squisq-editor-react` — React editor shell (Monaco raw, Tiptap WYSIWYG with Monaco code-fence insets, block preview, toolbar, theme/template pickers, version history, ASCII + Mermaid diagram editors, image editor, JsonEditor) + browser-based audio/camera/screen recording (MediaRecorder + getUserMedia + getDisplayMedia, persists into a `ContentContainer`)
- `@bendyline/squisq-video` — Cross-runtime render/timeline/preset helpers, shared GIF palette arguments, and a browser-only ffmpeg.wasm MP4 encoder. Node MP4/GIF export uses the CLI's native FFmpeg path.
- `@bendyline/squisq-video-react` — React components for browser-based MP4/GIF export (WebCodecs primary, ffmpeg.wasm fallback/palette pass; MP4 muxes narration audio, GIF is silent) + single-frame image export dialogs (cover + dashboard) sharing the capture pipeline
- `@bendyline/squisq-cli` — `squisq` bin command for converting documents (markdown **or** binary DOCX/PPTX/PDF/XLSX/CSV/HTML inputs) to DOCX/PDF/HTML/EPUB/PPTX/XLSX/CSV/MP4/GIF/PNG from the terminal, plus `squisq image` (dashboard → PNG, Chromium-only), `squisq doctor` (environment readiness) and `squisq transform` (markdown source transforms: unwrap/wrap/cleanup) — built on the shared format registry `convert()`
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
                            #   MediaProvider, ImageEditDoc, PageStyle (Theme.pageStyle art
                            #   direction: design family + page tokens + per-kind/template
                            #   overrides) + pageStyleDefaults (defaultPageStyle derivation)
        doc/
          templates/        # 33 block templates (title, sectionHeader, content, statHighlight,
                            #   quote, factCard, twoColumn, dateEvent, imageWithCaption, leftFeature,
                            #   rightFeature, map, fullBleedQuote, list, photoGrid,
                            #   definitionCard, comparisonBar, pullQuote, videoWithCaption,
                            #   videoPullQuote, dataTable, barChart, columnChart, pieChart,
                            #   donutChart, lineChart, areaChart, scatterChart, diagram, tree,
                            #   timeline, layout, drawing) +
                            #   coverBlock (start block, not in registry) + accentImage /
                            #   persistentLayers / captionUtils
                            #   shared utilities + chart/ (shared pure-SVG chart engine: table→
                            #   series parsing, nice ticks, arc/line geometry, stacking, legends —
                            #   the 7 chart templates render a markdown table in the block body,
                            #   falling back to content rendering when no chartable table exists)
          utils/            # animationUtils, themeUtils
          asciiDiagram/     # ASCII diagram codec: detect/parse/render box-and-line art in code
                            #   fences (boxes=nodes, lines/arrows=edges, box-in-box=containers,
                            #   `── label ──`/`│ label` edge labels) + grid↔canvas mapping.
                            #   parse(render(d)) is a semantic fixpoint; render is byte-stable
                            #   after one normalization cycle. THE authored diagram format.
          treeview/         # ASCII tree codec: detect/parse/render file-tree & outline art in
                            #   code fences (├──/└──/│, ASCII |--/`--/+--, pure indentation,
                            #   bullet-indent; trailing-slash dirs; # / <-- comments) + nested
                            #   TreeNode model + templateData mapping + markdown-list→tree walker.
                            #   Structural fixpoint (byte-stable). Mutually exclusive with the
                            #   diagram codec (a tree has 0 closed boxes). THE authored tree format.
          asciiTimeline/    # ASCII timeline codec: detect/parse/render horizontal marker rails,
                            #   aligned callouts and fractional pointers; repeated rails are tracks,
                            #   `branch: source -> target` links tracks. Source columns normalize
                            #   globally for shared scale. THE authored timeline format.
          materializeBlockLayers.ts # Canonical block→layer contract, policy, diagnostics
          dashboard/        # Dashboard mode materialization — the one-canvas sibling of the
                            #   slide/page projections: DashboardLayout (%-rect cells + validation
                            #   + orientation variants/transpose), 10 built-in layouts
                            #   (focus-1…grid-4x4) + the auto-pick ladder, settings resolver
                            #   (squisq-dashboard-layout/-title/-style) + custom-layout frontmatter codec
                            #   (squisq-dashboard-layouts), and materializeDashboard
                            #   (buildPreviewDoc candidates minus image interleave → per-cell
                            #   render-at-cell-size, title band + dedupe, canvas backdrop,
                            #   overflow diagnostics) + composeDashboardLayers (flat Layer[]) +
                            #   dashboardZoom (closed 1×/1.5×/2× cell type-scale ladder:
                            #   auto-boosts short text-led blocks, quantized to ≤1 boost level
                            #   per dashboard; explicit cell `zoom` pins win; squisq-dashboard-zoom
                            #   off kill-switch) + dashboardStyle (the orthogonal "dressing" axis:
                            #   basic/card/panel/accent cell chrome — canvas tint, elevation,
                            #   border, accent bar/wash — all derived from the ACTIVE THEME;
                            #   squisq-dashboard-style)
          page/             # Page (linear) mode materialization — the variable-height HTML
                            #   sibling of materializeBlockLayers: PageSection model (15 section
                            #   kinds), resolvePageBlock (typed-input merge), sectionExtractors
                            #   (all 33 templates → section drafts), materializePageSections
                            #   (doc walk + cover dedupe + background rhythm/accent rotation/
                            #   emphasis art direction). Framework-agnostic; React + exporters
                            #   consume the same sections.
          pageCss.ts        # PAGE_BASE_CSS structural stylesheet (all values via
                            #   --squisq-page-* vars + token data-attributes) + buildPageCssVars
                            #   + buildPageCss + pageStyleDataAttributes — single CSS source for
                            #   the React page view AND string-HTML exporters
          markdownToDoc.ts  # Markdown AST → Doc (content-aware auto templates ON by default:
                            #   unannotated headings with strong signals — table/images/quote/
                            #   list/stat/ASCII-diagram fence/ASCII-tree fence — get matching
                            #   templates + derived inputs; ephemeral via block.autoTemplate so
                            #   round-trips stay lossless; disable with { autoTemplates: false }
                            #   or frontmatter squisq-auto-templates: false, CLI --no-auto-templates)
          promoteBodyAnnotation.ts # Body-tag promotion (LLM tolerance): a single trailing
                            #   {[template …]} tag placed in a block's BODY (whole-paragraph or
                            #   glued to the last paragraph) under an UNANNOTATED heading is
                            #   understood as that block's template, stripped from the rendered
                            #   body, and recorded on block.promotedBodyAnnotation. Round-tripped
                            #   LAZILY: docToMarkdown re-emits the tag verbatim in the body until
                            #   the block's template/params are edited, then relocates it onto the
                            #   heading (# H {[…]}). Multiple body tags or a tag with content after
                            #   it keep the heading-less standalone-block behavior (annotationBlocks)
        templateInputs.ts # deriveTemplateInputs + body extractors (images/list/table/quote)
          docToMarkdown.ts  # Doc → Markdown AST (re-emits media annotations from MediaClip.origin)
          buildPreviewDoc.ts # THE canonical slideshow (slide-mode) projection: markdown-derived
                            #   Doc → flat, player-ready TemplateBlock slides (implicit
                            #   sectionHeader → loss-averse `content`, derived template inputs,
                            #   interleaved images, synthetic audio clock). Slide-mode sibling of
                            #   page/materializePageSections; the editor preview, HTML slideshow
                            #   export, and PPTX export all run through it
          audioMapping.ts   # resolveAudioMapping, narration linking (runs applyNarrationTiming
                            #   first; scheduled-media srcs excluded from segment auto-discovery)
          applyNarrationTiming.ts # doc-anchored narration take + v3 timing sidecar → re-timed
                            #   block startTime/duration (author pins win; id→similarity→order
                            #   block matching; v1 sidecars fall back to proportional timing)
        spatial/            # Haversine distance, Geohash encode/decode
        storage/            # StorageAdapter, Memory + LocalStorage + LocalForage adapters,
                            #   ContentContainer, MemoryContentContainer, ScopedContentContainer,
                            #   createMediaProviderFromContainer
        markdown/           # parseMarkdown, stringifyMarkdown, 30+ AST node types, tree utilities,
                            #   inferDocumentTitle, parseFrontmatter, hast HTML sub-DOM,
                            #   sourceTransforms (unwrap/wrap/cleanup source-text registry +
                            #   detectMarkdownWrapState wrap-convention detection)
        timing/             # Narration/reading time estimation
        random/             # SeededRandom (Mulberry32 PRNG)
        generate/           # Content extraction (slideshow generator removed in v1.5 → use transform/)
        transform/          # Slideshow transform pipeline: block analysis + 5 transform styles
                            #   (data-driven, documentary, magazine, minimal, narrative)
        versions/           # Document version history (snapshots in .versions/, prune/coalesce,
                            #   DocumentVersionManager)
        jsonForm/           # JSON Form headless logic (hint vocabulary, control picker,
                            #   conditional rules, schema inference)
        imageEdit/          # Layered raster authoring schema + sidecar persistence + version
                            #   history (mirrors versions/ shape over ImageEditDoc JSON)
        icons/              # FontAwesome Free catalog (ICONS) + resolveIcon, suggestIcons
                            #   (inline `{[token]}` icon split lives in markdown/convert.ts and
                            #   RESERVES block-template ids: a bare `{[list]}`/`{[map]}`/`{[tree]}`
                            #   is a block tag, never an icon — see TEMPLATE_TOKEN_NAMES /
                            #   isReservedAnnotationToken in templateNames.ts; use the qualified
                            #   `{[fa-solid:list]}` form for the icon)
        recommend/          # Block-content profiler + template recommendations
        narration/          # Narration/teleprompter engine: script model (Doc → word tokens +
                            #   syllable estimates + pause classes + block ranges), streaming DSP
                            #   (band features, adaptive VAD, syllable nuclei), voice-adaptive
                            #   pacing controller (pure step fn), live-session composition, and
                            #   the offline banded-DTW aligner (take → word/block timestamps).
                            #   Plus advanceTiming.ts — the OBSERVED sibling of the aligner:
                            #   a presenter's slide advances during a take (SlideAdvanceLog)
                            #   → the same v3 sidecar, with method 'presenter-advance'.
                            #   Pure TS, zero deps, no DOM — deterministic, Node-testable.
        proof/              # Proofing (grammar/spellcheck) support: ProofFinding types, the
                            #   harper LintKind → spelling/grammar/style tier map, {[…]}
                            #   annotation blanking (offset-preserving), joined-segment offset
                            #   mapping for one-call multi-block linting, and the frontmatter
                            #   settings codec (squisq-proofing / -proof-dialect / -proof-
                            #   dictionary; ignores are host-persisted, never in the doc).
                            #   Pure, zero-dep; the harper.js
                            #   adapter lives in editor-react.
    react/                  # @bendyline/squisq-react
      src/
        layers/             # ImageLayer, TextLayer, ShapeLayer, VideoLayer, MapLayer, TableLayer,
                            #   TreeLayer (interactive filesystem treeview via <foreignObject>)
        hooks/              # useAudioSync, useDocPlayback, useViewportOrientation, useAutoSurface,
                            #   MediaContext, AudioProvider
        styles/             # doc-animations.css + JsonView styles
        utils/              # animationUtils (re-exports from core), layerUtils, mapTileUtils
        DocPlayer.tsx       # Main player component
        BlockRenderer.tsx   # SVG-based block renderer
        page/               # Page-mode HTML section components: PageSectionView dispatcher +
                            #   per-kind sections (hero, banner, stat/quote bands, feature split,
                            #   gallery, callout, cards, item list, timeline rail, table, prose)
                            #   + CanvasSection (spatial SVG embeds via materializeBlockLayers)
        LinearDocView.tsx   # "Page" rendition: doc → materializePageSections → variable-height,
                            #   theme-art-directed HTML sections (SVG only for spatial embeds)
        DashboardView.tsx   # "Dashboard" rendition: doc → materializeDashboard → one static canvas
                            #   of absolutely-positioned per-cell BlockRenderers; publishes a minimal
                            #   render API (seekTo resolves when assets settle) for image capture
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
    calc/                   # @bendyline/squisq-calc
      src/
        types.ts            # The engine adapter contract (CalcEngine, CalcValue, Staleness,
                            #   SpillRole, budgets, cycle policy, capabilities) — Formualizer
                            #   vocabulary; every backend implements this one interface
        lexer/parser/ast    # Excel formula language: A1/abs refs, whole-col/row ranges,
                            #   quoted sheets, _xlfn. stripping, error literals, precedence
                            #   quirks (unary beats ^, ^ left-assoc, postfix %)
        coerce/dates/numfmt # Implicit coercion + comparison ordering, criteria grammar,
                            #   date serials (1900 leap bug + 1904 epoch, ISO round-trip),
                            #   TEXT() format subset
        evaluate.ts         # Interpreter: scalar/RangeView duality, implicit intersection,
                            #   used-extent-clamped whole-column ranges, budget enforcement
        functions/          # ~85 functions in 6 families (lookup is the corpus core)
        engine.ts           # createInHouseEngine: sparse store, range-aware dependency graph,
                            #   explicit-stack topo DFS (no recursion overflow), volatile
                            #   recompute, cycle policies (error → #CALC! / iterate), honest
                            #   budget stops with dirtyRemaining
        ironcalc/           # The /ironcalc SUBPATH: IronCalc Model behind the same contract
                            #   (1-based↔0-based boundary, apostrophe-prefixed string seeding,
                            #   type codes 1/2/4/16, PRE-FLIGHT budgets — wasm evaluate() is
                            #   uninterruptible — parser-derived graph queries, scratch-cell
                            #   evaluateFormula). @ironcalc/wasm = optional peer, dynamic import
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
        xlsx/               # XLSX import + export (SpreadsheetML). Import splits each sheet into
                            #   its contiguous data islands (regions.ts: merge-aware occupancy mask
                            #   → 8-connected components → bbox merge → caption absorption → stray
                            #   coalescing), one anchored block per island; cells.ts is the shared
                            #   XlsxCell model + A1 arithmetic + shared-formula translation.
                            #   Export is tables-only → ArrayBuffer; workbookPlan.ts turns anchored
                            #   blocks back into placed cells (unannotated tables keep the historical
                            #   one-sheet-per-table, A1 behavior)
        registry/           # Format registry + convert() front door (FormatDefinition per format id,
                            #   ConversionResult, ConversionError)
        outside-in/         # Rendered target ↔ hidden `_files/<slug>.md` layout/frontmatter
                            #   contract plus registry-backed import/export and shared HTML runtime
        csv/                # CSV import + export (parseCsv, csvToMarkdownDoc, markdownDocToCsv,
                            #   csvToContainer — sidecar-aware container import)
        data/               # Data sidecar support: DataSourceReader implementations (csv/tsv,
                            #   xlsx region-aware, parquet via optional peer hyparquet) behind
                            #   core's resolveDataReferences seam; sidecar naming/planning
                            #   (planDataSidecar → <docbasename>_files/data/<file>) and
                            #   materializeDataReferences (full-table embed for XLSX export)
        container/          # ContentContainer ZIP serialization (containerToZip, zipToContainer)
        infer/              # Theme inference from file imports: inferThemeFromFile (DOCX/PPTX/XLSX
                            #   theme1.xml → compiled Squisq Theme; PPTX optionally + custom layouts)
    grid-react/             # @bendyline/squisq-grid-react
      src/
        DataGrid.tsx        # TanStack-Virtual row-virtualized grid: sticky sortable/filterable
                            #   header, rectangular selection + clipboard (TSV + HTML), inline
                            #   cell editor with kind coercion, per-cell locks (XLSX formula/
                            #   date cells), dirty/save bar, staleView refresh, a11y grid roles
        store/              # In-house columnar store: columns.ts (typed arrays + dictionary-
                            #   encoded strings), kernel.ts (zero-import worker kernel shipped
                            #   via Function.prototype.toString → Blob URL; NEVER enable tsup
                            #   minify here), client.ts (TableStoreClient implements core
                            #   TableQueryProvider over a Blob worker or in-process
                            #   LocalKernelHost — the SSR/test path AND the parity proof),
                            #   journal.ts (EditJournal + module cache keyed (path, revision))
        styles/             # Grid stylesheet — only var(--squisq-grid-*, <literal>) tokens
    editor-react/           # @bendyline/squisq-editor-react
      src/
        EditorShell.tsx     # Top-level editor component (layout, keyboard shortcuts, theming)
        EditorContext.tsx   # State management (markdown, parsed doc, mention/link providers,
                            #   versioning hooks, debounced parse pipeline)
        RawEditor.tsx       # Monaco code editor
        WysiwygEditor.tsx   # Tiptap rich text editor
        PreviewPanel.tsx    # Rendered block preview via DocPlayer (thin shell)
        buildPreviewDoc.ts  # Re-export shim — the projection itself lives in core
                            #   (core/doc/buildPreviewDoc.ts) so exporters can reach it
        Toolbar.tsx         # Formatting toolbar (bold, italic, headings, lists, tables, icons, etc.)
        PreviewControls.tsx # Preview settings provider + toolbar controls
        ViewMenuPanel.tsx   # View-mode switcher menu
        TransformMenu.tsx   # Toolbar popover applying core's markdown source transforms
                            #   (unwrap/wrap/cleanup) + detected wrap-state readout; Source view
                            #   applies via minimal Monaco executeEdits between undo stops
        wrapPolicy.ts       # Pure "unwrap in Write view, persist with wrapping" helpers
                            #   (ingestForWrite/persistFromWrite) used by WysiwygEditor
        proofing/           # Grammar/spellcheck: ProofingProvider contract + harper.js adapter
                            #   (optional peer, dynamic import), useProofing orchestration
                            #   (per-view lint passes, 450ms debounce, single-flight), Tiptap +
                            #   Monaco squiggle decorations, right-click suggestions menu,
                            #   findings panel, StatusBar segment; host guide: docs/proofing.md
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
        fileKind.ts         # resolveFileKind + language detection (markdown/code/image/data)
        dataCard/           # Write-view grid host for data sidecars: DataCardExtension claims
                            #   a paragraph that is entirely one link to a relative csv/tsv/xlsx/
                            #   parquet file (the body link under a {[dataTable src=…]} heading);
                            #   DataCardWidget lazily mounts the REAL virtualized grid
                            #   (@bendyline/squisq-grid-react) under the card's identity strip —
                            #   compact preview card only as the load-failure fallback. Plus
                            #   ingestAdapters (bytes → IngestTable + CSV source conventions +
                            #   XLSX address map/per-cell locks), viewStateBinding (sort/filter ↔
                            #   owning-heading annotation params, PM-undoable, guarded),
                            #   gridSave (saveCsvEdits/saveXlsxEdits: .versions/data/ backup,
                            #   in-place rewrite/patch, fork detection). Decoration-only —
                            #   markdown round-trips untouched; reuses the fenceWidgets registry
                            #   (generalized to paragraphs) + containment
        useHeadingLayout.ts # Headings → flat outline + active-heading tracking
        useMonacoLoader.ts  # Monaco lazy loader
        hooks/              # useFileDrop (HTML5 drag/drop classification)
        imageEditor/        # ImageEditor sub-panels + useImageEditor + reducer + state types
        jsonEditor/         # <JsonEditor> editable form (text/multiline/richtext, color, slider,
                            #   toggle, chip-bin, card-stack, tabs, …) — uses chooseControl from core
        recorder/           # MediaRecorder UI + helpers (RecorderModal, RecorderButton,
                            #   RecorderPanel, hooks, sources, formats, timingJson,
                            #   documentNarrationInsertion, slidesModePolicy, slides/
                            #   — the deck panel shown opposite the capture controls)
        teleprompter/       # Narrate display mode (Use tab): voice-paced TeleprompterView/
                            #   Surface/Controls, useTeleprompter (core narration session on
                            #   AudioWorklet PCM hops — throttle-immune), useMicAnalysis,
                            #   pcmWorklet (inline source → Blob URL), floatingWindow 3-tier
                            #   ladder (document-pip → video-pip canvas → popup) + canvas
                            #   renderer, scrollModel, self-contained TELEPROMPTER_CSS, and
                            #   recording/ (useNarrationRecorder dual-capture, narrationSave
                            #   plan/executor, insertPreamble markdown rewriter)
        asciiDiagram/       # ASCII-fence diagram editing: AsciiDiagramExtension (position-registry
                            #   plugin that hides qualifying code fences and mounts the canvas),
                            #   AsciiDiagramWidget, useAsciiDiagramData, pure ops + command pipeline
                            #   (parse → op → render → verify → single-transaction fence rewrite),
                            #   paste gate for bare art
        mermaid/            # Explicit `mermaid`-fence complex-diagram mode: lazy official Mermaid
                            #   renderer (all Mermaid-supported syntaxes), shared source/maximize/
                            #   resize/zoom canvas chrome, strict rendering; fence stays source of truth
        codeSnippet/        # Ordinary explicit-language code fences: Monaco inset editor + language
                            #   catalog used by Insert Code Snippet; fence text/language stay authoritative
        treeview/           # ASCII-tree-fence outline editing (peer to asciiDiagram/):
                            #   TreeViewExtension (same position-registry pattern; box-diagram
                            #   fences excluded), TreeOutlineWidget (add/rename/indent/outdent/
                            #   move/delete/collapse), treeOps, treeViewCommands (reuses
                            #   replaceAsciiFenceText), useTreeViewData, paste gate for bare art
        timeline/           # ASCII-timeline-fence WYSIWYG editing: TimelineViewExtension hides
                            #   qualifying fences and mounts a shared-scale rail canvas; clickable
                            #   dots + add-point affordances feed an event inspector, then pure ops
                            #   re-render/verify/rewrite the canonical `timeline` fence in one undo
        diagram/            # Shared diagram canvas (DiagramCanvas over the Scene engine, types,
                            #   constants, maximize overlay) + heading-mutation helpers in
                            #   diagramCommands.ts still used by drawing/layout scene commands.
                            #   Heading-based diagram EDITING was removed in the ASCII cutover.
        tiptap/             # TiptapAudio, TiptapVideo, useResolvedMediaSrc — media node views
        utils/              # collectInlineFontAwesomeCss, dropUtils, normalizeMalformedAssetUrl
    video/                  # @bendyline/squisq-video
      src/
        renderHtml.ts       # Generates standalone player HTML for headless frame capture
                            #   (mounts 'slideshow' or 'dashboard' via displayMode/dashboard opts)
        dashboardImage.ts   # Dashboard image export presets (DASHBOARD_RESOLUTIONS) + dimension
                            #   validator/resolver shared by `squisq image` and the browser dialog
        wasmEncoder.ts      # ffmpeg.wasm frame → MP4 encoder
        ffmpegArgs.ts       # Shared MP4/audio flags + compression-friendly GIF palette graph
        types.ts            # VideoQuality, QualityPreset, orientation/dimension helpers
    video-react/            # @bendyline/squisq-video-react
      src/
        VideoExportModal.tsx  # Modal dialog for export config + progress
        VideoExportButton.tsx # Drop-in button wrapper
        CoverImageExportModal.tsx     # Single-frame cover image export dialog (/cover-image entry)
        DashboardImageExportModal.tsx # Dashboard image export dialog (/dashboard-image entry;
                            #   named resolutions + custom pixels + layout picker + title toggle)
        imageExportShared.ts # Shared single-frame helpers (format details, canvasToBlob,
                            #   FS-Access save flow, download fallback, filename sanitizer)
        hooks/              # useVideoExport, useFrameCapture
        workers/            # Web Worker for encoding (WebCodecs primary, ffmpeg.wasm fallback)
        mp4Mux.ts           # mp4-muxer wrapper for WebCodecs path
        gifTranscode.ts     # Bounded MP4 intermediate → global-palette animated GIF
    cli/                    # @bendyline/squisq-cli
      src/
        index.ts            # `squisq` bin entry point (commander-based)
        commands/           # convert (markdown/binary → DOCX/PDF/HTML/EPUB/PPTX/XLSX/CSV via registry),
                            #   video (markdown → MP4/GIF), image (dashboard → PNG, Chromium-only),
                            #   doctor (environment readiness), validate,
                            #   transform (markdown source transforms: unwrap/wrap/cleanup)
        registry.ts         # createCliRegistry — wires the formats registry + CLI-only mp4/gif/png
        api.ts              # Programmatic API surface (exported as `@bendyline/squisq-cli/api`);
                            #   withRenderPage (shared headless page session: media budget, bundle
                            #   variant, SSRF route guard, readiness poll) backs both the video
                            #   frame loop and renderDocToDashboardPng's single screenshot
    site/                   # squisq-site (dev/demo, not published)
      src/
        App.tsx             # Sample picker + view switching
        samples.ts          # Sample documents for testing + SAMPLE_GROUPS (the picker's
                            #   category tree, rendered as native <optgroup>s so Playwright's
                            #   selectOption() contract survives; a guard test keeps every
                            #   sample categorized)
        dataSamples.ts      # GENERATED data & calc samples — built in-browser at load time
                            #   (deterministic CSV sidecars + a real XLSX assembled via
                            #   markdownDocToXlsx + patchXlsxCellValues with live formulas),
                            #   so no binary fixtures live in the repo
        documentImport.ts   # Upload → markdown: registry-backed DOCX/PPTX/XLSX/PDF/CSV/TSV/
                            #   parquet/HTML/zip import; prefers a format’s importContainer so
                            #   embedded media AND data sidecars ride along into the editor
                            #   workspace. Opening a CSV/TSV always sidecars (the file IS the
                            #   content: doc = one {[dataTable src=…]} reference); XLSX keeps
                            #   the size threshold; .tsv rides the CSV importer with a tab
                            #   delimiter; .parquet synthesizes the sidecar container directly
        ImportProgressModal.tsx # Staged progress + failure dialog shown during those imports
        pdfWorker.ts        # One-time pdfjs worker registration (shared by import + export)
        ffmpegWasmConfig.ts # Same-origin ffmpeg.wasm core URLs used by MP4/GIF export
      vite.config.ts        # Serves/copies the pinned ffmpeg core for browser export
```

## Packages and Dependencies

**Always install via `npm run install:safe`. Do not use a bare `npm install`** —
`.npmrc` sets `ignore-scripts=true`, so a bare install succeeds but leaves
esbuild’s native binary missing and the next `npm run build` fails.

**Before any other package management** — adding, removing or updating a
dependency, running `npm audit fix`, editing `overrides`, or otherwise touching
`package-lock.json` — read **[`docs/dependencies.md`](docs/dependencies.md)**.
It is the single source for the rules that gate all of it: exact version
pinning, the 7-day cooldown on newly published versions
(`npm run deps:cooldown`), the install-script allowlist and its content pins,
notices regeneration, per-package dependency constraints, and the guardrail
tests each of those trips.

## Build System

- **Build tool:** tsup (esbuild-based, generates ESM + .d.ts)
- **Monorepo:** npm workspaces
- **Output:** `packages/*/dist/`

```bash
npm run install:safe       # Install deps + run allowlisted install scripts (see docs/dependencies.md)
npm run build              # Build all packages in dep order: core → calc → formats → react
                           #   → grid → video → video-react → editor → cli → site
npm run build:core         # Build core only
npm run build:calc         # Build calc only
npm run build:formats      # Build formats only
npm run build:react        # Build react only
npm run build:grid         # Build grid-react only
npm run build:video        # Build video only
npm run build:video-react  # Build video-react only
npm run build:editor       # Build editor-react only
npm run build:cli          # Build cli only
npm test                   # Run vitest unit tests (75 files, 1000+ tests)
npm run test:cli           # Run cli mocha tests
npm run test:extended      # Run opt-in extended tests (Stryker mutation testing + corpus tier)
npm run test:corpus        # Run the real-world data-corpus tier (tests/corpus/; needs
                           #   `node scripts/corpus-fetch.mjs` first — fetches the
                           #   tests/corpus/manifest.json files (government open-data XLSX/CSV,
                           #   OGL-licensed) into the gitignored .corpus/; skips with a warning
                           #   when absent. Sweeps importers + extracts the cached-value oracle
                           #   dataset (.corpus/report/oracle-pairs.json) for calc-engine testing
npm run test:published     # Run vitest against published-shape outputs
npm run test:e2e           # Build all + run Playwright E2E tests against Vite preview
npm run test:e2e:built     # Run Playwright E2E tests when dist/ is already current
npm run typecheck          # tsc -b across all packages (no emit)
npm run site               # Alias for npm run dev
npm run dev                # Build runtime packages, start their watchers, then start the dev site
                           # (Vite, port 5199) after every initial ESM watch build is ready
npm run lint               # ESLint
npm run format             # Prettier format
npm run deps:cooldown      # Cooldown gate: versions this branch adds/changes (docs/dependencies.md)
npm run deps:cooldown:all  # Cooldown gate: full lockfile audit
npm run all                # install:safe + deps:cooldown:all + build + lint + format:check +
                           #   typecheck + coverage + published + CLI + required native MP4/GIF +
                           #   browser E2E (full pre-release sweep; needs network, FFmpeg, browsers)
```

For CI / clean reproducible installs, run `npm ci && node scripts/run-install-allowlist.mjs`
(equivalent to `install:safe` but using `npm ci` instead of `npm install`).

## Subpath Exports

`@bendyline/squisq` exposes 19 subpath entries (canonical list — every entry matches a tsup
build entry and a `package.json` export):

- `@bendyline/squisq/schemas` — Type definitions (Doc, BlockTemplates, Viewport, LayoutStrategy, Theme, themeLibrary, themeCompile, themeValidator, colorUtils, fontStacks, Types, MediaProvider, ImageEditDoc)
- `@bendyline/squisq/doc` — Template registry + all 33 templates (`title`, `sectionHeader`, `content`, `statHighlight`, `quote`, `factCard`, `twoColumn`, `dateEvent`, `imageWithCaption`, `leftFeature`, `rightFeature`, `map`, `fullBleedQuote`, `list`, `photoGrid`, `definitionCard`, `comparisonBar`, `pullQuote`, `videoWithCaption`, `videoPullQuote`, `dataTable`, `barChart`, `columnChart`, `pieChart`, `donutChart`, `lineChart`, `areaChart`, `scatterChart` — the chart family renders the block's markdown table as a pure-SVG chart via the shared `chart/` engine (column-role params `labelColumn`/`valueColumns`, `stacked` on bar/column, `showTable`/`showLegend`/`showValues`/`unit`), falling back to content rendering when no chartable table exists — `diagram`, `tree`, `timeline`, `layout`, `drawing`) + agent-oriented `TEMPLATE_AUTHORING_METADATA` + the sole public block→layer API `materializeBlockLayers` + animationUtils + themeUtils + markdownToDoc + docToMarkdown (media annotations re-emitted from `MediaClip.origin`; reconciles each block's current `template`/`templateOverrides` with its heading annotation so programmatic edits round-trip, reusing agreeing annotations verbatim — legacy spellings included — so untouched docs stay byte-identical; pass `DocToMarkdownOptions.defaultTemplate` to match the `defaultTemplate` the doc was parsed with, or every plain heading comes back annotated) + resolveAudioMapping (now runs `applyNarrationTiming` first and excludes scheduled-media srcs from segment auto-discovery) + `applyNarrationTiming` (document-anchored narration take + v3 timing sidecar → voice-timed block startTime/duration; author-pinned `duration=`/`startTime=` win with a `narration-pin-conflict` info diagnostic) + **`resolveDataReferences`** (the DATA sibling of `resolveAudioMapping`: async, container-reading, PROJECTION-ONLY — `{[dataTable src=report_files/data/q3.csv]}` blocks (any TABLE_FED template; `sheet`/`anchor`/`headerRow` address inside an .xlsx src, `previewRows` widens the window) get `templateData.headers`/`rows` filled with a bounded preview + `srcStats` `{totalRows,totalCols,previewRows,truncated}`; author data wins, failures become diagnostics (`data-src-missing`/`-no-reader`/`-parse`/`-sheet-missing`), untouched docs return the same object, and a resolved doc must NEVER be serialized back through `docToMarkdown`) + the `DataSourceReader` seam (`DataSourceTable`/`DataSourceReadOptions` — implementations live in `@bendyline/squisq-formats/data`, keeping core parser-free) + `isDataFilePath` / `dataSidecarPrefix` / `DATA_FILE_EXTENSIONS` (the `<docbasename>_files/data/` convention) + `getPinnedBlockMeta` + `getBlockBodyText` + custom-templates frontmatter codec + custom-themes frontmatter codec (`readCustomThemesFromFrontmatter` / `writeCustomThemesToFrontmatter`) + `resolveThemeForDoc` (pure doc-scoped theme resolution) + template-param tooling (`TEMPLATE_INPUT_DESCRIPTORS`, `coerceTemplateParams`, `lintTemplateParams`) + `replaceDataFence` (data-fence rewriter) + the ASCII diagram codec (`parseAsciiDiagram` / `renderAsciiDiagram` / `detectAsciiDiagram` / `isAsciiDiagramFence` / `isEligibleAsciiFenceLang` / `isExplicitDiagramLang` / `repairAsciiDiagram` / `isRepairableDiagram`, mapping helpers `asciiDiagramToTemplateData` / `asciiDiagramFromTemplateData` / `asciiDiagramFromBlocks` / `asciiCellToCanvas` / `canvasToAsciiCell`, constants `ASCII_CHAR_W` / `ASCII_CHAR_H`) + the ASCII tree codec (`parseTree` / `renderTree` / `detectTree` / `isTreeFence` / `isEligibleTreeFenceLang` / `isExplicitTreeLang`, mapping helpers `treeToTemplateData` / `treeFromTemplateData` / `treeFromMarkdownList`) + the ASCII timeline codec (`parseAsciiTimeline` / `renderAsciiTimeline` / `detectAsciiTimeline` / `isAsciiTimelineFence` / `isEligibleAsciiTimelineFenceLang` / `isExplicitTimelineLang`, mapping helper `asciiTimelineToTemplateData`) + the Page (linear) mode pipeline: `materializePageSections` / `materializePageSection` (block → variable-height `PageSection` with content slots; doc-level walk applies cover synthesis+dedupe, background rhythm, accent rotation, emphasis curve), `resolvePageStyle` (theme.pageStyle ?? derived default, with transform-page-hint overlay), `resolvePageBlock` / `isTemplatedPageBlock` (typed-input merge shared with canvas embeds), `sectionExtractors` (all 33 templates → section kinds; spatial templates + charts → `canvas-embed`), and the page CSS source (`PAGE_BASE_CSS`, `buildPageCssVars`, `buildPageCss`, `pageStyleDataAttributes`) + the Slideshow (slide) mode projection: `buildPreviewDoc` / `documentTitleFromFileName` / `BuildPreviewDocOptions` — the slide-mode sibling of `materializePageSections`, turning a markdown-derived Doc into the flat, player-ready `TemplateBlock` sequence the DocPlayer renders (implicit `sectionHeader` → loss-averse `content`, derived template inputs, interleaved images, synthetic audio clock). The editor preview, HTML slideshow export, and `docToPptx` all run through it, so the slide sequence cannot drift by consumer. `expandDocBlocks` then schedules that sequence; discrete-slide consumers pass `splitLongBlocks: false` + `mergeShortBlocks: false` so the audio-timed path's video-pacing passes neither duplicate nor delete authored slides + the Dashboard mode pipeline: `materializeDashboard` / `composeDashboardLayers` (doc → ONE canvas of cells, each block rendered at its cell's size), the layout model (`DashboardLayoutDefinition` %-rect cells with orientation variants, `validateDashboardLayoutDefinition`, `layoutCapacity`, `transposeCells`, `resolveLayoutCells`), `BUILTIN_DASHBOARD_LAYOUTS` + `chooseDashboardLayout` (auto-pick ladder) + `resolveDashboardLayoutDefinition` + `getDashboardLayoutSummaries` / `listDashboardLayouts`, `resolveDashboardSettings` + `DASHBOARD_FRONTMATTER_KEYS` / `DEFAULT_DASHBOARD_SETTINGS` (`squisq-dashboard-layout`, `squisq-dashboard-title` — title band default ON when a title resolves), and the custom-layout frontmatter codec `readDashboardLayoutsFromFrontmatter` / `writeDashboardLayoutsToFrontmatter` (`squisq-dashboard-layouts`, compact JSON keyed by name), plus the cell-zoom ladder `DASHBOARD_ZOOM_LEVELS` / `normalizeDashboardZoom` / `desiredCellZoom` / `resolveDashboardZooms` (`squisq-dashboard-zoom`, default `auto`: short text-led cells render 1.5×/2× type via a per-cell `fontScale` multiplier, quantized to at most one boost level per dashboard; a cell definition's `zoom` pin wins and autos rally to it), plus the cell-style axis `DASHBOARD_STYLES` / `DASHBOARD_STYLE_IDS` / `DEFAULT_DASHBOARD_STYLE` / `resolveDashboardStyleId` / `buildDashboardCellChrome` / `dashboardCanvasFill` / `dashboardCellAccent` / `stripBlockBackdropLayer` (`squisq-dashboard-style`, default `basic`: `card` / `panel` / `accent` dress each cell with theme-derived chrome — canvas tint, elevation, border, accent bar/wash — while the layout keeps owning the geometry; `DashboardCell.frame` carries the behind/overlay layers and the percentage `contentRadiusPct` a host clips the cell with)
- `@bendyline/squisq/spatial` — Haversine, Geohash utilities
- `@bendyline/squisq/storage` — StorageAdapter, MemoryStorageAdapter, LocalStorageAdapter, LocalForageAdapter, ContentContainer, MemoryContentContainer, ScopedContentContainer, createMediaProviderFromContainer
- `@bendyline/squisq/markdown` — Markdown parsing, stringifying, AST types (MarkdownDocument — including the `superscript` / `subscript` inline nodes, whose SOURCE form is inline HTML: micromark hands `<sup>x</sup>` back as three UNPAIRED nodes, and `convertInlineChildren`'s `foldPairedInlineHtml` pass folds a BARE tag pair into one container node so consumers treat it like `strong` instead of rebuilding an empty `<sup></sup>` with the content stranded beside it; `inlineChildrenToMdast` expands it back to the same three tokens, so parse → stringify stays byte-identical. A tag with attributes, an unmatched tag, or a pair split across a formatting boundary stays raw `htmlInline`), tree utilities, frontmatter helpers (incl. `splitFrontmatterBlock` — raw frontmatter/body split preserving comment-only and empty blocks), HTML sub-DOM, and **markdown source transforms** (`MARKDOWN_SOURCE_TRANSFORMS` registry + `applyMarkdownSourceTransform` / `unwrapMarkdownSource` / `wrapMarkdownSource` / `cleanupMarkdownSource` / `DEFAULT_WRAP_WIDTH` — one-time string→string rewrites of markdown SOURCE TEXT: unwrap forced line wrapping, wrap prose at a column width, canonical house-style cleanup. Wrap/unwrap rewrite only paragraph prose located by position — headings/tables/code/math/HTML/frontmatter stay byte-identical, hard breaks and inline code/math/HTML/link-resource/mention/`{[…]}` spans are protected, and every transform reparses its output and structurally compares it against the input, degrading to a no-op — or throwing under `strict` — rather than risking corruption. Distinct from `@bendyline/squisq/transform`, the slideshow style pipeline) + `detectMarkdownWrapState` (the document's prevailing wrap convention: `unwrapped`/`wrapped` (+snapped `width`)/`mixed`/`no-prose`; hard-break lines are never wrap evidence and a candidate below 40 columns is inconclusive)
- `@bendyline/squisq/timing` — Narration/reading time estimation (estimateNarrationTime, estimateReadingTime, countSpokenWords)
- `@bendyline/squisq/random` — SeededRandom PRNG, hashString
- `@bendyline/squisq/generate` — Content extraction only (`extractContent`, `stripMarkdown`, `mapElementToBlock`). The legacy `generateSlideshow` was **removed** in v1.5 — use `markdownToDoc` + `applyTransform` instead. `extractContent`/`stripMarkdown` output shapes are a frozen public contract used directly by downstream consumers.
- `@bendyline/squisq/transform` — Slideshow transform pipeline: `applyTransform`, `resolveTransformStyle`, `createTransformStyleRegistry` (explicit caller-owned custom styles; no process-global mutation), 5 built-in styles (`data-driven`, `documentary`, `magazine`, `minimal`, `narrative`), block analyzer, doc-image extractor. `applyTransform` accepts a canonical style id or a call-scoped `TransformStyleConfig`; caller-owned ids resolve through `TransformOptions.registry`. Historical persisted `dataDriven` remains readable as `data-driven`, but ids/writes are canonical. Style contract v2: `templateMap` (per-style extraction→template remap, translated via `translateTemplateBlock`), `suggestedThemeId` (applied when neither caller nor doc declares a theme), `pacing` (intro/outro bookends), `budget.slidesPerMinute` (duration-based promotion cap), `page` (Page-mode hints — `spacing` overlay + `emphasisCurve`; consumers pass it as `MaterializePageSectionsOptions.transformPage`). Transform output carries provenance: extraction slides get `sourceBlockId`/`sourceCharOffset`, and `sourceStartTime`/`sourceDuration` are real doc-timeline SECONDS derived from the source block's timing (voice-timed when the doc has a narration take) — `allocateTiming` anchors such slides at their narration positions (floats fill the gaps; contiguous timeline), falling back to the historical rescale-to-fit when no anchors exist.
- `@bendyline/squisq/versions` — Document version history: `DocumentVersionManager` plus `saveVersion` / `listVersions` / `readVersion` / `revertToVersion` / `pruneVersions` / `coalesceVersions`, `PrunePolicy`, `Version` types, sortable-timestamp + path helpers. Snapshots live inside the same `ContentContainer` as the doc at `.versions/<basename>.<timestamp>.md`, so they ride along through ZIP serialization. Saving history also maintains a container-root `.gitignore` rule for `.versions/`, which keeps snapshots out of Git when the container is persisted as a `*_files/` sidecar folder. **`revertToVersion` is fail-safe:** it snapshots the current state first and, if that snapshot can't be written, ABANDONS the revert (`RevertResult.reason: 'snapshot-failed'`) rather than destroying unrecoverable state. Hosts whose live document lives outside the container (an editor buffer) MUST pass `RevertOptions.content` — otherwise the snapshot reads stale container bytes, or yields `no-document` and the revert declines. Pass `snapshotCurrent: false` when the caller has already preserved the current state itself. `revertToImageEditVersion` mirrors this contract with `RevertImageEditOptions.doc`.
- `@bendyline/squisq/jsonForm` — JSON Form headless logic. Exports the `SquisqAnnotatedSchema` / `SquisqHints` / `SquisqWhen` / `ControlKind` types, `chooseControl()` (the dispatcher both `<JsonView>` and `<JsonEditor>` use), `evaluateWhen()` / `resolveFlag()` (conditional visibility / disabled rules), `inferSchema()` (sample → JSON Schema via genson-js), and JSON Pointer helpers (`getByPointer`, `setByPointer`, `resolveRef`).
- `@bendyline/squisq/imageEdit` — Layered raster authoring: `ImageEditDoc` schema re-exports, state helpers (`addLayer`, `removeLayer`, `reorderLayer`, `updateLayer`, `setCanvas`), persistence (`readImageEditDoc`, `writeImageEditDoc`), version operations (`saveImageEditVersion`, `listImageEditVersions`, etc. — parallels `versions/` over JSON state), `ImageEditVersionManager`, and the SVG → raster export.
- `@bendyline/squisq/icons` — FontAwesome Free catalog (`ICONS`, `IconEntry`, `IconFamily`) and lookup helpers (`resolveIcon`, `canonicalIconToken`, `looksLikeIconToken`, `suggestIcons`, `iconGlyph`).
- `@bendyline/squisq/recommend` — Block-content profiler + template recommendations for the editor's block template picker: `profileBlockContents`, `recommendTemplatesForBlock`.
- `@bendyline/squisq/narration` — Narration/teleprompter engine (pure TS, zero deps, no DOM — deterministic and Node-testable). Script model: `buildNarrationScript` (Doc → `NarrationScript` word tokens with char offsets, syllable estimates, pause classes, per-block ranges; standalone punctuation runs — a lone em-dash/bullet — are marked `spoken: false` with 0 syllables so they display but are never the active-word highlight, never paused on, and add nothing to pacing/alignment) + query helpers (`expectedSyllablesAt`, `wordPosAtExpectedSyllables`, `wordIndexAtChar`, `wordIndexAtTime`) + `estimateSyllables`. Streaming DSP over mono `Float32Array` PCM: `createFeatureState`/`featureStep`/`extractFrameFeatures` (RBJ-biquad 250–3000 Hz band energy, RMS, ZCR), adaptive VAD (`createVadState`/`vadStep` — low-percentile noise floor, hysteresis + hangover, dip-starved rebaseline), syllable-nuclei detection (`createNucleiState`/`nucleiStep`/`detectSyllableOnsets`). Voice-adaptive pacing controller (`createPacingState`/`pacingStep`/`reanchorPacing` — cruise velocity BLENDS the user's set WPM (feedforward, always felt) with the detected syllable rate via `voiceBlend`, so the WPM slider is a real lever and an under-counting detector can't stall the prompter; halts on silence; a FORWARD-ONLY catch-up boost + resync speeds up when the reader is ahead but never drags the highlight backward on a false "prompter ahead" signal) + session composition (`createNarrationSession`/`narrationSessionStep`/`reanchorSession`) + live trace helpers (`traceWordPosAt`/`downsampleTrace`). Offline refinement: `alignNarration` (banded DTW of detected syllables/gaps vs expected syllable/pause slots, optionally band-constrained by the live trace) → per-word timestamps + contiguous per-block `startSec`/`endSec` ranges. Timing sidecar v3 codec: `buildNarrationTimingJson`/`parseNarrationTimingJson` (`NarrationTimingJsonV3` — strict superset of the recorder's v1 `{sourceText, duration, bookmarks}` shape, adding filled word bookmarks + per-block ranges + `cameraOffsetSec`; v1 files parse with empty blocks). Presenter-advance timings (`advanceTiming.ts`) are the OBSERVED alternative to the aligner, for a take where the presenter drove the slides themselves: `recordSlideShown` maintains a first-shown-only, monotonic `SlideAdvanceLog` (a revisit returns the SAME array reference, so it is safe in a React state updater), and `buildAdvanceTimingJson(doc, advances, durationSec)` turns it into the same `NarrationTimingJsonV3` — one entry per `flattenRenderableBlocks` block in document order, contiguous, spanning exactly `[0, duration]`, with `generator.method: 'presenter-advance'` (`NarrationTimingMethod` widens the union) and empty `bookmarks` (no word timings were measured, and they are documented as per-word). Blocks the presenter never reached get ZERO-LENGTH ranges so playback skips them while the sidecar stays complete; `advanceCoverage` reports how many. Char ranges come from `buildNarrationScript` keyed by `blockId` — never positionally, since the script omits blocks with no spoken text. All tuning configs exported with `DEFAULT_*` frozen defaults.
- `@bendyline/squisq/fence` — Host-pluggable fence-renderer contract (`FenceRendererMap` and friends) shared by the react read path and the editor's `HostFenceExtension`.
- `@bendyline/squisq/icon-marker` — Inline icon marker codec (`iconMarker`, `splitIconMarkers`, `stripIconMarkers`) used to embed resolved icons in plain text runs.
- `@bendyline/squisq/proof` — Proofing (grammar + spellcheck) support, pure and zero-dep: `ProofFinding`/`ProofCategory`/`ProofSuggestion`/`ProofDialect` types + `PROOF_DIALECTS`, `LINT_KIND_CATEGORIES`/`categorizeLintKind` (harper's 21 LintKinds → spelling|grammar|style tiers; unknown kinds degrade to style), `blankProtectedSpans`/`dropMaskedFindings` (`{[…]}` annotations blanked to equal-length spaces so engine offsets stay byte-identical; findings intersecting blanks dropped), `buildJoinedText`/`mapJoinedSpanToSegment`/`PROOF_JOIN_SEPARATOR` (many textblocks → ONE engine call with exact offset round-trips), and the frontmatter codec (`PROOF_FRONTMATTER_KEYS` — `squisq-proofing` / `-proof-dialect` / `-proof-dictionary` only, `DEFAULT_PROOF_SETTINGS`, `readProofingSettings`, `parseProofDictionary`/`formatProofDictionary`, `resolveProofDialect`; ignored findings deliberately have NO frontmatter key — they are host-persisted per document). The harper.js engine adapter + all UI live in `@bendyline/squisq-editor-react`.
- `@bendyline/squisq/table` — The tabular-data VIEW + PROVIDER contract shared by the grid, the sidecar readers, and exports: `TableQueryProvider` (`describe`/`setView`/`rows`/optional `applyEdits`/`dispose`) with `TableSchema`/`TableRowsPage`/`TableCellEdit`/`TableEditResult` (`staleView` — an edit touched an active sort/filter column; the UI offers refresh, never auto-re-permutes), and the **view-state grammar**: `parseTableViewState`/`serializeTableViewState` over `sort=Revenue:desc,Region` (multi-term, `:asc|:desc`, default asc) and `filter="Region=West;Revenue>=1000"` (AND-only; text ops `= != ~ !~ ^~ $~` — contains/starts-with/ends-with, CASE-INSENSITIVE by default with a `*` suffix for case-sensitive (`Region=*West`, `FilterClause.caseSensitive`) — plus comparison ops `> < >= <=`) — names/values quoted CSV-style (`""` doubling, NO backslashes; `^ $ *` are op/modifier chars and force quoting). Parsing never throws: unknown columns/malformed params drop with `ViewIssue`s (`data-view-unknown-column`/`data-view-invalid`). `applyTableViewState` is the pure reference implementation (filter → stable sort, blanks last, numeric columns via the shared `isNumericCellText`/`inferNumericColumn` rule, strings via `makeTableCollator`) that the grid-react worker kernel is parity-tested against. These `sort`/`filter` annotation params ride the OWNING heading (`{[dataTable src=… sort=…]}`), are applied INSIDE the formats readers over the FULL body before windowing, and therefore shape previews and exports — the author's sort IS part of the document.

`@bendyline/squisq-react` exports everything from the root plus a standalone IIFE bundle:

- Components: DocPlayer, BlockRenderer, CaptionOverlay, SocialCaptionOverlay, DocProgressBar, DocControlsOverlay/Bottom/Sidebar/Slideshow, DocPlayerWithSidebar, LinearDocView (the Page rendition — variable-height HTML sections; props gained `showCover` + `transformPage`), DashboardView (the Dashboard rendition — one static canvas of per-cell BlockRenderers via core `materializeDashboard`, plus each cell's style chrome (`style` prop / `squisq-dashboard-style`: basic|card|panel|accent); DocPlayer `displayMode: 'dashboard'` renders it (prop `dashboardStyle`), and in render mode it publishes a minimal SquisqRenderAPI whose `seekTo` resolves when assets settle so single-frame capture waits on the same contract as slides), PageSectionView + CanvasSection + PageViewContext/usePageView (the page section family), MarkdownRenderer, InlineVideoPlayer, InlineAudioPlayer, JsonView (read-only viewer for JSON values bound to a Squisq-annotated schema)
- Hooks: useAudioSync, useDocPlayback, useViewportOrientation, useAutoSurface (light/dark surface detection), MediaContext/useMediaProvider/useMediaUrl
- Layers: ImageLayer, TextLayer, ShapeLayer, VideoLayer, MapLayer, TableLayer (HTML table embedded via `<foreignObject>`), TreeLayer (interactive filesystem treeview — folder/file icons, connector rails, collapse chevrons — via `<foreignObject>`; interactive in the player, captured expanded in exports)
- Styles: `@bendyline/squisq-react/styles` for CSS (covers DocPlayer animations + `<JsonView>`)
- Standalone bundle: `@bendyline/squisq-react/standalone` and `/standalone-source` — IIFE bundle (`PLAYER_BUNDLE`) used by `formats/html` and `cli` to embed a complete player in a single HTML file. `mount()` returns a `SquisqPlayerHandle`; `getHandle(element)` recovers it, and render controls stay instance-scoped rather than being copied onto `window`. `MountOptions.mode` is `'slideshow' | 'static' | 'dashboard'` — dashboard mounts size their canvas from the host element's box and (in render mode) expose the dashboard render API through the same handle, which is what the CLI's single-frame PNG capture polls for.

`@bendyline/squisq-formats` exposes 11 subpath entries:

- `@bendyline/squisq-formats/docx` — DOCX import/export (markdownDocToDocx, docxToMarkdownDoc, docToDocx, docxToDoc). Footnotes AND endnotes import as GFM footnotes and export as real Word footnotes, always on. Import finishes with `renumberFootnotes` (`shared/footnotes.ts`): Word numbers its notes and gives them no label, so the identifiers are the importer's invention (`fn1`, `endnote2`) and would otherwise leak into the markdown — renumbering by reference order makes `markdown → DOCX → markdown` return the source **byte-identical**, and collapses the separate footnote/endnote id spaces so `fn1` and `endnote1` cannot collide
- `@bendyline/squisq-formats/ooxml` — Shared OOXML package reader/writer, XML utilities, namespace constants, shared DOM-read helpers (`attrNS`, `resolveTarget`, `baseDirOf`, `findRelByType`), main-part resolution (`resolveMainPartPath` / `requireMainPartPath` — per OPC the main part is whatever the **root** `officeDocument` relationship targets; `word/document.xml` / `xl/workbook.xml` / `ppt/presentation.xml` are conventions and are used only as a fallback. Every importer resolves through these, and a package with no main part throws rather than importing as an empty document), and the theme reader (`parseThemeXml`, `readThemePart` — `theme1.xml` clrScheme/fontScheme with sysClr fallbacks). OOXML readers accept `ZipSafetyLimits` and use the shared bounded JSZip member-stream engine; failures are structured `ZipSafetyError`s. OOXML **export** emits `w:rPr` / `a:rPr` children in ECMA-376 sequence order (`EG_RPrBase`, `CT_TextCharacterProperties`); `ooxmlSchemaOrder.test.ts` validates every run-property element in real generated parts against those sequences.
- `@bendyline/squisq-formats/pdf` — PDF import/export (markdownDocToPdf, pdfToMarkdownDoc, configurePdfWorker). Footnote markers draw as raised numbers off the shared `FootnoteIndex` (via `TextSpan.baselineShift`, the same mechanism superscript/subscript runs use) rather than the bracketed raw identifier they used to print on the baseline
- `@bendyline/squisq-formats/html` — **GFM footnotes are reconnected on import** (`html/footnoteImport.ts`): a footnote is two disconnected things in HTML — a marker anchor in the prose and an `<li>` at the foot of the page joined only by a fragment id — so import lifts the definitions out BEFORE sanitization (a `<section data-footnotes>` is not on the element allowlist, so afterwards the wrapper is gone), drops backlinks, shortens generator ids (`user-content-fn-1` → `1`), and rewrites marker links to `footnoteReference`. Deliberately conservative: it fires only when the page marks a footnotes CONTAINER (`data-footnotes`, `class="footnotes"`/`squisq-footnotes`, EPUB `epub:type="footnotes"`), and a link only converts when it is superscript-wrapped or marker-labelled — a prose link to a note stays a link. Export: `docToHtml` (single self-contained file with inlined player + data-URI images), `docToHtmlZip` (multi-file ZIP with external assets + optional audio), `collectImagePaths`, `inferMimeType`, plus the `markdownDocToPlainHtml` / `markdownDocsToPlainHtmlBundle` / `markdownDocsToHtmlBundle` static-rendering paths and HTML import (`htmlToMarkdown`, `htmlToMarkdownDoc`, `htmlToMarkdownDocSync`). Export needs `PLAYER_BUNDLE` from `@bendyline/squisq-react/standalone-source`.
- `@bendyline/squisq-formats/epub` — EPUB 3 e-book export (markdownDocToEpub, docToEpub). Footnotes render per chapter as an `epub:type="footnotes"` aside with `epub:type="noteref"` markers, numbered from a DOCUMENT-wide `FootnoteIndex` (`shared/footnotes.ts`) so numbers don't restart per chapter and a definition can live in a different chapter from its citation
- `@bendyline/squisq-formats/pptx` — PPTX export (docToPptx, markdownDocToPptx) + import (pptxToMarkdownDoc, pptxToDoc; covers slide text/lists/tables + slide-level embedded images via `pptxToContainer`). **`docToPptx` is the deck exporter** and what the registry / CLI / site all call: it runs the Doc through core's `buildPreviewDoc` slideshow projection, expands it with the video-pacing passes off, and maps the materialized layers to native DrawingML — one authored block per slide, plus the managed cover, matching the browser slideshow. `markdownDocToPptx` is the semantic-markdown fallback (heading segmentation, `slideBreak` default `'h2'`), used for Docs with no template blocks at all; calling it directly on an authored deck collapses every `###` slide into its parent section. Import infers the deck's theme and slide layouts **by default** (`inferTheme` / `inferLayouts` options, pass `false` to opt out): the theme rides as `squisq-custom-themes` + `squisq-theme` frontmatter, slide headings get `{[template]}` annotations matched to built-ins (title, sectionHeader, twoColumn, leftFeature/rightFeature, imageWithCaption, photoGrid), and distinctive layouts become `squisq-custom-templates` definitions. Layout inference is also exposed directly: `analyzePptxLayouts(pkg, opts)` and `inspectPptxLayouts(bytes, opts)` (per-layout verdict summaries for UI confirmation).
- `@bendyline/squisq-formats/xlsx` — XLSX import (xlsxToMarkdownDoc, xlsxToDoc) + export (markdownDocToXlsx, docToXlsx; both return `Promise<ArrayBuffer>`). **A cell's rich text is read, not flattened.** A worksheet records a footnote marker as a `vertAlign` RUN PROPERTY (`Fresh¹` is one cell whose `1` is an ordinary character with a property), so import reads `<si>`/`<is>` runs and emits `Fresh<sup>1</sup>`; `XlsxCell.richText` is additive — `text` stays the flattened string, so region detection, header sniffing, numeric inference and export placement are untouched. Export mirrors it: a cell carrying alignment is written as SpreadsheetML `<r>` runs, everything else keeps the flat single-`<t>` form. **A sheet is not one table.** Import splits each worksheet into its contiguous **data islands** and gives each its own block, anchored on the heading annotation: `## Q3 Revenue {[dataTable sheet=Sales anchor=B4]}`. Those params (`sheet`, `anchor`, plus `headerRow=false` when row 1 isn't a header and `titleAnchor` when a caption cell was promoted into the heading) are what let export put each table back where it came from. A region containing formulas also emits a `role=formulas` companion table whose **header row is the source column letters** — so its body rows cover every source row and each column names its own sheet address — and every left-over single cell on a sheet coalesces into one `role=loose` `Cell | Value` table rather than N one-cell blocks. Shared formulas (`<f t="shared">`, the fill-down pattern) are expanded onto their followers by A1 relative-ref translation; a follower that can't be translated is dropped rather than guessed at. Pass `{ regions: false }` (CLI `--no-xlsx-regions`) for the historical one-table-per-sheet output, `{ formulas: false }` (`--no-xlsx-formulas`) to suppress the companion tables. Export is still tables-only: an **unannotated** table keeps the historical behavior exactly (its own worksheet, named from the nearest preceding heading, grid at A1), while anchored tables group onto shared worksheets at their own addresses. Placement problems (a malformed anchor, overlapping regions) degrade with an `onWarning` message — never a throw; `maxCells` remains the only hard error. `inferNumericCells` now defaults to **true for anchored tables** (provably spreadsheet-origin) and false otherwise. Dates/percents still export as text, and merged ranges inform region detection but are not re-emitted. A region heading only survives the trip back when it carries `titleAnchor` (i.e. it came from a caption cell) — a hand-written heading over an anchored table has no cell to live in, so on re-import it reverts to the derived `Sheet — anchor` form. **`xlsxToContainer` is the sidecar-aware container import**: small regions emit byte-identically to `xlsxToMarkdownDoc`, but a region past the inline thresholds (`maxInlineRows` default 100 / `maxInlineCells` default 2000; `sidecar: 'auto'|'always'|'never'`) becomes a `{[dataTable src=<slug>_files/data/<source> sheet=… anchor=…]}` reference + body link, with the ORIGINAL workbook kept as the one sidecar (no per-region extraction — formulas stay intact inside it, so spilled regions emit no `role=formulas` companion). Doc-only `xlsxToMarkdownDoc` never spills (a `src` with no sidecar written would be a broken reference). Export closes the loop: the registry's xlsx exporter runs `materializeDataReferences` first, so a src-referenced block exports its FULL values at the recorded address. **`xlsxToCellGrids` is the raw-grid public view** (`XlsxWorkbookGrids`: per-sheet `XlsxCell[][]` with `formula` AND cached `value` colocated, plus `date1904` and `fullCalcOnLoad` — the `<calcPr>` "don't trust my cache" flag): the lowest-level path, consumed by the corpus cached-value oracle (`tests/corpus/`) and by calculation-engine feeding; `XlsxCell`/`XlsxCellKind`/`CellRect` types are exported alongside it. **`patchXlsxCellValues(bytes, patches)` is in-place cell-value patching** — the grid's XLSX save path: only the touched worksheet parts (plus `xl/workbook.xml`) are rewritten, every other archive member survives with byte-identical uncompressed content, and refusals are all-or-nothing structured `XlsxPatchRefusal`s (`formula-cell`, `shared-formula-follower` — the fill-down cell that LOOKS empty, `date-value-unsupported` — clearing with `null` stays legal, `sheet-missing`, `cell-ref-invalid`). Number → `<v>`, boolean → `t="b"`, string → `t="inlineStr"` (a shared-string cell switches to inlineStr; orphaned sst entries are legal), and a successful patch sets `<calcPr fullCalcOnLoad="1"/>` in CT_Workbook sequence position so Excel recomputes rather than trusting caches over patched inputs. XML goes through the package-owned xmldom parser AND serializer in every environment for determinism. A patch may instead carry `formula` (+ optional `cachedValue`) — the grid's FORMULA-edit save path: the cell's `<f>` is replaced (string results cached as `t="str"`), a shared-formula FOLLOWER may leave its group but replacing a shared MASTER is refused (`shared-formula-master` — its followers' `si` would dangle), and `XlsxCell.sharedFormulaRole` marks masters/followers on import so editors can lock accordingly. `listSheetParts`/`SheetRef` and `formatCellRef`/`parseCellRef` are exported alongside it.
- `@bendyline/squisq-formats/csv` — CSV import/export (parseCsv, csvToMarkdownDoc, csvToDoc, markdownDocToCsv) + `csvToContainer` (sidecar-aware container import: below the inline thresholds the doc is byte-identical to `csvToMarkdownDoc`; above them — or with `sidecar: 'always'`, the CSV-open-as-document mode — the ORIGINAL bytes land at `<docbasename>_files/data/<name>` and the doc becomes a `{[dataTable src=…]}` reference block + body link)
- `@bendyline/squisq-formats/data` — **Data sidecar support**: `csvDataReader` / `xlsxDataReader` (region-aware via `xlsxToTables`, addressed by the same `sheet`/`anchor` params the XLSX round-trip uses) / `parquetDataReader` (optional peer `hyparquet`, dynamic-import only — the harper.js semantics) + `defaultDataReaders()`, the implementations behind core's `resolveDataReferences` seam; sidecar naming (`planDataSidecar`, `docSlugForFileName`, `sidecarReferenceDoc`/`sidecarReferenceMarkdown` — one module owns `<docbasename>_files/data/<file>` so the `src` param and the container write can't disagree); and `materializeDataReferences` (markdown-level FULL-table embed used by XLSX export so a src-referenced block exports its values at the recorded sheet/anchor instead of vanishing, warning that sidecar formulas weren't carried)
- `@bendyline/squisq-formats/container` — ContentContainer ZIP serialization (`containerToZip`, `zipToContainer`). `zipToContainer` accepts `ZipSafetyLimits`; paths, declared metadata, per-entry bytes, aggregate emitted bytes, compression ratio, CRC, and size agreement are enforced by the same bounded stream engine used for OOXML imports.
- `@bendyline/squisq-formats/registry` — Format registry + programmatic `convert()` front door: `convert(source, targetFormatId, opts?)`, `createRegistry` / `defaultRegistry` / `defaultFormats`, `FormatRegistry` / `FormatDefinition` / `ConversionResult` / `ConvertSource` types, `BUILTIN_FORMAT_IDS`, and structured `ConversionError` (+ `ConversionErrorCode`). PPTX import inference threads through `ConvertOptions.formatOptions.pptx.{inferTheme,inferLayouts}` (default on; `false` disables). XLSX and CSV now define `importContainer` (→ `xlsxToContainer`/`csvToContainer`, sidecar-aware; thresholds + `sidecar` mode + `sourceName` thread through `formatOptions.{xlsx,csv}`), htmlzip carries data sidecar files into the archive at their exact paths so body links resolve after unzip, single-file HTML/EPUB emit a lossy warning per unresolvable data reference, and the xlsx exporter materializes src-referenced blocks to full tables before planning
- `@bendyline/squisq-formats/infer` — "Infer theme from a file import": `inferThemeFromFile(bytes, { format?, inferLayouts?, nameHint? })` sniffs DOCX/PPTX/XLSX, reads the OOXML theme part, and returns `{ theme, extraction, layouts?, warnings }` — a compiled, validated Squisq `Theme` (seeds from clrScheme via the master `clrMap`, so dark decks invert correctly; fonts via core `matchFontFamily`) plus, for PPTX with `inferLayouts`, `CustomTemplateDefinition`s from distinctive slide layouts. PDF is rejected (`unsupported-input` — no theme tables). Also exports the per-format extractors (`extractDocxTheme` / `extractPptxTheme` / `extractXlsxTheme`), `compileExtractedTheme`, and `colorHintsFromExtraction`

`@bendyline/squisq-editor-react` exports everything from the root, plus granular subpath entries (`/monaco`, `/monaco-workers`, `/shell`, `/json-editor`, `/image-editor`, `/recorder`, `/teleprompter`, `/proofing`, `/styles`):

- Components: EditorShell, RawEditor, WysiwygEditor, PreviewPanel, PlainHtmlPreview, Toolbar, StatusBar, ViewSwitcher, ViewMenuPanel, TransformMenu (toolbar popover applying core's markdown source transforms — unwrap/wrap-at-width/cleanup — with a detected wrap-state readout; Source view applies as minimal Monaco `executeEdits` between undo stops for a single byte-exact undo step, Write view as one `setMarkdownSource` write/one Tiptap history entry, Use view disabled with a hint; takes a pre-apply version snapshot when versioning is enabled), OutlinePanel, PreviewControls (+ PreviewSettingsProvider + PreviewToolbarControls + usePreviewSettings), VersionHistoryPanel, InlinePreviewGutter, ThemePicker, ThemeCustomizerPanel, TemplatePicker, templateLabel, DocumentSettingsDialog, EmojiPicker (+ `PICKER_CATEGORIES`, `ALL_PICKER_ENTRIES`, `searchPickerEntries`), LinkDialog, MediaBin, ImageEditor, ImageViewer, ImageNodeView, TooltipLayer, DropZoneOverlay, RecorderSlidesPanel (+ `buildRecorderSlideDeck` and the `slidesModePolicy` helpers), JsonEditor (editable form for JSON values bound to a Squisq-annotated schema; embeds `WysiwygEditor` for `richtext` controls)
- Context: EditorProvider, useEditorContext
- File-kind detection: `resolveFileKind`, `detectLanguageFromFileName` — useful for hosts that want to pre-decide chrome around the editor based on whether a file is markdown or code
- Drag-and-drop: `useFileDrop` (HTML5 drop classification), `classifyFile` (now with a `'data'` category for csv/tsv/xlsx/parquet — these used to be silently discarded), `partitionFiles`, `processMediaFiles`, `processDataFiles` (stores under `dataSidecarPrefix(docBasename)` with collision suffixing), `processTextFile`, `processTextFiles`. A dropped or Files-panel-uploaded data file lands in `<docbasename>_files/data/` and inserts a `## <title> {[dataTable src=…]}` reference block + body link (`EditorShell.insertDataRef`), which the Write view renders as the ALWAYS-GRID data card (`DataCardExtension` + `DataCardWidget`, exported with `dataLinkHrefOf`/`findDataCardBlockPos`/`loadDataPreview`): the widget lazily imports `@bendyline/squisq-grid-react` (a regular dependency, but only ever loaded via dynamic `import()` — code-split, with the compact preview card as the runtime FALLBACK when the module fails to load) and mounts the real virtualized grid under the card's identity strip. Sort/filter round-trip through the OWNING heading's annotation params via `readHeadingViewBinding`/`writeHeadingViewState` (persisted ONLY when the heading's template is table-fed AND its `src` equals the card's href — otherwise session-only with a footer hint; writes are single-transaction PM-undoable `dataTemplateParams` updates, byte-stable on repeat). CSV/TSV edits save in place through `saveCsvEdits` (`ingestSidecarBytes` sniffs and reproduces delimiter/newline/trailing-newline/BOM; unedited cells re-serialize from the parse product so `-5` survives; formula-prefix neutralization applies ONLY to edited non-numeric cells; `.versions/data/` backup via core `buildDataBackupPath`, pruned to 3; `addMedia` fork detection). XLSX edits save through `saveXlsxEdits` → formats `patchXlsxCellValues`. XLSX FORMULA editing runs on a `@bendyline/squisq-calc` in-house-engine session (`createXlsxFormulaSession` — lazily imported, seeded from the FULL workbook, interactive budgets: an over-budget workbook degrades to value-only editing rather than hanging): formula cells edit as `=source` with live dependent recalc pushed into the grid (a `#NAME?` result never overwrites a cached display), edits persist as formula+cachedValue patches, and only date cells + shared-formula masters stay locked; parquet stays read-only; the preview pipeline (`usePreviewProjection`) chains `resolveDataReferences` after `resolveAudioMapping` with the formats readers loaded lazily, re-resolving on `mediaRevision` bumps
- Bridge: `markdownToTiptap`, `tiptapToMarkdown` (bidirectional conversion in `tiptapBridge.ts`)
- Tiptap extension: `HeadingWithTemplate` (heading-template annotation)
- Vertical-alignment marks: `Superscript` / `Subscript` — locally defined marks (no new `@tiptap/extension-*` dependency) that give ProseMirror a schema slot for `<sup>`/`<sub>`, without which the Write view drops imported markup on the first edit. They parse a `vertical-align` style too, so a paste from Word or Google Docs (which express superscripts as styled spans) survives. Toolbar buttons sit beside inline `code` rather than beside bold/italic — the toolbar overflows in declaration order, and placing them earlier would push bullet lists and Heading 1 into the ··· menu. Shortcuts: Mod-. / Mod-,
- Diagram editor (ASCII fences are THE authored diagram format): `AsciiDiagramExtension` (+ `AsciiDiagramExtensionOptions`, `AsciiDiagramPluginState`, `AsciiDiagramBlockEntry`), `AsciiDiagramWidget`, `useAsciiDiagramData` (+ `AsciiDiagramView`, `asciiDiagramToCanvas`), `applyAsciiDiagramCommand` / `applyRepairCommand` / `replaceAsciiFenceText`, pure ops (`moveNodeOp`, `resizeNodeOp`, `addEdgeOp`, `removeEdgeOp`, `renameNodeOp`, `addNodeOp`, `removeNodeOp`, `sanitizeAsciiLabel`), `shouldPasteAsAsciiFence`, registry helpers (`findAsciiDiagramBlockPos`, `isAsciiSourceVisible`, `toggleAsciiSource`), the **`RepairableDiagramExtension`** (+ `findRepairableBlockPos` / `isRepairableFence` / `REPAIRABLE_KEY` + option/state types) that mounts the inline "Repair as diagram" button on broken box-art fences, plus the shared canvas `DiagramCanvas` and types `DiagramCommand` / `DiagramData` / `DiagramNode` / `DiagramEdge`. **BREAKING (ASCII cutover):** the heading-based `DiagramExtension`, `DiagramWidget`, `useDiagramData`, and heading command helpers were removed — legacy `{[diagram]}` heading sections still render in preview/player via core, but have no canvas editor. The toolbar's Insert → diagram now inserts a starter ASCII fence.
- Tree editor (ASCII tree fences are THE authored tree format; peer to the diagram editor): `TreeViewExtension` (+ `TreeViewExtensionOptions`, `TreeViewPluginState`, `TreeBlockEntry`), `TreeOutlineWidget`, `useTreeViewData` (+ `TreeViewData`), `applyTreeCommand` / `replaceTreeFenceText`, pure ops (`addItemOp`, `renameItemOp`, `indentItemOp`, `outdentItemOp`, `moveItemUpOp`, `moveItemDownOp`, `removeItemOp`, `toggleDirOp`, `sanitizeTreeLabel`), `shouldPasteAsTreeFence`, `findTreeBlockPos`. The outline widget manages items (add / rename / indent-outdent / move / delete / collapse); there is no on-canvas source toggle (edit the raw fence in the Source/Raw view). Toolbar Insert → tree inserts a starter ASCII tree fence. Mutually exclusive with the diagram editor (a fence with ≥2 closed boxes is a diagram, never a tree).
- Mention provider: `MentionCandidate`, `MentionProvider` (host wires its directory through `EditorContext`)
- Link schemes: pass `linkSchemes` to `EditorShell` to let the link dialog accept a host's own protocols (an app-internal navigation scheme it intercepts itself). It threads to `LinkDialog`, which validates through core's `sanitizeUrl` rather than a second policy — so executable schemes (`javascript:`/`vbscript:`/`data:`) are refused regardless of what a host lists, and the dialog rejects them at authoring time instead of silently writing a link the player will later strip. Relative paths, `#anchors`, `mailto:` and `tel:` are always allowed.
- Versioning: pass `allowVersioning` + `workspaceContainer` to `EditorShell` to enable; the toolbar surfaces a `VersionHistoryPanel` and the editor auto-saves snapshots on idle (configurable via `versioningAutoSaveIdleMs`, default 5s; `versioningPrunePolicy` defaults to keep-last-50). Hosts can also call `useEditorContext().versioning.saveVersion()` from their own save pipeline.
- Proofing (grammar + spellcheck): pass `proofing` to `EditorShell` — a `ProofingProvider` instance (host owns disposal; survives remounts) or factory (shell disposes on unmount) from `@bendyline/squisq-editor-react/proofing`, typically `createHarperProofingProvider({ wasmUrl })`. **harper.js is an optional peer dependency reached only via dynamic import** — no provider means no proofing UI and zero engine bytes (the `ffmpegWasm` semantics; guardrail: `tests/published/harperOptionalPeer.test.ts`). Default ON when the capability is present; `proofingDefaultEnabled={false}`, doc frontmatter `squisq-proofing: false`, and the View-menu session toggle each override. Red/green/blue squigglies render in Write (Tiptap `ProofingExtension` decorations, mapped through transactions while a pass is in flight) and Source (Monaco decorations collection); findings are PER VIEW (Write lints the Tiptap doc's own text via a findModel-style walk joined into ONE plaintext engine call; Source lints `model.getValue()` in markdown mode with `{[…]}` spans blanked) — never a shared offset space, because wrap-policy makes Write text differ from source. Hovering a squiggle explains it in place (category + engine message + top
  suggestions) and lets the user ACT on it without a right-click: the Write view
  mounts an interactive `ProofingTooltip` (portaled; hit-tested on the
  decoration's `data-proof-id` rather than `posAtCoords`, which snaps to the
  nearest position) whose top-3 suggestions are buttons, with Ignore + the
  dictionary items beneath and "+N more" opening the full menu; the Source view
  uses Monaco's own hover card via the decoration's `hoverMessage` — all worded
  by the shared `proofing/findingText.ts`. **Because the card is clickable, its
  lifecycle is a two-timer handshake**: leaving the squiggle only ARMS a close
  (`HOVER_CLOSE_DELAY_MS`, 260 ms) so the pointer can cross the gap, and the
  card's own pointer-enter (`holdHover`) cancels it, pointer-leave
  (`releaseHover`) re-arms it — a `pointer-events: none` tooltip needed none of
  this, but also could not be clicked. Only a mousedown in the text or a scroll
  dismisses immediately; `openMenu` tears the card down through `closeHover` so
  its timers cannot outlive it. Right-click a squiggle for the full menu — every
  suggestion / Ignore / **Add to dictionary** / **Add to document word list** (suggestions apply via one Tiptap transaction or Monaco `executeEdits` between undo stops, with a staleness guard and best-effort version snapshot first). The two dictionary items are deliberately distinct SCOPES so an author always knows when a word is recorded inside the file: "Add to dictionary" calls `provider.addWord` → the host's `onDictionaryWord` (app-wide storage, no document write), while "Add to document word list" calls `provider.addWords` (no callback) and appends to the doc's `squisq-proof-dictionary` frontmatter. The app item is HIDDEN when the provider reports `hasAppDictionary: false` (the harper adapter derives that from whether `onDictionaryWord` was supplied), so a word can never look saved app-wide with nowhere to save it. **Ignored findings are never written to the document** — a dismissal is one person's editing preference, not content that should reach everyone through git. The editor persists it through the `EditorShell` prop `proofingIgnoreStore` (`load`/`save` receive a `ProofingDocumentRef` of `{articleId, fileName}` so hosts key by file path; the payload is the engine's OPAQUE export — store verbatim, never `JSON.parse`). Omitting the store leaves Ignore session-only. Because one warm provider is often shared across documents and shells, each pass re-syncs the engine's ignore set (`clearIgnored` + `importIgnored`) only when it belongs to a different document — a string comparison in the common case. StatusBar shows a live count (click toggles the findings panel, a right-side dock). Engine facts encoded by the adapter: UTF-16 spans, blob-worker WASM (host CSP needs `script-src 'wasm-unsafe-eval'` + `worker-src blob:`; serve BOTH `harper_wasm_bg.wasm` and `harper_wasm_slim_bg.wasm` side by side, `application/wasm`), stacked-rule ignore iteration, opaque ignored-lints JSON. Host integration guide: `docs/proofing.md`.
- Source wrapping policy: the Write view transparently unwraps hard-wrapped paragraph prose for editing and re-applies the document's detected wrap convention when serializing (`wrapPolicy.ts` `ingestForWrite`/`persistFromWrite` — exported — wired into `WysiwygEditor` exactly like the frontmatter strip/reattach dance, via a `wrapStateRef` refreshed on every external ingest). Without it the line-based Tiptap bridge renders one choppy paragraph per physical line and the first Write edit persists that chopped structure. Gated by the `EditorShell` prop `preserveSourceWrapping` (default **true**; pass `false` for literal behavior), active only in document layout mode and only on a confident `detectMarkdownWrapState` `'wrapped'` verdict — `mixed`/`unwrapped`/`no-prose` docs behave exactly as before.
- Inline preview gutter: pass `inlinePreview` (and optional `inlinePreviewWidth`, default 320px) to `EditorShell` to render an `InlinePreviewGutter` next to the WYSIWYG surface. The gutter shows one small SVG card per template-annotated block in the document, auto-hides via container query below ~720px, and reuses the same template-resolution path as `LinearDocView`.
- Image editor (in `src/imageEditor/` + `ImageEditor.tsx` + `ImageViewer.tsx`): `useImageEditor`, `imageEditorReducer`, `initialImageEditorState`, `ImageEditorState`, `ImageEditorAction`, `ImageEditorTool`, `CanvasRect`. Pairs with the `<basename>_files/` sidecar convention and `core/imageEdit/`.
- Teleprompter (in `src/teleprompter/`): the **Narrate** display mode under the Use tab (`DisplayMode 'narrate'`; gated by the `allowNarrate` shell prop, default true; frontmatter `display-mode: narrate|teleprompter|prompter`, clamped to `video` when disallowed). `TeleprompterView` (mode root — PreviewPanel passes `recording` deps when `allowRecording` + a `mediaProvider` are wired; without them it is a pure prompter with zero capture code), `TeleprompterSurface` (prop-driven and portal-able; active-word highlight + eye-line smooth scroll applied imperatively on the surface's OWN window's rAF so a Document-PiP float keeps animating while the opener is occluded), `TeleprompterControls`, `useTeleprompter` (voice-adaptive pacing: core `narrationSessionStep` fed by AudioWorklet PCM hops — the audio render thread is the clock, so pacing survives full window occlusion by recording software; constant-rate manual mode as fallback), `useMicAnalysis` (worklet primary + ScriptProcessor fallback; `start()` RESOLVES with the live stream — the state field is a render-later snapshot), `PCM_WORKLET_SOURCE`/`registerPcmWorklet` (inline worklet source → Blob URL; posts CLONED buffers because Chrome recycles buffers transferred out of a worklet once the receiving handler returns), the 3-tier floating window (`useFloatingWindow`/`createFloatingWindowManager`/`detectFloatTiers`: `document-pip` (Chromium/Firefox 151+) → `video-pip` (Safari; canvas rendition pumped via `requestFrame()` on analysis ticks, never rAF) → `popup`, each tier falling through on any failure), pure `scrollModel` math, and self-contained `TELEPROMPTER_CSS` (injected into the main doc and every float window). Recording (in `src/teleprompter/recording/`): `useNarrationRecorder` (records the analysis mic stream + optional separate video-only camera capture with measured `cameraOffsetSec`; samples a live prompter trace; decodes the take and runs core `alignNarration` — decode failure degrades to saving without re-timing), `buildNarrationSavePlan`/`executeNarrationSave` (audio → `audio/narration-*.webm`, v3 timing sidecar via the container, ONE `setMarkdownSource` write; block timings live in the sidecar only — never baked into heading pins, so retakes just swap the sidecar), `insertNarrationPreamble` (inserts/replaces the `{[audio src=… anchor=document]}` preamble + optional inline camera `<video>`; retakes replace, never stack). Review playback re-scrolls the prompter from the alignment before anything is written. PreviewPanel exempts Narrate from the parsing/parse-error unmount gates (live mic/recording state must survive the reparse a save triggers). Manual test script: `docs/teleprompter-manual-tests.md`.
- Recorder (in `src/recorder/`): `RecorderModal`, `RecorderButton`, `RecorderPanel` — configure-and-capture dialog plus two trigger affordances (drop-in button and toolbar-shaped popover trigger). Recording is captured via `MediaRecorder` and written to a `MediaProvider`; narration mode also emits a `.timing.json` sidecar so `resolveAudioMapping()` auto-links the recording to a block. The four capture pills are grouped [Microphone, Camera] + [System audio, Screen]; enabling BOTH Camera and Screen records the two as separate files at once (`'screen+camera'`) — mic rides the camera file, system audio rides the screen file — and `RecorderEntry` inserts them as a composed pair (screen `overlay` clip + camera `picture-in-picture` clip, both `anchor=document`) via `buildDualClipInsertion` (`recorder/dualClipInsertion.ts`) + `insertMediaBlocks`. Every other combo produces exactly the single file it did before. System audio (desktop-Chromium-only, via `supportsSystemAudioCapture()`) needs any one companion source but no longer requires Screen: with Screen it folds into the display capture; on a mic/camera-only take it's captured through a SEPARATE `getDisplayMedia` whose video is discarded and mixed into the file (the browser still shows the screen/tab picker — audio-only display capture isn't allowed).
  - Hooks: `useMediaRecorder` (state machine wrapping `MediaRecorder`; drives a secondary camera lane for `'screen+camera'` — two recorders in lockstep with a measured `cameraOffsetSec`, exposed as `result.camera`; `getElapsedMs()` returns take-relative ms exact at call time, for STAMPING an event — the companion of the 10 Hz `durationMs`, which lags by up to a tick and is only fit for a readout), `useStreamPreview` (`MediaStream` → `<video>.srcObject`), `useMediaDevices` (live `enumerateDevices()` inventory + `getSupportedConstraints()` + a `refresh()` for the permission grant that reveals labels without firing `devicechange`).
  - Device pickers: `RecorderDeviceSettingsPanel` is the full "Advanced device settings" disclosure, and `RecorderDeviceQuickPicks` promotes just the microphone/camera selects onto the dialog itself — each shown only when its source is enabled AND `hasRecorderDeviceChoice` reports more than one real device of that kind. "Real" is `recorderDeviceOptions` (`recorder/mediaDeviceList.ts`): it drops Chromium's `default`/`communications` audio ALIASES (a one-mic machine enumerates three `audioinput` entries; the picker's own "System default" already covers that intent) and the id-less pre-permission placeholders, while always keeping a currently-selected id so a persisted setting can't vanish from its own control. Both surfaces render the same option list bound to the same `RecorderDeviceSettings` — a shortcut to one setting, never a second source of truth.
  - Source helpers: `requestMicStream`, `requestCameraStream`, `requestScreenStream` (optionally mixes a mic track into the screen capture via `AudioContext`; the dual `'screen+camera'` path takes screen with `includeMicrophone: false` so the mic stays on the camera file), and `requestSystemAudioStream` / `mixSystemAudio` (`recorder/sources/systemAudioStream.ts`) — capture system audio via a video-discarded display capture and mix it into a mic/camera stream for the non-screen `systemAudio` path.
  - Format probe: `resolveFormat`, `supportsMediaRecorder` / `supportsUserMedia` / `supportsDisplayMedia`, `buildFilename`.
  - Sidecar builder: `buildTimingJson`, `encodeTimingJson`, `encodeNarrationTimingJson` (the v3 per-block payload), `timingPathFor`. All four live in `recorder/timingJson.ts` so one module owns sidecar encoding and pathing — v1 and v3 share `<media>.timing.json` and a writer must pick exactly one.
  - Output strategy: browser-native. Chromium/Firefox produce WebM (VP9/Opus or VP8/Opus); Safari produces MP4 (H.264/AAC). No transcoding pass. `audioMapping.ts` was extended so `.webm`/`.mp4` audio under `audio/*` participates in the same auto-mapping pipeline `.mp3` files always did.
  - Editor wiring: `RecorderEntry` (`src/RecorderEntry.tsx`) renders the `RecorderPanel` into the toolbar next to `VersionHistoryPanel`. Reads `useEditorContext()` for `mediaProvider`, `workspaceContainer`, and the markdown insertion helpers. The shell's `allowRecording` prop (default true) gates visibility. (Recorder previously shipped as the standalone `@bendyline/squisq-recorder-react`; folded in to avoid first-publish friction on trusted publishing.)
  - Document narration (Insert → **Document narration**, `recorder/documentNarrationInsertion.ts`): the same capture dialog as Record media (`RecorderEntry mode="document-narration"`, camera-first, teleprompter narration mode suppressed since that pipeline writes its own preamble), differing only in the markdown it emits. The take is written at the top of the document's **first block** — after the first non-fenced heading, or after the frontmatter in a heading-less doc — and video is emitted as an `overlay` clip with `data-squisq-video-lock-to-block="false"`, which `htmlVideoClip` reads as `anchor: 'document'`. Together those two choices are what make it start at t=0 and play across every block: `markdownToDoc` starts an unlocked HTML video at its owning block's `startTime`, and the first block starts the timeline. A `'screen+camera'` take reuses `buildDualClipInsertion` verbatim (already unlocked overlay + PiP); an audio-only take emits the `{[audio … anchor=document]}` annotation instead. Re-recording REPLACES the previous take rather than stacking a second document-anchored track — matched by ROLE (unlocked scheduled `<video>` / doc-anchored `{[audio …]}`) and confined to the blank-padded run at the insertion point, so tags the user wrote elsewhere are never touched. Insertion is one `setMarkdownSource` write from the current snapshot and ignores the caret, so it behaves identically in Source and Write views.
  - Slides mode (`recorder/slides/`, `recorder/slidesModePolicy.ts`): the sibling of "Show narration mode" — instead of a teleprompter, the dialog's right column shows the deck one slide at a time (Prev/Next buttons + arrow/space keys scoped to the panel, so `useModalDialog`'s document-level Escape/Tab handling is untouched), with the block's own prose beneath as presenter notes. The two modes are mutually exclusive **structurally**: the dialog holds one `RecorderPanelMode` (`'none' | 'narration' | 'slides'`) rather than two booleans, with `narrationOn`/`slidesOn`/`expanded` derived from it, so there is no compatibility predicate to keep in sync (`data-narration` remains the narration test hook; `data-slides` / `data-panel-mode` join it). `buildRecorderSlideDeck` anchors the deck on `flattenRenderableBlocks` and looks cards up from ONE `buildPreviewDoc(doc, { interleaveImages: false })` pass by block id — interleaved image slides are the only thing that breaks the 1:1 slide↔block correspondence the timing sidecar depends on, and one whole-deck projection also gives each card its real `blockIndex`/`totalBlocks`. Offered by both recorder entries via `RecorderSlidesOptions`.
  - Slide-timing capture: while a take rolls in slides mode, each slide's FIRST showing is stamped via `useMediaRecorder().getElapsedMs()` (exact at call time, unlike the 100 ms-lagged `durationMs`) into a core `SlideAdvanceLog`. On save, `buildAdvanceTimingJson` (core `narration/advanceTiming.ts`) turns the log into an ordinary `NarrationTimingJsonV3` — same codec, `generator.method: 'presenter-advance'` instead of `'dsp-align'` — written to `<media>.timing.json`, where `applyNarrationTiming` reads it off the document-anchored clip (verified: it filters on `anchor === 'document'` with no `kind` filter, so a narration VIDEO qualifies) and writes `block.startTime`/`block.duration`. `RecorderSlidesOptions.captureTimings` gates this and is set only by the document-narration entry, since a block-anchored clip's sidecar would never be read back. A review-state checkbox ("Update block timings when I save this narration", default checked) is the opt-out. **Precedence, not choice:** v3 and the v1 script sidecar share one path and v3 is a strict superset, so the v1 write is an `else` — inverting it would clobber the block timings silently. For a `'screen+camera'` take the sidecar attaches to the SCREEN file (the screen tag is emitted first and carries `startAt: 0`; the camera clip carries the skew, which `applyNarrationTiming` would add to every block). Blocks the presenter never reached save as ZERO-LENGTH ranges — `getBlockAtTime` needs a non-zero span, so they are skipped in playback — which keeps the sidecar contiguous and complete; omitting them instead would make `applyNarrationTiming` place them at its running cursor with their reading-time duration and push every later block out of sync. `advanceCoverage` + `unshownSlidesWarning` surface the count in review.
- Styles: `@bendyline/squisq-editor-react/styles` for CSS

`@bendyline/squisq-video-react` exports everything from the root:

- Components: VideoExportModal, VideoExportButton, CoverImageExportModal (`/cover-image` entry), DashboardImageExportModal (`/dashboard-image` entry — renders the Dashboard rendition through the capture pipeline with named resolutions from `DASHBOARD_RESOLUTIONS`, custom pixels, layout picker, cell-style picker, title toggle, PNG/JPEG/WebP; both image entries exclude the MP4/GIF encoder worker graph and share `imageExportShared.ts`)
- Hooks: useVideoExport, useFrameCapture (render options thread `displayMode`/`dashboard` through to the mounted DocPlayer)
- Worker: the encoding worker is built from `src/workers/encode.worker.ts` for internal use by the exported hooks/components; there is no public `/worker` subpath today
- Encoding backends: WebCodecs (preferred, streaming H.264) with ffmpeg.wasm fallback (batched)
- Output: MP4 export muxes narration audio (WebCodecs path); animated GIF uses a bounded MP4 intermediate plus an ffmpeg.wasm diff-palette pass and omits audio. `VideoExportConfig.outputFormat` selects `mp4`/`gif`, and `animationsEnabled` can disable authored layer animations plus block transitions without freezing media/timing. The result reports `VideoExportResult.audioIncluded` / `audioSkippedReason`. `useVideoExport().startExport(doc, config)` takes the doc first. `playerScript` is optional on `VideoExportButton` / `VideoExportModal` (falls back to the bundled standalone player). Both components accept `colorScheme="light" | "dark"` for host-matched portaled UI (default `light`).
- Depends on `@bendyline/squisq-video` for shared types/encoder + `@bendyline/squisq-react` + `mp4-muxer` + `html2canvas`

`@bendyline/squisq-video` (browser-pure, no Node deps) is the underlying foundation:

- `generateRenderHtml(options)` — produces standalone HTML that loads a doc into the player for headless frame capture (used by `cli video`/`cli image`; `displayMode: 'dashboard'` + `dashboard: { layout, title, documentTitle }` mount the dashboard rendition)
- `framesToMp4Wasm(frames, options)` — browser-only ffmpeg.wasm encoder for frame sequences → MP4
- Dashboard image presets: `DASHBOARD_RESOLUTIONS` (hd/fhd/4k/square/square-2k/portrait/portrait-4k/standard, each naming its `VIEWPORT_PRESETS` family) + `validateDashboardImageDimensions` (cover-image ruleset — whole pixels, 64–7680/axis, ≤33 MP; deliberately NOT the H.264 even-dimension rule) + `resolveDashboardDimensions` (preset XOR custom width/height) — the one resolution vocabulary shared by `squisq image` and the browser export dialog
- Types: `VideoExportOptions`, `VideoQuality`, `VideoOrientation`, `QualityPreset`, `EncoderResult`; helpers `QUALITY_PRESETS`, `ORIENTATION_DIMENSIONS`, `resolveDimensions`

`@bendyline/squisq-cli` ships a `squisq` bin command:

- `squisq convert <input> [--formats <comma-separated-list>] [options]` — converts any supported input (markdown/JSON Doc/`.zip`/`.dbk`/folder **or** an importable binary `.docx`/`.pptx`/`.pdf`/`.xlsx`/`.csv`/`.html`) via the shared registry `convert()`. **`-o, --output <file>` is a single output file (format inferred from extension); `-d, --output-dir <dir>` is the multi-file/output-directory flag; `-f, --formats <list>` selects one or more formats**. PPTX inputs infer the deck's theme + slide layouts **by default** (theme/custom-template frontmatter + heading annotations in the converted output); opt out with `--no-infer-theme` / `--no-infer-layouts`. An explicit `--theme <id>` still wins over an inferred theme. XLSX inputs split each worksheet into its data islands by default; `--no-xlsx-regions` restores whole-sheet tables and `--no-xlsx-formulas` drops the companion formulas tables.
- `squisq video <input> [options]` — markdown → MP4 via headless render + WASM encode
- `squisq image <input> [options]` — the document's Dashboard rendition → PNG via headless single-frame capture (Chromium only, no ffmpeg). `--resolution <preset>` from `DASHBOARD_RESOLUTIONS` (default `fhd`) or `--width`/`--height` (both together; odd dimensions legal), `--layout <id|auto>` validated against the doc's own custom layouts + built-ins, `--style basic|card|panel|accent` for the cell dressing (unset defers to the doc's own `squisq-dashboard-style`), `--title`/`--no-title` for the title band. Also registered as the CLI-only `png` convert format (`convert -f png`); a bare `convert` still never launches a browser
- `squisq transform <input> --ops <list>` — one-time markdown SOURCE transforms from core's `MARKDOWN_SOURCE_TRANSFORMS` registry, applied in order (`unwrap`, `wrap` with `--width <n>` default 80, `cleanup`). Result → stdout by default (status on stderr); `-o <file>` writes a file (guarded by `--overwrite`), `--in-place` rewrites the input. Runs strict: a transform that cannot prove structural equivalence exits 1 instead of emitting. Exit codes 0/1/2 (2 = unreadable input). NOT the same thing as the `--transform <style>` slideshow-style flag on `convert`/`video`.
- `squisq doctor` — reports environment/runtime readiness for the conversion + video/image pipelines (per-feature lines: video/gif need ffmpeg + Chromium; the PNG image needs Chromium only)
- Programmatic API at the `@bendyline/squisq-cli/api` subpath for consumers who want to invoke the same conversion pipeline without spawning a process

## Code Style

- TypeScript strict mode
- ESM only (no CJS)
- React packages use `react` imports; consumers may alias them through `preact/compat`
- Core package has zero framework dependencies and no NodeJS-specific dependencies — must run in browser and Node
- Formats package depends on jszip (ZIP archives), pdf-lib, pdfjs-dist, and core's MarkdownDocument as pivot format; `hyparquet` is an **optional peer** reached only via dynamic import (parquet reading degrades to a per-block diagnostic without it)
- Editor-react depends on @tiptap and monaco-editor as peer dependencies
- Video-react depends on `@bendyline/squisq-video` (browser-pure), `mp4-muxer`, and `html2canvas`
- CLI depends on commander + playwright-core. `cli video` renders headlessly by feeding generated HTML straight to `page.setContent` — there is no dev server and nothing binds a port; the page's routes are blocked except `about:`/`blob:`/`data:`, which is the SSRF guard.
- All block templates are pure functions: `(input, context) => Layer[]`
- Use `catch (err: unknown)` with `instanceof Error` narrowing, never `catch (err: any)`
- Use `isTemplateBlock()` type guard instead of `(block as any).template` patterns
- Discriminated union: `DocBlock = Block | TemplateBlock` — use the guard to narrow
- **No `console.log` in production code** — remove all debug logging before committing. Use `console.warn` for degraded-but-functional scenarios, `console.error` for failures that affect output.
- **Test files should maintain type safety** — use typed test helpers instead of `as any` casts. Provide all required fields in test data.

### Accepted `any` exceptions

Only these boundaries are allowed to use `any` (each is documented with an `eslint-disable` comment at the site):

- **Unified/remark processor chain** in `core/src/markdown/parse.ts` and `core/src/markdown/stringify.ts` — the chained `.use()` builder has no usable static type, so the processor variable is typed `any`.
- **SVG `xmlns` attribute on `<foreignObject>` children** in `react/src/layers/TableLayer.tsx` (1 site) — React's JSX types don't accept `xmlns` on HTML children even though the runtime requires it for embedded HTML inside SVG to render correctly.

That is the **entire** list: `parse.ts`/`stringify.ts` carry a `let processor: any` each, and `TableLayer.tsx` carries one `as any`. Nothing else in any published `src/` may. (Earlier revisions of this file also exempted `WysiwygEditor.tsx`, `MentionExtension.tsx` and `video-react`'s `encode.worker.ts`; those sites are gone and the exemptions with them — do not reintroduce them on their authority.)

If you need an `any` outside these boundaries, find a different solution. Use `as unknown as X` for genuinely necessary runtime-shape casts (not `as any`).

## Key Design Decisions

- **Data sidecars: big data lives beside the document, not in it** — the markdown-as-pivot architecture caps what an inline GFM table can hold (Monaco/Tiptap/remark reparse on every debounce), so high-volume tabular data (`*.csv`, `*.tsv`, `*.xlsx`, `*.parquet`) lives as a file in the document's `<docbasename>_files/data/` sidecar and the markdown carries a REFERENCE: the annotation `src` param (`## Q3 {[dataTable src=report_files/data/q3.csv]}`, container-root-relative like `{[audio src=…]}`; `sheet`/`anchor`/`headerRow` address inside an .xlsx src — the same vocabulary the XLSX round-trip already uses) plus a plain body link for graceful degradation in plain renderers. Small tables stay inline byte-identically to before — importers spill only past size thresholds (or in `sidecar: 'always'` mode, which is what "open a CSV as a document" means). Rendering is a bounded preview: `resolveDataReferences` (core seam; readers in `formats/data`, parquet via optional peer hyparquet) fills `templateData` with the first N rows + `srcStats` before projection, and its output is PROJECTION-ONLY — never serialized back, or preview rows would bake into the markdown. The Write view mounts the reference as the real virtualized grid (`@bendyline/squisq-grid-react`, lazily imported; decoration-level and round-trip-safe — the compact card remains the load-failure fallback), where sort/filter persist as `sort=`/`filter=` annotation params (see `@bendyline/squisq/table` for the grammar; each filter input carries a ~26px operator dropdown — contains/equals/starts-/ends-with + case toggle for text columns, the comparison set for numeric) that the readers apply over the FULL body before windowing — so the author's curated view shapes previews AND exports; CSV/TSV and XLSX cells edit in place (journal → `.versions/data/` backup → sidecar rewrite / XLSX cell patch); exports either carry the file (htmlzip, bundles, dbk), re-embed full values (xlsx, via `materializeDataReferences`), or warn (single-file HTML, EPUB). This is the foundation the high-volume grid editor, calculation engine, and query providers build on.
- **Footnotes are footnotes, everywhere a document format has them** — GFM `[^1]` / `[^1]: …` is the pivot representation, and every DOCUMENT format converts to and from it by default (no flag): DOCX ↔ real Word footnotes/endnotes, HTML ↔ a marked footnotes section, EPUB → `epub:type="noteref"`/`"footnotes"`, PDF → raised numbers. `shared/footnotes.ts` owns the one numbering pass they share, so a marker and its definition agree and repeat citations each get their own element id (reusing one id is invalid HTML and sends every backlink to the same place). Two deliberate deviations from GFM's renderer: a definition NOTHING cites is still emitted (these are converters — a note whose marker was lost upstream is exactly the content a reader still needs), and definitions are pulled OUT of the document flow to a trailing section rather than rendered where the author wrote them. **Spreadsheets are deliberately excluded**: a footnote line in an XLSX is a CELL with an address, and the importer's whole contract is that `{[dataTable anchor=A5]}` puts it back at A5 — turning it into a `footnoteDefinition` leaves it nowhere to return to. XLSX keeps the superscript runs (`<sup>1</sup>`) and does not infer the linkage.
- **Templates are pure functions** — no side effects, no state, just data in → layers out
- **SVG-based rendering** — blocks render as SVG foreignObject for resolution independence
- **SVG for slides, HTML for pages** — slides/video frames and inherently spatial content (diagram/tree/timeline/map/drawing/layout, authored layers, custom templates) render through the fixed-viewport `materializeBlockLayers` SVG pipeline; Page (linear) mode renders through the sibling `materializePageSections` pipeline as variable-height HTML sections, with SVG embedded responsively only for spatial content (`canvas-embed`). Both consume the same doc + theme. The theme's `pageStyle` (design family + tokens + per-kind/template overrides + accent rotation) art-directs the page: all 11 built-ins declare distinct page personalities, and `defaultPageStyle` derives one for legacy/custom themes. One structural stylesheet (`PAGE_BASE_CSS`, values via `--squisq-page-*` vars + token data-attributes) serves every theme in the React preview, the standalone bundle, and static HTML exports (the html format's default `static` mode ships the page rendition).
- **Dashboard is the third core projection** — `materializeDashboard` (core `doc/dashboard/`) turns the same doc into ONE static canvas: candidates come from `buildPreviewDoc` (image interleaving off) so template resolution matches the slideshow; a layout (built-in ladder `focus-1`…`grid-4x4`, or a `squisq-dashboard-layouts` custom with optional 1-based `block` pins) places %-rect cells over the content area; each cell renders its block **at the cell's size** (synthetic per-cell viewport → templates re-compose per orientation, fonts scale via `calculateFontScale` — the embedded-spatial-media strategy, never shrink-a-full-slide); the cell area is inset from the canvas by a small margin (a fraction of the SHORTER axis, so the breathing room is physically equal on both axes) on every edge the title band does not occupy; the title band defaults ON when a title resolves (a leading title-restating block dedupes into it, and the band stays full-bleed but starts its type on the cell area's left edge); overflow blocks are dropped with a diagnostic, never console output; cell **zoom** is a closed 1×/1.5×/2× ladder on the cell's `fontScale` (composition still targets the cell) — auto-boosted for short text-led blocks and quantized to at most ONE boost level per dashboard so cells read consistently sized, with explicit layout-cell pins winning. Cell **style** (`squisq-dashboard-style`, default `basic`) is the second, ORTHOGONAL axis — the layout says where cells go, the style says how each is dressed: `basic` (blocks fill their cells, unchanged), `card` (tinted canvas + raised rounded card), `panel` (flat accent-outlined panel with a header bar), `accent` (card + rotating accent wash/bar). Every style derives its colors from the ACTIVE theme (`colors`, `style.borderRadius`, `colorSchemes` rotation) and never carries a palette, so gezellig cards read gezellig. The block FILLS its card rather than sitting in a padded well (templates bring their own padding, and many paint an opaque surface — letting that surface be the card face is what stops a card reading as a box in a box); a leading full-bleed backdrop that is exactly `theme.colors.background` is dropped so the card surface shows through, while borders and accents are OVERLAY layers drawn above the block for the same opacity reason. Core owns all geometry — React's `DashboardView` just absolute-positions per-cell `BlockRenderer`s (per-cell clipping + `useId` isolation) plus the frame's behind/overlay chrome, clipping the cell with `frame.contentRadiusPct` (percentage radii, so corners scale at any export size), and `composeDashboardLayers` flattens frame → block → overlay into one `Layer[]` for non-React consumers (which have no clip concept, so full-bleed art is not corner-rounded there). Export is a single-frame capture: dashboard mounts publish a minimal render API (`seekTo` resolves when assets settle, duration 0, no cover) through the standalone handle, and the CLI's `withRenderPage` + `renderDocToDashboardPng` screenshot it once — Chromium only, no ffmpeg.
- **One slideshow projection, every slide consumer** — the slide sequence a consumer renders is never re-derived. `buildPreviewDoc` (core) is the single markdown-Doc → player-ready slide list, and `expandDocBlocks` is the single scheduler on top of it; the editor preview, the HTML slideshow export, and the PPTX exporter all go through both. Two guards keep a discrete deck honest: only REAL narration segments reach the audio-timed path (a synthetic preview clock is just a timer — the player's `audioMode !== 'synthetic'` rule), and discrete consumers pass `splitLongBlocks: false` + `mergeShortBlocks: false` so the >20s split can't duplicate a slide and the <5s merge can't delete one. Skipping the projection is what made a `.pptx` disagree with the browser: exporting the raw markdown segmented on H1/H2 alone (every `###` slide lost) and exporting the raw Doc rendered unannotated headings through `sectionHeader`, dropping their body prose. A third guard covers narration: `buildPreviewDoc`'s image interleaving (default ON) splices untimed 5s filler slides and then recomputes every `startTime` cumulatively, which shifts every later slide off the audio, so `usePreviewProjection` passes `interleaveImages: false` whenever the doc carries a document-anchored clip — a take that owns the timeline outranks decoration. That is also the one thing that would break the 1:1 slide↔block correspondence the recorder's slides panel and its timing sidecar depend on.
- **React, not Preact** — the react package targets standard React; consumers may opt into `preact/compat` aliases
- **Subpath exports** — consumers import only what they need via granular entry points
- **No app-specific code** — everything here must be generic and reusable
- **MarkdownDocument as pivot format** — every format converter (DOCX, PDF, HTML, EPUB, PPTX) uses core's markdown AST as the intermediate representation
- **`ContentContainer` + `.versions/` sidecar pattern** — document-like assets that need history use the `.versions/<basename>.<timestamp>.<ext>` convention inside their `ContentContainer`. The markdown doc uses `core/versions/`; image-edit state uses `core/imageEdit/versions/` over the same shape. Both maintain `.versions/` in the container-root `.gitignore`, preserving existing rules, and share `PrunePolicy`, `Version`, and `CoalesceOptions` from `versions/types.ts` so hosts can configure pruning once.
- **Editor isolation** — heavy editor dependencies (Monaco, Tiptap) are isolated in editor-react, separate from the lighter react package
- **Standalone player bundle** — `@bendyline/squisq-react/standalone-source` exports `PLAYER_BUNDLE`, an IIFE-wrapped string that boots a complete player into a host page. `formats/html` and `squisq-cli` inline this to produce single-file HTML exports.
- **`<JsonView>` and `<JsonEditor>` share `chooseControl()` from core** — read-only viewer and editable form always agree on what each schema field _is_; only their rendering differs.
- **ASCII fences are the standard diagram format** — a diagram is a code fence of box-and-line art (the kind AI assistants emit); the fence text is the source of truth end-to-end. Core's codec (`doc/asciiDiagram/`) parses boxes/edges/containers/labels and renders them back with a semantic fixpoint guarantee (`parse(render(d)) ≡ d`; byte-stable after one normalization cycle). The editor mounts an interactive canvas OVER the fence and rewrites the art on every semantic edit (verify-before-commit aborts if the renderer and parser ever disagree); untouched fences stay byte-identical. The doc pipeline auto-detects diagram fences via the `autoTemplate` mechanism (detection is conservative — lang allowlist, ≥2 closed boxes, table-lattice and loose-text rejectors — and the negative corpus in `asciiDiagramDetect.test.ts` is the tuning contract). The box tracer is robust to real-world hand-drawn art: an arrowhead embedded in a border (`┌──▼──┐`) is read as an edge stem (not a title), and a side wall tolerates a bounded run of gap cells so a label that overflowed one row's border still closes its box. But when the art is broken past recovery — labels overflow AND collide so box-drawing chars leak into the extracted labels (the columns desync row-to-row) — detection declines with `garbled-labels`, so the fence falls back to a faithful code block instead of a garbled canvas. From that fallback the user can opt into an inline **Repair as diagram** button (`RepairableDiagramExtension`): `repairAsciiDiagram` (core) aggressively re-traces the boxes, recovers labels by **row-band segment matching** (each label row's `│…│` segments map to the band's boxes by reading order — sidestepping the column desync), infers best-effort edges, normalizes the layout, and re-renders clean `diagram`-tagged art, turning the broken fence into an editable canvas in one undoable step (`isRepairableDiagram` gates the button; the aggressive tracer is `traceBoxes(grid, /*repair*/ true)`, never used by conservative detection). **The fence LANGUAGE is a durable "block tag"**: a ` ```diagram ` fence is an explicit author marker that survives markdown ↔ Tiptap round-trips (the `language-diagram` class round-trips; fence _meta_ does not) and switches detection to lenient mode (≥1 box, rejectors skipped) so a degenerate/edited diagram stays a diagram. The editor makes identity sticky — toolbar-inserted starters and pasted art are tagged, and the first canvas edit promotes an untagged fence's language to `diagram` in the same transaction as the art rewrite (`replaceAsciiFenceText`'s `ensureLanguage` arg; the position registry is boundary-churn tolerant so the widget's React root survives the promotion). Legacy `{[diagram]}` heading sections render read-only; `drawing`/`layout` keep heading-based markup.
- **Mermaid fences are the complex-diagram alternate** — an explicit ` ```mermaid ` fence is claimed by `MermaidDiagramExtension` and rendered lazily through Mermaid's public renderer, so flowcharts, sequence/state/class/ER diagrams, charts, mindmaps, and the rest of the syntax supported by the pinned Mermaid release do not pass through a narrowing Squisq parser. The original code block remains the only persisted representation and is exposed by the shared **Source** action for live edits; maximize, resize, zoom, stable block identity, and inline error recovery reuse the diagram editor's chrome. Rendering uses Mermaid's strict security level and never binds authored callbacks. The extension never serializes the SVG or a reduced node model back into markdown, so untouched and source-edited diagrams round-trip as `mermaid` code blocks.
- **ASCII fences are the tree format** (peer to diagrams, for hierarchies) — a tree is a code fence of file-tree / outline art (`├── src/`, `└── utils/`, ASCII `|--`/`` `--``/`+--`, pure indentation). Core's codec (`doc/treeview/`) recovers depth across renditions via an indent stack (label-start column → outline reconstruction), tolerates ragged dedents, and preserves trailing-slash dirs + `#`/`<--`/`//` comments. A comment is delimited by a **GAP — ≥2 whitespace before the marker** (the aligned form real tree art uses: `main.go␣␣␣␣␣␣# entrypoint`); a single-spaced marker is ordinary label text, which is what lets a label legitimately contain one (`release # notes`, `C# bindings`, `https://…`) and survive a round-trip. Render collapses whitespace runs inside labels/comments so a label can never forge the delimiter — the same normalize-at-the-render-boundary trade the diagram codec's edge labels make, and the reason escaping is never needed. Rendering is a deterministic tree-walk, so the fixpoint is structural and byte-stable (no spatial layout → no jitter). Use mode renders a **`TreeLayer`** — an interactive filesystem treeview (folder/file icons, connector rails, collapse chevrons) via `<foreignObject>`, interactive in the player and captured expanded in exports. The editor mounts an outline widget OVER the fence (add/rename/indent/outdent/move/delete/collapse) and rewrites the art per edit (verify-before-commit). **Mutually exclusive with the diagram codec**: a tree is built only from tees/elbows/rails (`├ └ │ ─`) and contains NO box corners — the tree detector rejects any fence with a top or bottom-right corner (`┌ ┐ ┘`, `has-box-corners`), which also keeps a MALFORMED box diagram (misaligned borders → <2 closed boxes) from falling through to a mangled treeview. Auto-detection requires connector branches (the unambiguous AI file-tree signal); `asciiDiagramDetect.test.ts`'s file-tree rejections and `treeviewDetect.test.ts` are the mutual-exclusion contract. Like diagrams, the fence LANGUAGE is a durable "block tag": a ` ```tree ` fence is an explicit marker that survives round-trips and switches detection to lenient mode (≥1 node, no connector requirement) — this is what lets a **flattened** tree (connectors removed → auto-detection would reject) stay a treeview. Starters/paste are tagged and the first outline edit promotes the language to `tree`, so identity is sticky.

## Adding a New Block Template

This is the single most error-prone mechanical change in the codebase. **All eight steps are required** — skipping any one breaks the build, the runtime, or makes the template silently invisible in the editor:

1. Add the input interface `XxxInput extends BaseTemplateBlock` in `core/src/schemas/BlockTemplates.ts`.
2. Add it to the `TemplateBlock` discriminated union in the same file.
3. Create the template function in `core/src/doc/templates/xxxBlock.ts` — a pure `(input, context) => Layer[]`.
4. Import + register in `core/src/doc/templates/registry.ts` under its canonical short id (e.g. `xxx: xxxBlock`).
5. Add a `TEMPLATE_METADATA` entry (label + description) in `core/src/doc/templates/metadata.ts` — this is the canonical UI metadata that drives the editor's template picker. **Skipping this fails `templateMetadata.test.ts`** (metadata must stay 1:1 with the registry).
6. Add a matching preview icon to `TEMPLATE_ENTRIES` in `editor-react/src/TemplatePicker.tsx` (same id/order; label + description must equal the core metadata). **Skipping this fails `templatePickerMetadata.test.ts`** — without it the template never shows up in the gallery.
7. Add tests in `core/src/__tests__/templates.test.ts` covering representative inputs.
8. Add input descriptors for the template's `{[…]}` params in `core/src/doc/templates/inputDescriptors.ts` — a `TEMPLATE_INPUT_DESCRIPTORS[<id>]` entry listing each param key (with `coerce` kind, closed-enum `values`, and `required` flags). This is what makes inline attribute coercion (`{[xxx key=value]}` → typed input) and param linting (`lintTemplateParams`) cover the new template. Without it the template still renders, but its annotation params stay untyped strings and are exempt from lint.

If the template replaces an older name, add it to the internal `TEMPLATE_ALIASES` in `templates/templateNames.ts` so legacy documents still resolve. After adding, update the template count in this file's "Subpath Exports" → `@bendyline/squisq/doc` line.

## Theme System

The Theme system provides unified visual styling for rendered docs. A `Theme` bundles colors, typography, visual style, and render-style algorithms into a single JSON-serializable object.

**Architecture:**

- `Theme` type in `schemas/Theme.ts` — defines `ThemeColorPalette`, `ThemeTypography`, `ThemeStyle`, `RenderStyle`, and per-theme `colorSchemes`
- `themeLibrary.ts` — 11 built-in themes: standard (the default, `DEFAULT_THEME_ID`), standard-dark, documentary, minimalist, bold, morning-light, tech-dark, magazine, cinematic, warm-earth, gezellig (JSON files in `schemas/themes/`)
- `themeUtils.ts` — template-facing helpers: `resolveColorScheme()`, `themedFontSize()`, `getTemplateHint()`, etc.
- `Doc.themeId` — optional pointer to a theme; resolved at render time via `resolveTheme()`
- `createTheme(base, overrides)` — deep-merge utility for customizing a built-in theme
- `compileTheme(partial, { base?, contrast? })` — fills a partial/seed theme into a full validated Theme, inheriting from a chosen `base` built-in (render style / color schemes / typography / persistentLayers) when given, else the neutral `STARTER_THEME`; records `basedOn`. `colorSchemes` is replaced wholesale when the partial supplies it.
- `resolveThemeForDoc(doc, id?, registry?)` (`doc/resolveDocTheme.ts`) — **pure, doc-scoped** theme resolution: resolves an id against the doc's own `customThemes` first, then an optional caller-owned registry, then built-ins. The theme analog of `buildRegistry` for custom templates; used by the editor preview and every export path without process-global mutation.
- `Theme.pageStyle` (`schemas/PageStyle.ts`) — optional page art direction for Page (linear) mode: a design `family` (clean/editorial/brutalist/terminal/cinematic/documentary/organic/soft), `tokens` (column widths, section spacing, dividers, background rhythm, hero style, heading treatment incl. numbered/mono-tag eyebrows, image framing, shadows, quote marks, numeral style, pattern), per-section-kind `sections` + per-template `templates` overrides (scalar `hints` like `frame: "terminal"`/`dropCap`), and an `accentRotation` strategy over `colorSchemes`. Validated by `themeValidator`, filled by `compileTheme` via `defaultPageStyle(theme)` (derived from renderStyle.name/borderRadius/imageTreatment/persistentLayers), explicit in all 11 built-in JSONs (pairwise-distinct art-direction tuples — a unit test enforces this), and consumed at render time through `resolvePageStyle`.

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

- `applyRenderStyleToLayers()` (`doc/utils/applyRenderStyle.ts`) runs once inside `materializeBlockLayers` for template-generated layers: it scales animation durations by `style.animationSpeed`, and — when `renderStyle.ambientMotion` is true — gives full-bleed cover imagery with no authored animation a deterministic gentle Ken Burns (seeded from block+layer id). Explicit animations (including `{ type: 'none' }`) always win; raw authored `block.layers` are never restyled.
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

## Editor Chrome Palette

The `Theme` system above dresses the **document**. The furniture around it —
toolbar, menus, dialogs, pickers, outline, timeline, status bar — is themed
separately, through the `--squisq-*` chrome palette in
[`packages/editor-react/src/styles/chrome.css`](packages/editor-react/src/styles/chrome.css).
The split is deliberate: a host wants its own app palette on the chrome while
the document keeps the author's theme.

**The rule: chrome CSS never names a color.** Every chrome color resolves to a
token from `chrome.css`. A guard test
(`editor-react/src/__tests__/chromePalette.test.ts`) fails on a literal in any
chrome stylesheet, and on a token declared for one theme but not the other.
The one exempt file is the image editor, a deliberate dark room in both themes
because a photo is judged against a neutral dark field.

**Token families.** Ink (`text-strong` → `text` → `text-soft` → `text-muted`
→ `text-faint`), surfaces (`bg`, `surface`, `-subtle`, `-sunken`, `-hover`,
`-raised`, `input-bg`, `row-hover`, plus the `desk-*` family the editing page
floats on), lines (`border-subtle` / `border` / `border-strong`), and four
state families that share one shape — `accent`, `danger`, `warning`, `success`
— each with `-hover`, `-strong` (colored TEXT on a light ground, which needs
more contrast than a fill), `-soft` (tinted fill), `-subtle` (faintest wash)
and `-border`, plus `text-on-accent` / `text-on-danger`. Then the semantic
one-offs that must NOT derive from the accent: proofing squiggles, timeline
clip colors, find highlights, mentions.

**Scoping.** Declarations sit inside `:where()`, so they carry zero
specificity and a host rebinds any of them from a single plain class. Light
values bind on `:root` and `[data-theme='light']`; dark values bind on any
`[data-theme='dark']` element. Both matter, because menus and dialogs
**portal to `document.body`**, outside the editor shell — before the palette
existed, every portaled surface had to carry a private copy of the colors, and
those copies drifted (an indigo family beside a blue one; a slate ramp beside
a gray one).

**Working in chrome CSS:**

- Never declare a color token on `.squisq-editor-shell` or on a feature root.
  That is what forced hosts to out-specify the shell to retone a pane. Put it
  in `chrome.css`, keyed on `data-theme`.
- Never write `var(--squisq-x, #literal)` for a token `chrome.css` declares —
  the fallback is a second source of truth that silently diverges. Fallbacks
  are still correct for tokens the palette does NOT own: fonts, the
  `--squisq-theme-*` / `--squisq-page-*` document families, and the
  teleprompter's float-window CSS, which is injected into a separate document
  that never loads this stylesheet.
- A dark rule that only restates the light rule's tokens is dead — the token
  already flips. Delete it.
- Per-feature families (`--squisq-layout-*`, `--squisq-block-props-*`,
  `--squisq-preview-*`, `--squisq-template-gallery-*`) are kept as host API
  but DEFAULT to core tokens, so binding `--squisq-accent` alone recolors them.

Host-side integration notes live in [`docs/theming.md`](docs/theming.md).

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
- **Instance render APIs** — React hosts use `onRenderAPIReady`; standalone hosts use the `mount()` handle / `getHandle(element)`. Never copy render methods onto `window`.
- **`catch (err: unknown)`** — always narrow with `instanceof Error`, never use `catch (err: any)`
- **`as unknown as X`** — when a cast is truly necessary (e.g., runtime data shapes), use double-cast through `unknown`, not `as any`

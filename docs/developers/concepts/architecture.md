---
title: Architecture
description: How Squisq turns Markdown into a document model, projects it into slides, pages, and dashboards, renders it, and converts it to and from other formats.
---

# Architecture

Every Squisq rendition — the slideshow, the scrolling page, the dashboard, a video, a `.pptx` — is
built by one pipeline. Markdown is parsed into a syntax tree, the tree becomes a typed `Doc`, the
`Doc` is _projected_ into the shape a rendition needs, and a renderer or exporter draws that
projection. Knowing the stages tells you where to hook in.

```text
  Markdown source (string)
        │ parseMarkdown()                              ▲ stringifyMarkdown()
        ▼                                              │
  MarkdownDocument  ◀── importers: DOCX PPTX PDF XLSX CSV HTML
        │ markdownToDoc()                              ▲ docToMarkdown()
        ▼                                              │
  Doc ─────────────────────────────────────────────────┘
   │  blocks (one per heading) · templates · timing · theme · media
   │
   │  optional pre-passes: resolveAudioMapping · resolveDataReferences · applyTransform
   │
   ├─▶ buildPreviewDoc() ─▶ expandDocBlocks() ─▶ slides (Block[] with layers)
   │        DocPlayer (slideshow, video) · PPTX · HTML slideshow · MP4 / GIF
   │
   ├─▶ materializePageSections() ─▶ page sections (HTML + embedded SVG)
   │        LinearDocView · static HTML export
   │
   └─▶ materializeDashboard() ─▶ one canvas of cells
            DashboardView · PNG export
```

## Stage 1: Markdown to a syntax tree

`parseMarkdown` (from `@bendyline/squisq/markdown`) parses GitHub-flavored Markdown plus Squisq's
extensions — `{[template]}` tags, Pandoc-style `{#id key=value}` heading attributes, math, inline
icons, directives — into a `MarkdownDocument`: a plain, JSON-serializable tree with the YAML
frontmatter already parsed.

```ts
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';

const tree = parseMarkdown(
  '# Harbor Survey\n\n## Water quality {[statHighlight]}\n\n92% passed.\n',
);
tree.children.map((node) => node.type); // ['heading', 'heading', 'paragraph']
stringifyMarkdown(tree); // back to Markdown text
```

The tree is the **pivot format**: every format converter reads and writes it (see
[Formats](formats.md)), and you can edit it directly with the tree utilities in the same subpath.

## Stage 2: The document model

`markdownToDoc` (from `@bendyline/squisq/doc`) walks the tree and builds a `Doc`. Each heading
becomes a `Block` — with nested headings as `children` — carrying its title, its body nodes, its
resolved template, its timing, and any media it schedules. Frontmatter becomes typed fields: the
theme id, the custom templates and themes a document carries, and a cover (`startBlock`).

```ts
import { markdownToDoc } from '@bendyline/squisq/doc';

const doc = markdownToDoc(tree);
doc.blocks[0].children?.[0].template; // 'statHighlight'
```

Unannotated headings get a template chosen from their content — a table, a list, a quote, a big
number — unless you pass `{ autoTemplates: false }`. Conversion never throws for content problems;
it degrades and records `doc.diagnostics`. See [The document model](document-model.md).

## Stage 3: Projections

A `Doc` keeps the document's structure: nested blocks, Markdown bodies, authored timing. Each
rendition needs a different shape, so a **projection** reshapes it:

| Projection                            | Produces                                                            | Used by                                                               |
| ------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `buildPreviewDoc` + `expandDocBlocks` | A flat sequence of slides, each with its layers and start time      | `DocPlayer` slideshow and video, PPTX export, HTML slideshow, MP4/GIF |
| `materializePageSections`             | Variable-height page sections (hero, prose, quote band, gallery, …) | `LinearDocView`, static HTML export                                   |
| `materializeDashboard`                | One canvas with every block placed in a layout cell                 | `DashboardView`, dashboard PNG export                                 |
| `materializeFlashcards`               | A study deck built from the nested block tree                       | `FlashcardView`                                                       |

Before projecting, hosts with a workspace run optional pre-passes: `resolveAudioMapping` attaches
narration audio (and re-times blocks to a recorded voice), `resolveDataReferences` fills preview
rows from data files beside the document, and `applyTransform` rewrites the document into a summary
style. [Projections](projections.md) shows each one and the exact order the editor uses.

## Stage 4: Blocks become layers

Slides, dashboard cells, and the spatial sections of a page are drawn as **layers** — typed,
positioned visual primitives:
`text`, `image`, `shape`, `path`, `video`, `table`, `tree`, `map`, `mermaid`, `svg`, and hosted
`videoEmbed`. `materializeBlockLayers` is the single public entry point for that step. It looks up
the block's template, gives it a [template context](templates.md#the-template-context) (theme,
viewport, font scale), runs it, applies the theme's render style, and adds persistent theme layers.

```ts
import { buildPreviewDoc, materializeBlockLayers } from '@bendyline/squisq/doc';
import { resolveTheme } from '@bendyline/squisq/schemas';

const slides = buildPreviewDoc(doc);
const { layers, source } = materializeBlockLayers(slides.blocks[1], {
  theme: resolveTheme('documentary'),
});
// source: 'template'; layers: the theme's backdrop, text "92%" and "passed.", a vignette
```

Because layers are plain data, the same output feeds the SVG player, frame capture for video, and
the PowerPoint exporter, which maps each layer to a native DrawingML shape.

## Stage 5: Renderers

| Renderer               | Package                                                  | Draws                                                                                 |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `DocPlayer`            | `@bendyline/squisq-react`                                | Slides and timed video as SVG; also hosts page, dashboard, and flashcard modes        |
| `BlockRenderer`        | `@bendyline/squisq-react`                                | One block's layers as SVG — for thumbnails and custom players                         |
| `LinearDocView`        | `@bendyline/squisq-react`                                | Page sections as HTML                                                                 |
| `DashboardView`        | `@bendyline/squisq-react`                                | A dashboard canvas of per-cell `BlockRenderer`s                                       |
| `MarkdownRenderer`     | `@bendyline/squisq-react`                                | Markdown nodes (`tree.children`) as plain rich text                                   |
| Standalone player      | `@bendyline/squisq-react/standalone`                     | The same components as one script for pages with no build step (`SquisqPlayer.mount`) |
| Exporters              | `@bendyline/squisq-formats`                              | DOCX, PDF, EPUB, PPTX, HTML, XLSX, CSV files                                          |
| Video and image export | `@bendyline/squisq-video-react`, `@bendyline/squisq-cli` | MP4, GIF, and PNG, by capturing frames of the rendered player                         |

The single-file HTML export inlines the standalone player bundle (`PLAYER_BUNDLE` from
`@bendyline/squisq-react/standalone-source`), so an exported page plays exactly as the app does.

## The reverse path

`docToMarkdown` turns a `Doc` back into a `MarkdownDocument`, and `stringifyMarkdown` turns that
into text. The round trip is designed to be lossless:

- A document you parse and serialize without changes comes back unchanged, apart from the
  serializer's canonical style (`-` bullets, `**bold**`, ATX `#` headings).
- Automatically chosen templates are not written back as tags. A block whose template was
  auto-picked carries `autoTemplate: true`, and `docToMarkdown` leaves its heading untagged.
- Programmatic edits round-trip. Change a block's `template` or `templateOverrides` and the
  heading's `{[…]}` tag is rewritten to match; tags that already agree are kept verbatim, legacy
  spellings included.

```ts
import { docToMarkdown } from '@bendyline/squisq/doc';

const block = doc.blocks[0].children![0];
block.template = 'factCard';
delete block.autoTemplate; // claim the template, or it is treated as auto-picked
stringifyMarkdown(docToMarkdown(doc)); // '## Water quality {[factCard]}' …
```

Two rules keep the round trip honest. If you assign a template to a block that was auto-picked,
clear `autoTemplate` or the change is not written. And if you parsed with a non-default
`defaultTemplate`, pass the same value to `docToMarkdown({ defaultTemplate })`, or every plain
heading comes back tagged.

Projection outputs are not round-trippable. A projected slide list, or a document whose data
references were resolved into preview rows, is for rendering only — serialize the `Doc` that
`markdownToDoc` returned.

## Design decisions to know

- **Templates are pure functions.** A template is `(input, context) => Layer[]` — no state, no side
  effects, no DOM. That is what lets the same template run in a browser, a worker, or Node, and
  feed both the player and the exporters. See [Templates](templates.md).
- **SVG for slides, HTML for pages.** Slides, video frames, and spatial content (diagrams, trees,
  timelines, maps, charts, layouts) render through the fixed-viewport layer pipeline as SVG. Page
  view renders variable-height HTML sections and embeds SVG only for spatial content. Both read the
  same `Doc` and theme.
- **One slideshow projection for every consumer.** The editor preview, the HTML slideshow export,
  and the PPTX exporter all call `buildPreviewDoc` and then `expandDocBlocks`. Re-deriving slides
  yourself is how a deck drifts from what the author saw.
- **Big data lives beside the document.** Large tables are files in a
  `<docbasename>_files/data/` folder next to the Markdown; the document carries a reference
  (`{[dataTable src=…]}`) and a plain link. Rendering resolves a bounded preview at projection time
  and never writes it back. See [Data files](../../guide/data-and-charts.md#data-files) and
  [Storage](storage.md).
- **Hosted videos are links.** A YouTube, Vimeo, Loom, or Wistia video is a paragraph that is only
  a link to the video's page. Plain renderers show a working link; Squisq's renderers swap in a
  player whose embed URL core rebuilds from a validated video id. See
  [Hosted videos](../../guide/media.md#hosted-videos).
- **ASCII fences are the diagram format.** A box-and-line diagram, a file tree, or a timeline is a
  code fence of plain-text art, and the fence text is the source of truth. The editor's canvas
  rewrites the art on every edit; untouched fences stay byte-identical. See
  [Diagrams](../../guide/diagrams.md).
- **Markdown is the pivot.** Every converter imports to, and exports from, a `MarkdownDocument`
  (rendering exporters also use the `Doc` built from it), so adding a format means writing one
  importer and one exporter, not a converter per pair.
- **No process-wide state.** Custom templates and themes travel inside the document or in
  registries you create and pass in, and each player instance owns its own render API. Two
  documents on one page never see each other's templates or themes.

## Where code runs

| Runs anywhere (browser, worker, Node)                                                                                                                              | Needs a DOM                                                               | Needs Node              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------- |
| `@bendyline/squisq`, `@bendyline/squisq-formats`, `@bendyline/squisq-graph`, `@bendyline/squisq-calc`, `@bendyline/squisq-video` (except its browser-only encoder) | `@bendyline/squisq-react`, `-grid-react`, `-editor-react`, `-video-react` | `@bendyline/squisq-cli` |

This split is what lets you parse and validate in a server, convert in a worker, and render in the
browser with the same results.

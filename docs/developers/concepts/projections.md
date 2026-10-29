---
title: Projections
description: The functions that reshape a Doc for each rendition — slides, page sections, dashboards, flashcards — the pre-passes that run before them, and the exact order the editor calls them in.
---

# Projections

A `Doc` keeps a document's structure: nested blocks, Markdown bodies, authored timing. No
rendition draws that structure directly. A **projection** reshapes it into what one rendition
needs — a flat list of timed slides, a column of page sections, a single canvas of cells — and every
consumer of that rendition calls the same projection, so they cannot drift apart.

Here is one document in three projections. Use the theme switcher on any preview to see how each
rendition adapts.

```markdown preview
# Ferry Ridership, Spring 2026

Weekday crossings between the harbor and Bell Island, March through May.

## Riders per weekday {[statHighlight]}

**4,180** riders a day, up 12% from last spring.

## Busiest crossings {[columnChart]}

| Crossing | Riders |
| -------- | -----: |
| 7:15     |    640 |
| 8:00     |    710 |
| 17:30    |    690 |

## From the dock {[quote]}

> The 8:00 boat leaves full most mornings now. — Dana Ruiz, deckhand
```

```markdown preview=page nosource
# Ferry Ridership, Spring 2026

Weekday crossings between the harbor and Bell Island, March through May.

## Riders per weekday {[statHighlight]}

**4,180** riders a day, up 12% from last spring.

## Busiest crossings {[columnChart]}

| Crossing | Riders |
| -------- | -----: |
| 7:15     |    640 |
| 8:00     |    710 |
| 17:30    |    690 |

## From the dock {[quote]}

> The 8:00 boat leaves full most mornings now. — Dana Ruiz, deckhand
```

```markdown preview=dashboard nosource
# Ferry Ridership, Spring 2026

Weekday crossings between the harbor and Bell Island, March through May.

## Riders per weekday {[statHighlight]}

**4,180** riders a day, up 12% from last spring.

## Busiest crossings {[columnChart]}

| Crossing | Riders |
| -------- | -----: |
| 7:15     |    640 |
| 8:00     |    710 |
| 17:30    |    690 |

## From the dock {[quote]}

> The 8:00 boat leaves full most mornings now. — Dana Ruiz, deckhand
```

## At a glance

| Rendition        | Projection                                | Output                                                             | Consumers                                                       |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Slideshow, video | `buildPreviewDoc`, then `expandDocBlocks` | A `Doc` of flat slides, then `Block[]` with layers and start times | `DocPlayer`, PPTX export, HTML slideshow export, MP4/GIF export |
| Page             | `materializePageSections`                 | `PageSectionMaterialization[]`                                     | `LinearDocView`, static HTML export                             |
| Dashboard        | `materializeDashboard`                    | `DashboardMaterialization` (layout, cells, title, backdrop)        | `DashboardView`, dashboard PNG export                           |
| Flashcards       | `materializeFlashcards`                   | `FlashcardDeck`                                                    | `FlashcardView`                                                 |

All of them are in `@bendyline/squisq/doc` and are pure: they don't touch storage, and they return
new objects rather than changing the `Doc` you pass. The React components call them for you; call
them yourself to build your own renderer, an exporter, or a test.

```ts
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  buildPreviewDoc,
  composeDashboardLayers,
  expandDocBlocks,
  flattenRenderableBlocks,
  markdownToDoc,
  materializeDashboard,
  materializePageSections,
  resolveThemeForDoc,
  VIEWPORT_PRESETS,
} from '@bendyline/squisq/doc';

const doc = markdownToDoc(parseMarkdown(source));
const theme = resolveThemeForDoc(doc);

// Slides — the same sequence the player, PPTX, and HTML slideshow use.
const slides = expandDocBlocks(flattenRenderableBlocks(buildPreviewDoc(doc).blocks), {
  theme,
  viewport: VIEWPORT_PRESETS.landscape,
  customTemplates: doc.customTemplates,
  splitLongBlocks: false,
  mergeShortBlocks: false,
});
for (const slide of slides) {
  console.log(slide.id, slide.template, `${slide.startTime}s`, `${slide.layers?.length} layers`);
}

// Page sections — what LinearDocView renders.
const sections = materializePageSections(doc, { theme, cover: doc.startBlock ?? false });
console.log(sections.map(({ section }) => `${section.kind}:${section.blockId || 'cover'}`));
// ['hero:cover', 'stat-band:water-quality', 'quote-band:what-the-divers-saw', 'item-list:next-steps']

// Dashboard — one canvas.
const dashboard = materializeDashboard(doc, { theme, viewport: VIEWPORT_PRESETS.landscape });
console.log(dashboard.layout.name); // 'grid-2x2'
const canvasLayers = composeDashboardLayers(dashboard); // one flat Layer[] for non-React renderers
```

(The sample output is for the [quick start](../quick-start.md#the-document)'s harbor survey.)

## Slides: `buildPreviewDoc` and `expandDocBlocks`

`buildPreviewDoc(doc, options)` is the one slideshow projection. It:

- flattens the block tree into slide order, leaving out the children of container templates
  (`diagram`, `drawing`, `layout`), which draw them;
- renders a heading that has no tag through the loss-averse `content` template — heading and full
  body — instead of the heading-only `sectionHeader` that `markdownToDoc` records as its default;
- derives each slide's template inputs from its heading and body and coerces its tag parameters;
- interleaves document images that no block shows as their own image slides;
- synthesizes a single, source-less audio segment spanning the deck, as a playback clock.

| Option             | Default | Effect                                                                                                                                         |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `documentTitle`    | none    | Header for the leading heading-less block when the frontmatter has no `title` — typically the file name, via `documentTitleFromFileName(name)` |
| `interleaveImages` | `true`  | Add the extra image slides. Pass `false` when a fixed set of slides must map one-to-one to blocks                                              |

`expandDocBlocks(blocks, options)` then schedules the slides: it materializes each block's layers
through `materializeBlockLayers`, adds persistent layers and default transitions, and assigns start
times. `DocPlayer` runs it internally, so you pass the player the `buildPreviewDoc` output.
Exporters and custom renderers call it themselves.

### Discrete slides versus timed playback

When you pass `audioSegments` (real narration), `expandDocBlocks` paces the deck for video: it
splits a block that would stay on screen longer than about 20 seconds into repeated parts, and
merges a block shorter than about 5 seconds into its predecessor. That is right for a continuous
video and wrong for a deck, where it duplicates or deletes authored slides. Discrete consumers turn
both off:

```ts
const slidesDoc = buildPreviewDoc(doc);
const deck = expandDocBlocks(flattenRenderableBlocks(slidesDoc.blocks), {
  theme,
  splitLongBlocks: false,
  mergeShortBlocks: false,
  // Only real narration reshapes the sequence; never pass buildPreviewDoc's placeholder clock.
  audioSegments: doc.audio.segments.length ? slidesDoc.audio.segments : undefined,
});
```

This is exactly what the PPTX exporter does, which is why a `.pptx` has the same slides as the
browser slideshow, never a duplicated or missing one.

## Page: `materializePageSections`

`materializePageSections(doc, options)` turns the `Doc` — not the slide projection — into
variable-height page sections. Each `PageSectionMaterialization` has a `section` with a `kind`
(`hero`, `banner`, `stat-band`, `quote-band`, `feature-split`, `media-figure`, `gallery`,
`callout`, `card-grid`, `item-list`, `timeline-rail`, `table-section`, `canvas-embed`, `prose`,
`footer`), content `slots` (title, body, media, items, table, …), and the source `block`.
Spatial templates and charts become `canvas-embed` sections drawn through the same layer pipeline
as slides.

Pass `cover: doc.startBlock` to open with a hero (the leading block that restates the title is
folded into it), `variant: 'document'` for the report register, and `transformPage` for a
transform style's spacing hints. The theme's `pageStyle` art-directs the result: background
rhythm, accent rotation, emphasis.

`LinearDocView` renders the sections as React. For string HTML, `PAGE_BASE_CSS`,
`buildPageCssVars`, and `buildPageCss` give you the same stylesheet the component uses.

## Dashboard: `materializeDashboard`

`materializeDashboard(doc, options)` places every block on one canvas. It takes its candidate
blocks from `buildPreviewDoc` with image interleaving off, picks a layout (a built-in from
`focus-1` to `grid-4x4`, a custom one from `squisq-dashboard-layouts`, or the `layout` option),
and renders each block **at its cell's size** so templates compose for that shape. The result
carries the `layout`, the `cells` (each with its `block`, `rect`, and `layers`), the `title` band,
the canvas `backdrop`, and `diagnostics` — for example, blocks that didn't fit.

`DashboardView` renders it with one `BlockRenderer` per cell. `composeDashboardLayers` flattens the
whole canvas into a single `Layer[]` for renderers that have no notion of cells.

## Flashcards: `materializeFlashcards`

`materializeFlashcards(doc)` builds a study deck from the **nested** block tree. It needs the
parent and child boundaries that the slide projection flattens away, so it takes the `Doc`
directly.

## Pre-passes

Pre-passes produce a new `Doc` and run before any projection. Two of them are async and bring in
what isn't in the Markdown — the narration files and data tables in the document's workspace,
read through a [`ContentContainer`](storage.md). The third, a transform style, is optional.

### Narration and audio

`resolveAudioMapping(doc, container)` populates `doc.audio.segments` from narration files in the
container — explicit `{[audio …]}` references first, then files matched to blocks by content — and
assigns blocks to segments. Its first step is `applyNarrationTiming(doc, container)`: when the
document carries a document-anchored narration take with a timing sidecar (`<media>.timing.json`),
it re-times every block to the recorded voice, and rebuilds the captions when the sidecar has
word timings.
Author-pinned `startTime`/`duration` attributes still win. Call `applyNarrationTiming` on its own
when you want only the re-timing; it returns `{ doc, applied }`, with `applied: false` when no take
or sidecar matched.

### Data references

`resolveDataReferences(doc, container, { readers })` fills `{[dataTable src=…]}` blocks (and the
charts) with a bounded preview of a data file stored beside the document. The readers live in the
formats package — `defaultDataReaders()` from `@bendyline/squisq-formats/data` — so the core stays
parser-free. It returns `{ doc, diagnostics }`; `maxPreviewRows` sets the window (default 50) and a
`tableCache` map you own memoizes full-file reads across calls.

> [!WARNING]
> A resolved document is for rendering only. Never pass it to `docToMarkdown` — the preview rows
> would be written into the Markdown as an inline table. Keep the `Doc` from `markdownToDoc` as
> your source of truth.

### Transform styles

`applyTransform(doc, style)` from `@bendyline/squisq/transform` rewrites a document into a summary
deck and returns `{ doc, stats }`. `getTransformStyleIds()` lists the built-in styles:
`documentary`, `magazine`, `data-driven`, `narrative`, `minimal`, `headings-and-features`, and
`dynamic-slides`. Its output already consists of typed template blocks, so it feeds
`buildPreviewDoc` like any other `Doc`.

## The order the editor uses

The editor preview ([`usePreviewProjection.ts`](../../../packages/editor-react/src/usePreviewProjection.ts))
is the reference sequence. In outline:

```ts
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  buildPreviewDoc,
  markdownToDoc,
  resolveAudioMapping,
  resolveDataReferences,
  type DataSourceTable,
} from '@bendyline/squisq/doc';
import { applyTransform } from '@bendyline/squisq/transform';
import { defaultDataReaders } from '@bendyline/squisq-formats/data';
import type { ContentContainer } from '@bendyline/squisq/storage';

const tableCache = new Map<string, Promise<DataSourceTable>>();

export async function projectForPreview(
  source: string,
  workspace: ContentContainer,
  fileName: string,
  transformStyle?: string,
) {
  // 1. Parse — the editor re-runs this on a debounce as the author types.
  const doc = markdownToDoc(parseMarkdown(source), { fileName });

  // 2. Workspace pre-passes. resolveAudioMapping runs applyNarrationTiming first.
  const withAudio = await resolveAudioMapping(doc, workspace);
  const { doc: resolved } = await resolveDataReferences(withAudio, workspace, {
    readers: defaultDataReaders(),
    maxPreviewRows: 50,
    tableCache,
  });

  // 3. Optional summary style ("Transform" in the editor).
  const contentDoc = transformStyle ? applyTransform(resolved, transformStyle).doc : resolved;

  // 4. The slide projection. A document-anchored take owns the timeline,
  //    so interleaved image slides would push every later slide off the audio.
  const narrationOwnsTimeline = (contentDoc.documentMedia ?? []).some(
    (clip) => clip.anchor === 'document',
  );
  const playerDoc = buildPreviewDoc(contentDoc, {
    documentTitle: fileName.replace(/\.[^.]+$/, ''),
    interleaveImages: !narrationOwnsTimeline,
  });

  return {
    contentDoc, // → LinearDocView (page), DashboardView, FlashcardView
    playerDoc, // → DocPlayer (slideshow, video)
    audioMode: contentDoc.audio.segments.length > 0 ? ('media' as const) : ('synthetic' as const),
  };
}
```

The real hook adds three details: it shows the unresolved projection immediately and swaps in the
resolved one when the pre-passes finish; it falls back to the unresolved projection if audio
discovery fails; and it starts a fresh `tableCache` whenever the host signals that workspace files
changed (a re-upload or a saved grid edit). Without a workspace container, it skips step 2.

Note what goes where: the slide renditions get `playerDoc`, while page, dashboard, and flashcards
get `contentDoc` and run their own projections. `audioMode` is decided from `contentDoc`, because
`playerDoc` always carries the placeholder clock segment.

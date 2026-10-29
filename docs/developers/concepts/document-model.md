---
title: The document model
description: The Doc, Block, TemplateBlock, and Layer types — what each field means, how Markdown fills them in, and how to build and inspect a document in code.
---

# The document model

A `Doc` is the typed, JSON-serializable form of a document. `markdownToDoc` builds one from
Markdown; every renderer and exporter reads one. All of the types on this page are exported from
`@bendyline/squisq/schemas`; the full declarations are in the
[API reference](../../API.md#subpath-schemas).

## Build one from Markdown and look inside

```ts
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { flattenRenderableBlocks, markdownToDoc } from '@bendyline/squisq/doc';

const doc = markdownToDoc(
  parseMarkdown(`---
title: Harbor Survey 2026
---

# Harbor Survey 2026

A field report on the north harbor.

## Water quality {[statHighlight]}

92% of samples passed.

## Next steps {#next duration=6}

- Repair the east breakwater
- Re-test in April
`),
);

for (const block of flattenRenderableBlocks(doc.blocks)) {
  console.log(
    block.id,
    block.template,
    block.autoTemplate ?? false,
    block.startTime,
    block.duration,
  );
}
// harbor-survey-2026 sectionHeader false 0 3
// water-quality      statHighlight false 3 3
// next               list          true  6 6
```

Three things to notice:

- **Blocks nest.** The two `##` sections are `children` of the `#` block. `flattenRenderableBlocks`
  walks the tree in document order (and skips the children of container templates such as
  `diagram`, which draw their children themselves).
- **Every heading block has a template.** An unannotated heading gets `sectionHeader`, or a
  template chosen from its content — here, `list`, with `autoTemplate: true` marking it as chosen
  rather than authored.
- **Timing is estimated.** `startTime` and `duration` come from reading time unless a heading
  attribute such as `duration=6` sets them.

## `Doc`

| Field              | Type                                        | What it holds                                                                                     |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `articleId`        | `string`                                    | An id for the document (`markdownToDoc` uses `options.articleId`, default `'markdown-doc'`)       |
| `blocks`           | `Block[]`                                   | The top-level blocks, in order; nested headings are in each block's `children`                    |
| `duration`         | `number`                                    | Total seconds                                                                                     |
| `audio`            | `AudioTrack`                                | `{ segments: AudioSegment[] }` — narration files, empty until audio is mapped                     |
| `captions`         | `CaptionTrack?`                             | Caption phrases with start and end times                                                          |
| `startBlock`       | `StartBlockConfig?`                         | The cover: `title`, `subtitle`, optional hero image, credit, and cover style                      |
| `themeId`          | `string?`                                   | The selected theme, from `squisq-theme` (or the legacy `themeId` / `theme`) frontmatter           |
| `customThemes`     | `Theme[]?`                                  | Themes carried in the document (`squisq-custom-themes`)                                           |
| `customTemplates`  | `CustomTemplateDefinition[]?`               | Templates carried in the document (`squisq-custom-templates`)                                     |
| `motion`           | `MotionSpec?`                               | How much templates move (`squisq-motion`); falls back to the theme's motion profile               |
| `persistentLayers` | `PersistentLayerConfig?`                    | Layers drawn behind or above every block; when absent, the theme's apply                          |
| `documentMedia`    | `MediaClip[]?`                              | Audio or video timed from the start of the document (`anchor=document`), such as a narration take |
| `frontmatter`      | `Record<string, unknown>?`                  | The raw parsed frontmatter, for any key Squisq doesn't type                                       |
| `diagnostics`      | `DocDiagnostic[]?`                          | Structural problems found while building — `severity`, `code`, `message`, `blockId`, `line`       |
| `meta`             | `{ generatedAt?, generatedBy?, version? }?` | Free provenance fields                                                                            |

The [frontmatter reference](../../guide/frontmatter.md) lists every key authors can set.

## `Block`

A block is one heading's section. Its fields fall into a few groups.

**Identity and timing.** `id` is a slug of the heading text unless the heading sets `{#custom-id}`.
`startTime` and `duration` are seconds; `audioSegment` is the index of the narration segment the
block plays over. `transition` describes how the block enters.

**Template.** Four fields carry template information, and they are easy to confuse:

| Field               | Holds                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `template`          | The template id the block renders with (legacy aliases already resolved)                               |
| `autoTemplate`      | `true` when `template` was chosen from the content rather than written in a tag                        |
| `templateOverrides` | The tag's parameters as raw strings — `{[statHighlight colorScheme=blue]}` → `{ colorScheme: 'blue' }` |
| `templateData`      | Structured inputs with real types, from a `json data` / `yaml data` fence or a table under the heading |

At render time the inputs merge in this order: values derived from the heading and body, then
`templateData`, then `templateOverrides` (coerced to their declared types), so a tag parameter
always wins. See [Templates](templates.md).

**Markdown structure.** `title` is the heading text, `contents` holds the body nodes between this
heading and the next, `children` holds sub-heading blocks, and `sourceHeading` points at the
original heading node (it is absent on the preamble block, the content before the first heading).

**Heading attributes.** A Pandoc-style attribute block, `## Pier 4 {#pier4 .urgent x=2 y=1
connectsTo=pier5:flow}`, fills `x` and `y` (positions for spatial layouts), `connectsTo`
(`{ target, type? }[]`), `classes`, and `metadata` (any other key, as raw strings). `startTime`
and `duration` attributes set the block's timing.

**Media.** `media` holds the audio and video clips the block schedules (`{[audio …]}`,
`{[video …]}`), each timed relative to the block's start.

**Precomputed layers.** `layers` is optional. Blocks from Markdown omit it and compute layers on
demand; a block you build by hand can supply its own.

## `TemplateBlock`, `DocBlock`, and `isTemplateBlock`

Each built-in template has a typed input interface — `TitleBlockInput`, `StatHighlightInput`,
`QuoteBlockInput`, and so on — with a literal `template` discriminant and the template's own
fields. `TemplateBlock` is the union of all of them, and `DocBlock = Block | TemplateBlock` is what
the materializers accept.

```ts
import type { StatHighlightInput } from '@bendyline/squisq/schemas';
import { materializeBlockLayers } from '@bendyline/squisq/doc';

const stat: StatHighlightInput = {
  template: 'statHighlight',
  id: 'water',
  duration: 5,
  audioSegment: 0,
  stat: '92%',
  description: 'of water samples passed',
};

const { layers } = materializeBlockLayers(stat);
```

Narrow a `DocBlock` with the `isTemplateBlock` guard rather than reading `.template` through a
cast. It returns `true` for any block whose `template` is a string — which includes every
heading block from `markdownToDoc`:

```ts
import { isTemplateBlock, type DocBlock } from '@bendyline/squisq/schemas';

function describe(block: DocBlock): string {
  return isTemplateBlock(block) ? `${block.id}: ${block.template}` : `${block.id}: raw layers`;
}
```

## Building a `Doc` by hand

A generator, an agent, or an import pipeline can build a `Doc` directly. `blocks` is typed
`Block[]`, so give each block a `template` and put its inputs in `templateData`; or skip templates
entirely and supply `layers`:

```ts
import type { Doc } from '@bendyline/squisq/schemas';

const doc: Doc = {
  articleId: 'harbor-survey',
  duration: 12,
  audio: { segments: [] },
  blocks: [
    {
      id: 'opening',
      startTime: 0,
      duration: 4,
      audioSegment: 0,
      template: 'title',
      templateData: { title: 'Harbor Survey 2026', subtitle: 'North harbor field report' },
    },
    {
      id: 'water',
      startTime: 4,
      duration: 5,
      audioSegment: 0,
      template: 'statHighlight',
      templateData: { stat: '92%', description: 'of water samples passed' },
    },
    {
      id: 'credits',
      startTime: 9,
      duration: 3,
      audioSegment: 0,
      layers: [
        {
          id: 'bg',
          type: 'shape',
          position: { x: 0, y: 0, width: '100%', height: '100%' },
          content: { shape: 'rect', fill: '#0b3954' },
        },
        {
          id: 'thanks',
          type: 'text',
          position: { x: '50%', y: '50%', anchor: 'center' },
          content: { text: 'Thanks to the dive team', style: { fontSize: 64, color: '#ffffff' } },
        },
      ],
    },
  ],
};
```

Pass it to `<DocPlayer doc={doc} audioMode="synthetic" />`, or to `convert({ kind: 'doc', doc },
'pptx')`. A hand-built document has no Markdown structure, so it doesn't need `buildPreviewDoc`;
blocks with authored `layers` render as written (the theme's persistent layers are still added).
To store it as Markdown, give each block a `sourceHeading` or build the document from Markdown
instead — `docToMarkdown` writes a heading only for blocks that have one.

## Layers

A layer is one positioned visual element. Layers draw back to front, the first being the
background. Every layer has an `id`, a `position`, an optional `animation`, a `type` discriminant,
and its data in `content`:

| `type`       | Draws                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| `text`       | Plain or sanitized rich text with a `style` (font, size, color, alignment) |
| `image`      | An image with `fit`, alt text, credit, and an optional photographic grade  |
| `shape`      | A rectangle, circle, or line with fill, stroke, gradient, or pattern       |
| `path`       | An SVG path, such as a connector with markers                              |
| `video`      | A video clip                                                               |
| `videoEmbed` | A hosted YouTube, Vimeo, Loom, or Wistia player, from the video's page URL |
| `table`      | An HTML table                                                              |
| `tree`       | An interactive file-tree or outline                                        |
| `map`        | A tile map with markers                                                    |
| `mermaid`    | A Mermaid diagram from its source                                          |
| `svg`        | An SVG picture, re-sanitized from its source at render time                |

`position` takes pixels (numbers, on a 1920×1080 landscape canvas by default) or percentages
(`'50%'`), plus an optional `anchor`. Animations name a type (`fadeIn`, `slideIn`, `wordReveal`,
`countUp`, `zoomIn`, `panLeft`, …) with a duration and delay in seconds.

## Timing, audio, and captions

Times are seconds from the start of the document. `markdownToDoc` estimates each block's duration
from the reading time of its body — at least three seconds, or `options.defaultDuration` (default 5) for a block with no body text — and lays blocks end to end;
`getBlockAtTime(blocks, t)` (from `@bendyline/squisq/schemas`) finds the block on screen at a time.

`doc.audio.segments` starts empty. When a workspace holds narration, `resolveAudioMapping`
(see [Projections](projections.md#narration-and-audio)) fills the segments and assigns each block
to one, and a document-anchored narration take with a timing sidecar re-times every block to the
recorded voice. Note that `buildPreviewDoc` adds a single, source-less segment as a playback clock,
so check for real audio on the document you started with, not the projection.

`doc.captions` holds caption phrases. `markdownToDoc` derives them from the text at reading pace;
narration timing replaces them with word-timed captions when the take has word bookmarks.

## The cover

`startBlock` is the cover shown before playback and at the top of a page. `markdownToDoc` builds it
unless you pass `{ generateCoverBlock: false }`: the title is the frontmatter `title`, else the
first shallowest heading, else `options.fileName`; the subtitle is the frontmatter `subtitle`, or
the paragraph directly under that heading; the first image in the document becomes the hero.

## Diagnostics

Conversion never throws for content problems. `markdownToDoc` records structural problems such as
duplicate block ids in `doc.diagnostics`. For a full check — unknown templates with "did you mean"
suggestions, invalid tag parameters, missing assets — run `validateMarkdownSource(markdown)` or
`validateMarkdownDoc(tree)` from `@bendyline/squisq/doc`; both return
`{ diagnostics, errorCount, warningCount, infoCount, doc }`.

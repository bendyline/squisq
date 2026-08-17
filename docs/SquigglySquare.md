# Squiggly Square — Template Annotation Syntax

This document describes the "Squiggly Square" annotation notation used in Squisq Markdown to embed template blocks inline in Markdown documents.

Synopsis

- The annotation syntax is delimited with `{[` and `]}`.
- A **template annotation** rides at the end of a heading line and picks the visual template for that heading's section.
- The same delimiters serve three other, narrower roles: standalone **media clips** in a block's body (`{[audio …]}` / `{[video …]}` / `{[media …]}`), **inline icons** in any text (`{[github]}`), and **shape/layer primitives** on the child headings of a `drawing`/`layout` container.

Basic grammar

- Minimal form: `{[templateName]}`
- With attributes: `{[templateName key=value otherKey="value with spaces"]}`
- Attributes only (no template name): `{[duration=8]}` — the heading keeps the default template and the key/value pairs still apply (see [Timeline & timed media](#timeline--timed-media) and [Narration audio](#narration-audio)).

Rules

- Attribute names are alphanumeric and case-sensitive (they map to template input keys).
- Attribute values are parsed as strings. Use quotes (single or double) when a value contains spaces or special characters.
- Unknown attributes are passed through to the template input — templates may choose to parse or ignore them.
- A template annotation must be in **trailing position** on a heading: `## Gallery {[photoGrid]}` parses, `## The {[chart]} section` does not (the `{[chart]}` there is treated as a possible inline icon or literal text).
- A heading may carry both a template annotation and a Pandoc-style attribute block, in either order: `## CEO {#ceo} {[factCard]}` and `## CEO {[factCard]} {#ceo}` are equivalent.

Where `{[…]}` is recognized

| Context                                                                               | Meaning                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Trailing on a heading                                                                 | Template annotation → the section becomes a `TemplateBlock`  |
| A standalone body paragraph that is _exactly_ `{[templateName …]}` (not a media name) | Heading-less template block (see **Standalone annotations**) |
| A body paragraph that is _exactly_ `{[audio …]}`, `{[video …]}`, or `{[media …]}`     | Timed media clip (see below)                                 |
| Trailing on a child heading of a `{[drawing]}` / `{[layout]}` block                   | Shape / layer primitive (see **Drawings**)                   |
| Anywhere in text, when the token resolves to a known FontAwesome icon                 | Inline icon (see **Inline icons**)                           |

Anywhere else, `{[…]}` is left as literal text — and `squisq validate` flags it with an `unparsed-annotation` diagnostic so the mistake is visible. A **top-level** paragraph that is exactly `{[templateName …]}` is now recognized as a standalone template block (see [Standalone annotations](#standalone-annotations)); a `{[…]}` paragraph **nested inside a list item, blockquote, or table cell is still not** — those keep warning, so author slides as headings or top-level standalone paragraphs.

Examples

- Heading annotated with a template. Attributes supply the template's inputs:

```markdown
## Sunset {[imageWithCaption imageSrc="photo.jpg" caption="Beach at sunset"]}
```

- Heading annotated with a template that collects its inputs from the section body —
  `photoGrid` reads the images under the heading:

```markdown
## Gallery {[photoGrid caption="Beach highlights"]}

![Sunrise](a.jpg)
![Midday](b.jpg)
![Sunset](c.jpg)
```

- A body-level media clip (the only `{[…]}` form recognized outside a heading):

```markdown
## Narrated section

Body text shown while the narration plays.

{[audio src=narration.mp3 startAt=5]}
```

Attribute value rules & escaping

The same value grammar applies to both annotation forms — `{[templateName key=value]}` and the Pandoc-style `{#id .class key=value}` block share one tokenizer.

- Unquoted values: no spaces, quotes, or `[` `]` `{` `}`, e.g. `columns=3` or `autoplay=true`. An apostrophe inside an unquoted value is literal (`attribution=O'Brien` works).
- Quoted values: use double or single quotes for values with spaces, e.g. `caption="A long caption"` or `caption='A long caption'`. Quoted values may contain commas, `]`, and `}` (e.g. `caption="rows 1, 2]"`).
- To include a double quote inside a value, wrap the value in single quotes (or vice versa): `caption='She said "hello"'`. Backslash escaping (`caption="She said \"hello\""`) is also accepted, but values containing both quote characters are best avoided in markdown source.
- Headings are still markdown text, so markdown-significant characters inside values (`*`, `_`, `` ` ``, `~`) must be backslash-escaped when authoring by hand: `text="a \*starred\* word"`. The serializer emits these escapes automatically; they resolve back to bare characters on parse.
- On save, values are canonicalized: double quotes preferred, single quotes used when the value itself contains a double quote, quotes omitted when not needed.
- An accidental doubled closer (`…]}]}` or a stray trailing `]`) is tolerated by the parser; the canonical form has exactly one `]}`.

How the annotation is handled

- The Markdown parser emits a `TemplateAnnotationNode` on the heading (`heading.templateAnnotation`) with `template` and `attributes: Record<string,string>`.
- When converting to a `Doc` (`markdownToDoc`), every heading becomes a `Block`; the annotation's template name is resolved (through legacy aliases) onto `block.template`, and the raw params land on `block.templateOverrides`. At render time the effective template input is merged as: block fields → structured body data (`block.templateData`) → `{[…]}` params. The `{[…]}` params are **coerced to their typed shape** on the way in (see [Inline attribute coercion](#inline-attribute-coercion)) — e.g. `center="47.6,-122.3"` becomes `{ lat, lng }` — while `block.templateOverrides` itself stays raw strings for lossless round-tripping. Template functions receive the merged, coerced input and render `Layer[]`.
- Params whose keys are known **block-meta keys** (`duration`, `startTime`, `x`, `y`, `connectsTo`, `transition`, `transitionDuration`, `transitionDirection`) are _also_ coerced onto the block's typed fields — so `{[quote duration=8]}` works. When the same key appears in both the squiggly annotation and the Pandoc `{…}` block, the Pandoc value wins.
- Pandoc attributes map to the block too: `{#id}` pins the block id (generated ids are slugified heading text, deduped with `-2`, `-3`, …; pinned ids are reserved so later slugs don't collide), `.class` tokens land on `block.classes`, and unrecognized `key=value` pairs land on `block.metadata`.
- Content before the first heading becomes a heading-less "preamble" block. The first H1 also seeds an auto-generated cover (`doc.startBlock`) with the H1 text as title, the following paragraph as subtitle, and the document's first image as hero (disable via `markdownToDoc(…, { generateCoverBlock: false })`).
- The editor extension `HeadingWithTemplate` preserves annotations inside headings and round-trips them between Tiptap and Markdown.

Registering custom templates

- Custom templates travel **with the document**, not through a global registry. Author them in the editor (Template picker → create custom template); they are stored in the `squisq-custom-templates` frontmatter key (a compact single-line JSON object keyed by template name) and surfaced as `Doc.customTemplates`. The expansion pipeline merges them via `buildRegistry(doc.customTemplates)` before walking blocks, so a heading annotated `{[myTemplate]}` resolves against a doc-defined template named `myTemplate`. There is no global `registerTemplate()` function.
- A custom template's `name` must be a slug (lowercase alphanumerics and hyphens). Built-in names always win on collision — a custom definition cannot shadow `title` or `diagram`.
- A custom template's content is a `Layer[]` whose text/image fields may carry placeholder tokens resolved against the block at render time (grammar v2):
  - **Block tokens** — `{title}`, `{content}`, `{children}` (comma-joined child titles), `{image:N}` (the Nth body image — URL in `ImageLayer.content.src`, alt text in text content), and `{attr:key}` (reads the block's `{[…]}` annotation attribute `key`, falling back to structured data then metadata).
  - **Pipe defaults on any token** — `{title|Untitled}`, `{attr:subtitle|Untitled}`, `{image:1|fallback.jpg}`. The default is used when the token resolves to the empty string; for an `{image:N}` in an `ImageLayer.content.src` a default also suppresses the "drop the layer" behaviour when the Nth image is missing.
  - **Escape** — `{{title}}` renders as the literal text `{title}`.
  - **Per-layer `repeat`** — a layer may carry a `repeat` directive (`{ source: 'images' | 'children' | 'listItems', direction?, gap?, max? }`) that clones it once per item of the chosen collection, laid out in a row/column. Inside a repeated layer the per-item tokens `{item}`, `{item:src}`, `{item:label}`, and `{index}` (1-based) resolve against the current item. Custom-template definitions live in the `squisq-custom-templates` frontmatter — see [Multi-line frontmatter](#multi-line-frontmatter) for authoring them as pretty JSON.

Built-in template types

Below is a concise reference of built-in templates (names match the `template`
property used in annotations, and the attribute keys map 1:1 to the template's
input fields — there is no attribute renaming at render time). Fields marked
_(required)_ must be supplied by the annotation, a data fence, or (where noted)
the block body. Everything else is optional. `colorScheme` is a theme
colour-scheme name; `ambientMotion` is `zoomIn` | `zoomOut` | `panLeft` |
`panRight`. `accentImage` is `{ src, alt, position, ambientMotion?, credit?,
license? }` where `position` is `left-strip` | `right-strip` | `bottom-strip`
| `corner-inset`.

Every template also accepts the shared block-level attributes: the timeline
keys above, `useBottomLayer` / `useTopLayer` (`false` opts the block out of
doc-wide persistent layers), and `imageTreatment` (`none` | `mono` | `duotone`
| `warm` | `cool` — per-block override of the theme's photographic grade).

- `title`
  - Inputs: `title` _(required)_, `subtitle` (supports `\n` line breaks), `backgroundColor`
  - Usage: hero/title slide

- `sectionHeader`
  - Inputs: `title` _(required)_, `colorScheme`, `imageSrc`, `imageAlt`, `ambientMotion`
  - Usage: section separators or small header slides (the structural default for unannotated headings)

- `statHighlight`
  - Inputs: `stat`, `description` _(required)_, `detail`, `colorScheme`, `accentImage`
  - Usage: numeric callouts (e.g., "89% — up 5%")

- `quote`
  - Inputs: `quote` _(required)_, `attribution`, `accentImage`
  - Usage: standard quotes

- `factCard`
  - Inputs: `fact`, `explanation` _(required)_, `source`, `accentImage`
  - Usage: short fact + context

- `twoColumn`
  - Inputs: `left`, `right` _(required; each an object `{ label, sublabel? }`)_, `header`, `leftColor`, `rightColor`
  - Usage: side-by-side text/content
  - Inline: `left`/`right` accept a `"label|sublabel"` string inline (`{[twoColumn left="Espresso|Bold" right="Filter|Smooth"]}`); the pipe splits label from sublabel. A data fence still works for values that carry a literal `|`.

- `dateEvent`
  - Inputs: `date`, `description` _(required)_, `footer`, `mood` (`neutral` | `somber` | `celebratory`), `accentImage`
  - Usage: timeline or event slides

- `imageWithCaption`
  - Inputs: `imageSrc`, `imageAlt` _(required — or an image in the block body)_, `caption`, `captionPosition` (`bottom` | `top` | `center`), `ambientMotion`, `isTitle`, `subtitle`, `imageCredit`, `imageLicense`
  - Usage: image + caption (inline or full-bleed)

- `leftFeature`
  - Inputs: `imageSrc` _(required — or an image in the block body)_, `imageAlt`, `imageWidth`, `imageHeight`, `title`, `body`
  - Usage: editorial feature block with media on the left and text on the right

- `rightFeature`
  - Inputs: `imageSrc` _(required — or an image in the block body)_, `imageAlt`, `imageWidth`, `imageHeight`, `title`, `body`
  - Usage: editorial feature block with text on the left and media on the right

- `map`
  - Inputs: `center` _(required; an object `{ lat, lng }`)_, `zoom` _(required)_, `mapStyle`, `title`, `caption`, `markers` (array of `{ lat, lng, label? }`), `ambientMotion`, `staticSrc` (pre-rendered image path)
  - Usage: small map embeds
  - Inline: `center` accepts a `"lat,lng"` string inline (`{[map center="47.6,-122.3" zoom=9]}`) — it is coerced to `{ lat, lng }` at render time, and `zoom` coerces to a number. `markers` is an object array, so it still needs a `json data` fence (or a YAML `data` fence, see [Structured data fences](#structured-data-fences)); the fence remains the power path for full marker sets.

- `fullBleedQuote`
  - Inputs: `text` _(required)_, `colorScheme`
  - Usage: prominent quote over full bleed background

- `list`
  - Inputs: `items` _(required — usually the block's markdown list)_, `title`, `colorScheme`, `accentImage`
  - Usage: bulleted/numbered lists authored as a single template

- `photoGrid`
  - Inputs: `images` _(required — the 2–4 images in the block body, each `{ src, alt, credit?, license? }`)_, `caption`, `ambientMotion`
  - Usage: image gallery grid

- `definitionCard`
  - Inputs: `term`, `definition` _(required)_, `origin`, `colorScheme`, `accentImage`
  - Usage: glossary/definition

- `comparisonBar`
  - Inputs: `leftLabel`, `leftValue`, `rightLabel`, `rightValue` _(required)_, `unit`, `colorScheme`
  - Usage: side-by-side comparison visualization

- `dataTable`
  - Inputs: `headers`, `rows` _(required)_, `title`, `align`, `colorScheme`
  - Usage: themed tabular data for structured comparisons or reference sections
  - Sourcing: when `headers`/`rows` aren't provided explicitly, the first GFM table in the section body supplies them (including column alignment) — write a normal markdown table under the heading and it renders as the themed table

- `diagram`
  - Inputs: `title`, `colorScheme`, `nodeShape` (`rounded` | `rect` | `pill`), `edgeStyle` (`curved` | `straight` | `orthogonal`), `startStyle`, `endStyle`, `lineStyle`; child headings provide nodes (positioned by `x`/`y`) and `connectsTo` edges
  - Usage: node-and-edge diagrams authored from nested section headings

- `layout`
  - Inputs: none on the parent — each **child heading** is one absolutely-positioned layer: `{[text x=.. y=.. width=.. height=..]}` (the child's body markdown is the text content), `{[image src=.. alt=.. fit=..]}` (alias `img`; `fit` is `cover` | `contain` | `fill`), or any drawing shape primitive. Children render in document order (first child = back-most layer). Coordinates are absolute viewport units — no auto-fit.
  - Usage: one-off free-form block layouts that don't fit a template
  - Legacy: layouts authored visually before the child-heading format persisted their `Layer[]` as a base64-JSON `layers="…"` Pandoc param; the editor migrates those to child sub-blocks on first edit (they are not decoded at render time)

- `drawing`
  - Inputs: `title`, `colorScheme`, `fill`, `stroke`; child headings provide the shapes (see **Drawings** below)
  - Usage: free-form shape canvases (org charts, sketches, annotated layouts) authored as nested section headings — each child heading is one shape, positioned by `x`/`y`/`width`/`height` and optionally joined by `from`/`to` connectors
  - Legacy: like `layout`, drawings authored visually before the child-heading format used a base64 `layers="…"` param; the editor migrates those on first edit (a drawing with no child shapes renders an "empty drawing" hint)

- `pullQuote`
  - Inputs: `text`, `backgroundImage` _(required; `backgroundImage` is `{ src, alt, credit?, license? }`)_, `attribution`, `ambientMotion`
  - Usage: smaller inline quote treatment over a background image

- `videoWithCaption`
  - Inputs: `videoSrc`, `videoAlt`, `clipStart`, `clipEnd` _(required)_, `posterSrc`, `caption`, `captionPosition`, `videoCredit`, `videoLicense`
  - Usage: inline video with caption

- `videoPullQuote`
  - Inputs: `text`, `backgroundVideo` _(required; `backgroundVideo` is `{ src, posterSrc?, alt, clipStart, clipEnd }` — supply via a data fence)_, `attribution`
  - Usage: combination of video + pull-quote

Legacy aliases — documents written before the "Block" suffix was dropped keep
parsing: `titleBlock` → `title`, `quoteBlock` → `quote`, `mapBlock` → `map`,
`listBlock` → `list`, `diagramBlock` / `diagramNode` → `diagram`. Aliases are
resolved everywhere a template name is looked up; the canonical short id is
what serializers write.

## Standalone annotations

A template annotation doesn't always need a heading to ride on. A **standalone
annotation** — a top-level paragraph whose entire trimmed text is exactly
`{[templateName key=value …]}` — becomes a **heading-less template block**. The
body nodes that follow it, up to the next heading _or_ the next standalone
annotation, become that block's contents. This is the body-level analog of the
trailing heading annotation: same grammar, same quoting/escaping, same
block-meta keys (`{[quote duration=8]}` pins timing just as a heading would).

```markdown
## Results

{[statHighlight stat="89%" description="Customer satisfaction" detail="up 5% YoY"]}

{[quote quote="It just works." attribution="A happy user"]}
```

The two annotations above produce two heading-less blocks under the `Results`
section — no `###` sub-headings needed. Body content attaches to the annotation
it follows:

````markdown
{[map zoom=12]}

```yaml data
center:
  lat: 47.6062
  lng: -122.3321
```
````

Here the paragraph is the whole block; the `yaml data` fence right after it
feeds the same block's `map` template (fences attach to standalone blocks
exactly as they do to heading blocks). The nested `center` mapping is the
[one-level YAML nesting](#structured-data-fences) shipped this release.

Notes and caveats:

- **Media names keep their existing meaning.** A standalone `{[audio …]}` /
  `{[video …]}` / `{[media …]}` is still a [timed media clip](#timed-media-clips),
  not a template block — media extraction runs first, so those names are never
  turned into heading-less blocks.
- **A `title` param becomes the block's display title**; every other param
  flows through `templateOverrides` and is coerced (below) like a heading
  annotation's.
- **Round-trip caveat.** A standalone annotation placed _before_ a sub-heading
  child of the same section relocates to _after_ that child on the first
  markdown→markdown round-trip (the heading-less block is emitted as a sibling
  after the parent's whole subtree). The result is stable — a second round-trip
  is a no-op — but expect that one-time reordering if you interleave standalone
  annotations with sub-headings.
- **List-item nesting is not lifted.** Only top-level standalone paragraphs are
  recognized. A `{[…]}` paragraph nested inside a list item still warns as an
  `unparsed-annotation`; true list-item template blocks are future work.

## Inline attribute coercion

`{[…]}` params always arrive as strings, but the built-in templates now
**coerce typed inputs inline**, so simple scalar/tuple values no longer need a
data fence. `{[map center="47.6,-122.3" zoom=9]}` renders a real map;
`{[twoColumn left="Espresso|Bold" right="Filter|Smooth"]}` renders two
labelled columns. Coercion is driven by a per-template descriptor table
(`TEMPLATE_INPUT_DESCRIPTORS`, exported from `@bendyline/squisq/doc`); unknown
keys always pass through untouched, and a value that fails to coerce keeps its
raw string (and surfaces an `invalid-input-value` diagnostic) — coercion is
never lossy.

| Coercion kind | Inline form                   | Becomes                     | Used by (examples)                                                                 |
| ------------- | ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `string`      | `caption="Beach at sunset"`   | the string                  | most text inputs                                                                   |
| `number`      | `zoom=9`, `leftValue=42`      | a number                    | `map.zoom`, `comparisonBar.left/rightValue`, `leftFeature.imageWidth`, video clips |
| `boolean`     | `isTitle=true`, `useTopLayer` | a boolean (bare key → true) | `imageWithCaption.isTitle`, `useTopLayer`/`useBottomLayer`                         |
| `latLng`      | `center="47.6,-122.3"`        | `{ lat, lng }`              | `map.center`                                                                       |
| `labeledPair` | `left="Espresso\|Bold"`       | `{ label, sublabel? }`      | `twoColumn.left`, `twoColumn.right`                                                |
| `stringList`  | `images="a.jpg,b.jpg"`        | `string[]`                  | `photoGrid.images`, `dataTable.headers`                                            |

Closed-enum inputs (`captionPosition`, `ambientMotion`, `mapStyle`,
`dateEvent.mood`, `imageTreatment`) are validated against their allowed values
inline — an out-of-set value is flagged `invalid-input-value`.

**Caveat — `photoGrid images`.** `images="a.jpg,b.jpg"` coerces to a string
list, but `photoGrid` renders image _objects_ (`{ src, alt, credit?, license? }`).
Inline `images` is therefore a partial convenience (it wires up the sources) —
authoring images in the section body, or a `json data` fence for full objects
with alt/credit, remains the complete render path. Object arrays in general
(map `markers`, `dataTable.rows`, `videoPullQuote.backgroundVideo`) still belong
in a data fence.

## Automatic templates

Unannotated headings don't always stay on the structural default
(`sectionHeader`). By default, `markdownToDoc` inspects each unannotated
heading's body for one strong content signal and applies the matching
template, deriving its inputs from that body:

| Body signal (checked in this order)                  | Auto-picked template                         |
| ---------------------------------------------------- | -------------------------------------------- |
| GFM table                                            | `dataTable`                                  |
| 2+ images                                            | `photoGrid`                                  |
| 1 image                                              | `leftFeature` / `rightFeature` (alternating) |
| Blockquote                                           | `quote`                                      |
| A short, stat-looking line (`89%`, `$2.3M`, `1,234`) | `statHighlight`                              |
| List                                                 | `list`                                       |

Derivation is strict: if the essential input can't be built from the body
(e.g. a feature with no image source), the block keeps the structural
default. Auto-picked blocks are marked `block.autoTemplate = true`, which is
deliberately **ephemeral** — serializing back to markdown does not write a
`{[…]}` annotation for them, so round-trips stay lossless. Explicit
annotations always win over auto-picking.

Disable per call with `markdownToDoc(…, { autoTemplates: false })`, per
document with frontmatter `squisq-auto-templates: false`, or on the CLI with
`--no-auto-templates`.

## YAML Frontmatter

Squisq Markdown documents can include a YAML frontmatter block at the very top (delimited by `---`). Frontmatter properties set document-level rendering hints.

Two of the keys below — `document-render-as` and `display-mode` — are **editor-preview hints only**: the editor's Preview panel and toolbar read them, but core (`markdownToDoc`) and the exporters/CLI do not. The `theme` key (and the other `squisq-*` keys documented under [Other Squisq frontmatter keys](#other-squisq-frontmatter-keys)) _are_ load-bearing — every render and export path honours them.

```yaml
---
document-render-as: landscape
display-mode: slideshow
squisq-theme: cinematic
---
```

### `document-render-as`

Sets the default viewport aspect ratio for rendered output.

| Value                                     | Resolved preset            |
| ----------------------------------------- | -------------------------- |
| `landscape`, `16:9`, `widescreen`         | 16:9 Landscape (1920×1080) |
| `portrait`, `9:16`, `vertical`, `stories` | 9:16 Portrait (1080×1920)  |
| `square`, `1:1`                           | 1:1 Square (1080×1080)     |
| `standard`, `4:3`                         | 4:3 Standard (1440×1080)   |

Default when omitted: `landscape`.

### `display-mode`

Sets the default display/playback mode.

| Value                                         | Resolved mode                                                      |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `video`                                       | Video — timeline playback with audio sync, scrub bar, auto-advance |
| `slideshow`, `slides`, `presentation`, `deck` | Slideshow — prev/next navigation, no auto-advance                  |
| `dashboard`, `dash`                           | Dashboard — every block arranged on one static canvas              |
| `linear`, `document`, `scroll`                | Document — long-scrolling readable view, no audio                  |
| `page`, `html`, `plain`, `reader`             | Page — static plain-HTML rendering (no doc model)                  |

Default when omitted: `video`.

### `theme`

Sets the visual theme for rendered blocks (colors, typography, style).

| Value           | Theme                                                       |
| --------------- | ----------------------------------------------------------- |
| `standard`      | Standard (default) — safe system fonts, motion-conservative |
| `standard-dark` | Standard Dark — the standard palette on a dark surface      |
| `documentary`   | Documentary — classic dark palette                          |
| `minimalist`    | Minimalist — clean, reduced contrast                        |
| `bold`          | Bold — high-contrast, vibrant                               |
| `morning-light` | Morning Light — warm, light tones                           |
| `tech-dark`     | Tech Dark — deep blue-black, neon accents                   |
| `magazine`      | Magazine — editorial, sophisticated                         |
| `cinematic`     | Cinematic — moody, filmic palette                           |
| `warm-earth`    | Warm Earth — natural, earthy tones                          |
| `gezellig`      | Gezellig — cozy, warm-hued                                  |

Ids are the hyphenated form (`morning-light`). The editor's preview also
accepts a spaced spelling (`morning light`) and normalizes it; core resolution
is exact-id. Unknown ids fall back to the default. Default when omitted:
`standard`.

The canonical key the editor writes is `squisq-theme`; `theme` and `themeId` are accepted as legacy fallbacks. Resolution order when more than one is present: `squisq-theme` → `themeId` → `theme`. The id resolves against the doc's own custom themes first (see below), then the built-ins.

### Other Squisq frontmatter keys

These are read by core and every export path (not just the editor preview):

| Key                       | Purpose                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `squisq-theme`            | Canonical theme selector (see [`theme`](#theme) above). Resolves against the doc's own custom themes first, then built-ins.                                |
| `squisq-custom-themes`    | Inline custom `Theme[]` payload (compact single-line JSON keyed by theme id) → `Doc.customThemes`. One is activated via `squisq-theme`.                    |
| `squisq-custom-templates` | Inline custom template definitions (compact single-line JSON keyed by name) → `Doc.customTemplates`. A `{[myTemplate]}` annotation resolves against these. |
| `squisq-auto-templates`   | Kill-switch for content-aware auto-templating in `markdownToDoc`. Disabled when the value is `false`/`off`/`no`/`0`.                                       |
| `title`                   | Document title. Preferred over the first heading by `inferDocumentTitle()`.                                                                                |

These are managed by the editor's Preview controls and consumed by the player/export paths:

| Key                                               | Purpose                                                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `squisq-transform` (legacy `transform-style`)     | Slideshow transform style id applied in preview. Omitted for the default of no transform.                   |
| `squisq-captions` (legacy `caption-style`)        | Caption mode — `off`, `standard`, or `social` (`instagram`/`tiktok`/`reels` → social). Default: `standard`. |
| `squisq-cover-slide` (legacy `cover-slide`)       | Whether to show the generated cover slide. Default: `true`.                                                 |
| `squisq-cover-template` (legacy `cover-template`) | Cover appearance: `cover`, `title`, `sectionHeader`, or `imageWithCaption`. Default: `cover`.               |
| `squisq-cover-duration` (legacy `cover-duration`) | Seconds the cover remains visible in Video/export (0-60). Default: `2`.                                     |
| `squisq-cover-playback` (legacy `cover-playback`) | `preroll` delays the story; `overlay` advances video/audio beneath the cover. Default: `preroll`.           |
| `squisq-video-loop` (legacy `video-loop`)         | Whether Video mode restarts automatically after playback ends. Default: `false`.                            |

When the editor writes these settings, values matching their runtime defaults are omitted rather than persisted. The same applies to the default `standard` theme. Choosing a default also removes any legacy alias; non-default values use the canonical `squisq-*` key.

### Dashboard

Dashboard mode (`display-mode: dashboard`) renders the document as ONE static
canvas: a layout places the doc's blocks into cells (grids and hero mosaics),
each block rendered at its cell's size. Blocks beyond the layout's capacity
are not rendered (an overflow diagnostic is reported, never a console error).
There is no clock: video layers show as paused poster frames and scheduled
audio/video media does not play.

| Key                                                   | Purpose                                                                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `squisq-dashboard-layout` (legacy `dashboard-layout`) | Preferred layout id, or `auto` (default) to pick the smallest layout that fits the block count. Built-ins: `focus-1`, `split-2`, `hero-left`, `grid-2x2`, `hero-top`, `mosaic-5`, `grid-3x2`, `grid-3x3`, `grid-4x3`, `grid-4x4`. |
| `squisq-dashboard-title` (legacy `dashboard-title`)   | Whether the document-title band renders (default `true`; the band only appears when a title actually resolves, and a leading block that merely restates the title dedupes into it).                                               |
| `squisq-dashboard-layouts`                            | Inline custom layout definitions (compact single-line JSON keyed by layout name, same convention as `squisq-custom-templates`). Customs win name collisions with built-ins and join auto-pick.                                    |
| `squisq-dashboard-zoom` (legacy `dashboard-zoom`)     | Cell zoom behavior: `auto` (default) boosts short text-led blocks to 1.5×/2× type so they fill their slot, quantized to at most ONE boost level per dashboard (cells stay consistently sized); `off` renders everything at 1×.    |

A custom layout defines `%`-rect cells relative to the content area (the
canvas minus the title band), per orientation (`ls` landscape required;
`pt` portrait / `sq` square optional — portrait falls back to a transposed
landscape). A cell may pin a specific block with `bk` (1-based document
order; duplicates allowed — a KPI wall may repeat a block) and may pin a
type-scale zoom with `zo` (`1`/`1.5`/`2`, percent spellings `100/150/200`
accepted — pinned cells are exempt from the automatic pick, and automatic
boosts rally to a pinned level so the dashboard keeps ≤2 unique sizes):

```yaml
squisq-dashboard-layouts:
  {
    'kpi-wall':
      {
        'lb': 'KPI Wall',
        'ce':
          {
            'ls':
              [
                { 'x': '0%', 'y': '0%', 'wd': '49%', 'hg': '100%', 'bk': 1 },
                { 'x': '51%', 'y': '0%', 'wd': '49%', 'hg': '100%' },
              ],
          },
      },
  }
squisq-dashboard-layout: kpi-wall
```

The editor's Dashboard mode adds a Layout picker + Title toggle to the
preview toolbar (persisted with the keys above) and an "Export dashboard as
image" dialog; the CLI exports the same rendition with `squisq image` or
`squisq convert -f png`.

### Custom frontmatter

Any other YAML key-value pairs in the frontmatter block are preserved in `Doc.frontmatter` as a `Record<string, unknown>` and are available to consuming applications. Squisq only interprets the keys documented above; everything else is passed through untouched.

Note that squisq's frontmatter parser is deliberately a **line-based subset**
of YAML: flat `key: value` pairs only, with `true`/`false` and numbers coerced
to their types, surrounding quotes stripped, and `#`-comment lines skipped.
Nested YAML mapping/sequence structures are not parsed (a single-line JSON
literal passes through verbatim — which is exactly how the custom-templates and
custom-themes payloads ride along). The one exception is the **literal block
scalar** described next, which lets those payloads be authored across multiple
lines.

### Multi-line frontmatter

Frontmatter now understands YAML **literal block scalars** (`key: |` and
`key: |-`): the more-indented lines that follow are dedented by their common
leading whitespace and joined with `\n` into the key's string value. This lets
the JSON-bearing keys — `squisq-custom-templates` and `squisq-custom-themes` —
be authored as pretty, reviewable multi-line JSON instead of one dense line.

Compact single-line JSON still parses (fully backward compatible):

```yaml
---
squisq-custom-templates:
  {
    'myCard':
      {
        'name': 'myCard',
        'label': 'My Card',
        'viewport': { 'width': 1920, 'height': 1080 },
        'layers': [],
      },
  }
---
```

The same payload as a block scalar:

```yaml
---
squisq-custom-templates: |-
  {
    "myCard": {
      "name": "myCard",
      "label": "My Card",
      "viewport": { "width": 1920, "height": 1080 },
      "layers": []
    }
  }
---
```

Both parse to the identical `Doc.customTemplates`. The serializer emits a
block scalar (`|-`) automatically for any multi-line frontmatter value and a
verbatim single line for compact JSON, so hand-authored multi-line payloads
round-trip. (Only `|` / `|-` are modelled; folded scalars `>` / `>-` and the
`+` chomping indicator are not.)

Notes on arrays and complex attributes

- The built-in array-valued templates source their arrays from the section **body**, not from attribute strings: `list` reads the block's markdown list, `photoGrid` reads the block's images, and `dataTable` reads the first GFM table. A custom template may still choose to parse a comma-separated attribute string itself.
- Simple scalar and tuple inputs now coerce inline — numbers (`zoom=9`), booleans (`isTitle=true`), a `map` `center="lat,lng"`, a `twoColumn` `left="label|sublabel"` (see [Inline attribute coercion](#inline-attribute-coercion)). For object **arrays** (map `markers`, `videoPullQuote.backgroundVideo`, explicit `dataTable` rows), a structured data fence (below) is still the right channel — those can't be expressed as a single inline string.

## Structured data fences

Tabular or nested template inputs don't pack well into a single attribute line. Instead, place a fenced code block whose info string is `json data` or `yaml data` (also `yml data`) in the section body — the parsed object feeds the block's template directly:

````markdown
## Quarterly numbers {[dataTable]}

```json data
{
  "headers": ["Q", "Revenue"],
  "rows": [
    ["Q1", "1.2M"],
    ["Q2", "1.4M"]
  ]
}
```
````

A nested example — a `map` with markers (scalar `center`/`zoom` can go inline now, but an array of marker objects is the fence's job):

````markdown
## Where it happened {[map]}

```json data
{
  "center": { "lat": 47.6062, "lng": -122.3321 },
  "zoom": 12,
  "markers": [{ "lat": 47.6205, "lng": -122.3493, "label": "Space Needle" }]
}
```
````

Rules:

- The `data` marker is required (` ```json data `). A plain ` ```json ` fence is ordinary code and renders as code — it never feeds the template.
- A JSON fence must contain a top-level object (`{"key": …}` — a bare array has no key to merge under).
- Values keep their parsed types (arrays, numbers, booleans, nested objects), unlike `{[…]}` params which are always strings.
- Merge order at render time: template defaults → data fence values → `{[…]}` params. An explicit annotation param always wins.
- Multiple data fences in one section merge in order (later keys override earlier ones).
- An unparseable fence never breaks the document: the block renders without that data and the problem is recorded as a diagnostic (see Validation).

YAML fences support a deliberate subset (squisq carries no YAML dependency): top-level `key: scalar`, inline arrays (`headers: [Name, Age]`), block sequences of scalars or inline arrays, and **one level of nested mapping** (a `key:` line followed by indented `subkey: scalar` lines):

````markdown
```yaml data
title: Roster
headers: [Name, Age]
rows:
  - [Alice, 30]
  - [Bob, 25]
```
````

The one-level nested-mapping support means a `map` block's `center` can be authored as pure YAML — no `json data` fence required:

````markdown
## Where it happened {[map zoom=12]}

```yaml data
center:
  lat: 47.6062
  lng: -122.3321
```
````

Nesting **deeper than one level**, and mixing `- list` items with `subkey:` mapping lines under the same key, are rejected with a clear, line-anchored error — reach for a `json data` fence for those (e.g. an array of marker objects).

## Timeline & timed media

Every block has a position on the playback timeline: `startTime` (when it
appears) and `duration` (how long it shows). These — and a few other
block-meta keys — can be pinned as heading attributes, in either the Pandoc
`{…}` block or the squiggly `{[…]}` annotation (the Pandoc value wins when a
key appears in both):

```markdown
## Pinned section {#intro startTime=02:15 duration=8}

## Also fine {[quote duration=8 transition=dissolve]}
```

| Key                   | Meaning                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `startTime`           | Timeline start of the block (time value)                                                                                                                                 |
| `duration`            | How long the block shows (time value)                                                                                                                                    |
| `transition`          | Entry transition type (e.g. `fade`, `dissolve`, `push`, `wipe`, `zoom`, `flip`, `cube`, `pageCurl`, … — the full PowerPoint-compatible vocabulary in `TRANSITION_TYPES`) |
| `transitionDuration`  | Transition length (time value)                                                                                                                                           |
| `transitionDirection` | `left` \| `right` \| `up` \| `down` \| `in` \| `out` \| `horizontal` \| `vertical`                                                                                       |
| `x`, `y`              | Position on a `diagram`/`drawing`/`layout` canvas (numbers)                                                                                                              |
| `connectsTo`          | Comma-separated diagram edges: `target` or `target:type` (e.g. `foo,bar:flow`)                                                                                           |

Time values accept seconds (`5`, `5.5`), `mm:ss` (`01:30`), `mm:ss.ms`
(`01:30.500`), or `1500ms`. Seconds in `mm:ss` must be below 60. Malformed
values are dropped (the raw string is preserved for round-tripping) and
reported as an `invalid-attribute` diagnostic.

When not pinned, `duration` defaults to the block's reading time (min 3s;
blocks with no body text get 5s) and `startTime` defaults to the running sum
of prior durations. A pinned `startTime` keeps its value while the running
cursor still advances past it, so following blocks sequence after it. The
editor's **Timeline** view edits these by dragging block edges — see the
editor docs.

### Timed media clips

A standalone `{[audio …]}` / `{[video …]}` annotation on its own line in a
block's body attaches a timed media clip to that block (`{[media …]}` is an
accepted synonym for an audio clip). The paragraph must contain nothing but
the annotation. A block can carry several clips. Timing is relative to the
block:

```markdown
## Narrated section {duration=20}

Body text shown while the narration plays.

{[audio src=narration.mp3 startAt=5 spillover=true]}
```

| Key           | Meaning                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `src`         | Media file (required), relative to the article media dir                                       |
| `startAt`     | Seconds into the block before the clip begins (default 0); `startTime` is accepted as an alias |
| `clipStart`   | Source in-point within the file (default 0)                                                    |
| `clipEnd`     | Source out-point within the file (default: block / file end)                                   |
| `spillover`   | `true` keeps the clip playing past the block's end (default stops at it)                       |
| `anchor`      | `document` makes the clip span the whole document (see below)                                  |
| `placement`   | Video only: `picture-in-picture` or `overlay`; `pip=true` / `overlay=true` are aliases         |
| `lockToBlock` | Placed video only: `true` follows its block; `false` uses independent document timing          |

All timing keys accept the same time formats as `startTime`/`duration` above.
So a clip with `startAt=5` inside a block that begins at 3:30 plays at 3:35.
A `{[video …]}` annotation behaves the same but is rendered as a video.

The Write editor exposes the same choice directly on an inline `<video>`.
`In layout` leaves the video in block content. PIP and Overlay store a valid
HTML data attribute and promote the video to the timed compositor:

```html
<video src="video/presenter.webm" controls data-squisq-video-placement="picture-in-picture"></video>
```

Because `data-*` attributes are valid HTML, no synthetic heading is required.
PIP and Overlay videos are locked to their parent block by default: they begin
with the block, disappear when it ends, and follow block timing edits. Turning
off **Lock to block** writes an explicit flag and makes the video independently
movable and resizable on the document timeline:

```html
<video
  src="video/presenter.webm"
  controls
  data-squisq-video-placement="picture-in-picture"
  data-squisq-video-lock-to-block="false"
></video>
```

The timeline adds `data-squisq-video-start-at`,
`data-squisq-video-clip-start`, and `data-squisq-video-clip-end` only as those
independent values are edited. An unlocked video with no explicit start begins
at its original parent block, and its audio and video may continue across later
blocks. It does not participate in the original block's automatic duration.

### Document-spanning media

A media annotation flagged `anchor=document` (or the synonym `span=document`),
typically in the preamble before the first heading, plays across the entire
document — e.g. a full-length narration MP3 or a background MP4:

```markdown
{[audio src=voice.mp3 anchor=document]}

# First section
```

Its `startAt` is relative to the document start; `spillover` is meaningless
here (the clip already spans the timeline). The annotation does not create a
visible block — a preamble that held only document media is dropped from the
block list.

### Narration audio

Separately from timed clips, `resolveAudioMapping()` links per-section
narration files stored in the document's `ContentContainer` to blocks:

- **Explicit**: a heading annotated `{[audio=narration.mp3]}` (an
  attributes-only annotation — the key rides in `templateOverrides`) maps that
  block to the named file.
- **Automatic**: when no annotations exist, audio files are matched to blocks
  by comparing each file's `.timing.json` sidecar `sourceText` against block
  text (word overlap), falling back to slugified-filename ↔ title matching.

Files with `.mp3`/`.wav`/`.ogg`/`.m4a` extensions anywhere in the container
participate; `.webm`/`.mp4` files participate only when they live under the
`audio/` directory (where the browser recorder writes), since those container
formats are otherwise video.

## Inline icons

Anywhere in text — headings, paragraphs, list items — a `{[token]}` whose
token resolves to a FontAwesome Free icon renders as an inline icon glyph:

```markdown
Deploy with {[github]} or chat on {[fa-brands:discord]}.
```

- **Bare** tokens (`github`) resolve only when the name is unique across icon
  families.
- **Qualified** tokens (`fa-solid:user`, `fa-brands:github`, `fa-regular:…`)
  disambiguate names that ship in multiple families.
- Unresolved tokens are left as literal text (so you _can_ write `{[sic]}` in
  prose), and `squisq validate` flags them so typos don't silently ship.

## Drawings

A `{[drawing]}` block is a container: each direct child heading is one shape on a
free-form canvas. The shape primitive is the child's `{[…]}` annotation name; its
geometry and style ride in the annotation params; a `{#id}` makes it referenceable;
the heading text is the shape's label and the body text an optional sublabel. This
mirrors how `diagram` reads its children — drawings just add a richer shape
vocabulary and free geometry.

```markdown
## Org chart {[drawing]}

### CEO {#ceo} {[rectangle x=21 y=25 width=100 height=100]}

The CEO is the chief executive.

### reports to {[line from=ceo to=dev1]}

### Developer {#dev1} {[rectangle x=21 y=190 width=100 height=100]}
```

Shape primitives (the `{[…]}` name on a drawing's child):

- `rectangle` / `rect` / `square` — a box. `borderRadius` rounds the corners.
- `circle` / `ellipse` / `oval` — an oval filling the box.
- `line` — a straight stroke. With `from`/`to` it becomes a connector (below).
- `arrow` — like `line`, but draws an arrowhead at the `to` end.
- `path` — an opaque SVG path; pass the geometry in `d="M … L …"` (for freehand strokes).
- `text` — a free text label; the content is `text=`, else the heading text, else the body.
- Polygons & glyphs — `triangle`, `right-triangle`, `diamond` (`rhombus`), `pentagon`,
  `hexagon`, `octagon`, `star` (`star4`/`star6`), `parallelogram`, `trapezoid`,
  `plus` (`cross`), `chevron`, `arrow-right`/`-left`/`-up`/`-down`, `double-arrow`,
  `callout` (`speech`), `cylinder`, `cloud`, `heart`, `lightning` (`bolt`). Each is
  inscribed in the shape's bounding box and filled per `fill` (default `none` →
  outline only).

Geometry & style params (all optional; coordinates are author-defined units that the
template fits to the viewport, so you don't think in absolute pixels):

- Position/size: `x`, `y`, `width` (or `w`), `height` (or `h`).
- Style: `fill`, `stroke`, `strokeWidth`, `borderRadius`, `dasharray`.
- Connectors: `from` and `to` reference sibling shape ids; a `line`/`arrow` with either
  becomes a connector clipped to the two shapes it joins (its heading text is the
  midpoint label). A shape's Pandoc `connectsTo=` also draws an arrow, exactly as in
  `diagram`.
- Connector end-styles & routing:
  - `startStyle` / `endStyle` — the marker at each end: `none`, `arrow` (filled triangle;
    aliases `triangle`, `filled`), `open` (stroked V; alias `v`), `diamond`, `circle`
    (alias `dot`), `square` (alias `box`). Default: `arrow` connectors end with an
    arrow, plain `line`s have none.
  - `lineStyle` — `solid` (default), `dashed`, or `dotted` (sets the dash pattern; an
    explicit `dasharray` still wins).
  - `routing` — `straight` (alias `direct`; default), `orthogonal` (aliases `elbow`,
    `step`), or `curved` (aliases `curve`, `bezier`).

  Example: `### owns {[arrow from=a to=b endStyle=diamond startStyle=circle lineStyle=dashed routing=orthogonal]}`.

The `diagram` template's edges accept the same `startStyle` / `endStyle` / `lineStyle` on
the `{[diagram]}` parent (applied to all edges; `edgeStyle` is the diagram's routing).

Notes:

- Params are space-separated, like every other annotation. A trailing comma is tolerated
  (`x=21, y=25` works) but the canonical form omits it.
- Shape annotations are only recognized on a drawing's (or layout's) children. A
  `{[rectangle]}` elsewhere is flagged `shape-outside-drawing`; an unknown shape inside
  a drawing is flagged `unknown-shape` (with a did-you-mean).
- Authoring is markdown-first: shapes render in previews and exports and git-diff cleanly.

## Validation

`squisq validate <input>` (from `@bendyline/squisq-cli`) checks a `.md` file, `.dbk`/`.zip` container, or folder and reports structural problems with line numbers:

Diagnostics carry one of three severities: **error**, **warning**, or **info** (the last is an advisory nudge, new in this release, that never affects the exit code).

- `unknown-template` — annotation names no built-in, alias, or doc-defined template (includes a did-you-mean suggestion) — _warning_
- `unknown-shape` — a `{[drawing]}` child's annotation names no known shape (includes a did-you-mean among the shape primitives) — _warning_
- `shape-outside-drawing` — a shape annotation (`{[rectangle]}`, `{[line]}`, …) on a heading that isn't a drawing's child — _warning_
- `unparsed-annotation` — literal `{[…]}` text that wasn't recognized (broken quoting, or a `{[…]}` paragraph nested inside a list item / blockquote — those aren't lifted, or an unknown inline icon) — _warning_
- `invalid-attribute` — malformed heading-attribute values (`x=abc`, bad `startTime`/`duration`) or non-numeric drawing-shape geometry — _warning_
- `unknown-input` — a `{[…]}` param key that isn't a known input for the template (includes a did-you-mean among the template's inputs + block-meta keys) — _warning_
- `invalid-input-value` — a `{[…]}` value outside a closed enum, or one that fails its coercion (bad `zoom`, malformed `center`) — _warning_
- `missing-input` — a required template input is absent from the annotation and can't be derived from the block's fields, a data fence, or the body — _warning_
- `duplicate-id` — two blocks share an id (pinned `{#id}` clashes; reported as an error) — _error_
- `unresolved-connection` — a `connectsTo` target, or a drawing connector's `from`/`to`, that matches no block/shape id — _warning_
- `data-fence-parse` — a `json data` / `yaml data` fence that failed to parse (reported as an error) — _error_
- `possible-data-fence` — a plain ` ```json ` / ` ```yaml ` fence inside a **templated** block whose content parses as an object — likely a forgotten `data` marker; add `data` to the fence to feed it to the template — _info_
- `conflicting-annotation-key` — the same block-meta key (`duration`, `startTime`, …) is pinned in both the `{[…]}` annotation and the Pandoc `{…}` block with different values; the `{…}` value wins — _info_
- `missing-asset` — a relative image/video reference not found in the bundle (or next to the `.md` file) — _warning_

`--json` emits the diagnostics as machine-readable JSON; `--strict` makes warnings fail the exit code. Agents should run validate after writing a document and iterate until the diagnostics list is empty.

The same checks are available programmatically via `validateMarkdownSource(source, options)` from `@bendyline/squisq/doc`. Conversion itself (`markdownToDoc`) also records its findings on `doc.diagnostics` — it never throws for content problems and is fully deterministic (the same markdown always produces the same Doc).

## Graceful degradation

A block whose template can't render never produces a blank slide. If the template name is unknown, or the template function throws, the block renders as a plain card showing the heading title and body text, with a small notice naming the problem (e.g. `⚠ Unknown template "photGrid"`). Content is never lost to a typo — the document stays readable, and the notice (plus the matching `validate` diagnostic) points at the fix.

Authoring tips

- Author slide decks as a flat run of annotated headings — one heading per slide:

```markdown
## Welcome {[title title="Welcome" subtitle="Intro to Squisq"]}

## Our product {[imageWithCaption caption="Our product"]}

![Product shot](photo.jpg)
```

- Lean on content sourcing: put the image/table/list/quote in the section body and let the template (or auto-templating) pick it up, instead of packing everything into attribute strings.
- Use `photoGrid` for compact galleries and `imageWithCaption` for single-image focus.
- When adding custom templates, keep attribute names simple (no spaces) and parse comma-separated lists inside the template function.

Where to look in the code

- The Markdown parser and annotation node types are in `@bendyline/squisq/markdown` (shared tokenizer/recognizers in `packages/core/src/markdown/attrTokens.ts`; block-meta coercion in `annotationCoercion.ts`).
- The template registry and built-ins live under `packages/core/src/doc/templates` (exposed via `@bendyline/squisq/doc`).
- Standalone-paragraph annotations are parsed in `packages/core/src/doc/standaloneAnnotation.ts` and lifted into heading-less blocks by `annotationBlocks.ts`.
- Inline attribute coercion + input linting live in `packages/core/src/doc/templates/inputDescriptors.ts` (`TEMPLATE_INPUT_DESCRIPTORS`, `coerceTemplateParams`, `lintTemplateParams`); the validator surfaces the lint findings in `validate.ts`. Custom-template token resolution (v2) is in `templates/tokens/resolveTokens.ts`. Data-fence parsing (incl. the YAML subset) is in `structuredData.ts`; multi-line frontmatter is in `markdown/utils.ts`.
- The editor extension for heading annotations is in `packages/editor-react/src/TemplateAnnotation.ts` and `tiptapBridge.ts`.

See also: `docs/API.md` for the formal API reference and `@bendyline/squisq/schemas` for `TemplateBlock`/`TemplateBlockInput` types.

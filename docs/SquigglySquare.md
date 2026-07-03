# Squiggly Square — Template Annotation Syntax

This document describes the "Squiggly Square" annotation notation used in Squisq Markdown to embed template blocks inline in Markdown documents.

Synopsis

- The annotation syntax is delimited with `{[` and `]}`.
- It can appear inline (headings, paragraphs) or as a standalone line (commonly used inside lists to create slides/blocks).

Basic grammar

- Minimal form: `{[templateName]}`
- With attributes: `{[templateName key=value otherKey="value with spaces"]}`

Rules

- Attribute names are alphanumeric and case-sensitive (they map to template input keys).
- Attribute values are parsed as strings. Use quotes (single or double) when a value contains spaces or special characters.
- Arrays are commonly represented as comma-separated values (e.g. `images="a.jpg,b.jpg,c.jpg"`). Templates that expect arrays should split/parse the string accordingly.
- Unknown attributes are passed through to the template input — templates may choose to parse or ignore them.

Examples

- List item containing a template (common pattern used to author slides):

```markdown
- {[imageWithCaption imageSrc="photo.jpg" caption="Beach at sunset"]}
```

- Heading annotated with a template (the editor preserves heading annotations).
  `photoGrid` collects its images from the section body:

```markdown
## Gallery {[photoGrid caption="Beach highlights"]}

![Sunrise](a.jpg)
![Midday](b.jpg)
![Sunset](c.jpg)
```

- Full-line template with surrounding content:

```markdown
{[title title="Welcome" subtitle="Intro to Squisq"]}

Some body text here.
```

Attribute value rules & escaping

The same value grammar applies to both annotation forms — `{[templateName key=value]}` and the Pandoc-style `{#id .class key=value}` block share one tokenizer.

- Unquoted values: no spaces, quotes, or `[` `]` `{` `}`, e.g. `columns=3` or `autoplay=true`. An apostrophe inside an unquoted value is literal (`attribution=O'Brien` works).
- Quoted values: use double or single quotes for values with spaces, e.g. `caption="A long caption"` or `caption='A long caption'`. Quoted values may contain commas, `]`, and `}` (e.g. `caption="rows 1, 2]"`).
- To include a double quote inside a value, wrap the value in single quotes (or vice versa): `caption='She said "hello"'`. Backslash escaping (`caption="She said \"hello\""`) is also accepted, but values containing both quote characters are best avoided in markdown source.
- Headings are still markdown text, so markdown-significant characters inside values (`*`, `_`, `` ` ``, `~`) must be backslash-escaped when authoring by hand: `text="a \*starred\* word"`. The serializer emits these escapes automatically; they resolve back to bare characters on parse.
- On save, values are canonicalized: double quotes preferred, single quotes used when the value itself contains a double quote, quotes omitted when not needed.

How the annotation is handled

- The Markdown parser emits a `TemplateAnnotationNode` in the AST with `template` and `attributes: Record<string,string>`.
- When converting to a `Doc`, the annotation is converted to a `TemplateBlock` (the attributes become the `TemplateBlockInput` fields). Template functions receive the input and render `Layer[]`.
- The editor extension `HeadingWithTemplate` preserves annotations inside headings and round-trips them between Tiptap and Markdown.

Registering custom templates

- Custom templates travel **with the document**, not through a global registry. Author them in the editor (Template picker → create custom template); they are stored in the `squisq-custom-templates` frontmatter key and surfaced as `Doc.customTemplates`. The expansion pipeline merges them via `buildRegistry(doc.customTemplates)` before walking blocks, so a heading annotated `{[myTemplate]}` resolves against a doc-defined template named `myTemplate`. There is no global `registerTemplate()` function.

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

- `title`
  - Inputs: `title` _(required)_, `subtitle`, `backgroundColor`
  - Usage: hero/title slide

- `sectionHeader`
  - Inputs: `title` _(required)_, `colorScheme`, `imageSrc`, `imageAlt`, `ambientMotion`
  - Usage: section separators or small header slides

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
  - Inputs: `left`, `right` _(required; each an object `{ label, sublabel? }` — supply via a data fence)_, `header`, `leftColor`, `rightColor`
  - Usage: side-by-side text/content

- `dateEvent`
  - Inputs: `date`, `description` _(required)_, `footer`, `mood` (`neutral` | `somber` | `celebratory`), `accentImage`
  - Usage: timeline or event slides

- `imageWithCaption`
  - Inputs: `imageSrc`, `imageAlt` _(required — or an image in the block body)_, `caption`, `captionPosition` (`bottom` | `top` | `center`), `ambientMotion`, `isTitle`, `subtitle`
  - Usage: image + caption (inline or full-bleed)

- `leftFeature`
  - Inputs: `imageSrc` _(required)_, `imageAlt`, `imageWidth`, `imageHeight`, `title`, `body`
  - Usage: editorial feature block with media on the left and text on the right

- `rightFeature`
  - Inputs: `imageSrc` _(required)_, `imageAlt`, `imageWidth`, `imageHeight`, `title`, `body`
  - Usage: editorial feature block with text on the left and media on the right

- `map`
  - Inputs: `center` (as `lat,lng`), `zoom` _(required)_, `mapStyle`, `title`, `caption`, `markers`, `ambientMotion`, `staticSrc`
  - Usage: small map embeds

- `fullBleedQuote`
  - Inputs: `text` _(required)_, `colorScheme`
  - Usage: prominent quote over full bleed background

- `list`
  - Inputs: `items` _(required — usually the block's markdown list)_, `title`, `colorScheme`, `accentImage`
  - Usage: bulleted/numbered lists authored as a single template

- `photoGrid`
  - Inputs: `images` _(required — the images in the block body, each `{ src, alt, credit?, license? }`)_, `caption`, `ambientMotion`
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
  - Inputs: `title`, `colorScheme`, `nodeShape`, `edgeStyle`, `startStyle`, `endStyle`, `lineStyle`; child headings provide nodes and `connectsTo` edges
  - Usage: node-and-edge diagrams authored from nested section headings

- `layout`
  - Inputs: none — `Layer[]` is authored visually via the Scene engine and persisted in `data-block-attrs` as a base64-JSON `layers="..."` param
  - Usage: one-off block layouts that don't fit a template (drag layers into place)

- `drawing`
  - Inputs: `title`, `colorScheme`, `fill`, `stroke`; child headings provide the shapes (see **Drawings** below)
  - Usage: free-form shape canvases (org charts, sketches, annotated layouts) authored as nested section headings — each child heading is one shape, positioned by `x`/`y`/`width`/`height` and optionally joined by `from`/`to` connectors
  - Legacy: drawings authored visually in the editor persist their `Layer[]` as a base64 `layers="…"` param (like `layout`) and have no children; those still render unchanged

- `pullQuote`
  - Inputs: `text`, `backgroundImage` _(required; `backgroundImage` is `{ src, alt, credit?, license? }`)_, `attribution`, `ambientMotion`
  - Usage: smaller inline quote treatment over a background image

- `videoWithCaption`
  - Inputs: `videoSrc`, `videoAlt`, `clipStart`, `clipEnd` _(required)_, `posterSrc`, `caption`, `captionPosition`
  - Usage: inline video with caption

- `videoPullQuote`
  - Inputs: `text`, `backgroundVideo` _(required; `backgroundVideo` is `{ src, posterSrc?, alt, clipStart, clipEnd }` — supply via a data fence)_, `attribution`
  - Usage: combination of video + pull-quote

## YAML Frontmatter

Squisq Markdown documents can include a YAML frontmatter block at the very top (delimited by `---`). Frontmatter properties set document-level rendering hints.

Two of the keys below — `document-render-as` and `display-mode` — are **editor-preview hints only**: the editor's Preview panel and toolbar read them, but core (`markdownToDoc`) and the exporters/CLI do not. The `theme` key (and the other `squisq-*` keys documented under [Other Squisq frontmatter keys](#other-squisq-frontmatter-keys)) _are_ load-bearing — every render and export path honours them.

```yaml
---
document-render-as: landscape
display-mode: slideshow
theme: cinematic
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
| `linear`, `document`, `scroll`, `page`        | Document — long-scrolling readable view, no audio                  |

Default when omitted: `video`.

### `theme`

Sets the visual theme for rendered blocks (colors, typography, style).

| Value           | Theme                                        |
| --------------- | -------------------------------------------- |
| `documentary`   | Documentary (default) — classic dark palette |
| `minimalist`    | Minimalist — clean, reduced contrast         |
| `bold`          | Bold — high-contrast, vibrant                |
| `morning-light` | Morning Light — warm, light tones            |
| `tech-dark`     | Tech Dark — deep blue-black, neon accents    |
| `magazine`      | Magazine — editorial, sophisticated          |
| `cinematic`     | Cinematic — moody, filmic palette            |
| `warm-earth`    | Warm Earth — natural, earthy tones           |

Accepts hyphenated ids (`morning-light`) or spaced names (`morning light`). Default when omitted: `documentary`.

The canonical key the editor writes is `squisq-theme`; `theme` and `themeId` are accepted as legacy fallbacks. Resolution order when more than one is present: `squisq-theme` → `themeId` → `theme`.

### Other Squisq frontmatter keys

These are read by core and every export path (not just the editor preview):

| Key                       | Purpose                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `squisq-theme`            | Canonical theme selector (see [`theme`](#theme) above). Resolves against the doc's own custom themes first, then built-ins.      |
| `squisq-custom-themes`    | Inline custom `Theme[]` payload (compact JSON) → `Doc.customThemes`. One is activated via `squisq-theme`.                        |
| `squisq-custom-templates` | Inline custom template definitions (compact JSON) → `Doc.customTemplates`. A `{[myTemplate]}` annotation resolves against these. |
| `squisq-auto-templates`   | Kill-switch for content-aware auto-templating in `markdownToDoc`. Disabled when the value is `false`/`off`/`no`/`0`.             |
| `title`                   | Document title. Preferred over the first heading by `inferDocumentTitle()`.                                                      |

These are read only by the editor's Preview controls (like `document-render-as` / `display-mode`):

| Key                                           | Purpose                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `squisq-transform` (legacy `transform-style`) | Slideshow transform style id applied in preview.                                |
| `squisq-captions` (legacy `caption-style`)    | Caption style — `standard` or `social` (`instagram`/`tiktok`/`reels` → social). |

### Custom frontmatter

Any other YAML key-value pairs in the frontmatter block are preserved in `Doc.frontmatter` as a `Record<string, unknown>` and are available to consuming applications. Squisq only interprets the keys documented above; everything else is passed through untouched.

Notes on arrays and complex attributes

- The built-in array-valued templates source their arrays from the section **body**, not from attribute strings: `list` reads the block's markdown list, `photoGrid` reads the block's images, and `dataTable` reads the first GFM table. For nested/tabular inputs (e.g. `twoColumn`, `videoPullQuote`, explicit `dataTable` rows), use a structured data fence (below). A custom template may still choose to parse a comma-separated attribute string itself.
- For geographic inputs, `map` accepts `center` as `"lat,lng"` (e.g. `center="37.78,-122.42"`); `markers` are best supplied via a data fence.
- For anything tabular or nested, prefer a structured data fence (below) over packing values into attribute strings.

## Structured data fences

Tabular or nested template inputs don't pack well into a single attribute line. Instead, place a fenced code block whose info string is `json data` or `yaml data` in the section body — the parsed object feeds the block's template directly:

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

Rules:

- The `data` marker is required (` ```json data `). A plain ` ```json ` fence is ordinary code and renders as code — it never feeds the template.
- Values keep their parsed types (arrays, numbers, booleans), unlike `{[…]}` params which are always strings.
- Merge order at render time: template defaults → data fence values → `{[…]}` params. An explicit annotation param always wins.
- Multiple data fences in one section merge in order (later keys override earlier ones).
- An unparseable fence never breaks the document: the block renders without that data and the problem is recorded as a diagnostic (see Validation).

YAML fences support a deliberate subset (squisq carries no YAML dependency): top-level `key: scalar`, inline arrays (`headers: [Name, Age]`), and block sequences of scalars or inline arrays:

````markdown
```yaml data
zoom: 12
markers:
  - '47.61,-122.33'
  - '47.62,-122.35'
rows:
  - [Alice, 30]
  - [Bob, 25]
```
````

Nested mappings are rejected with a clear error — use a `json data` fence for deeply nested input.

## Timeline & timed media

Every block has a position on the playback timeline: `startTime` (when it
appears) and `duration` (how long it shows). Both are heading attributes and
accept seconds, `mm:ss`, `mm:ss.ms`, or `1500ms`:

```markdown
## Pinned section {#intro startTime=02:15 duration=8}
```

`duration` defaults to the block's reading time (min 3s); `startTime` defaults
to the running sum of prior durations. The editor's **Timeline** view edits
these by dragging block edges — see the editor docs.

### Timed media clips

A standalone `{[audio …]}` / `{[video …]}` annotation on its own line in a
block's body attaches a timed media clip to that block. Its timing is relative
to the block:

```markdown
## Narrated section {duration=20}

Body text shown while the narration plays.

{[audio src=narration.mp3 startAt=5 spillover=true]}
```

| Key         | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `src`       | Media file (required), relative to the article media dir                 |
| `startAt`   | Seconds into the block before the clip begins (default 0)                |
| `clipStart` | Source in-point within the file (default 0)                              |
| `clipEnd`   | Source out-point within the file (default: block / file end)             |
| `spillover` | `true` keeps the clip playing past the block's end (default stops at it) |
| `anchor`    | `document` makes the clip span the whole document (see below)            |

So a clip with `startAt=5` inside a block that begins at 3:30 plays at 3:35.
A `{[video …]}` annotation behaves the same but is rendered as a video.

### Document-spanning media

A media annotation flagged `anchor=document` (typically in the preamble, before
the first heading) plays across the entire document — e.g. a full-length
narration MP3 or a background MP4:

```markdown
{[audio src=voice.mp3 anchor=document]}

# First section
```

Its `startAt` is relative to the document start. The annotation does not create
a visible block.

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

- `rectangle` / `rect` — a box. `borderRadius` rounds the corners.
- `circle` / `ellipse` — an oval filling the box.
- `line` — a straight stroke. With `from`/`to` it becomes a connector (below).
- `arrow` — like `line`, but draws an arrowhead at the `to` end.
- `path` — an opaque SVG path; pass the geometry in `d="M … L …"` (for freehand strokes).
- `text` — a free text label; the content is `text=`, else the heading text, else the body.
- Polygons & glyphs — `triangle`, `right-triangle`, `diamond`, `pentagon`, `hexagon`,
  `octagon`, `star` (`star4`/`star6`), `parallelogram`, `trapezoid`, `plus` (`cross`),
  `chevron`, `arrow-right`/`-left`/`-up`/`-down`, `double-arrow`, `callout`, `cylinder`,
  `cloud`, `heart`, `lightning`. Each is inscribed in the shape's bounding box and filled
  per `fill` (default `none` → outline only).

Geometry & style params (all optional; coordinates are author-defined units that the
template fits to the viewport, so you don't think in absolute pixels):

- Position/size: `x`, `y`, `width` (or `w`), `height` (or `h`).
- Style: `fill`, `stroke`, `strokeWidth`, `borderRadius`, `dasharray`.
- Connectors: `from` and `to` reference sibling shape ids; a `line`/`arrow` with either
  becomes a connector clipped to the two shapes it joins (its heading text is the
  midpoint label). A shape's Pandoc `connectsTo=` also draws an arrow, exactly as in
  `diagram`.
- Connector end-styles & routing:
  - `startStyle` / `endStyle` — the marker at each end: `none`, `arrow` (filled triangle),
    `open` (stroked V), `diamond`, `circle`, `square`. Default: `arrow` connectors end with
    an arrow, plain `line`s have none.
  - `lineStyle` — `solid` (default), `dashed`, or `dotted` (sets the dash pattern; an
    explicit `dasharray` still wins).
  - `routing` — `straight` (default), `orthogonal` (elbow), or `curved` (bezier).

  Example: `### owns {[arrow from=a to=b endStyle=diamond startStyle=circle lineStyle=dashed routing=orthogonal]}`.

The `diagram` template's edges accept the same `startStyle` / `endStyle` / `lineStyle` on
the `{[diagram]}` parent (applied to all edges; `edgeStyle` is the diagram's routing).

Notes:

- Params are space-separated, like every other annotation. A trailing comma is tolerated
  (`x=21, y=25` works) but the canonical form omits it.
- Shape annotations are only recognized on a drawing's children. A `{[rectangle]}`
  elsewhere is flagged `shape-outside-drawing`; an unknown shape inside a drawing is
  flagged `unknown-shape` (with a did-you-mean).
- Authoring is markdown-first: shapes render in previews and exports and git-diff cleanly.
  The visual Scene editor still authors drawings as a base64 `layers="…"` blob; those
  legacy drawings keep rendering (the template decodes them when a drawing has no child
  shapes).

## Validation

`squisq validate <input>` (from `@bendyline/squisq-cli`) checks a `.md` file, `.dbk`/`.zip` container, or folder and reports structural problems with line numbers:

- `unknown-template` — annotation names no built-in, alias, or doc-defined template (includes a did-you-mean suggestion)
- `unknown-shape` — a `{[drawing]}` child's annotation names no known shape (includes a did-you-mean among the shape primitives)
- `shape-outside-drawing` — a shape annotation (`{[rectangle]}`, `{[line]}`, …) on a heading that isn't a drawing's child
- `unparsed-annotation` — literal `{[…]}` text that wasn't recognized (broken quoting, body placement — annotations are heading-only, or an unknown inline icon)
- `invalid-attribute` — malformed heading-attribute values (`x=abc`, bad `startTime`/`duration`) or non-numeric drawing-shape geometry
- `duplicate-id` — two blocks share an id (pinned `{#id}` clashes)
- `unresolved-connection` — a `connectsTo` target, or a drawing connector's `from`/`to`, that matches no block/shape id
- `data-fence-parse` — a `json data` / `yaml data` fence that failed to parse
- `missing-asset` — a relative image/video reference not found in the bundle (or next to the `.md` file)

`--json` emits the diagnostics as machine-readable JSON; `--strict` makes warnings fail the exit code. Agents should run validate after writing a document and iterate until the diagnostics list is empty.

The same checks are available programmatically via `validateMarkdownSource(source, options)` from `@bendyline/squisq/doc`. Conversion itself (`markdownToDoc`) also records its findings on `doc.diagnostics` — it never throws for content problems and is fully deterministic (the same markdown always produces the same Doc).

## Graceful degradation

A block whose template can't render never produces a blank slide. If the template name is unknown, or the template function throws, the block renders as a plain card showing the heading title and body text, with a small notice naming the problem (e.g. `⚠ Unknown template "photGrid"`). Content is never lost to a typo — the document stays readable, and the notice (plus the matching `validate` diagnostic) points at the fix.

Authoring tips

- Prefer using annotations as standalone lines inside lists to author slide decks quickly:

```markdown
- {[title title="Welcome" subtitle="Intro to Squisq"]}
- {[imageWithCaption imageSrc="photo.jpg" caption="Our product"]}
```

- Use `photoGrid` for compact galleries and `imageWithCaption` for single-image focus.
- When adding custom templates, keep attribute names simple (no spaces) and parse comma-separated lists inside the template function.

Where to look in the code

- The Markdown parser and annotation node types are in `@bendyline/squisq/markdown`.
- The template registry and built-ins live under `packages/core/src/doc/templates` (exposed via `@bendyline/squisq/doc`).
- The editor extension for heading annotations is in `packages/editor-react/src/TemplateAnnotation.ts` and `tiptapBridge.ts`.

See also: `docs/API.md` for the formal API reference and `@bendyline/squisq/schemas` for `TemplateBlock`/`TemplateBlockInput` types.

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
- {[imageWithCaption src="photo.jpg" caption="Beach at sunset"]}
```

- Heading annotated with a template (the editor preserves heading annotations):

```markdown
## Gallery {[photoGrid images="a.jpg,b.jpg,c.jpg" columns=3]}
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

- Use `registerTemplate(name, fn)` from `@bendyline/squisq/doc` to add new templates. The annotation parser will then recognise `name`.

Built-in template types

Below is a concise reference of built-in templates (names match the `template` property used in annotations). For each template we list the most common input keys — all inputs are optional unless otherwise stated.

- `title`
  - Inputs: `title`, `subtitle`, `backgroundImage`, `backgroundGradient`
  - Usage: hero/title slide

- `sectionHeader`
  - Inputs: `title`, `subtitle`, `backgroundColor`
  - Usage: section separators or small header slides

- `statHighlight`
  - Inputs: `stat`, `description`, `trend`, `trendDirection`
  - Usage: numeric callouts (e.g., "89% — up 5%")

- `quote`
  - Inputs: `quote`, `attribution`, `backgroundImage`
  - Usage: standard quotes

- `factCard`
  - Inputs: `fact`, `explanation`, `backgroundImage`
  - Usage: short fact + context

- `twoColumn`
  - Inputs: `left`, `right`, `heading`
  - Usage: side-by-side text/content

- `dateEvent`
  - Inputs: `date`, `title`, `description`
  - Usage: timeline or event slides

- `imageWithCaption`
  - Inputs: `src` or `imageSrc`, `caption`, `alt`, `objectFit`
  - Usage: image + caption (inline or full-bleed)

- `leftFeature`
  - Inputs: `imageSrc`, `imageAlt`, `imageWidth`, `imageHeight`, `title`, `body`
  - Usage: editorial feature block with media on the left and text on the right

- `rightFeature`
  - Inputs: `imageSrc`, `imageAlt`, `imageWidth`, `imageHeight`, `title`, `body`
  - Usage: editorial feature block with text on the left and media on the right

- `map`
  - Inputs: `center` (as `lat,lng`), `zoom`, `markers` (string that templates can parse), `tileUrl`
  - Usage: small map embeds

- `fullBleedQuote`
  - Inputs: `quote`, `attribution`, `backgroundImage`
  - Usage: prominent quote over full bleed background

- `list`
  - Inputs: `heading`, `items` (comma-separated), `icon`
  - Usage: bulleted/numbered lists authored as a single template

- `photoGrid`
  - Inputs: `images` (comma-separated), `columns`, `gap`
  - Usage: image gallery grid

- `definitionCard`
  - Inputs: `term`, `definition`, `example`
  - Usage: glossary/definition

- `comparisonBar`
  - Inputs: `leftLabel`, `leftValue`, `rightLabel`, `rightValue`, `heading`
  - Usage: side-by-side comparison visualization

- `dataTable`
  - Inputs: `title`, `headers`, `rows`, `align`, `colorScheme`
  - Usage: themed tabular data for structured comparisons or reference sections
  - Sourcing: when `headers`/`rows` aren't provided explicitly, the first GFM table in the section body supplies them (including column alignment) — write a normal markdown table under the heading and it renders as the themed table

- `diagram`
  - Inputs: `title`, `colorScheme`, `nodeShape`, `edgeStyle`; child headings provide nodes and `connectsTo` edges
  - Usage: node-and-edge diagrams authored from nested section headings

- `layout`
  - Inputs: none — `Layer[]` is authored visually via the Scene engine and persisted in `data-block-attrs` as a base64-JSON `layers="..."` param
  - Usage: one-off block layouts that don't fit a template (drag layers into place)

- `drawing`
  - Inputs: same as `layout`
  - Usage: free-form sketches; the editor pre-bundles shape / path / text tools for authoring new layers from scratch

- `pullQuote`
  - Inputs: `quote`, `attribution`
  - Usage: smaller inline quote treatment

- `videoWithCaption`
  - Inputs: `src` or `videoSrc`, `poster`, `caption`, `autoplay`, `loop`, `muted`
  - Usage: inline video with caption

- `videoPullQuote`
  - Inputs: `videoSrc`, `quote`, `attribution`
  - Usage: combination of video + pull-quote

## YAML Frontmatter

Squisq Markdown documents can include a YAML frontmatter block at the very top (delimited by `---`). Frontmatter properties set document-level rendering hints. The editor's Preview panel reads these values automatically; they can also be overridden via the toolbar dropdowns.

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

### Custom frontmatter

Any other YAML key-value pairs in the frontmatter block are preserved in `Doc.frontmatter` as a `Record<string, unknown>` and are available to consuming applications. Squisq itself only reads the three properties above.

Notes on arrays and complex attributes

- For multi-value inputs (e.g. `images`, `items`, `markers`), use a comma-separated string and let the template parse it. Example: `images="a.jpg,b.jpg,c.jpg"`.
- For geographic inputs, `center` may be provided as `"lat,lng"` (e.g. `center="37.78,-122.42"`) or as two attributes (`centerLat`, `centerLng`) depending on the template implementation.
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

## Validation

`squisq validate <input>` (from `@bendyline/squisq-cli`) checks a `.md` file, `.dbk`/`.zip` container, or folder and reports structural problems with line numbers:

- `unknown-template` — annotation names no built-in, alias, or doc-defined template (includes a did-you-mean suggestion)
- `unparsed-annotation` — literal `{[…]}` text that wasn't recognized (broken quoting, body placement — annotations are heading-only, or an unknown inline icon)
- `invalid-attribute` — malformed heading-attribute values (`x=abc`, bad `startTime`/`duration`)
- `duplicate-id` — two blocks share an id (pinned `{#id}` clashes)
- `unresolved-connection` — a `connectsTo` target that matches no block id
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
- {[imageWithCaption src="photo.jpg" caption="Our product"]}
```

- Use `photoGrid` for compact galleries and `imageWithCaption` for single-image focus.
- When adding custom templates, keep attribute names simple (no spaces) and parse comma-separated lists inside the template function.

Where to look in the code

- The Markdown parser and annotation node types are in `@bendyline/squisq/markdown`.
- The template registry and built-ins live under `packages/core/src/doc/templates` (exposed via `@bendyline/squisq/doc`).
- The editor extension for heading annotations is in `packages/editor-react/src/TemplateAnnotation.ts` and `tiptapBridge.ts`.

See also: `docs/API.md` for the formal API reference and `@bendyline/squisq/schemas` for `TemplateBlock`/`TemplateBlockInput` types.

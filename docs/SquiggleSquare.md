# Squiggle Square — Template Annotation Syntax

This document describes the "Squiggle Square" annotation notation used in Squisq Markdown to embed template blocks inline in Markdown documents.

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
{[titleBlock title="Welcome" subtitle="Intro to Squisq"]}

Some body text here.
```

Attribute value rules & escaping

- Unquoted values: no spaces, e.g. `columns=3` or `autoplay=true`.
- Quoted values: use double or single quotes for values with spaces, e.g. `caption="A long caption"` or `caption='A long caption'`.
- To include a quote inside a quoted value, escape it with a backslash, e.g. `caption="She said \"hello\""`.

How the annotation is handled

- The Markdown parser emits a `TemplateAnnotationNode` in the AST with `template` and `attributes: Record<string,string>`.
- When converting to a `Doc`, the annotation is converted to a `TemplateBlock` (the attributes become the `TemplateBlockInput` fields). Template functions receive the input and render `Layer[]`.
- The editor extension `HeadingWithTemplate` preserves annotations inside headings and round-trips them between Tiptap and Markdown.

Registering custom templates

- Use `registerTemplate(name, fn)` from `@bendyline/squisq/doc` to add new templates. The annotation parser will then recognise `name`.

Built-in template types

Below is a concise reference of built-in templates (names match the `template` property used in annotations). For each template we list the most common input keys — all inputs are optional unless otherwise stated.

- `titleBlock`
  - Inputs: `title`, `subtitle`, `backgroundImage`, `backgroundGradient`
  - Usage: hero/title slide

- `sectionHeader`
  - Inputs: `title`, `subtitle`, `backgroundColor`
  - Usage: section separators or small header slides

- `statHighlight`
  - Inputs: `stat`, `description`, `trend`, `trendDirection`
  - Usage: numeric callouts (e.g., "89% — up 5%")

- `quoteBlock`
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

- `mapBlock`
  - Inputs: `center` (as `lat,lng`), `zoom`, `markers` (string that templates can parse), `tileUrl`
  - Usage: small map embeds

- `fullBleedQuote`
  - Inputs: `quote`, `attribution`, `backgroundImage`
  - Usage: prominent quote over full bleed background

- `listBlock`
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

- `pullQuote`
  - Inputs: `quote`, `attribution`
  - Usage: smaller inline quote treatment

- `videoWithCaption`
  - Inputs: `src` or `videoSrc`, `poster`, `caption`, `autoplay`, `loop`, `muted`
  - Usage: inline video with caption

- `videoPullQuote`
  - Inputs: `videoSrc`, `quote`, `attribution`
  - Usage: combination of video + pull-quote

Notes on arrays and complex attributes

- For multi-value inputs (e.g. `images`, `items`, `markers`), use a comma-separated string and let the template parse it. Example: `images="a.jpg,b.jpg,c.jpg"`.
- For geographic inputs, `center` may be provided as `"lat,lng"` (e.g. `center="37.78,-122.42"`) or as two attributes (`centerLat`, `centerLng`) depending on the template implementation.

Authoring tips

- Prefer using annotations as standalone lines inside lists to author slide decks quickly:

```markdown
- {[titleBlock title="Welcome" subtitle="Intro to Squisq"]}
- {[imageWithCaption src="photo.jpg" caption="Our product"]}
```

- Use `photoGrid` for compact galleries and `imageWithCaption` for single-image focus.
- When adding custom templates, keep attribute names simple (no spaces) and parse comma-separated lists inside the template function.

Where to look in the code

- The Markdown parser and annotation node types are in `@bendyline/squisq/markdown`.
- The template registry and built-ins live under `packages/core/src/doc/templates` (exposed via `@bendyline/squisq/doc`).
- The editor extension for heading annotations is in `packages/editor-react/src/TemplateAnnotation.ts` and `tiptapBridge.ts`.

See also: `docs/API.md` for the formal API reference and `@bendyline/squisq/schemas` for `TemplateBlock`/`TemplateBlockInput` types.

---

If you'd like, I can also:

- Add a short example authoring guide to the dev site sample docs.
- Add convenience helpers to parse common attribute shapes (e.g., `parseLatLng`, `parseCsv`).

Would you like me to commit and push `docs/SquiggleSquare.md` now?

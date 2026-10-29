---
title: How the format works
description: The Markdown Squiggly Square understands, how headings turn a document into blocks, how tags attach, and how templates are picked for you when you leave tags off.
---

# How the format works

A Squiggly Square document is a Markdown file. Everything you already know about Markdown still
works, and a file without a single tag is a complete, valid document. This page explains what
happens to that file when it's shown: how it splits into **blocks**, how a **tag** changes a
block's look, and how Squiggly Square picks a look for you when you don't.

## Markdown you already know

Squiggly Square reads CommonMark plus GitHub's extensions.

| You write                                | You get                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `#` to `######`                          | Headings, levels 1 to 6. Each one starts a block (see below).          |
| `**bold**`, `*italic*`, `~~struck~~`     | Bold, italic, strikethrough                                            |
| `` `code` ``                             | Inline code                                                            |
| `[text](https://…)`, a bare `https://…`  | Links; bare web addresses become links on their own                    |
| `![alt text](images/harbor.svg)`         | Images                                                                 |
| `-`, `*`, or `1.` at the start of a line | Bulleted and numbered lists, nested by indenting                       |
| `- [ ]` and `- [x]`                      | Task lists with checkboxes                                             |
| `>` at the start of a line               | Blockquotes                                                            |
| A pipe table with a `---` row            | Tables; `:--`, `:-:`, and `--:` set column alignment                   |
| `[^1]` and `[^1]: The note.`             | Footnotes                                                              |
| `H<sub>2</sub>O`, `mc<sup>2</sup>`       | Subscript and superscript                                              |
| ` ``` ` fences                           | Code blocks; some fence languages draw pictures instead (below)        |
| `$x^2$`, `$$…$$`                         | Math, kept intact and shown as its TeX source in a code style          |
| `---` on its own line                    | A horizontal rule                                                      |
| Simple HTML                              | A safe subset: `<details>`, `<figure>`, `<mark>`, `<video>`, and so on |

> [!TIP]
> Subscript and superscript are written with `<sub>` and `<sup>`. A single tilde (`H~2~O`) is
> strikethrough in GitHub-flavored Markdown, not subscript.

A dollar sign followed by a number stays a dollar sign, so `$5 and $10` is prose, not math.
HTML that could run code or load other pages — scripts, styles, forms, and frames other than
recognized video players — is removed when the document is shown.

> [!WARNING]
> Put a space after a colon in prose. A colon immediately followed by a letter, as in
> `ratio:high`, is read as a Markdown directive, and the word after the colon disappears from the
> rendered views. `Note: high` and times like `10:30` are fine.

### Picture fences

A few fence languages draw a picture instead of showing code. They need no tag and can sit
anywhere in a block's body:

| Fence           | Draws                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| ` ```diagram `  | A box-and-line diagram from ASCII art — see [box diagrams](diagrams.md#box-diagrams)                   |
| ` ```tree `     | A file or outline tree — see [trees](diagrams.md#trees)                                                |
| ` ```timeline ` | A timeline of dated events — see [timelines](diagrams.md#timelines)                                    |
| ` ```mermaid `  | A [Mermaid](https://mermaid.js.org) diagram — see [Mermaid](diagrams.md#mermaid)                       |
| ` ```svg `      | Your own SVG drawing, cleaned up and shown as a picture — see [SVG pictures](diagrams.md#svg-pictures) |

Diagram, tree, and timeline art is also recognized in untagged and `text` fences. A fence with
`json data` or `yaml data` in its info string feeds structured values to the block's template;
the [block pages](../blocks/index.md) say which templates use one.

## How a document becomes blocks

Squiggly Square splits your document at its headings. **Each heading starts a block**: the
heading, plus everything under it up to the next heading. In a slideshow every block is a slide;
on a page every block is a section; on a dashboard every block is a cell.

```markdown preview
# Harbor Survey 2026

A season of measurements from the north breakwater.

## Why we measured

Silt has been building up along the north wall since the winter storms. This survey sets a baseline for next year's dredging plan.

## What we found

The main channel is shallower than it was a decade ago, and the berths by the fish market are shallowest of all.
```

Step through the preview: three headings, three slides. None of them has a tag, so each shows
its heading and its full body.

### Heading levels and nesting

Every heading starts a block, whatever its level. A deeper heading nests under the shallower
heading before it — `###` under `##`, `##` under `#` — and that nesting is what page view uses
for its heading sizes and outline. In a slideshow the nesting doesn't merge anything: each
heading, at any depth, is still its own slide, in document order.

```markdown preview
## Equipment

The survey used two instruments.

### Echo sounder

A single-beam sounder mounted on the harbor launch, sampling ten times a second.

### Tide gauge

A pressure gauge at the fuel dock, logged every five minutes and used to correct each depth.
```

The exception is the container blocks `{[diagram]}`, `{[drawing]}`, and `{[layout]}`: their
child headings are the nodes, shapes, or layers inside them, not slides of their own. See
[Drawing](../blocks/drawing.md) and [Layout](../blocks/layout.md).

### Content before the first heading

Anything above your first heading becomes a block of its own with no heading. It shows as a
plain content slide and as the opening section of a page.

```markdown preview
Prepared for the Harbor Commission, spring session.

## Summary

The channel needs dredging before next winter.
```

### The cover

Squiggly Square builds a **cover** for the document from:

- **Title** — the frontmatter `title`, else the first of your shallowest headings (usually the
  `#` heading), else the file name.
- **Subtitle** — the frontmatter `subtitle`, else the first paragraph under that heading.
- **Picture** — the first image anywhere in the document.

The cover opens the slideshow and video, and heads the page. Turn it off, or choose how it looks,
with the editor's **Cover slide** control or the `squisq-cover-*` keys in
[frontmatter](frontmatter.md). (The live examples in these docs leave the cover out.)

### Frontmatter

A block of `key: value` lines between two `---` lines at the very top of the file is
**frontmatter**. It holds settings for the whole document — its title, theme, and so on — and is
never shown as content.

```markdown
---
title: Harbor Survey 2026
squisq-theme: documentary
---

# Harbor Survey 2026
```

Every key Squiggly Square reads is listed in [Frontmatter](frontmatter.md).

## Attaching a tag

A **tag** at the end of a heading chooses that block's **template** — the design it's drawn
with. Tags are written in "squiggly square" brackets:

```markdown preview
## The busiest season on record {[statHighlight]}

**1,284** boats passed the breakwater between March and June.
```

The tag must come **last** on the heading line. `## The {[quote]} section` is not a tag; the
text stays in the heading. A tag may carry parameters, and it can share the end of the heading
with a `{#id}` attribute block in either order. The [tag reference](tags.md) covers the full
syntax; the [block gallery](../blocks/index.md) shows every template.

The template only changes how the block is _presented_. The heading and body are still ordinary
Markdown, so delete the tag and you're left with the same text.

## Automatic templates

You don't have to tag every heading. When a heading has no tag, Squiggly Square looks at what's
under it, and when the body is clearly one kind of thing it picks the matching template:

| When the body is…                                                      | You get                                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| One ASCII box diagram fence                                            | [Diagram](../blocks/diagram.md)                                                                      |
| One ASCII timeline fence                                               | [Timeline](../blocks/timeline.md)                                                                    |
| One ASCII tree fence                                                   | [Tree](../blocks/tree.md)                                                                            |
| One table                                                              | [Data Table](../blocks/dataTable.md)                                                                 |
| One video — a video file or a YouTube or Vimeo link — and nothing else | [Video with Caption](../blocks/videoWithCaption.md)                                                  |
| Two to four images, with no other text                                 | [Photo Grid](../blocks/photoGrid.md)                                                                 |
| Paragraphs that include an image                                       | [Left Feature](../blocks/leftFeature.md) and [Right Feature](../blocks/rightFeature.md), alternating |
| One blockquote                                                         | [Quote](../blocks/quote.md)                                                                          |
| A short line built around a figure (`18%`, `$2.3M`, `3×`)              | [Stat Highlight](../blocks/statHighlight.md)                                                         |
| One list                                                               | [List](../blocks/list.md)                                                                            |

The rules are checked in that order, and they're deliberately strict: the body must be _only_
that one thing. A table with an introductory paragraph above it, or a list followed by a closing
sentence, keeps the default and shows everything as written.

```markdown preview
## Catch by species

| Species  | Tonnes |
| -------- | -----: |
| Herring  |    412 |
| Cod      |    198 |
| Mackerel |    155 |

## The skipper's view

> Thirty years on this water, and I've never seen the herring run this early. — Marta Lind, skipper of the Ellen Rose

## Highlights

- Earliest herring run on record
- Two new berths opened on the east quay
- No lost-time accidents all season

## Traffic

**18%** more boats than last spring

## The new east quay

![The east quay at dawn](images/harbor.svg)

Two berths opened in April, giving the herring boats somewhere to land when the fish market is full.
```

None of those headings has a tag, yet each section gets a fitting design.

**Automatic templates are never written into your file.** They're worked out fresh every time the
document is shown, so your Markdown stays exactly as you wrote it, and if you change a section's
content its template follows. A tag you write yourself always wins.

When nothing matches, the block keeps the default: in slides, a content slide with the heading
and the complete body; on a page, a prose section.

### Turning automatic templates off

To show every untagged heading with the default design, add this to the document's frontmatter:

```markdown preview
---
squisq-auto-templates: false
---

## Highlights

- Earliest herring run on record
- Two new berths opened on the east quay
```

The values `false`, `off`, `no`, and `0` turn it off. On the command line, pass
`--no-auto-templates` to `squisq convert` or `squisq video` (see [CLI](cli.md)).

## Tags in a section's body

Tags belong on headings, but a tag placed at the **end of a section's body** is understood too —
the shape AI assistants often produce. When a heading has no tag and the last thing under it is a
tag, either on its own line or at the end of the last paragraph, that tag becomes the section's
tag:

```markdown preview
## Volunteers this season

A record turnout for the spring cleanup along the breakwater.

{[statHighlight stat="214" description="volunteers joined the spring cleanup"]}
```

The tag is taken out of the body, so it never shows as text. Your file is left as it is until you
change that block's template or parameters in the editor; then the editor moves the tag up onto
the heading, where it belongs.

This only applies to a single tag at the very end. When a section's body holds two or more tags
on lines of their own, or a tag followed by more content, each tag starts a heading-less block
instead — see [standalone tags](tags.md#standalone-tags).

## One document, many renditions

The same Markdown is presented differently depending on where it's shown. Here is one section in
a slideshow:

```markdown preview
## Dredging plan {[leftFeature]}

![The north breakwater](images/harbor.svg)

Work starts in October, when the herring boats are out, and moves from the fuel dock toward the harbor mouth. The channel stays open throughout.
```

And the same section on a page:

```markdown preview=page
## Dredging plan {[leftFeature]}

![The north breakwater](images/harbor.svg)

Work starts in October, when the herring boats are out, and moves from the fuel dock toward the harbor mouth. The channel stays open throughout.
```

Slides are a fixed size, so a template places the picture and text to fit one screen. A page
scrolls, so its sections grow to fit their content and follow the theme's page design. Office
exports go further still: Word and PDF keep the Markdown structure (headings, paragraphs,
tables), while PowerPoint gets one designed slide per block.

Some templates show only part of a section's body — a quote block shows the quote, a stat block
shows the number — on slides and on the designed page alike. The rest isn't lost: it stays in
your file, and the **Document** view and Word and PDF exports show the whole section. Each
[block page](../blocks/index.md) says how much of the body its template shows.

See [Display modes](display-modes.md) for every way to present a document, and
[Page view](page-mode.md) for how pages are designed.

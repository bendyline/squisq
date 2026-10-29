---
title: Welcome
description: The authors' guide to Squiggly Square — write a document in plain Markdown and present it as slides, a page, a dashboard, a video, or an office file.
---

# The authors' guide

Squiggly Square lets you write a document once, in plain Markdown, and present it however you
need: as a slideshow, a designed web page, a dashboard, a video, or a Word, PowerPoint, or PDF
file. You write the words; a short tag on a heading chooses how each part looks; a theme dresses
the whole thing.

```markdown preview
## Morning at the fish market

The first boats tie up before five, and by six the auction is in full swing.

## Before sunrise {[statHighlight]}

**42** crates of herring sold before the sun was up.

## Auction prices

| Species | Price per crate |
| ------- | --------------: |
| Herring |             €38 |
| Cod     |             €64 |
| Plaice  |             €51 |
```

That's the whole source. The first section is plain text, the second has a tag, and the third
is a table that Squiggly Square recognized and drew as one on its own. Step through the slides,
switch the theme, or open the example in the editor and change it.

## The ideas in five minutes

### A document is Markdown

Headings, paragraphs, lists, tables, images, links — the Markdown you'd write for a README or a
notes app. There's no special file format and nothing hidden: a Squiggly Square document is a
`.md` file that any Markdown tool can open, with its tags showing as plain text. The
[editor](/) gives you a visual way to write it. See [How the format works](markup.md).

### Each heading starts a block

Your document is split at its headings. A heading and everything under it, up to the next
heading, is one **block**. In a slideshow each block is a slide; on a page it's a section; on a
dashboard it's a cell.

### A tag picks the block's template

Add a tag such as `{[quote]}` or `{[statHighlight]}` to the end of a heading and that block is
drawn with the matching **template** — there are 38 built in, from title slides and quotes to
charts, maps, and diagrams. The tag changes only the presentation; delete it and your text is
untouched. Leave tags off and a table, list, quote, or picture still gets a fitting design
[automatically](markup.md#automatic-templates). See [Tags](tags.md) and the
[block gallery](../blocks/index.md).

### Themes dress the whole document

A **theme** sets the colors, fonts, motion, and page design for everything at once. Choose one of
the eleven built-in themes, adjust it, or design your own and keep it inside the document. See
[Themes](themes.md).

### One document, every rendition

The same Markdown plays as a **slideshow**, scrolls as a **page**, arranges itself on a
**dashboard**, times itself into a **video**, turns into **flashcards**, or becomes a
**teleprompter** for recording narration. It exports to Word, PowerPoint, PDF, HTML, EPUB, Excel,
video, and images. See [Display modes](display-modes.md) and
[Import and export](import-export.md).

## How this guide is organized

**Start here**

- [Getting started](getting-started.md) — write, tag, preview, theme, and export your first
  document.
- [The editor](editor.md) — a complete tour of the editor's views, menus, and shortcuts.

**The format**

- [How the format works](markup.md) — the Markdown you can use, how documents become blocks, and
  automatic templates.
- [Tags](tags.md) — every tag form, the settings every block accepts, and inline icons.
- [Frontmatter](frontmatter.md) — every document-level setting.
- [Cheat sheet](cheatsheet.md) — the whole format on one page.
- [Format specification](../SquigglySquare.md) — the exhaustive reference.

**Presenting**

- [Display modes](display-modes.md), [Themes](themes.md), [Page view](page-mode.md),
  [HTML page templates](page-templates.md), [Dashboards](dashboards.md), and
  [Custom templates](custom-templates.md).

**Rich content**

- [Diagrams](diagrams.md) — box diagrams, trees, timelines, Mermaid, and SVG pictures.
- [Data and charts](data-and-charts.md) — tables, charts, and spreadsheet files.
- [Media](media.md) — images, hosted videos, and timed audio and video clips.
- [Narration](narration.md) — recording a voice-over and timing slides to it.

**Sharing**

- [Import and export](import-export.md) — every file format in and out.
- [Command line](cli.md) — converting and checking documents from a terminal.

Ready? Open the [editor](/) and follow [Getting started](getting-started.md).

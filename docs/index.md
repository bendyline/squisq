---
title: Squiggly Square Docs
description: Write ordinary Markdown and present it as slides, pages, dashboards, video, or office files — the guide for authors and the reference for developers building with Squisq.
---

# Rich documents from plain Markdown

Squiggly Square turns ordinary Markdown into slideshows, scrolling pages, dashboards, videos, and
office documents. You write headings and paragraphs as you always have; a short tag such as
`{[quote]}` at the end of a heading chooses how that section looks. **Squisq** is the open-source
family of libraries that does the work — the same ones you can build into your own apps.

```markdown preview
# Field Notes from the Harbor {[title subtitle="A season of tides, boats, and early mornings"]}

## 1,284 boats {[statHighlight]}

**1,284** vessels passed the breakwater this spring — the busiest season on record.

## What the harbormaster said {[quote]}

> The tide doesn't care about your schedule. You learn to keep its. — Ines Duarte, harbormaster
```

That is the whole source: three headings, three tags. Step through the slides above, switch the
theme, or open the example in the editor and change it.

## Where to start

**Writing documents**

- [Getting started](guide/getting-started.md) — your first document in the editor, in five minutes.
- [How the format works](guide/markup.md) — headings become blocks; tags choose their look.
- [Tag reference](guide/tags.md) and the [cheat sheet](guide/cheatsheet.md) — every
  `{[…]}` form on one page.
- [Block gallery](blocks/index.md) — all 38 built-in blocks, each with a live example.

**Presenting and sharing**

- [Display modes](guide/display-modes.md) — slideshow, video, page, dashboard, flashcards, and
  narration from the same document.
- [Themes](guide/themes.md), [Page view](guide/page-mode.md), and
  [HTML page templates](guide/page-templates.md) — the look of everything around your words.
- [Import and export](guide/import-export.md) — Word, PowerPoint, PDF, HTML, EPUB, Excel, CSV,
  video, and images.

**Building with Squisq**

- [Developer introduction](developers/index.md) — what the packages do and how they fit together.
- [Quick start](developers/quick-start.md) — render Markdown as slides in a React app.
- [Concepts](developers/concepts/architecture.md) — the document model, templates, projections,
  themes, storage, and formats.
- [Sample apps](developers/samples/index.md) — complete, copyable projects.
- [API reference](API.md) — every package, subpath, and export.

## Try it now

The [editor](/) on this site is the full Squisq editor running in your browser. Pick a sample
from its menu, switch between **Write**, **Source**, and **Use**, and export to any format. It
runs entirely in your browser; there is no account and no server-side copy of your document.

> [!TIP]
> Every live example in these docs has an **Open in editor** link that opens it in the editor,
> ready to change.

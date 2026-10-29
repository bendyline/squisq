---
title: Getting started
description: Write your first Squiggly Square document in the demo editor — headings and paragraphs, a tag or two, a preview, a theme, and an export.
---

# Getting started

In about five minutes you'll write a short document, give two of its sections a designed look,
present it as slides, change its theme, and download it as a PowerPoint deck. Everything happens
in the [editor](/) at the root of this site — it runs in your browser, with no account.

## 1. Open the editor

Open the [editor](/). It loads a sample called **About SquigglySquare (squisq)** in the **Write**
view, which looks and works like a word processor.

Along the top of the editor are three tabs:

- **Write** — edit the document visually.
- **Source** — the same document as Markdown text.
- **Slideshow** — the finished document. This third tab is the **Use** view, and it's named after
  the display mode you're in.

Click **Slideshow**, then press → to step through the sample's slides. Each slide is one heading
of the document, drawn with a different design. Click **Write** to go back.

> [!TIP]
> The **Sample** menu in the top bar has more documents to explore, grouped by topic. Picking
> one replaces what's in the editor.

## 2. Start a document

There's no **New** button: start by clearing the sample. Click in the Write view, select all
(Ctrl+A, or ⌘A on a Mac), and press Delete. The editor shows a prompt in the empty page.

Your document lives in the page until you save it. Reloading or picking another sample discards
it, so see [step 7](#7-save-and-export) before you write anything you want to keep.

## 3. Write headings and paragraphs

Type `# ` (a hash and a space) at the start of a line to make a heading, or use the **Heading 1**,
**Heading 2**, and **Heading 3** buttons on the toolbar. Write a top-level title, then a few
sections with `## `:

```markdown preview
# Harbor Survey 2026

A season of measurements from the north breakwater.

## Why we measured

Silt has been building up along the north wall since the winter storms. This survey sets a baseline for next year's dredging plan.

## What changed

The main channel is shallower than it was a decade ago, and the berths by the fish market are shallowest of all.
```

Each heading starts a **block**: the heading and everything under it. In a slideshow each block
is a slide. Without any tags, a block shows its heading and its text. Switch to **Source** to see
the Markdown you've been writing; you can edit there too.

## 4. Give a block a design

A **tag** at the end of a heading chooses its design, or **template**. Put the caret in the
**What changed** heading. A small **Block** badge appears at the end of it — click it to open the
block type gallery, then choose **Stat Highlight**. The gallery shows each design using your own
block's content.

The badge writes the tag for you. You can also type it at the end of the heading, in either view:

```markdown preview
# Harbor Survey 2026

A season of measurements from the north breakwater.

## Why we measured

Silt has been building up along the north wall since the winter storms. This survey sets a baseline for next year's dredging plan.

## What changed {[statHighlight stat="0.9 m" description="shallower than the channel was in 2016"]}

The main channel is shallower than it was a decade ago, and the berths by the fish market are shallowest of all.

## In their words {[quote]}

> The tide doesn't care about your schedule. You learn to keep its. — Ines Duarte, harbormaster
```

The stat block takes its number and caption from the tag's `stat` and `description` parameters.
The quote block needs no parameters: it finds the quote in the section's body. In the Source
view, typing `{[` at the end of a heading suggests template names, then their parameters.

Browse every template in the [block gallery](../blocks/index.md). Some sections get a design
even without a tag — a lone table, list, or quote is recognized automatically (see
[automatic templates](markup.md#automatic-templates)).

## 5. Preview it

Click the **Slideshow** tab. Press → and ← to move between slides; the first slide is a **cover**
made from your `#` title and the paragraph under it.

Click the **▾** beside the tab to see the document other ways:

- **Page** — a designed page that scrolls.
- **Document** — clean, text-first reading.
- **Video** — the slides on a timer, as a video would play them.
- **Dashboard** — every block on one canvas.

```markdown preview=page
# Harbor Survey 2026

A season of measurements from the north breakwater.

## What changed {[statHighlight stat="0.9 m" description="shallower than the channel was in 2016"]}

The main channel is shallower than it was a decade ago, and the berths by the fish market are shallowest of all.

## In their words {[quote]}

> The tide doesn't care about your schedule. You learn to keep its. — Ines Duarte, harbormaster
```

That's the same Markdown in **Page** mode. [Display modes](display-modes.md) describes them all.

## 6. Change the theme

A **theme** sets the colors, fonts, and motion of the whole document. In the Use view, click the
picker next to **Theme:** in the toolbar and choose **Documentary**. Every slide changes at once.

The editor records the choice at the top of your document, in its **frontmatter**. Switch to
**Source** and you'll see it:

```markdown preview
---
squisq-theme: documentary
---

# Harbor Survey 2026

A season of measurements from the north breakwater.

## What changed {[statHighlight stat="0.9 m" description="shallower than the channel was in 2016"]}

The main channel is shallower than it was a decade ago.
```

The pencil beside the picker opens the theme designer, where you can make a theme of your own.
See [Themes](themes.md).

## 7. Save and export

Use the buttons on the right of the top bar:

- **↓ Download** saves a copy straight away: **Markdown (.md)**, **Word (.docx)**, **PowerPoint
  (.pptx)**, **PDF (.pdf)**, **Standalone HTML (.html)**, and more. Choose **PowerPoint** to get
  your slides as a PowerPoint deck, one slide per block.
- **Export…** offers the same formats with more options.
- **↓ Download → Video / Animated GIF** renders the document as a video.
- **Storage** keeps documents in your browser. Choose a slot, then **Save**; later, choose the
  slot and **Load**.

The Markdown download is the document itself. Open it again any time with **↑ Upload**.

## Next steps

- [How the format works](markup.md) — blocks, tags, and the Markdown Squiggly Square understands.
- [The editor](editor.md) — every view, menu, and shortcut.
- [Tags](tags.md) — timing, transitions, builds, icons, and more.
- [Block gallery](../blocks/index.md) — every built-in design, with live examples.
- [Cheat sheet](cheatsheet.md) — the whole format on one page.

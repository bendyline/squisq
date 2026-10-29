---
title: Custom templates
description: Design your own reusable block layouts, store them in a document, and use them with a tag like any built-in block.
---

# Custom templates

The built-in blocks cover most slides, but sometimes you want a layout of your own: a branded
title card, a "station report" with a photo on the right, a quote laid out the way your
organization always lays it out. A **custom template** is that layout, designed once and saved
with a name. Any heading can then use it with a tag, exactly like a built-in block:

```markdown
## North pier {[field-card]}
```

The template draws the same shapes and text boxes every time, filling in each block's own
heading, body text, and images.

```markdown preview
---
squisq-custom-templates: |-
  {
    "field-card": {
      "lb": "Field card",
      "ds": "A station heading and notes beside a photo.",
      "ly": [
        { "id": "panel", "type": "shape",
          "position": { "x": "0%", "y": "0%", "width": "100%", "height": "100%" },
          "content": { "shape": "rect", "fill": "#0b4f6c" } },
        { "id": "photo", "type": "image",
          "position": { "x": "54%", "y": "10%", "width": "40%", "height": "80%" },
          "content": { "src": "{image:0}", "alt": "{image:0}", "fit": "cover" } },
        { "id": "kicker", "type": "text",
          "position": { "x": "6%", "y": "14%", "width": "42%" },
          "content": { "text": "HARBOR SURVEY",
            "style": { "fontSize": 30, "fontWeight": "bold", "color": "#f4a259" } } },
        { "id": "heading", "type": "text",
          "position": { "x": "6%", "y": "24%", "width": "42%" },
          "content": { "text": "{title}",
            "style": { "fontSize": 76, "fontWeight": "bold", "color": "#ffffff" } } },
        { "id": "notes", "type": "text",
          "position": { "x": "6%", "y": "52%", "width": "42%" },
          "content": { "text": "{content}",
            "style": { "fontSize": 32, "color": "#d9e6ec" } } }
      ]
    }
  }
---

## North pier {[field-card]}

![Boats moored at the north pier](images/harbor.svg)

Calm water and a full house of fishing boats by six in the evening.

## Outer wall {[field-card]}

![Open water beyond the wall](images/ocean.svg)

A long swell from the west, breaking well short of the new stone.
```

Both slides use the same template. The blue panel and the HARBOR SURVEY label are part of the
design; the heading, the notes, and the photo come from each block.

## Designing a template in the editor

1. In the Write view, click the template badge on a heading to open the block gallery, and
   choose **New block type** at the top. (The **Custom layouts** button in the toolbar opens the
   same designer in a larger window, with every custom template listed beside it.)
2. Give the template a **Label** — the name shown in the gallery. Its **Name**, the word you
   write in the tag, is made from the label (`Field card` becomes `field-card`); you can change
   it. Add an optional **Description**.
3. Build the layout on the canvas. Drag **placeholders** in for the parts that change from block
   to block — **Title**, **Content**, **Children**, and **Image** — and add shapes, or drop in
   image files, for the parts that stay the same. Select a layer to move and resize it and to set
   its font, size, fill, and border.
4. Use the **Preview** switch (16:9, 9:16, 1:1) to check the layout in other shapes. Positions
   are kept as percentages, so a template adapts to portrait and square slides.
5. Save it:
   - **Save to this doc** writes the template into the document's frontmatter. It travels with the
     file, and every app and export can render it.
   - **Save to library** keeps it in your browser for use in other documents. Using a library
     template in a document copies it into that document, so the file never depends on your
     library.

Your templates appear under **Custom** in the block gallery, ready to pick for any heading.

## Using a custom template

Tag a heading with the template's name: `## North pier {[field-card]}`. Everything else works as
for a built-in block — the heading, the body, and [block settings](tags.md#block-settings) such
as `duration=` and `transition=`.

A custom template reads the block through **placeholders**:

| Placeholder        | Becomes                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `{title}`          | The heading's text                                                                                              |
| `{content}`        | The body's text, as plain text                                                                                  |
| `{children}`       | The titles of the headings nested under this one, separated by commas                                           |
| `{image:0}`        | In an image, the first image in the body; in text, that image's alt text. `{image:1}` is the second, and so on. |
| `{name\|fallback}` | Any placeholder with a fallback for when it is empty: `{title\|Untitled}`, `{image:0\|images/harbor.svg}`       |
| `{{title}}`        | The literal text `{title}`, not a placeholder                                                                   |

An image placeholder with nothing to show and no fallback is left out, so the rest of the
layout still draws. A placeholder the template doesn't recognize stays as written, which makes a
typo easy to spot.

In the stored JSON (see below), a layer can also carry a `repeat` setting that draws it once per
item — a thumbnail for every image in the body, a row for every list item or child heading —
filled with `{item}`, `{item:src}` (an image's address), and `{index}` (its number).

A custom template draws exactly what you designed. Colors and fonts set on its layers stay fixed
when you change the document's [theme](themes.md), so pick them to suit the themes you use. In
[Page view](page-mode.md) and on [dashboards](dashboards.md), a custom-template block is drawn as
its slide and placed in the page or cell.

> [!NOTE]
> Built-in names come first. A custom template named like a built-in block — `quote`, `title` —
> is ignored, so choose a name of your own.

## How a template is stored

A document's custom templates live in its frontmatter under `squisq-custom-templates`, as JSON
keyed by each template's name. The editor writes it on one line, with short property names to
keep it compact:

```text
squisq-custom-templates: {"field-card":{"lb":"Field card","ly":[{"id":"heading","ty":"text","po":{"x":"6%","y":"24%","wd":"42%"},"ct":{"tx":"{title}","sy":{"fz":76,"fw":"bold","cl":"#ffffff"}}}]}}
```

You can also write it across several lines after `squisq-custom-templates: |-`, as in the example
at the top of this page. For each template:

| Key  | Holds                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| `lb` | The label shown in the gallery (required)                                                                  |
| `ds` | An optional description                                                                                    |
| `vp` | The canvas size it was designed on, when not the default 1920×1080                                         |
| `ly` | The layers, back to front: `text`, `image`, `shape`, `path`, `map`, `video`, `table`, `tree`, or `mermaid` |

Inside the layers, full property names (`type`, `position`, `content`, `fontSize`) and their
short codes (`ty`, `po`, `ct`, `fz`) both work; the editor writes the short codes when it saves.
Positions are percentages of the slide. A template that doesn't validate is ignored, and blocks
that ask for it are shown with a fallback layout instead.

## Layouts from PowerPoint

When you open a PowerPoint file, Squiggly Square reads the slide layouts the deck uses. Layouts
that match a built-in block — a title slide, a section header, two columns, a picture beside
text — become that block's tag on each slide's heading. Layouts with distinctive placeholder
arrangements of their own become custom templates, named after the layout, and the slides that
use them are tagged with them. The deck's theme comes along as a
[custom theme](themes.md#custom-themes).

The theme designer's **Import from file** section does the same for a `.pptx` you only want to
borrow from: when you save the theme to the document, the deck's layouts are saved with it as
custom templates.
From the command line, `squisq convert` infers layouts by default; `--no-infer-layouts` turns it
off. See [Import and export](import-export.md).

## Custom templates, layouts, and drawings

Three ways to place things freely on a slide, for different jobs:

- **A custom template** is reusable. You design it once, and many blocks fill it with their own
  content.
- **A [layout](../blocks/layout.md) block** is a one-off. Its text boxes, shapes, and images are
  written as sub-headings with positions, for a slide that no template fits.
- **A [drawing](../blocks/drawing.md) block** is a sketch: shapes, lines, and labels connected
  together, scaled to fit the slide.

If you find yourself copying the same layout block from slide to slide, make it a custom
template instead.

---
template: layout
description: The Layout block is a free-form canvas where each sub-heading places one text box, image, or shape at exact coordinates on the slide.
---

# Layout

Use Layout for the one slide no template quite fits: a poster, a title card with a photo set
just so, an annotated screenshot. Each sub-heading under the block places one layer, a text box,
an image, or a shape, at the position and size you give it, and layers stack in the order you
write them. Nothing moves or resizes on its own, so what you place is what you get. When the
same arrangement should repeat across many slides, make it a
[custom template](../guide/custom-templates.md) instead.

```markdown preview
## Harbor Lights Festival poster {[layout]}

### {#backdrop} {[rectangle x=0 y=0 width=1920 height=1080 fill="#f5f1e8"]}

### {#band} {[rectangle x=0 y=0 width=1920 height=380 fill="#1e3a5f"]}

### {#headline} {[text x=120 y=110 width=1500 height=180 fontSize=110 fontWeight=bold color="#ffffff"]}

Harbor Lights Festival

### {#photo} {[image src=images/harbor.svg x=1040 y=440 width=780 height=560 fit=cover]}

### {#details} {[text x=120 y=470 width=840 height=420 fontSize=52 lineHeight=1.4 color="#1f2937"]}

Friday, August 14 · 6 p.m.

Pier 4, Waterfront Park

Free and open to all
```

## How it reads your section

- **Sub-headings** — each one directly under the Layout heading is one layer. Its tag names the
  kind of layer and carries its position, size, and style.
- **Text boxes** — `{[text …]}`. The text is the body under that sub-heading, so it reads
  naturally in the Markdown; paragraphs become separate lines.
- **Images** — `{[image src=… …]}` (or `img`). An image without `src` is skipped.
- **Shapes** — `{[rectangle …]}`, `{[circle …]}`, `{[line …]}`, `{[arrow …]}`, and the other
  shapes [Drawing](drawing.md) knows, from `triangle` to `cloud`.
- **Ids** — `{#name}` on a sub-heading gives the layer a name. It's optional, but it keeps the
  layers easy to find and edit.
- **Order** — the first sub-heading is the back-most layer and each later one sits on top.
- **The block's own heading and text** — not drawn. The heading names the slide in the outline.

Positions and sizes are in slide pixels from the top-left corner: a widescreen slide is 1920
wide and 1080 tall. Unlike [Drawing](drawing.md), Layout never scales or recenters what you
place. In [page view](../guide/display-modes.md#page) the canvas is drawn just as on the slide.

## Examples

### A title card

A backdrop, two text boxes, and an accent bar make a quiet chapter opener.

```markdown preview
## Chapter two {[layout]}

### {#backdrop} {[rectangle x=0 y=0 width=1920 height=1080 fill="#faf7f2"]}

### {#rule} {[rectangle x=160 y=520 width=180 height=10 fill="#d97706"]}

### {#kicker} {[text x=160 y=400 width=1200 height=90 fontSize=40 color="#d97706" fontWeight=bold]}

Chapter two

### {#title} {[text x=160 y=560 width=1600 height=260 fontSize=96 fontWeight=bold color="#1f2937"]}

The year the river came back
```

### Annotating a picture

An arrow and a label call out part of an image.

```markdown preview
## Meet the training fleet {[layout]}

### {#photo} {[image src=images/harbor.svg x=0 y=0 width=1920 height=1080 fit=cover]}

### {#note} {[text x=760 y=120 width=560 height=200 fontSize=40 padding=24 background="#ffffffdd" color="#111827"]}

Wren, our new training sloop, launches in May.

### {#pointer} {[arrow x=900 y=340 width=-320 height=260 stroke="#ffffff" strokeWidth=8]}
```

## Parameters

```squisq-docs
template-params
```

The block itself takes no parameters; the settings live on each layer's sub-heading.

| Layer                 | Keys                                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every layer           | `x`, `y` (top-left corner, default 0), `width`, `height`                                                                                                                                                                            |
| `text`                | `fontSize` (default 32), `color`, `fontFamily`, `fontWeight` (`bold`, `normal`), `fontStyle` (`italic`, `normal`), `align` (`left`, `center`, `right`), `valign` (`top`, `middle`, `bottom`), `lineHeight`, `padding`, `background` |
| `image`               | `src` (required), `alt`, `fit` (`cover`, `contain`, `fill`)                                                                                                                                                                         |
| `rectangle`, `circle` | `fill`, `stroke`, `strokeWidth`, `borderStyle` (`solid`, `dashed`, `dotted`), and `borderRadius` on rectangles                                                                                                                      |
| `line`, `arrow`       | `stroke`, `strokeWidth`, `dasharray`. The line runs from (`x`, `y`) to (`x` + `width`, `y` + `height`), so a negative width or height points it the other way.                                                                      |
| Other shapes          | `fill`, `stroke`, `strokeWidth`, `dasharray`; `path` also takes `d`, an SVG path                                                                                                                                                    |

Without a size, a text box is 300 × 80, an image 320 × 240, and a shape 160 × 90. Text and lines
default to the theme's text color.

## Tips

- **Design for one slide shape.** Coordinates are fixed pixels, so a layout made for a
  widescreen slide won't rearrange itself for a portrait or square one.
- **Paint a background first.** The block draws only your layers, and the slideshow's backdrop
  behind them is black. Start with a full-slide `rectangle` (`width=1920 height=1080`) or image,
  and give text an explicit `color`, since the default follows the theme and a dark theme's text
  is light.
- **Quote colors with `#`.** Write `fill="#1e3a5f"` with quotes so the color reads as one value.
- **Arrange it visually.** In the editor, the layout opens as a canvas where you can drag and
  resize layers; the sub-headings are rewritten to match.

## Related

- [Drawing](drawing.md) — shapes that scale to fit, with connectors between them
- [Custom templates](../guide/custom-templates.md) — reusable layouts
- [Content](content.md) — when the words should simply flow

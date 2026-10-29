---
template: mediaOnly
description: The Media Only block fills the whole slide with the section's picture, video, or diagram and shows no text at all.
---

# Media Only

Use Media Only when the picture says it all: a full-screen photo between chapters, a video that
plays edge to edge, a diagram that needs every pixel. The slide shows the section's media and
nothing else: no title, no caption, no body text. If you want a caption over the picture,
choose [Image with Caption](imageWithCaption.md) or [Video with Caption](videoWithCaption.md)
instead.

```markdown preview
## Harbor at dawn {[mediaOnly]}

![Fishing boats in the harbor at first light](images/harbor.svg)
```

## How it reads your section

- **Media** — every image, video clip, [hosted video](../guide/media.md#hosted-videos), and
  picture fence (a Mermaid diagram or an SVG) in the body fills the slide. The whole picture is
  shown, scaled as large as the slide allows. Several items share the slide side by side.
- **Heading and body text** — not drawn on the slide while there's media to show. They still
  count: the heading names the slide in the editor's outline, and in
  [page view](../guide/display-modes.md#page) the section reads as normal prose, with the
  heading, the text, and then the media.

Without any media, Media Only falls back to an ordinary [Content](content.md) slide, so the
heading and body appear and nothing you wrote goes missing.

## Examples

### A video that fills the screen

A hosted video link on its own line becomes a player the size of the whole slide.

```markdown preview
## Tears of Steel {[mediaOnly]}

https://www.youtube.com/watch?v=R6MlUcmOul8
```

### A section without media

Until you add a picture, the section shows its heading and text like a Content slide.

```markdown preview
## Gallery 3 — photographs to come {[mediaOnly]}

The harbor series arrives from the printer next week. Until then, this slide holds its place.
```

## Parameters

```squisq-docs
template-params
```

## Tips

- **Write the text anyway.** Words under the heading don't appear on the slide, but they
  appear in page view and in Word or PDF exports, and they're part of the script when you
  [narrate](../guide/narration.md).
- **Pick media that fits the slide's shape.** A picture is never cropped, so one the same shape
  as the slide fills it edge to edge, while a squarer or taller one leaves bands of the theme's
  background at the sides.
- **One item at a time.** Two pictures share the slide side by side. For a deliberate set of
  photos, use [Photo Grid](photoGrid.md).

## Related

- [Image with Caption](imageWithCaption.md) — a full-bleed image with a caption over it
- [Video with Caption](videoWithCaption.md) — a video with a caption
- [Top Feature](topFeature.md) and [Bottom Feature](bottomFeature.md) — full-width media with a
  band of text
- [Images](../guide/media.md#images) and [hosted videos](../guide/media.md#hosted-videos)

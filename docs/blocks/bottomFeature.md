---
template: bottomFeature
description: The Bottom Feature block puts your heading and text in a band across the top of the slide and gives the section's picture, video, or diagram the full width below.
---

# Bottom Feature

Use Bottom Feature when the words come first and the picture backs them up: a headline and a
short paragraph across the top, then a wide photo, video, or diagram given the full width of
the slide underneath. It's the mirror of [Top Feature](topFeature.md), which puts the media
on top. When you want the picture beside the text instead, reach for
[Left Feature](leftFeature.md) or [Right Feature](rightFeature.md); those give the media half
the slide, while Bottom Feature gives it the whole width.

```markdown preview
## Ridgeline Trail reopens {[bottomFeature]}

The 11-mile loop above Cedar Lake is open again after a summer of repairs.

![The ridge above Cedar Lake](images/mountains.svg)
```

## How it reads your section

- **Heading** — the title at the top of the band.
- **Body text** — shown in full, as [Content](content.md) shows it: paragraphs, lists, and
  formatting all stay. The band grows to fit the text, up to about two-fifths of the slide, and
  the type shrinks if it needs to. Past that, long text gets cut off, so keep it short.
- **Media** — every image, video clip, [hosted video](../guide/media.md#hosted-videos), and
  picture fence (a Mermaid diagram or an SVG) in the body fills the area below the band, which
  spans the slide's full width. The whole picture is shown, scaled as large as the area allows.
  Several pictures sit side by side. Images don't also appear as text.

Without any media, Bottom Feature draws an ordinary [Content](content.md) slide, so choosing it
never hides your words.

In [page view](../guide/display-modes.md#page) the section reads as normal prose: the heading,
the text, then the media.

## Examples

### A list above the picture

The body can be a list. Each item stays a bullet.

```markdown preview
## What the trail crew finished {[bottomFeature]}

- Rebuilt three washed-out switchbacks
- Replaced the Miller Creek footbridge
- Cleared 40 downed trees from the north loop

![Old-growth forest on the north loop](images/forest.svg)
```

### A hosted video

Paste a YouTube, Vimeo, Loom, or Wistia link on its own line, and the player fills the lower
part of the slide.

```markdown preview
## Friday film night {[bottomFeature]}

This week the club screens Spring, a short from the Blender Studio. Doors open at 7.

https://www.youtube.com/watch?v=WhWc3b3KhnY
```

### A portrait slide

The layout holds on a tall slide too: the text keeps its band across the top, and the media
still spans the full width below it.

```markdown preview aspect=portrait
## The new waterfront {[bottomFeature]}

Pier 4 reopens to the public on June 1.

![The harbor at dusk](images/harbor.svg)
```

## Parameters

```squisq-docs
template-params
```

The title comes from the heading, so you rarely need `title=`. Everything else comes from the
body.

## Tips

- **Keep the text short.** One headline and a sentence or two leave most of the slide to the
  picture. A long body squeezes the media and may be cut off. If the text matters more than the
  picture, use [Content](content.md) or a side-by-side feature instead.
- **Use wide pictures.** The media area is much wider than it is tall, so panoramas and
  widescreen video fill it edge to edge. A squarer photo is never cropped; it's shown smaller,
  with margins at the sides.
- **One picture reads best.** Two or more share the width side by side, each narrower.
- **No media yet?** The slide renders as plain content until you add some, so you can tag the
  section first and drop the picture in later.

## Related

- [Top Feature](topFeature.md) — the same layout with the media on top
- [Media Only](mediaOnly.md) — the media fills the slide, with no text
- [Left Feature](leftFeature.md) and [Right Feature](rightFeature.md) — media beside the text
- [Images](../guide/media.md#images) and [hosted videos](../guide/media.md#hosted-videos)

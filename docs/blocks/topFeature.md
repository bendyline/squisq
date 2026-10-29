---
template: topFeature
description: The Top Feature block runs the section's image, video, or diagram across the full width of the slide, with the heading and the complete body in a band below.
---

# Top Feature

Top Feature gives your media the whole width of the slide. The picture — or video, or diagram —
spans edge to edge across the top, and the heading and body sit in a band beneath it, sized to the
text. It is the layout for wide panoramas, maps, flowcharts, and portrait stages, where a
side-by-side [Left Feature](leftFeature.md) would cut the media in half.

Unlike the side features, Top Feature keeps everything you wrote: lists, formatting, and every
paragraph, laid out the way [Content](content.md) lays them out. [Bottom Feature](bottomFeature.md)
is the same idea flipped, with the text on top.

```markdown preview
## Above the treeline {[topFeature]}

![The ridge at sunrise](images/mountains.svg)

The last two kilometers climb 400 meters over loose scree. Start before dawn to summit ahead of the afternoon storms.
```

## How it reads your section

- **Media** — the images, video clips, [hosted videos](../guide/media.md#hosted-videos),
  [Mermaid diagrams](../guide/diagrams.md#mermaid), and [SVG pictures](../guide/diagrams.md#svg-pictures)
  in the body fill the top of the slide, full width. Several share the band side by side.
- **Heading** — the title, at the top of the text band.
- **Body** — the complete body under the title, with lists, bold, italics, and links intact. A
  paragraph that is only a picture is left out of the text, since the picture is already above.
- **No media?** Then the slide is an ordinary Content slide, so choosing Top Feature never loses
  your words.

The text band takes only the height the text needs, and the media gets the rest. A longer body
means a shorter picture.

## Examples

### A picture drawn in SVG

An `svg` fence is a picture too, and spans the band like a photo. Its markup isn't repeated as
text.

````markdown preview
## The climb, kilometer by kilometer {[topFeature]}

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 200">
  <polygon points="0,190 120,170 260,150 380,120 470,110 560,70 680,40 800,20 800,200 0,200" fill="#7aa2c8" opacity="0.35"/>
  <polyline points="0,190 120,170 260,150 380,120 470,110 560,70 680,40 800,20" fill="none" stroke="#2f5d8a" stroke-width="6"/>
  <circle cx="800" cy="20" r="10" fill="#2f5d8a"/>
</svg>
```

The trail gains 900 meters in eleven kilometers. The last two are the steepest.
````

### With a list

```markdown preview
## The upper lake loop {[topFeature]}

![Lake below the ridge](images/ocean.svg)

- 14 km round trip, 600 m of climbing
- Water at the 6 km mark only
```

### Portrait

On a tall stage, the media takes most of the frame and the text sits in a band at the bottom — a
good fit for vertical video.

```markdown preview aspect=portrait
## Night at the market {[topFeature]}

![The harbor at night](images/harbor.svg)

Forty vendors, live music, and the waterfront lit up every Friday in July.
```

## Parameters

```squisq-docs
template-params
```

`title=` replaces the heading in the text band. The media and the body always come from the
section.

## Tips

- Wide pictures suit Top Feature best. The media is shown whole, never cropped, so a wide picture
  fills the band and a tall one sits narrow in the middle of it.
- Put one picture per Top Feature. In a slideshow, every image after the first in a section is
  also shown again later as a slide of its own.
- Keep the body short — a sentence or a few list items — so the media keeps most of the slide.
- In [page view](../guide/display-modes.md#page), Top Feature reads as ordinary prose under its
  heading, with the media in place.

## Related

- [Bottom Feature](bottomFeature.md) — text on top, media below
- [Media Only](mediaOnly.md) — the media fills the slide, no text
- [Left Feature](leftFeature.md) and [Right Feature](rightFeature.md) — media beside the text
- [Content](content.md) — the same text layout, with media in a framed box
- [Images](../guide/media.md#images) and [diagrams](../guide/diagrams.md)

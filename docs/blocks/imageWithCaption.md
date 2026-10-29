---
template: imageWithCaption
description: The Image with Caption block fills the slide with one photo and lays a short caption across it on a soft band.
---

# Image with Caption

Image with Caption is the photo slide: one picture, edge to edge, and a line of text that tells the
audience what they're looking at. With `isTitle=true` it becomes a title card over the photo
instead.

Choose it when the picture should own the slide. When the words need as much room as the picture,
use [Left Feature](leftFeature.md) or [Right Feature](rightFeature.md); for media across the top
with a full body beneath, [Top Feature](topFeature.md).

```markdown preview
## The harbor at first light {[imageWithCaption imageSrc=images/harbor.svg caption="Boats return to the north pier before dawn"]}
```

## How it reads your section

On a slide, everything this block shows comes from the tag:

- **`imageSrc=`** — the photo. It fills the slide, cropped to cover it.
- **`caption=`** — the text, on a soft band tinted from the theme's background so it stays
  readable. A long caption wraps to two lines. Without a caption, the photo stands alone.
- **`captionPosition=`** — where the band sits: `bottom` (the default), `top`, or `center`.
- **Body** — not drawn. It stays in your Markdown, and it counts toward the slide's timing.

> [!IMPORTANT]
> Set the photo with `imageSrc=` and the words with `caption=`. A slideshow doesn't take them from
> the body or the heading, so an image written in the body ends up in a small framed box instead of
> filling the slide. ([Page view](../guide/display-modes.md#page) does fall back to the first image
> in the body, and to the heading as the caption.)

You don't need this tag for a quick photo slide. An untagged heading with one picture and a little
prose below it automatically becomes a [Left Feature](leftFeature.md) or
[Right Feature](rightFeature.md) — see [automatic templates](../guide/markup.md#automatic-templates).

## Examples

### As a title card

`isTitle=true` sets the caption large and centered low on the slide, over a gradient, with an
optional `subtitle`.

```markdown preview
## Cover {[imageWithCaption imageSrc=images/mountains.svg caption="Three Weeks in the High Basin" isTitle=true subtitle="Field journal, summer 2027"]}
```

### Caption at the top, slow pan

`ambientMotion` drifts the photo slowly — here, panning right.

```markdown preview
## The east bank today {[imageWithCaption imageSrc=images/city.svg caption="The east bank today, from the Fremont bridge" captionPosition=top ambientMotion=panRight]}
```

### Credited and graded

`imageCredit` and `imageLicense` record where the photo came from — page view prints them under the
figure. `imageTreatment=mono` regrades the photo in black and white for this one slide.

```markdown preview
## The 1962 pier {[imageWithCaption imageSrc=images/harbor.svg caption="The original timber pier, shortly before demolition" imageCredit="Port Archives" imageLicense="CC BY 4.0" imageTreatment=mono]}
```

### Portrait

The photo is cropped to fill a tall stage, so keep the subject near the middle.

```markdown preview aspect=portrait
## Old growth {[imageWithCaption imageSrc=images/forest.svg caption="Western red cedar, roughly 800 years old"]}
```

## Parameters

```squisq-docs
template-params
```

`subtitle` only appears with `isTitle=true`, and `isTitle` needs a `caption` to show anything. Write
flags with a value — `isTitle=true`; a bare `isTitle` is ignored. Without `ambientMotion` the photo
holds still (some themes add a gentle drift of their own). `imageTreatment` (`none`, `mono`,
`duotone`, `warm`, `cool`) overrides the theme's photo grade for this block.

## Tips

- Captions read best at one line. Two lines is the limit before the text is cut off, and closing
  punctuation (a period, colon, or question mark) is dropped.
- Write `imageAlt=` for anyone using a screen reader — the caption describes the moment, the alt text
  describes the picture.
- In [page view](../guide/display-modes.md#page), the block becomes a figure with the caption
  beneath it; with `isTitle=true` it becomes a lead hero with the photo as its background.

## Related

- [Left Feature](leftFeature.md) and [Right Feature](rightFeature.md) — a photo beside a paragraph
- [Top Feature](topFeature.md) — media across the top, the full body below
- [Pull Quote](pullQuote.md) — a quotation over a photo
- [Photo Grid](photoGrid.md) — several photos at once
- [Images](../guide/media.md#images)

---
template: leftFeature
description: The Left Feature block puts a picture in the left half of the slide and the heading and body text in the right half.
---

# Left Feature

Left Feature is the editorial spread: a picture on the left, and on the right the heading with a
paragraph or two that tells its story. It suits product highlights, project profiles, and any
section where one image and a short explanation carry equal weight.

[Right Feature](rightFeature.md) is the mirror image. Alternate the two down a deck and a run of
picture slides reads like a magazine layout instead of a stack. For a photo that should fill the
whole slide, use [Image with Caption](imageWithCaption.md).

```markdown preview
## The new workshop {[leftFeature]}

![Workbenches under the skylight](images/workshop.svg)

Twelve benches, a shared tool wall, and a dust collector that finally keeps up with the lathes.
```

## How it reads your section

- **An image** — the first image in the body fills the left half, cropped to cover it.
- **Heading** — the title, above the body in the right-hand column. Title and body are centered
  vertically as a group.
- **Body** — every paragraph, list item, and quote, as plain text under the title. Formatting and
  list markers are dropped, and the text shrinks to fit the column.

Give the section an image: without one, the left half stays empty. An untagged heading with one
picture and only paragraphs around it becomes a Left Feature or Right Feature automatically,
alternating sides down the document — see
[automatic templates](../guide/markup.md#automatic-templates).

## Examples

### Image from the tag

`imageSrc=` sets the picture directly — handy when the body is pure prose.

```markdown preview
## Meet the volunteers {[leftFeature imageSrc=images/team.svg]}

Forty-two neighbors staffed the spring cleanup, hauling 3.2 tons of debris off the riverbank in a single weekend.
```

### A short body

```markdown preview
## Open studio {[leftFeature]}

![The workshop floor](images/workshop.svg)

First Friday of every month, 6 to 9 p.m.
```

### Portrait

On a tall stage, the picture takes the top half and the text sits below it.

```markdown preview aspect=portrait
## The ridge route {[leftFeature]}

![Ridge at sunrise](images/mountains.svg)

Eleven kilometers, 900 meters of climbing, and a view of three volcanoes from the top.
```

## Parameters

```squisq-docs
template-params
```

`title` and `body` replace the heading and body text. `imageWidth` and `imageHeight` mark the image
as a sized picture — as happens when you resize it in the editor — and the block then centers it at
that size inside its half, with padding, instead of filling the half.

## Tips

- Pictures with their subject in the middle crop best; the image is cut to fill a half-slide
  that is taller than it is wide.
- Keep the body to one or two short paragraphs. It shrinks to fit, but a feature reads at a
  glance.
- A list in the body loses its bullets here. When the list matters, use [Content](content.md).
- In [page view](../guide/display-modes.md#page), the block becomes a split section with the
  picture on the left.

## Related

- [Right Feature](rightFeature.md) — the same layout, picture on the right
- [Top Feature](topFeature.md) — media across the full width, text below
- [Image with Caption](imageWithCaption.md) — a full-bleed photo with a caption
- [Images](../guide/media.md#images)

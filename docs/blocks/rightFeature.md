---
template: rightFeature
description: The Right Feature block puts the heading and body text in the left half of the slide and a picture in the right half.
---

# Right Feature

Right Feature pairs words and a picture with the words first: heading and body on the left, image
on the right. It is the mirror of [Left Feature](leftFeature.md), and the two work best together —
alternate them down a deck so a run of picture slides doesn't stack the same layout.

Choose a feature over [Image with Caption](imageWithCaption.md) when the text deserves as much room
as the picture.

```markdown preview
## The team behind the plan {[rightFeature]}

![The planning team at the east bank site](images/team.svg)

Six planners, two ecologists, and a rotating panel of residents met every Tuesday for eighteen months.
```

## How it reads your section

- **An image** — the first image in the body fills the right half, cropped to cover it.
- **Heading** — the title, above the body in the left-hand column. Title and body are centered
  vertically as a group.
- **Body** — every paragraph, list item, and quote, as plain text under the title. Formatting and
  list markers are dropped, and the text shrinks to fit the column.

Give the section an image: without one, the right half stays empty. Untagged headings with one
picture and a few paragraphs become Left and Right Features automatically, alternating sides — see
[automatic templates](../guide/markup.md#automatic-templates).

## Examples

### Paired with a Left Feature

Two features in a row, one each way, read as a spread.

```markdown preview
## Before {[leftFeature]}

![The east bank in 2019](images/city.svg)

Parking lots, a shuttered cannery, and no way down to the water.

## After {[rightFeature]}

![The east bank as planned](images/forest.svg)

A restored marsh, a boardwalk, and a ferry landing that connects both shores.
```

### Image from the tag

```markdown preview
## Our ferry captains {[rightFeature imageSrc=images/ocean.svg]}

Every captain on the line has logged at least 2,000 crossings, and three of them grew up on the islands they now serve.
```

### Portrait

On a tall stage, the picture moves to the top and the text sits below it, as on a Left Feature.

```markdown preview aspect=portrait
## Night market {[rightFeature]}

![Stalls along the waterfront](images/harbor.svg)

Forty vendors, live music, and the harbor lit up every Friday in July.
```

## Parameters

```squisq-docs
template-params
```

`title` and `body` replace the heading and body text. `imageWidth` and `imageHeight` mark the image
as a sized picture — as happens when you resize it in the editor — and the block then centers it at
that size inside its half instead of filling the half.

## Tips

- Pick the side by where the picture's subject looks: a face turned left sits well on the right,
  looking into the text.
- Keep the body to one or two short paragraphs; for longer text, use [Content](content.md) with the
  image beside it.
- In [page view](../guide/display-modes.md#page), the block becomes a split section with the
  picture on the right.

## Related

- [Left Feature](leftFeature.md) — the same layout, picture on the left
- [Top Feature](topFeature.md) — media across the full width, text below
- [Image with Caption](imageWithCaption.md) — a full-bleed photo with a caption
- [Images](../guide/media.md#images)

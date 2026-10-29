---
template: pullQuote
description: The Pull Quote block sets a quotation over a full-bleed photo, darkened so the words stay readable, with an optional attribution.
---

# Pull Quote

Pull Quote is the cinematic quote: the first image in your section fills the slide, a dark veil
settles over it, and the quotation sits in the middle in large white type. It suits oral histories,
interviews, and field reports where the place matters as much as the words.

Without an image it still works — the quote sits on the theme's surface, like a simpler
[Quote](quote.md). Choose Quote when you also want a heading above the quotation; Pull Quote shows
the quote and attribution only.

```markdown preview
## The tide {[pullQuote attribution="Harbor master's log, 1911"]}

![The harbor at dusk](images/harbor.svg)

> The sea gives back everything, eventually.
```

## How it reads your section

- **Body** — the quotation, from the body's blockquote; without one, the body's text is used.
- **An image** — the first one in the body becomes the full-bleed background, under a dark veil.
  Without an image, the quote sits on the theme's surface instead.
- **`attribution=`** — the speaker or source, under the quote. The dash is added for you.
- **Heading** — not drawn when there is a body. A heading-only block uses the heading as the
  quotation.

## Examples

### No photo

```markdown preview
## From the interviews {[pullQuote attribution="Delia Hart, ferry captain, 1979–2011"]}

> You learn the water the way you learn a person. Slowly, and never all the way.
```

### Over the mountains

```markdown preview
## Day four {[pullQuote attribution="Field journal, upper basin"]}

![Ridge at first light](images/mountains.svg)

> We woke above the clouds and nobody said a word for ten minutes.
```

### Portrait

```markdown preview aspect=portrait
## Night shift {[pullQuote attribution="Ward nurse, 22 years"]}

![City at night](images/city.svg)

> The city never sleeps. It just gets quieter so you can hear it.
```

## Parameters

```squisq-docs
template-params
```

`text=` replaces the quotation the block reads from the body. The background picture comes from the
first image in the body.

## Tips

- Pick a photo with a calm area in the middle, or one that is simply dark; the text sits at the
  center of the frame.
- Put the attribution in the tag rather than on a line inside the blockquote, which would be set
  as part of the quotation.
- Long quotes shrink to fit and stay in the frame, but a sentence or two reads best over a photo.
- In [page view](../guide/display-modes.md#page), the block becomes a full-bleed quote band with
  the photo as its background.

## Related

- [Quote](quote.md) — a quotation with a heading, on the theme's surface
- [Full Bleed Quote](fullBleedQuote.md) — one short line at maximum size, no photo
- [Image with Caption](imageWithCaption.md) — a photo with a caption band
- [Video Pull Quote](videoPullQuote.md) — a quote beside a video
- [Images](../guide/media.md#images)

---
template: quote
description: The Quote block sets a quotation in large type under a decorative quotation mark, with an optional heading and attribution.
---

# Quote

Quote is for words someone said or wrote: a line from an interview, a testimonial, a passage from a
founding document. The quotation is centered in the theme's title face, a large faint quotation
mark sits above it, and the attribution hangs just below.

Choose [Pull Quote](pullQuote.md) to set the quote over a photo, or
[Full Bleed Quote](fullBleedQuote.md) for a short line at movie-poster size.

```markdown preview
## On the waterfront {[quote attribution="Lena Marsh, lead landscape architect"]}

> We didn't plan a park. We planned a place people would choose to linger.
```

## How it reads your section

- **Body** — the quotation. Write it as a Markdown blockquote (`>`). The slide uses the text of
  the whole body, so keep anything that isn't the quote out of it.
- **Heading** — a small, muted title above the quote.
- **`attribution=`** — the speaker or source, shown under the quote. The dash is added for you.
- **An image** — the first one in the body becomes an accent strip down the left edge (along the
  bottom on a portrait stage), and the quote moves over beside it.

A heading whose body is only a blockquote becomes a Quote automatically, so the tag is optional
there — though you still need the tag to add an `attribution`. See
[automatic templates](../guide/markup.md#automatic-templates).

## Examples

### A different kicker

`title=` replaces the heading as the line above the quote.

```markdown preview
## Testimonials {[quote title="From the spring survey" attribution="Ballard resident, 34 years"]}

> I walk past the old cannery every day. For the first time, I want to stop.
```

### With an accent image

```markdown preview
## Why we're here {[quote attribution="Harbor master's log, 1911"]}

![The north pier](images/harbor.svg)

> The sea gives back everything, eventually.
```

### Portrait

```markdown preview aspect=portrait
## From the founders {[quote attribution="Ada and Tomas Ruiz"]}

> We opened the shop to fix bikes. We kept it open to fix the neighborhood.
```

## Parameters

```squisq-docs
template-params
```

`quote=` replaces the body as the quotation. Each value overrides what the block would otherwise
read from the section.

## Tips

- Give every Quote a body. A heading-only Quote uses the heading as the quotation, and a slide
  then shows those words twice — as the title and as the quote.
- Put the attribution in the tag, not on a `— Name` line inside the blockquote. A line inside the
  quote is set as part of the quotation.
- Long quotes shrink to fit and stay inside the frame, but a quote reads best at a sentence or two.
  Trim with an ellipsis rather than squeezing in the whole paragraph.
- On a [dashboard](../guide/display-modes.md#dashboard), a short quote renders with larger type
  so it fills its cell.
- In [page view](../guide/display-modes.md#page), the block becomes a quote band with its title
  and attribution.

## Related

- [Pull Quote](pullQuote.md) — a quote over a full-bleed photo
- [Full Bleed Quote](fullBleedQuote.md) — one short line at maximum size
- [Transcript](transcript.md) — a speaker and message, chat style
- [Fact Card](factCard.md) — a statement of fact rather than a quotation

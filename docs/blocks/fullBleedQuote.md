---
template: fullBleedQuote
description: The Full Bleed Quote block sets one short, dramatic line at movie-title size across the whole slide.
---

# Full Bleed Quote

Full Bleed Quote takes a single line and makes it enormous: massive type, centered on a vignette in
one of the theme's colors, like a title card in a film. Use it for the sentence your whole talk
builds toward — a promise, a turning point, a call to action.

It draws text only, despite the name; there is no photo behind it. To set a line over a picture,
use [Pull Quote](pullQuote.md). For a quotation with attribution, use [Quote](quote.md).

```markdown preview
## The turning point {[fullBleedQuote]}

Nobody was coming to save the marsh. So we did.
```

## How it reads your section

- **Body** — the line. If the body holds a blockquote, its text is used; otherwise all of the
  body's text is.
- **Heading** — not drawn when there is a body. A heading-only block uses the heading as its line.
- **`colorScheme`** — the color of the vignette and of the text.

The type is full size up to about 40 characters, then eases down as the line gets longer, and
finally shrinks and line-clamps rather than leave the frame. A body image isn't part of the design:
it gets a framed box of its own, and the line shrinks to make room.

## Examples

### A blockquote, in red

```markdown preview
## Our ask {[fullBleedQuote colorScheme=red]}

> Every street is a public space.
```

### Heading only

With no body, the heading is the line.

```markdown preview
## Fewer cars. More neighbors. {[fullBleedQuote colorScheme=teal]}
```

### Portrait

A tall stage stacks the words, which suits a vertical video.

```markdown preview aspect=portrait
## Closing {[fullBleedQuote colorScheme=purple]}

See you on the water.
```

## Parameters

```squisq-docs
template-params
```

These are the values `{[fullBleedQuote]}` reads from its tag. Each is plain text, and a misspelled key is
silently ignored rather than reported:

| Parameter     | What it does                                                  | Values                                                                                                                    |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `colorScheme` | Color of the vignette behind the line, and of the line itself | A [color scheme](../guide/themes.md#color-schemes) name: `blue` (the default), `green`, `purple`, `red`, `orange`, `teal` |
| `text`        | The line, in place of the body                                | Text                                                                                                                      |

## Tips

- Keep it under 60 characters. The block is designed for a single punchy line, and the type gets
  smaller as the line grows.
- Use it once or twice in a deck. Its power comes from contrast with the slides around it.
- Color scheme names come from the theme. A theme without the name you chose falls back to its
  first scheme — the Gezellig theme, for one, names its schemes `terracotta`, `sage`, `amber`,
  `plum`, `ink`, and `cream`.
- In [page view](../guide/display-modes.md#page), the line becomes a display quote band across the
  page.

## Related

- [Pull Quote](pullQuote.md) — a quote over a full-bleed photo
- [Big Text](bigText.md) — the heading as gigantic uppercase type
- [Quote](quote.md) — a quotation with attribution
- [Color schemes](../guide/themes.md#color-schemes)

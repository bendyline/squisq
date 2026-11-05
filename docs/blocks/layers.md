---
template: layers
description: The Layers block draws nested parts as concentric rings, innermost first, each one called out.
---

# Layers

Layers draws the parts in your section as rings inside one another, the first part at the centre,
and calls each one out beside the drawing. It is for things built in shells: the layers of the
Sun or the Earth, the parts of a cell, the rings of a system around its core.

Choose it over [Cards](cards.md) when one part sits inside the next, and over
[Process](process.md) when the parts are places rather than stages.

```markdown preview
## Inside the Sun {[layers]}

- Core: nuclear reactions fuse hydrogen into helium
- Radiative zone: light bounces around for about 170,000 years
- Convection zone: bubbles of hot plasma rise to the surface
```

## How it reads your section

- **Heading** — the headline above the drawing, with the theme's accent rule.
- **List** — one ring per item, innermost first, three to six. `Label: detail` sets the label bold
  above its detail.
- **No list** — each paragraph becomes a ring. A single part draws as [Cards](cards.md).
- **Layout** — the rings sit on the left, deepening in the theme's accent toward the centre, with a
  line from each ring to its words on the right. On a portrait stage the rings sit above the words,
  each marked with its ring's color.

## Revealed one at a time

`build=items` grows the rings out from the centre one by one, each with its callout. In a
dynamic-slides deck, AI suggestions choose this layout for a passage that describes nested parts.

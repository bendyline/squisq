---
template: matrix
description: The Matrix block places four ideas on two axes as a two-by-two grid.
---

# Matrix

Matrix places four ideas on two axes, as a grid of two rows and two columns with an arrow up the
side and one along the foot. It is for choices that turn on two questions at once: how much effort
against how much impact, how urgent against how important.

Choose it over [Cards](cards.md) when where an idea sits is part of what it means.

```markdown preview
## What to do first {[matrix xAxis="Urgency" yAxis="Importance"]}

- Plan: important, but it can wait
- Do now: important and urgent
- Drop: neither
- Delegate: urgent, but not important
```

## How it reads your section

- **Heading** — the headline above the grid, with the theme's accent rule.
- **List** — exactly four items, in reading order: top left, top right, bottom left, bottom right.
  `Label: detail` sets the label bold above its detail.
- **`xAxis` and `yAxis`** — what grows from left to right and from bottom to top. Leave either out
  and its arrow is not drawn.
- **Items that place themselves** — when you name no axes and each item says where it stands on
  the same two measures (`Quick wins: low effort, high impact`), the measures name the axes:
  low on the first is left, high on the second is top. This applies only when the items are
  already in that order, so your order always stands.
- **Not four items** — the ideas draw as [Cards](cards.md), and the document reports a
  `template-shape-unmet` warning saying what the matrix was missing.

A four-item list under a heading that names a matrix ("Priority matrix", "SWOT", "2×2") is drawn
as one automatically.

## Revealed one at a time

`build=items` brings the four ideas in one by one. The axes are there from the start.

---
template: stats
description: The Key Numbers block sets two to six figures side by side, each counting up over what it measures.
---

# Key Numbers

Key Numbers sets the figures in your section side by side, each large in the theme's accent with
what it measures beneath. It is for the handful of numbers a reader should remember: how many, how
much, how fast.

Choose it over [Stat Highlight](statHighlight.md) when there is more than one number, and over a
[chart](columnChart.md) when the numbers measure different things.

```markdown preview
## Measles vaccination in numbers {[stats]}

- 57 million: deaths prevented since 2000
- 95%: coverage needed for herd immunity
- 2 doses: for lifelong protection
```

## How it reads your section

- **Heading** — the headline above the figures, with the theme's accent rule.
- **List** — one figure per item, two to six, written `Figure: what it measures`. The figure may
  also follow its label (`Coverage: 95%`) or open the item (`57 million deaths prevented`).
- **Scale words** — `57 million` sets `57` large with `million` beneath it, so long numbers stay
  large.
- **No figures** — a list without a number in it draws as [Cards](cards.md).
- **Layout** — up to four figures sit in one row, five or six three to a row; a portrait stage
  stacks them.

A bulleted list whose items are all figures is drawn as Key Numbers automatically; see
[how lists are drawn](../guide/markup.md#lists-that-draw-themselves).

## Revealed one at a time

`build=items` brings the figures in one by one. Where the theme's motion counts numbers up, each
figure counts up as it arrives.

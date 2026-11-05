---
template: cycle
description: The Cycle block arranges the stages of a cycle on a ring, the last leading back to the first.
---

# Cycle

Cycle places the stages in your section around a ring, each joined to the next by a curved arrow
and the last joined back to the first. It is for processes that repeat: the water cycle, a
season, a feedback loop.

Choose it over [Process](process.md) when the last stage leads back to the first.

```markdown preview
## The water cycle {[cycle]}

- Evaporation: the sun heats water and it rises
- Condensation: the vapor cools into clouds
- Precipitation: water falls as rain or snow
- Collection: rivers carry it back to the sea
```

## How it reads your section

- **Heading** — the headline above the ring, with the theme's accent rule.
- **List** — one stage per item, three to six. `Label: detail` sets the label bold above its
  detail. Short labels read best: each sits beside its stage, out from the ring.
- **No list** — each paragraph becomes a stage. One stage alone draws as a [Process](process.md).
- **Layout** — the ring is as large as the labels allow while they keep most of their size.

## Revealed one at a time

`build=items` brings the stages in one by one, each with the arrow that arrives at it. In a
dynamic-slides deck, a passage of ordered sentences that says the sequence repeats is drawn as a
cycle automatically.

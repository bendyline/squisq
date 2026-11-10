---
template: funnel
description: The Funnel block draws stages that narrow as a funnel, the widest first and the outcome last.
---

# Funnel

Funnel draws the stages in your section as one narrowing shape, the first stage at the wide mouth
and the last at the stem. It is for anything that starts with many and ends with few: visitors who
become customers, applicants who are hired, ore that becomes metal.

Choose it over [Process](process.md) when each stage is smaller than the one before, and over
[Pyramid](pyramid.md) when the wide end is where things begin.

```markdown preview
## From visitor to regular {[funnel]}

- 10,000 visitors: walk the promenade each weekend
- 2,400 stop: at a stall or a café
- 600 return: within the month
- 150 regulars: come every week
```

## How it reads your section

- **Heading** — the headline above the drawing, with the theme's accent rule.
- **List** — one stage per item, widest first, two to six. `Label: detail` sets the label bold
  above its detail; a figure makes a good label.
- **No list** — each paragraph becomes a stage. A single stage draws as [Cards](cards.md).
- **Layout** — the funnel sits on the left, deepening in the theme's accent toward the stem, with
  a line from each stage to its words. On a portrait stage the funnel sits above the words.

A numbered list whose figures shrink from item to item, or a list under a heading that says the
stages narrow ("Sign-up funnel"), is drawn as a funnel automatically.

## Revealed one at a time

`build=items` brings the stages in one by one, from the mouth down.

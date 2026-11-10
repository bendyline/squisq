---
template: venn
description: The Venn block draws two sets as overlapping circles, with what they share in the overlap.
---

# Venn

Venn draws two things as overlapping circles: what belongs to each alone beside its circle, and
what they share tied to the overlap. It is for comparisons where the common ground matters as much
as the differences.

Choose it over [Cards](cards.md) with `versus` when the two things have something in common.

```markdown preview
## Frogs and toads {[venn]}

- Frogs: smooth, moist skin and long legs for leaping
- Toads: dry, bumpy skin and short legs for walking
- Both: amphibians that lay their eggs in water
```

## How it reads your section

- **Heading** — the headline above the drawing, with the theme's accent rule.
- **List** — three items: the two sets, each `Name: what only it has`, and one labelled `Both:` (or
  `Shared:`, `In common:`) that says what they share. The shared item may come anywhere in the
  list.
- **Without a shared item** — the circles still overlap, with nothing written under them.
- **Anything else** — a list that is not two sets draws as [Cards](cards.md).
- **Layout** — each set's name sits inside its circle and its detail beside it; the second circle
  takes a second color from the theme so the overlap blends the two. On a portrait stage the three
  are listed under the circles.

A three-item list with an item labelled `Both:` is drawn as a Venn diagram automatically.

## Revealed one at a time

`build=items` brings in each circle with its words, then the overlap.

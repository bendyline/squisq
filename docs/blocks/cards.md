---
template: cards
description: The Cards block sets two to six parallel ideas side by side, each in its own card.
---

# Cards

Cards takes the points in your section and gives each one a card of its own: a short bold label
over a line or two of detail. It is for ideas that sit side by side rather than in order — the
kinds of something, the causes of something, the features of something.

Choose it over [List](list.md) when each point has a name and a short explanation, and over
[Process](process.md) when the points do not happen in order.

```markdown preview
## Four gases warm the planet {[cards]}

- Carbon dioxide: volcanoes, fossil fuels and deforestation
- Methane: wetlands, landfills, rice farming and livestock
- Nitrous oxide: fertilizer and burning vegetation
- Chlorofluorocarbons: wholly industrial, once used as refrigerants
```

## How it reads your section

- **Heading** — the headline above the cards, with the theme's accent rule.
- **List** — one card per item, up to six. `Label: detail` (or `Label — detail`) sets the label
  bold above its detail; an item without a label sets as plain words.
- **No list** — each paragraph becomes a card.
- **Layout** — up to three cards sit in a row; four sit two by two unless they are only a few
  words each; five or six sit three to a row. On a portrait stage the cards stack.
- **Type** — every card on a slide sets in the same sizes, which grow when the ideas are short and
  step down when they run long, without ever breaking a word.
- **A single unlabelled item** — sets as a lead paragraph beside an accent bar instead of one card.

## Revealed one at a time

`build=items` brings the cards in one by one as you advance. In a dynamic-slides deck each card
appears as the narration reaches the sentence it summarizes.

```markdown preview
## Vaccines come in two kinds {[cards build=items]}

- Live-attenuated: two doses give long-lasting protection
- Non-live: safer for weak immune systems, but needs boosters
```

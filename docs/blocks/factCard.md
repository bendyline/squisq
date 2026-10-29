---
template: factCard
description: The Fact Card block states one fact as a bold headline and explains it in the text beneath, with an optional source line.
---

# Fact Card

Fact Card is a claim and its backing: your heading is the fact, set large, and the body explains
why it's true or why it matters. It suits the "did you know" moments of a report or a talk, where
the point is a sentence rather than a number.

Choose [Stat Highlight](statHighlight.md) when the fact is really a figure, and
[Definition Card](definitionCard.md) when the heading is a term rather than a claim.

```markdown preview
## Salt marshes outpace forests {[factCard source="Coastal Carbon Survey, 2026"]}

A hectare of salt marsh locks away roughly ten times more carbon each year than a hectare of mature forest.
```

## How it reads your section

- **Heading** — the fact, large and bold. A long heading steps its size down to fit.
- **Body** — the explanation, left-aligned under the fact. All of the body's text is used, as
  plain text: paragraphs, list items, and quotes each become a line of their own.
- **`source=`** — an optional small line under the explanation, for a citation.
- **An image** — the first one in the body becomes an accent strip down the left edge (along the
  bottom on a portrait stage), and the card moves over beside it.

## Examples

### With an accent image

```markdown preview
## The ridge trail is older than the park {[factCard source="State Archives, survey map of 1887"]}

![Mountain ridge](images/mountains.svg)

Shepherds cut the switchbacks to move flocks between summer pastures, forty years before the park existed.
```

### A longer explanation

The explanation shrinks to fit the space under the fact and clamps with an ellipsis only at a
readable floor.

```markdown preview
## Most of the city's water comes from snow {[factCard]}

About 70 percent of the reservoir's yearly inflow arrives as spring snowmelt from the upper watershed.

A warm winter with little snowpack can leave the reservoir short by August, even after a wet autumn.
```

### Portrait

```markdown preview aspect=portrait
## Cyclists spend more downtown {[factCard source="Downtown Business Council, 2027"]}

Shops on the new protected bike lane report that cyclists spend more per month than drivers.
```

## Parameters

```squisq-docs
template-params
```

These are the values `{[factCard]}` reads from its tag. Each is plain text, and a misspelled key is
silently ignored rather than reported:

| Parameter        | What it does                                                   | Values                                    |
| ---------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `source`         | A small, muted citation line under the explanation             | Text                                      |
| `fact`           | The headline fact, in place of the heading                     | Text                                      |
| `explanation`    | The text under the fact, in place of the body                  | Text                                      |
| `imageTreatment` | Regrades the accent image for this block, overriding the theme | `none`, `mono`, `duotone`, `warm`, `cool` |

The accent image itself comes from the first image in the body.

## Tips

- Write the heading as a complete claim — "Salt marshes outpace forests", not "Salt marshes".
- Always write an explanation. A heading-only Fact Card repeats the fact in the explanation slot on
  a slide.
- On a [dashboard](../guide/display-modes.md#dashboard), a short card renders with larger type to
  fill its cell.
- In [page view](../guide/display-modes.md#page), the card becomes a callout with the fact as its
  title and the source beneath.

## Related

- [Stat Highlight](statHighlight.md) — one big number
- [Definition Card](definitionCard.md) — a term and its meaning
- [Quote](quote.md) — words someone said
- [Content](content.md) — the whole section, with formatting

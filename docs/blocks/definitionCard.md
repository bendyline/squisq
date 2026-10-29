---
template: definitionCard
description: The Definition Card block shows a term and its definition laid out like a dictionary entry.
---

# Definition Card

Definition Card is for vocabulary: the place name, the technical term, or the bit of jargon your
audience needs before the next slide makes sense. The term is large and colored, a short rule sits
under it, and the definition follows in plain type — all left-aligned, like an entry in a
dictionary.

Choose it over [Fact Card](factCard.md) when the heading is a word to learn rather than a claim
to remember.

```markdown preview
## Riparian buffer {[definitionCard]}

A strip of trees, shrubs, and grasses along a stream bank that filters runoff, cools the water, and holds the soil in place.
```

## How it reads your section

- **Heading** — the term.
- **Body** — the definition. All of the body's text is used, as plain text without formatting,
  so keep it to a sentence or two. A long definition steps its size down to fit.
- **An image** — the first one in the body becomes an accent strip down the left edge (along the
  bottom on a portrait stage), and the entry moves over beside it.

## Examples

### With an origin note

`origin=` adds a muted line under the definition — an etymology, a pronunciation, or a source.

```markdown preview
## Gezellig {[definitionCard origin="Dutch, from gezel, companion"]}

The warm, unhurried feeling of time spent with people you like, somewhere cozy.
```

### Another color

`colorScheme` colors the term and the rule.

```markdown preview
## Estuary {[definitionCard colorScheme=teal]}

The wide lower course of a river, where fresh water meets the tide and mixes with the sea.
```

### With an accent image

```markdown preview
## Understory {[definitionCard]}

![Ferns under old-growth cedar](images/forest.svg)

The layer of shrubs and young trees growing beneath a forest's main canopy.
```

## Parameters

```squisq-docs
template-params
```

These are the values `{[definitionCard]}` reads from its tag. Each is plain text, and a misspelled key is
silently ignored rather than reported:

| Parameter        | What it does                                                         | Values                                                                                                                    |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `origin`         | A muted line under the definition — etymology, pronunciation, source | Text                                                                                                                      |
| `colorScheme`    | Color of the term and the rule under it                              | A [color scheme](../guide/themes.md#color-schemes) name: `blue` (the default), `green`, `purple`, `red`, `orange`, `teal` |
| `term`           | The term, in place of the heading                                    | Text                                                                                                                      |
| `definition`     | The definition, in place of the body                                 | Text                                                                                                                      |
| `imageTreatment` | Regrades the accent image for this block, overriding the theme       | `none`, `mono`, `duotone`, `warm`, `cool`                                                                                 |

The accent image itself comes from the first image in the body.

## Tips

- Always write a definition. A heading-only card repeats the term in the definition slot on a
  slide.
- One term per card. A glossary of five terms is five headings, or a [List](list.md) if the
  definitions are a few words each.
- On a [dashboard](../guide/display-modes.md#dashboard), a short card renders with larger type to
  fill its cell.
- In [page view](../guide/display-modes.md#page), the card becomes a callout with the term as its
  title and the origin beneath.

## Related

- [Fact Card](factCard.md) — a headline fact with a short explanation
- [Stat Highlight](statHighlight.md) — one big number
- [Quote](quote.md) — words someone said, with attribution

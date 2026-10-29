---
template: statHighlight
description: The Stat Highlight block makes one number the whole slide, with a short line saying what it means.
---

# Stat Highlight

Stat Highlight puts a single figure front and center — a percentage, a count, a dollar amount —
with a line of context under it. It is the slide people remember from an annual report or a
funding pitch.

Choose it when one number carries the point. To compare two numbers, use
[Comparison Bar](comparisonBar.md); for a whole table of them, a [chart](barChart.md) or a
[Data Table](dataTable.md).

```markdown preview
## A record year for the pantry {[statHighlight]}

**1.2 million** meals rescued from grocers and served to neighbors.
```

## How it reads your section

The block looks for the number in this order:

1. **A bold number at the start of the first paragraph** — `**42%** of riders…`. The bold run
   becomes the big figure, and the rest of the body becomes the line beneath it (or the heading,
   if the body is only the number). This is the clearest way to write it, and it works for any
   figure, even a bare `**12**`.
2. **A heading that is just a number** — `## 42%`. The body becomes the line beneath.
3. **A number inside the first paragraph** — `Ridership rose 42% this spring.` The figure is
   lifted out, and the sentence that's left becomes the line beneath.

If none of these finds a number, the heading itself is shown as the big figure.

- **Heading** — when the body supplies both the number and its description, the heading isn't
  drawn on the slide. Write it for your outline and for readers of the Markdown.
- **`detail=`** — an optional smaller line under the description, such as a source or a date.
- **An image** — the first one in the body becomes an accent strip down the left edge (along the
  bottom on a portrait stage).

An untagged heading whose body is only paragraphs, with a figure that stands out, becomes a Stat
Highlight automatically (see [automatic templates](../guide/markup.md#automatic-templates)). An
automatic one keeps your heading: it becomes the line under the figure, and the rest of the body
moves down to the detail line.

## Examples

### With a source line and another color

`detail=` adds a smaller line; `colorScheme` colors the figure and that line.

```markdown preview
## Ridership this spring {[statHighlight colorScheme=green detail="Metro Transit, April 2027"]}

**42%** more riders on the Route 7 corridor since the bus lanes opened.
```

### Number in the heading

```markdown preview
## 3× {[statHighlight]}

More visitors to the reading room than in the year before the renovation.
```

### With an accent image

```markdown preview
## Trees planted {[statHighlight]}

**18,400** native trees along four miles of the river.

![Young forest](images/forest.svg)
```

### Portrait

```markdown preview aspect=portrait
## Volunteer hours {[statHighlight]}

**9,250** hours given by 312 volunteers this season.
```

## Parameters

```squisq-docs
template-params
```

`stat` and `description` are normally read from the section as described above; set them on the
tag only to override. `colorScheme` names come from the theme (see
[color schemes](../guide/themes.md#color-schemes)); the default is `blue`.

## Tips

- Bold the number. It is the clearest signal there is: `**$2.4M**`, `**+18%**`, `**3×**`.
  Bold only the figure and its unit — the description is whatever follows.
- Keep the description to a sentence. It shrinks to fit, but a short line reads at a glance.
- In themes with livelier motion — Bold, Documentary, Cinematic, Tech Dark, and Warm Earth — the
  figure counts up from zero as the slide appears.
- A heading-only block such as `## 42% {[statHighlight]}` shows just the figure.
- In [page view](../guide/display-modes.md#page), the block becomes a stat band: the figure, the
  description, and the detail.

## Related

- [Comparison Bar](comparisonBar.md) — two values as proportional bars
- [Fact Card](factCard.md) — a headline fact in words rather than a number
- [Big Text](bigText.md) — gigantic display type for a word or two
- [Charts](../guide/data-and-charts.md#charts) — many numbers at once

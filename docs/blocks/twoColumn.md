---
template: twoColumn
description: The Two Column block sets two short items side by side — two options, a before and after, a this-or-that — each with a label and a line of detail.
---

# Two Column

Two Column puts two things next to each other so the audience compares them at a glance: two
proposals, two eras, the problem and the fix. Each column gets a large label and a short line of
detail, and an arrow between them suggests the move from one to the other.

Use it when the comparison is in words. When it's in numbers, use
[Comparison Bar](comparisonBar.md); when each side needs a paragraph and a picture, use a pair of
[Left Feature](leftFeature.md) and [Right Feature](rightFeature.md) slides.

```markdown preview
## Two routes to the ferry {[twoColumn header="Two routes to the ferry" left="Tram|Extend the line along Harbor Street" right="Shuttle|An electric loop every eight minutes"]}
```

## How it reads your section

The columns come from the tag (or a [data fence](#from-a-data-fence)), not from the body's text:

- **`left=` and `right=`** — each column, written `"Label|Detail"`: the text before the `|` is the
  large label, the text after it the smaller line beneath. Both are required; without them the
  slide is blank.
- **`header=`** — the title above the columns. On a slide this is the only source of the title,
  so repeat your heading here if you want it shown.
- **Body** — not drawn. It still counts toward the slide's timing and the
  [Narrate](../guide/display-modes.md#narrate) script, and stays in Word, PDF, and EPUB exports.

[Page view](../guide/display-modes.md#page) shows the two columns as a pair of cards, using the
heading as their title when `header=` is absent.

## Examples

### Before and after, in your own colors

`leftColor` and `rightColor` color each column's label.

```markdown preview
## Parking reform {[twoColumn header="What changes on Main Street" left="Before|212 free spaces, two-hour limit" right="After|180 metered spaces, 40 bike racks" leftColor=orange rightColor=teal]}
```

### Labels only

The detail after `|` is optional.

```markdown preview
## Then and now {[twoColumn header="The Harbor Street pier" left=1962 right=2027]}
```

### From a data fence

A `json data` fence in the body can supply the same values, which keeps a long tag readable. The
fence itself is never drawn.

````markdown preview
## Two routes {[twoColumn]}

```json data
{
  "header": "Two routes to the ferry",
  "left": { "label": "Tram", "sublabel": "Extend the line along Harbor Street" },
  "right": { "label": "Shuttle", "sublabel": "An electric loop every eight minutes" }
}
```
````

### Portrait

On a tall stage the columns stack, with the arrow pointing down.

```markdown preview aspect=portrait
## Our plan {[twoColumn header="Our plan" left="Phase one|Restore the wetland, 2027" right="Phase two|Open the boardwalk, 2028"]}
```

## Parameters

```squisq-docs
template-params
```

The label and detail are split at the first `|`. `leftColor` defaults to `green` and `rightColor`
to `blue`; scheme names come from the theme (see
[color schemes](../guide/themes.md#color-schemes)). In a `json data` fence, each column is an object
with `label` and an optional `sublabel` — the format is described under "Structured data fences" in
the [format specification](../SquigglySquare.md).

## Tips

- Keep labels to a word or two and details to one line. The columns are wide, but they are made
  for contrast, not paragraphs.
- The arrow between the columns implies a direction — old to new, problem to fix. For two equal
  options, say so in the header.
- Quote any value that has a space in it: `left="Phase one|Restore the wetland"`.

## Related

- [Comparison Bar](comparisonBar.md) — two numbers as proportional bars
- [List](list.md) — three or more items
- [Left Feature](leftFeature.md) — a picture beside a paragraph
- [Tags](../guide/tags.md) — how tag values and quoting work

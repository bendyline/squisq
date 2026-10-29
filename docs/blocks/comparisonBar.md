---
template: comparisonBar
description: The Comparison Bar block draws two numbers as horizontal bars whose lengths are in proportion, each with a label and its value.
---

# Comparison Bar

Comparison Bar makes a gap visible. Two labeled bars, one above the other, run as long as their
values say — so "34 minutes by car, 21 by bike" stops being two numbers and becomes a shape the
audience sees at once.

Use it for exactly two values. For one number, use [Stat Highlight](statHighlight.md); for three
or more, a [Bar Chart](barChart.md) reads a whole table.

```markdown preview
## Commute times {[comparisonBar leftLabel="By car" leftValue=34 rightLabel="By bike" rightValue=21 unit=min]}
```

## How it reads your section

Everything comes from the tag — or, if you prefer, from a `json data` fence in the body holding the
same keys (see [Two Column](twoColumn.md#from-a-data-fence) for the form):

- **`leftLabel` and `leftValue`** — the first bar, on top.
- **`rightLabel` and `rightValue`** — the second bar, below it.
- **`unit`** — an optional unit printed after each value.
- **`colorScheme`** — the bars' colors. The two bars take two shades from the same scheme.

The longer bar spans the available width and the other is drawn in proportion. Neither the heading
nor the body is drawn on the slide; the body still counts toward the slide's timing and the
[Narrate](../guide/display-modes.md#narrate) script, and both stay in Word, PDF, and EPUB exports.

> [!IMPORTANT]
> Set all four of `leftLabel`, `leftValue`, `rightLabel`, and `rightValue`. A Comparison Bar
> missing them shows placeholder bars labeled "A" and "B".

## Examples

### Large numbers

Values from a thousand up are shortened: `652503` shows as `653K`, and millions as `1.2M`.

```markdown preview
## Two cities {[comparisonBar leftLabel=Portland leftValue=652503 rightLabel=Seattle rightValue=755078 colorScheme=green]}
```

### Money

```markdown preview
## Cost per mile {[comparisonBar leftLabel="New road" leftValue=4.2 rightLabel="Bus lane" rightValue=0.6 unit="million dollars" colorScheme=orange]}
```

### Portrait

```markdown preview aspect=portrait
## Water use {[comparisonBar leftLabel="Lawn" leftValue=210 rightLabel="Native garden" rightValue=45 unit=gal colorScheme=teal]}
```

## Parameters

```squisq-docs
template-params
```

Values must be plain numbers — `34`, `4.2`, `652503` — without commas, currency signs, or units;
put the unit in `unit=`. A negative value draws an empty bar. `colorScheme` names come from the
theme (see [color schemes](../guide/themes.md#color-schemes)); the default is `blue`.

## Tips

- Put the larger value where it makes your point. The bars don't reorder, so top and bottom are
  yours to choose.
- In themes with livelier motion, the bars grow in from the left and the values count up.
- Because the heading isn't drawn, the labels must explain themselves. "By car" and "By bike" work;
  "A" and "B" don't.
- In [page view](../guide/display-modes.md#page), the block becomes a stat band showing both values
  with the unit.

## Related

- [Stat Highlight](statHighlight.md) — one number, large
- [Two Column](twoColumn.md) — two items compared in words
- [Bar Chart](barChart.md) — many values from a table
- [Charts](../guide/data-and-charts.md#charts)

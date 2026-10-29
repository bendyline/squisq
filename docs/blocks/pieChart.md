---
template: pieChart
description: The Pie Chart block draws the section's Markdown table as a pie, with one labeled slice for each row.
---

# Pie Chart

Use Pie Chart to show how a whole divides into a few parts: an energy mix, a budget, survey
answers. Each row of your table becomes a slice sized by its share of the total, with a legend
naming them. Pies work best with two to six slices; to compare many categories, or to compare
amounts that aren't parts of one whole, use [Bar Chart](barChart.md). [Donut Chart](donutChart.md)
is the same chart with a hole in the middle.

```markdown preview
## Where the city's electricity comes from {[pieChart]}

| Source      | Share |
| ----------- | ----: |
| Hydro       |   62% |
| Wind        |   21% |
| Solar       |    9% |
| Natural gas |    8% |
```

## How it reads your section

- **Table** — the first Markdown table in the body is the data. Each row is a slice.
- **Labels** — the first column names the slices in the legend, unless `labelColumn` names
  another column.
- **Values** — the first column of numbers after the labels, unless `valueColumns` picks one. A
  pie shows a single series; any further value columns are ignored.
- **Slices** — sized by each value's share of the total, so the values don't need to add up
  to 100. Zero, negative, and non-numeric values are left out.
- **Heading** — the chart's title.
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports, which show the table itself, keep it.

If the section has no table, no column of numbers, or no positive value, it renders as a plain
[Content](content.md) slide instead.

In [page view](../guide/display-modes.md#page) the chart is drawn just as on the slide, and in a
[dashboard](../guide/display-modes.md#dashboard) it's redrawn to fit its cell.

## Examples

### Percentages on the slices

`showValues=true` prints each slice's share of the total as a percentage. Very thin slices are
left unlabeled.

```markdown preview
## How visitors heard about the exhibit {[pieChart showValues=true]}

| Source            | Visitors |
| ----------------- | -------: |
| Friends or family |    1,240 |
| Social media      |      860 |
| Local news        |      410 |
| Walked by         |      290 |
```

### Choosing the column to plot

When the table has several numeric columns, `valueColumns` picks the one the pie shows. The name
must match the column's header exactly, apart from capitalization.

```markdown preview
## Household waste in 2025, in tonnes {[pieChart valueColumns=2025 showValues=true]}

| Stream    |   2024 |   2025 |
| --------- | -----: | -----: |
| Compost   | 18,400 | 21,900 |
| Recycling | 24,100 | 23,600 |
| Landfill  | 31,700 | 27,200 |
```

## Parameters

```squisq-docs
template-params
```

- Write booleans in full: `showValues=true`. A bare `showValues` is ignored.
- `valueColumns` accepts a header name (any capitalization) or a column position counted from 0.
  A pie uses only the first column it names.
- The legend lists every slice and is on by default; `showLegend=false` hides it.
- Slice colors start from the theme's first color scheme, or from `colorScheme` when you set one,
  and move through the theme's other schemes.
- `stacked` and `unit` don't apply to pies.

## Tips

- **Five slices or fewer.** Beyond that, small slices blur together and the legend gets long.
  Fold the smallest into an "Other" row.
- **Order the rows.** Slices are drawn clockwise from the top in table order; putting the
  largest first makes the chart easier to read.
- **Use real parts of a whole.** If the values don't share one total, such as averages or
  rates, a bar chart tells the truth better.

## Related

- [Donut Chart](donutChart.md) — the same chart with a hollow center
- [Bar Chart](barChart.md) — for comparing many categories
- [Stat Highlight](statHighlight.md) — when one share is the whole story
- [Charts](../guide/data-and-charts.md#charts) — all seven chart types and how they read tables

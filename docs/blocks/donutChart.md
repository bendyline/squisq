---
template: donutChart
description: The Donut Chart block draws the section's Markdown table as a ring, with one labeled slice for each row.
---

# Donut Chart

Use Donut Chart to show how a whole divides into a few parts, like a [Pie Chart](pieChart.md),
with a lighter look: the slices form a ring around an open center. It reads the table exactly as
a pie does. Choose it when you want the chart to feel less heavy on the slide, or when the
percentages printed on the ring matter more than the wedge shapes.

```markdown preview
## Where each ticket dollar goes {[donutChart]}

| Use          | Share |
| ------------ | ----: |
| Artists      |   48% |
| Venue & crew |   22% |
| Production   |   17% |
| Free seats   |    8% |
| Office       |    5% |
```

## How it reads your section

- **Table** — the first Markdown table in the body is the data. Each row is a slice of the ring.
- **Labels** — the first column names the slices in the legend, unless `labelColumn` names
  another column.
- **Values** — the first column of numbers after the labels, unless `valueColumns` picks one. A
  donut shows a single series; any further value columns are ignored.
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

### Percentages on the ring

`showValues=true` prints each slice's share in the middle of its band. Very thin slices are left
unlabeled.

```markdown preview
## How residents get to work {[donutChart showValues=true]}

| Mode           | Residents |
| -------------- | --------: |
| Drive alone    |    41,300 |
| Transit        |    22,800 |
| Walk           |     9,600 |
| Bike           |     4,100 |
| Work from home |    18,900 |
```

### A different starting color

`colorScheme` sets the first slice's color; the rest follow the theme's other schemes in order.

```markdown preview
## Museum visitors by ticket type {[donutChart colorScheme=teal showValues=true]}

| Ticket        | Visitors |
| ------------- | -------: |
| Adult         |   18,200 |
| Member        |    9,700 |
| Student       |    6,400 |
| Free Thursday |    7,900 |
```

## Parameters

```squisq-docs
template-params
```

- Write booleans in full: `showValues=true`. A bare `showValues` is ignored.
- `valueColumns` accepts a header name (any capitalization) or a column position counted from 0.
  A donut uses only the first column it names.
- The legend lists every slice and is on by default; `showLegend=false` hides it.
- `stacked` and `unit` don't apply to donuts.

## Tips

- **Five slices or fewer.** Fold small categories into an "Other" row so the ring stays
  readable.
- **Order the rows.** Slices run clockwise from the top in table order.
- **Pair it with a headline number.** A donut leaves its center empty; if one share is the
  story, a [Stat Highlight](statHighlight.md) on the next slide can name it.

## Related

- [Pie Chart](pieChart.md) — the same chart, filled to the center
- [Bar Chart](barChart.md) — for comparing many categories
- [Stat Highlight](statHighlight.md) — one number, big
- [Charts](../guide/data-and-charts.md#charts) — all seven chart types and how they read tables

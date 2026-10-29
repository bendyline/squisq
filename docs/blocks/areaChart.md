---
template: areaChart
description: The Area Chart block draws the section's Markdown table as lines with the area beneath each one filled in.
---

# Area Chart

Use Area Chart when the amount under a line matters as much as its shape: energy produced
through a day, water held in a reservoir, visitors over a season. It reads your table exactly
like a [Line Chart](lineChart.md) does, then fills each line down to zero with a soft wash of its
color. For several series that cross each other often, a plain line chart stays easier to read.

```markdown preview
## Rooftop solar on the longest day {[areaChart unit=kW]}

| Hour  | Output |
| ----- | -----: |
| 6 am  |    0.2 |
| 8 am  |    1.9 |
| 10 am |    4.1 |
| Noon  |    5.6 |
| 2 pm  |    5.2 |
| 4 pm  |    3.6 |
| 6 pm  |    1.4 |
| 8 pm  |    0.1 |
```

## How it reads your section

- **Table** — the first Markdown table in the body is the data. Each row is one point along the
  bottom axis, in table order.
- **Labels** — the first column, unless `labelColumn` names another.
- **Values** — every other column that holds numbers, unless `valueColumns` lists the ones to
  use. Each becomes a line with a translucent fill beneath it; with two or more, a legend names
  them and the fills overlap.
- **Numbers** — cells can carry currency symbols, thousands separators, a percent sign, or
  accounting parentheses. A cell that isn't a number, such as `—`, breaks the line and its fill
  there.
- **Heading** — the chart's title.
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports, which show the table itself, keep it.

Unlike a line chart, the value axis always includes zero, so the filled areas are true to size.

If the section has no table, or no column of numbers, it renders as a plain
[Content](content.md) slide instead.

In [page view](../guide/display-modes.md#page) the chart is drawn just as on the slide, and in a
[dashboard](../guide/display-modes.md#dashboard) it's redrawn to fit its cell.

## Examples

### Two overlapping areas

Each numeric column gets its own fill, so you can see where one exceeds the other.

```markdown preview
## Solar output against household use {[areaChart unit=kW]}

| Hour | Solar | Household |
| ---- | ----: | --------: |
| 6 am |   0.2 |       0.9 |
| 9 am |   3.0 |       1.4 |
| Noon |   5.6 |       1.1 |
| 3 pm |   4.6 |       1.3 |
| 6 pm |   1.4 |       2.8 |
| 9 pm |     0 |       2.2 |
```

### A season of visitors

A single filled series gives a season its shape at a glance. Each point gets a dot when there
are 30 rows or fewer.

```markdown preview
## Weekly visitors to the botanical garden {[areaChart]}

| Week   | Visitors |
| ------ | -------: |
| Apr 6  |    3,100 |
| Apr 20 |    4,800 |
| May 4  |    7,900 |
| May 18 |   10,400 |
| Jun 1  |   12,200 |
| Jun 15 |   11,600 |
| Jun 29 |    9,300 |
| Jul 13 |    8,700 |
```

## Parameters

```squisq-docs
template-params
```

- Write booleans in full: `showValues=true`. A bare `showValues` is ignored.
- `labelColumn` and `valueColumns` accept header names (any capitalization) or column positions
  counted from 0.
- `unit` adds a space and the unit after every tick and value label (`4 kW`).
- `stacked` doesn't apply to areas; overlapping series are drawn over one another, not piled up.

## Tips

- **Two series at most.** Overlapping fills muddy quickly; for more, use a
  [Line Chart](lineChart.md).
- **Put the larger series first.** Later series are drawn on top, so a small series stays
  visible over a big one.
- **Use evenly spaced periods.** Points are spaced by row, not by time.

## Related

- [Line Chart](lineChart.md) — the same data without the fill
- [Column Chart](columnChart.md) — for a few periods, or stacked totals
- [Charts](../guide/data-and-charts.md#charts) — all seven chart types and how they read tables

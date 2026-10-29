---
template: columnChart
description: The Column Chart block draws the section's Markdown table as vertical columns, one column for each row.
---

# Column Chart

Use Column Chart to compare amounts across a handful of categories, above all periods of time:
months, quarters, years. Each row of your table becomes a column standing on a shared baseline,
labeled underneath. When the category names are long, [Bar Chart](barChart.md) gives them more
room; to show a trend over many periods, [Line Chart](lineChart.md) is clearer.

```markdown preview
## Bike-share trips by month {[columnChart]}

| Month     |  Trips |
| --------- | -----: |
| April     | 41,800 |
| May       | 58,300 |
| June      | 72,900 |
| July      | 81,400 |
| August    | 78,600 |
| September | 60,200 |
```

## How it reads your section

- **Table** — the first Markdown table in the body is the data. Each row is a column.
- **Labels** — the first column, unless `labelColumn` names another. They run along the bottom;
  when there are too many to fit, every other one (or fewer) is shown.
- **Values** — every other column that holds numbers, unless `valueColumns` lists the ones to
  use. Two or more value columns draw grouped columns, one color per column, with a legend.
- **Numbers** — cells can carry currency symbols, thousands separators, a percent sign, or
  accounting parentheses. A cell that isn't a number leaves a gap. Negative values hang below
  the baseline.
- **Heading** — the chart's title.
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports, which show the table itself, keep it.

If the section has no table, or no column of numbers, it renders as a plain
[Content](content.md) slide instead.

In [page view](../guide/display-modes.md#page) the chart is drawn just as on the slide, and in a
[dashboard](../guide/display-modes.md#dashboard) it's redrawn to fit its cell.

## Examples

### Stacked columns

`stacked=true` piles the series on top of each other, so each column's height is the row's
total and its segments show the parts.

```markdown preview
## Library visits by branch {[columnChart stacked=true]}

| Quarter | Central | Eastside | Harbor |
| ------- | ------: | -------: | -----: |
| Q1      |  21,400 |    9,800 |  6,100 |
| Q2      |  23,900 |   10,400 |  7,300 |
| Q3      |  26,100 |   11,900 |  8,800 |
| Q4      |  22,800 |   10,100 |  7,000 |
```

### Values on the columns

`showValues=true` prints each value above its column.

```markdown preview
## New housing permits {[columnChart showValues=true]}

| Year | Permits |
| ---- | ------: |
| 2021 |   1,140 |
| 2022 |   1,385 |
| 2023 |     960 |
| 2024 |   1,512 |
| 2025 |   1,730 |
```

### Gains and losses

Negative numbers drop below the baseline, which suits budgets and net change.

```markdown preview
## Net change in members {[columnChart]}

| Month | Change |
| ----- | -----: |
| Jan   |    +84 |
| Feb   |    +31 |
| Mar   |   (12) |
| Apr   |    -47 |
| May   |    +65 |
| Jun   |   +102 |
```

## Parameters

```squisq-docs
template-params
```

- Write booleans in full: `stacked=true`. A bare `stacked` is ignored.
- `labelColumn` and `valueColumns` accept header names (any capitalization) or column positions
  counted from 0.
- The legend appears on its own when there are two or more series; `showLegend=false` hides
  it.
- Value labels aren't printed on stacked columns.
- Axis ticks and value labels shorten thousands and millions: `1,140` shows as `1.1K`.
- `src` reads the data from a file beside the document instead of a table in the body. See
  [data files](../guide/data-and-charts.md#data-files).

## Tips

- **Keep it to about a dozen columns.** Past that, labels thin out and the columns get narrow;
  a [Line Chart](lineChart.md) handles long series better.
- **Short labels fit best.** `Jan` reads better than `January 2025` under a narrow column.
- **Type negatives with a hyphen or parentheses.** `-47` and `(47)` are both read as negative
  numbers; a typographic minus sign (`−47`) isn't read at all.
- **Show the numbers too.** `showTable=true` draws the source table beneath the chart.

## Related

- [Bar Chart](barChart.md) — horizontal bars, for long category names
- [Line Chart](lineChart.md) and [Area Chart](areaChart.md) — trends over many periods
- [Data Table](dataTable.md) — the same table, drawn as a table
- [Charts](../guide/data-and-charts.md#charts) — all seven chart types and how they read tables

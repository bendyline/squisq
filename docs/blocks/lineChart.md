---
template: lineChart
description: The Line Chart block draws the section's Markdown table as lines, one line for each column of numbers.
---

# Line Chart

Use Line Chart to show change over time: temperatures through the year, riders week by week,
prices over a decade. The rows run left to right along the bottom, and each column of numbers
becomes a line, so two or three series are easy to compare. For a few periods where the amounts
themselves matter, [Column Chart](columnChart.md) is often clearer; to stress the volume under a
line, use [Area Chart](areaChart.md).

```markdown preview
## Average daily high {[lineChart unit=°F]}

| Month | Seattle | Phoenix |
| ----- | ------: | ------: |
| Jan   |      48 |      67 |
| Feb   |      51 |      71 |
| Mar   |      55 |      77 |
| Apr   |      60 |      85 |
| May   |      66 |      94 |
| Jun   |      71 |     104 |
| Jul   |      77 |     106 |
| Aug   |      77 |     104 |
| Sep   |      71 |     100 |
| Oct   |      60 |      89 |
| Nov   |      52 |      76 |
| Dec   |      47 |      66 |
```

## How it reads your section

- **Table** — the first Markdown table in the body is the data. Each row is one point along the
  bottom axis, in table order.
- **Labels** — the first column, unless `labelColumn` names another. Labels are spaced evenly,
  so the rows should already be in order and evenly spaced in time.
- **Values** — every other column that holds numbers, unless `valueColumns` lists the ones to
  use. Each becomes a line in its own color; with two or more, a legend names them.
- **Numbers** — cells can carry currency symbols, thousands separators, a percent sign, or
  accounting parentheses. A cell that isn't a number, such as `—`, breaks the line there.
- **Heading** — the chart's title.
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports, which show the table itself, keep it.

The value axis fits the data, so it doesn't have to start at zero. Each point gets a dot when
there are 30 rows or fewer.

If the section has no table, or no column of numbers, it renders as a plain
[Content](content.md) slide instead.

In [page view](../guide/display-modes.md#page) the chart is drawn just as on the slide, and in a
[dashboard](../guide/display-modes.md#dashboard) it's redrawn to fit its cell.

## Examples

### A gap in the data

A missing reading leaves a break in the line instead of a misleading dip to zero.

```markdown preview
## River level at the Cedar Falls gauge {[lineChart unit=ft]}

| Week   | Level |
| ------ | ----: |
| Mar 3  |   6.2 |
| Mar 10 |   7.9 |
| Mar 17 |   9.4 |
| Mar 24 |     — |
| Mar 31 |  11.8 |
| Apr 7  |  10.3 |
| Apr 14 |   8.1 |
```

### Picking the series

`valueColumns` plots only the columns you list, so a table can carry extra numbers.

```markdown preview
## Weekly riders on the waterfront streetcar {[lineChart valueColumns="Weekday,Weekend"]}

| Week   | Weekday | Weekend | Service hours |
| ------ | ------: | ------: | ------------: |
| Jun 2  |  18,400 |   9,200 |           312 |
| Jun 9  |  19,100 |  10,800 |           312 |
| Jun 16 |  20,300 |  12,500 |           318 |
| Jun 23 |  21,700 |  14,100 |           324 |
| Jun 30 |  19,900 |  15,600 |           324 |
```

### Values at each point

`showValues=true` prints each value above its dot. It suits short series.

```markdown preview
## Median home price {[lineChart showValues=true]}

| Year |    Price |
| ---- | -------: |
| 2021 | $612,000 |
| 2022 | $668,000 |
| 2023 | $641,000 |
| 2024 | $655,000 |
| 2025 | $679,000 |
```

## Parameters

```squisq-docs
template-params
```

- Write booleans in full: `showValues=true`. A bare `showValues` is ignored.
- `labelColumn` and `valueColumns` accept header names (any capitalization) or column positions
  counted from 0. Separate several with commas, and quote the list when a name contains a
  space: `valueColumns="Weekday riders,Weekend riders"`.
- `unit` adds a space and the unit after every tick and value label (`60 °F`).
- Axis ticks and value labels shorten thousands and millions: `612,000` shows as `612K`.
- `stacked` doesn't apply to lines.

## Tips

- **Keep it to three lines or so.** More series tangle; split them across two charts.
- **Use evenly spaced periods.** Points are spaced by row, not by date, so skipping a month
  without a row squeezes time.
- **Mark missing data honestly.** Use `—` or leave the cell empty rather than writing `0`.
- **Short labels.** Many rows means narrow spacing; labels thin out automatically when they
  don't fit.

## Related

- [Area Chart](areaChart.md) — the same chart with the area under each line filled
- [Column Chart](columnChart.md) — for a few periods
- [Scatter Chart](scatterChart.md) — for two measurements plotted against each other
- [Charts](../guide/data-and-charts.md#charts) — all seven chart types and how they read tables

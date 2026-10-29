---
template: scatterChart
description: The Scatter Chart block plots the rows of the section's Markdown table as dots, with the first column across and the numbers up.
---

# Scatter Chart

Use Scatter Chart to show how two measurements relate: snowfall against elevation, price against
size, hours studied against test scores. Each row of your table becomes a dot, placed across by
its first column and up by its value, so clusters and trends show at a glance. When the first
column is a sequence of dates or periods, a [Line Chart](lineChart.md) usually tells the story
better.

```markdown preview
## Higher stations get more snow {[scatterChart unit=cm]}

| Elevation (m) | Snowfall |
| ------------: | -------: |
|           310 |       42 |
|           540 |       88 |
|           720 |      131 |
|           880 |      162 |
|         1,050 |      214 |
|         1,240 |      268 |
|         1,390 |      305 |
|         1,610 |      361 |
```

## How it reads your section

- **Table** — the first Markdown table in the body is the data. Each row is one dot for every
  value column.
- **Across (x)** — the first column, unless `labelColumn` names another. When most of its cells
  are numbers, dots are placed by those numbers on a numeric scale. Otherwise the rows are spaced
  evenly in table order, with the cells as labels.
- **Up (y)** — every other column that holds numbers, unless `valueColumns` lists the ones to
  use. Each becomes a set of dots in its own color; with two or more, a legend names them.
- **Numbers** — cells can carry currency symbols, thousands separators, a percent sign, or
  accounting parentheses. A row whose cell isn't a number gets no dot.
- **Heading** — the chart's title.
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports, which show the table itself, keep it.

Both axes fit the data, so neither has to start at zero. The axes carry tick values but no
titles, so say what they measure in the heading.

If the section has no table, or no column of numbers, it renders as a plain
[Content](content.md) slide instead.

In [page view](../guide/display-modes.md#page) the chart is drawn just as on the slide, and in a
[dashboard](../guide/display-modes.md#dashboard) it's redrawn to fit its cell.

## Examples

### Two groups

Give each group its own column. A row can leave the other group's cell empty.

```markdown preview
## Apartment rent by size, two neighborhoods {[scatterChart]}

| Size (sq ft) | Eastlake | Ballard |
| -----------: | -------: | ------: |
|          480 |   $1,690 |         |
|          560 |          |  $1,820 |
|          640 |   $1,950 |         |
|          710 |          |  $2,240 |
|          820 |   $2,380 |         |
|          900 |          |  $2,710 |
|        1,050 |   $2,890 |         |
|        1,120 |          |  $3,150 |
```

### Picking the columns

`labelColumn` and `valueColumns` choose the axes when the table has more columns than you want
to plot.

```markdown preview
## Study time and exam scores {[scatterChart labelColumn="Hours studied" valueColumns=Score]}

| Student | Hours studied | Score | Absences |
| ------- | ------------: | ----: | -------: |
| A       |             2 |    61 |        4 |
| B       |             4 |    68 |        2 |
| C       |             5 |    74 |        3 |
| D       |             7 |    79 |        1 |
| E       |             8 |    85 |        0 |
| F       |            10 |    91 |        1 |
```

## Parameters

```squisq-docs
template-params
```

- `labelColumn` and `valueColumns` accept header names (any capitalization) or column positions
  counted from 0. Quote a name that contains a space: `labelColumn="Hours studied"`.
- `unit` applies to the up axis only (`120 cm`).
- The legend appears on its own when there are two or more series; `showLegend=true` adds one
  for a single series, and `showLegend=false` hides it.
- `showValues` and `stacked` have no effect on a scatter chart.

## Tips

- **Name the axes in the heading.** "Snowfall rises with elevation" tells readers what they're
  looking at; the axes themselves are unlabeled.
- **Use enough points.** Six or more rows make a pattern; with three, a table may say it better.
- **Keep the across column numeric.** Text values such as `Small`, `Medium`, `Large` still plot,
  but evenly spaced, which hides real distances.

## Related

- [Line Chart](lineChart.md) — values over time, joined by lines
- [Column Chart](columnChart.md) — comparing amounts by category
- [Charts](../guide/data-and-charts.md#charts) — all seven chart types and how they read tables

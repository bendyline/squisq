---
template: barChart
description: The Bar Chart block draws the section's Markdown table as horizontal bars, one bar for each row.
---

# Bar Chart

Use Bar Chart to compare amounts across categories, especially when the category names are
long: transit lines, neighborhoods, product names. Each row of your table becomes a horizontal
bar, labeled on the left, and the bars are easy to rank at a glance. For time periods along the
bottom, [Column Chart](columnChart.md) reads more naturally; for parts of a whole, try
[Pie Chart](pieChart.md).

```markdown preview
## Weekday riders by line {[barChart]}

| Line        | Riders |
| ----------- | -----: |
| Red Line    | 48,200 |
| Blue Line   | 36,900 |
| Green Line  | 29,400 |
| Orange Line | 18,750 |
```

## How it reads your section

- **Table** — the first Markdown table in the body is the data. Each row is a bar.
- **Labels** — the first column, unless `labelColumn` names another.
- **Values** — every other column that holds numbers, unless `valueColumns` lists the ones to
  use. Two or more value columns draw grouped bars, one color per column, with a legend.
- **Numbers** — cells can carry currency symbols, thousands separators, a percent sign, or
  accounting parentheses: `$48,200`, `12%`, and `(300)` all read as numbers. A cell that isn't a
  number, such as `—` or `n/a`, leaves a gap. Suffixes like `5K` aren't read.
- **Heading** — the chart's title.
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports, which show the table itself, keep it.

If the section has no table, or no column of numbers, it renders as a plain
[Content](content.md) slide instead.

In [page view](../guide/display-modes.md#page) the chart is drawn just as on the slide, and in a
[dashboard](../guide/display-modes.md#dashboard) it's redrawn to fit its cell.

## Examples

### Value labels and a unit

`showValues=true` prints each bar's value at its end, and `unit` adds a unit after every number.

```markdown preview
## Average commute by neighborhood {[barChart showValues=true unit=min]}

| Neighborhood     | Commute |
| ---------------- | ------: |
| Ballard          |      31 |
| Capitol Hill     |      22 |
| Columbia City    |      28 |
| West Seattle     |      37 |
| University Dist. |      19 |
```

### Two series

Each numeric column becomes its own bar in a group, with a legend.

```markdown preview
## Riders before and after the bus redesign {[barChart]}

| Route    |   2024 |   2025 |
| -------- | -----: | -----: |
| Route 7  | 11,200 | 13,900 |
| Route 40 |  8,600 | 10,100 |
| Route 44 |  7,300 |  7,800 |
| Route 62 |  5,100 |  6,700 |
```

### Stacked bars

`stacked=true` stacks the series end to end, so each bar's length is the row's total.

```markdown preview
## Where weekday trips start {[barChart stacked=true]}

| Station      |  Walk |   Bus |  Bike |
| ------------ | ----: | ----: | ----: |
| Westlake     | 9,400 | 6,100 |   800 |
| Capitol Hill | 7,800 | 2,900 | 1,100 |
| U District   | 6,200 | 3,400 |   950 |
| Beacon Hill  | 2,100 | 1,800 |   300 |
```

## Parameters

```squisq-docs
template-params
```

- Write booleans in full: `showValues=true`. A bare `showValues` is ignored.
- `labelColumn` and `valueColumns` accept header names (any capitalization) or column positions
  counted from 0. Separate several with commas, and quote the list when a name contains a
  space: `valueColumns="Walk,Park and ride"`.
- The legend appears on its own when there are two or more series. `showLegend=true` adds one
  for a single series; `showLegend=false` hides it.
- Value labels aren't printed on stacked bars.
- Axis ticks and value labels shorten thousands and millions: `48,200` shows as `48K`.
- `src` reads the data from a file beside the document instead of a table in the body. See
  [data files](../guide/data-and-charts.md#data-files).

## Tips

- **Sort the rows.** Bars are drawn in table order, top to bottom. Sorting largest first makes
  the ranking obvious.
- **Keep labels short.** Long category names get a wide label column, which narrows the bars.
- **Watch the unit.** `unit` adds a space and the unit after every number (`31 min`), so it
  suits words and symbols that follow a number. For money, put the symbol in the column header
  instead.
- **Show the numbers too.** `showTable=true` draws the source table under the chart, handy when
  readers need exact values.

## Related

- [Column Chart](columnChart.md) — vertical columns, for time periods
- [Comparison Bar](comparisonBar.md) — just two values side by side
- [Data Table](dataTable.md) — the same table, drawn as a table
- [Charts](../guide/data-and-charts.md#charts) — all seven chart types and how they read tables

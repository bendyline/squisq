---
template: dataTable
description: The Data Table block shows the section's Markdown table as a clean, themed table with a colored header row.
---

# Data Table

Use Data Table when the numbers themselves are the point: a schedule, a price list, a
comparison readers will scan row by row. It takes the ordinary Markdown table in your section
and draws it with a themed header row, quiet row shading, and the heading as its title. When the
shape of the data matters more than the exact values, chart it instead with
[Bar Chart](barChart.md) or one of the other [charts](../guide/data-and-charts.md#charts).

```markdown preview
## Ferry routes at a glance {[dataTable]}

| Route                  | Crossing | Daily sailings | Adult fare |
| ---------------------- | -------: | -------------: | ---------: |
| Seattle – Bainbridge   |   35 min |             23 |      $9.85 |
| Edmonds – Kingston     |   30 min |             18 |      $9.85 |
| Mukilteo – Clinton     |   20 min |             36 |      $6.30 |
| Anacortes – Friday Hbr |   65 min |              7 |     $16.40 |
```

A section whose body is only a table gets this template automatically, so the tag is
optional.

## How it reads your section

- **Table** — the first Markdown table in the body. Its first row is the header; the colons in
  the divider row (`---:`, `:---:`) set each column's alignment.
- **Heading** — the title above the table.
- **Other text** — not drawn on the slide. A section with prose besides the table isn't picked
  as a data table automatically.

The title and table are centered together, and the table is sized to its rows. A slide shows
about ten rows; in the player, a longer table scrolls inside its frame.

In [page view](../guide/display-modes.md#page) the table appears in full, with every row.

## Examples

### A different header color

`colorScheme` picks the header color from the theme's palette.

```markdown preview
## Reading room hours {[dataTable colorScheme=green]}

| Day               | Opens   | Closes |
| ----------------- | ------- | ------ |
| Monday – Thursday | 9 a.m.  | 8 p.m. |
| Friday            | 9 a.m.  | 6 p.m. |
| Saturday          | 10 a.m. | 5 p.m. |
| Sunday            | 1 p.m.  | 5 p.m. |
```

### A title that differs from the heading

`title=` replaces the heading on the slide. An empty `title=""` shows the table alone.

```markdown preview
## Q3 results {[dataTable title="Third-quarter revenue by region"]}

| Region    | Revenue | Change |
| --------- | ------: | -----: |
| Northeast |   $4.2M |   +12% |
| Southeast |   $3.1M |    +4% |
| Midwest   |   $2.7M |    −2% |
| West      |   $5.6M |   +18% |
```

## Parameters

```squisq-docs
template-params
```

- `headers` and `rows` come from the Markdown table; you only set them when the data arrives
  some other way, such as a `json data` fence.
- `sheet`, `anchor`, `role`, `headerRow`, and `titleAnchor` record where a table came from in an
  Excel workbook. Importing an `.xlsx` file writes them so exporting can put each table back in
  place; they don't change how the table looks.
- `src` points at a data file stored beside the document (`.csv`, `.tsv`, `.xlsx`, or
  `.parquet`) instead of a table in the body. The slide shows the first rows, and `sort` and
  `filter` shape which rows those are. See [data files](../guide/data-and-charts.md#data-files).

## Tips

- **Keep slide tables small.** Four to eight rows and a handful of short columns read from the
  back of a room. Put the full table in page view or an export, and show the highlights on the
  slide.
- **Right-align numbers.** Use `---:` under numeric columns so the digits line up.
- **Big data belongs in a file.** A table with hundreds of rows is easier to keep in a CSV or
  spreadsheet beside the document, referenced with `src=`.
- **Chart it too.** The same table under a [Bar Chart](barChart.md) heading becomes a chart; add
  `showTable=true` there to show the numbers beneath the bars.

## Related

- [Bar Chart](barChart.md), [Column Chart](columnChart.md), [Line Chart](lineChart.md) — the same
  table, drawn as a chart
- [Comparison Bar](comparisonBar.md) — two values side by side
- [Data and charts](../guide/data-and-charts.md#charts) and
  [data files](../guide/data-and-charts.md#data-files)
- [Automatic templates](../guide/markup.md#automatic-templates)

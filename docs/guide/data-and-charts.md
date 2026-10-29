---
title: Data and charts
description: Show tables, turn them into charts, and keep large data sets in files beside your document.
---

# Data and charts

Tables in Squiggly Square are ordinary Markdown tables. Put one in a section and it becomes a data
table slide; tag the section with a chart and the same table becomes a chart. When a table is too
big to keep in the document, it lives in a file beside it and the document points to it.

## Tables

Write a table with pipes and a separator row. A colon in the separator row aligns the column:
`:---` left, `:---:` center, `---:` right.

```markdown preview
## Moorings by pier

| Pier  | Berths | Occupied | Waiting list |
| :---- | -----: | -------: | -----------: |
| North |     42 |       39 |           12 |
| South |     36 |       30 |            4 |
| East  |     28 |       28 |           19 |
```

A section whose body is a table is shown as a [data table](../blocks/dataTable.md) automatically.
Tag the heading `` `{[dataTable]}` `` to choose it yourself — for example, to add a `colorScheme`
for the header row. In the Page and Document views a table is an ordinary HTML table that scrolls
with the page.

To add a table in the editor, use **Insert → Table**. To turn existing text into one, select lines
whose cells are separated by tabs, commas, pipes, or runs of spaces, and choose **Insert → Convert →
Table**; the first line becomes the header row.

## Charts

A chart block draws the table in its body. Tag a section's heading with the chart you want and
write the table beneath it:

```markdown preview
## Vessel arrivals by quarter {[columnChart]}

| Quarter | Cargo | Ferries | Cruise |
| ------- | ----: | ------: | -----: |
| Q1      |   118 |     342 |     12 |
| Q2      |   131 |     410 |     38 |
| Q3      |   126 |     455 |     51 |
| Q4      |   109 |     361 |     17 |
```

The first column labels the bars, and every other column of numbers becomes a series. Each series
gets a color from the theme, and a chart with more than one series gets a legend.

| Block                                           | Draws                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`{[barChart]}`](../blocks/barChart.md)         | Horizontal bars, one per row                                                             |
| [`{[columnChart]}`](../blocks/columnChart.md)   | Vertical columns, one per row                                                            |
| [`{[lineChart]}`](../blocks/lineChart.md)       | A line per value column                                                                  |
| [`{[areaChart]}`](../blocks/areaChart.md)       | A filled area per value column                                                           |
| [`{[pieChart]}`](../blocks/pieChart.md)         | A slice per row, from the first value column                                             |
| [`{[donutChart]}`](../blocks/donutChart.md)     | A pie with a hole                                                                        |
| [`{[scatterChart]}`](../blocks/scatterChart.md) | A point per row: x from the label column when it holds numbers, y from each value column |

**Insert → Chart** offers each type with a starter table you can edit.

### Chart settings

| Setting        | Charts         | What it does                                                                                                                 |
| -------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `labelColumn`  | All            | The column that labels the rows: a header name or a 0-based index. Default: the first column                                 |
| `valueColumns` | All            | The columns to plot, comma-separated names or indexes. Default: every numeric column but the label column                    |
| `stacked`      | Bar and column | `true` stacks the series instead of placing them side by side                                                                |
| `showTable`    | All            | `true` shows the table beneath the chart                                                                                     |
| `showLegend`   | All            | `false` hides the legend; `true` shows one even for a single series                                                          |
| `showValues`   | All            | `true` prints each value on its bar or point, and each slice's percentage on a pie or donut. Stacked bars don't print values |
| `unit`         | All            | A unit written after every axis and value label, such as `km` or `t`                                                         |
| `colorScheme`  | All            | The theme color scheme the series colors start from                                                                          |
| `title`        | All            | A title to use instead of the heading                                                                                        |

A setting goes in the tag as `key=value`; quote a value that contains spaces:

```markdown preview
## Cargo handled {[barChart valueColumns="Containers,Bulk" stacked=true unit=kt]}

| Terminal  | Containers | Bulk | Staff |
| --------- | ---------: | ---: | ----: |
| Westquay  |        420 |  160 |    85 |
| Eastquay  |        310 |  290 |    64 |
| Riverside |        120 |  340 |    41 |
```

Here `Staff` is numeric too, so `valueColumns` keeps it off the chart.

```markdown preview
## Where our visitors come from {[pieChart showValues=true]}

| Region        | Visitors |
| ------------- | -------: |
| Local         |     4200 |
| Elsewhere     |     2600 |
| International |     1100 |
```

```markdown preview
## Water level at the gauge {[lineChart unit=m showTable=true]}

| Hour  | Inner harbor | Outer mole |
| ----- | -----------: | ---------: |
| 06:00 |          1.2 |        1.4 |
| 09:00 |          2.8 |        3.1 |
| 12:00 |          3.9 |        4.2 |
| 15:00 |          2.6 |        2.9 |
| 18:00 |          1.1 |        1.3 |
```

### How numbers are read

Cells are text, so the chart reads each one as a number when it can. Currency symbols (`$ € £ ¥`),
a trailing `%`, thousands separators (`1,234` or `1 234`), a leading `+` or `-`, and accounting
negatives (`(300)`) are all understood. `K`, `M`, and `B` suffixes are not — `5m` could be millions
or meters. A cell that isn't a number (`—`, `N/A`, `12 units`) is a gap, never a zero.

A column counts as numeric when at least 60% of its filled cells are numbers. A pie or donut skips
rows that are zero or negative.

If no column of numbers is found, the block shows its body as an ordinary content slide, so a
chart tag never hides your text.

## Data files

A big table doesn't belong inside the document: the editor re-reads the whole document every time
you pause typing. Keep the table in a file beside the document instead and point to it. Squiggly
Square reads CSV (`.csv`), TSV (`.tsv`), Excel (`.xlsx`), and Parquet (`.parquet`) files. Parquet
needs an app that includes Parquet support; without it, the block reports that it can't read the
file.

Data files live in a folder named after the document, `<docname>_files/data/`. A document named
`harbor-report.md` keeps its data in `harbor-report_files/data/`. The reference is a tagged heading
plus a link to the file:

```markdown
## Berth fees, 2026 {[dataTable src=harbor-report_files/data/berth-fees.csv]}

[berth-fees.csv](harbor-report_files/data/berth-fees.csv)
```

`src` is the file's path from the folder that holds the document. The link is for everyone else: a
Markdown viewer that knows nothing about Squiggly Square still shows a working link to the data.

Any table block takes `src` — `dataTable` and all seven charts:

```markdown
## Fees by vessel type {[barChart src=harbor-report_files/data/berth-fees.csv labelColumn="Vessel type" valueColumns=Fee]}

[berth-fees.csv](harbor-report_files/data/berth-fees.csv)
```

### Adding a data file in the editor

Drop a `.csv`, `.tsv`, `.xlsx`, or `.parquet` file on the editor, upload it in the Files panel, or
choose it with **Insert → File**. The editor stores it in the document's data folder and inserts the
heading and link for you, titled with the file's name. Opening a CSV or TSV file as a document does
the same: the document is one reference to the file. Importing a large spreadsheet keeps the
workbook as a data file; see [Import and export](import-export.md).

### Settings

| Setting       | What it does                                               |
| ------------- | ---------------------------------------------------------- |
| `src`         | The data file's path                                       |
| `sheet`       | The worksheet to read in an `.xlsx` file                   |
| `anchor`      | The top-left cell of the table in that sheet, such as `B4` |
| `headerRow`   | `false` when the first row is data, not column names       |
| `previewRows` | How many rows the preview shows (default 50)               |
| `sort`        | The row order, below                                       |
| `filter`      | Which rows to show, below                                  |

```markdown
## Q3 revenue {[dataTable src=harbor-report_files/data/finance.xlsx sheet=Revenue anchor=B4]}

[finance.xlsx](harbor-report_files/data/finance.xlsx)
```

### Previews

Slides, the Page view, and dashboards show a preview: the first 50 rows of the file (or
`previewRows`), after any sort and filter. A chart plots the same rows. The file itself is never
changed by a preview, and the preview is never written into the document.

If the file is missing or can't be read, the block shows its heading and link instead, and the Write
view's grid card says what went wrong.

### Sort and filter

`sort` and `filter` choose what the preview shows. They're part of the document: everyone who opens
it sees the same view, and exports use it too.

```markdown
## Busiest berths {[dataTable src=harbor-report_files/data/berth-fees.csv sort=Fee:desc,Berth filter=Region=West;Fee>=1000]}

[berth-fees.csv](harbor-report_files/data/berth-fees.csv)
```

**Sort** lists columns, separated by commas, each optionally followed by `:asc` or `:desc` (ascending
is the default). `sort=Fee:desc,Berth` sorts by fee, highest first, then by berth. Empty cells sort
last.

**Filter** lists conditions separated by semicolons; a row must meet all of them.

| Condition                                        | Keeps rows where the column…                               |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `Region=West`                                    | equals the value                                           |
| `Region!=West`                                   | doesn't equal the value                                    |
| `Berth~North`                                    | contains the value                                         |
| `Berth!~North`                                   | doesn't contain the value                                  |
| `Berth^~North`                                   | starts with the value                                      |
| `Berth$~quay`                                    | ends with the value                                        |
| `Fee>1000`, `Fee<1000`, `Fee>=1000`, `Fee<=1000` | compares as a number (or alphabetically, in a text column) |
| `Notes=""`                                       | is empty                                                   |
| `Notes!=""`                                      | isn't empty                                                |

Text matches ignore case. Add `*` after the operator to match case exactly: `Region=*West`. Column
names must match the header text exactly. A name or value that contains a comma, semicolon, colon,
operator character, or quote goes in double quotes, with any quote inside doubled:
`sort="Ratio A:B":desc`.

A filter value with spaces, or a filter like `Notes=""`, needs the whole setting quoted in the tag:
`filter="Vessel type~ferry"`, `filter='Notes=""'`. A condition that names a column the file doesn't
have is dropped, and the editor reports it.

`sort` and `filter` apply to data files. A table written in the document is shown in the order you
wrote it.

### Working with data in the Write view

In the Write view, a data file reference becomes a grid of the whole file, however large, under a
strip with the file's name, size, and row and column counts.

- **Sort**: click a column header. **Filter**: type in the box under a header, choose an operator
  from the menu beside it (contains, equals, starts with, is empty, and so on), or pick from the
  column's values with the button after it. When the heading owns the file, the grid writes your
  sort and filter into the heading as `sort=` and `filter=`, and **Undo** takes them back.
- **Edit**: double-click a cell, press **Enter** or **F2**, or just start typing. Edits collect in a
  bar that counts them, with **Save** and **Discard**; Ctrl/⌘+Z undoes the last one. Saving rewrites
  the file in place, keeping its delimiter, line endings, and encoding, and first keeps a backup of
  the previous version in the document's `.versions/data/` folder (the last three are kept).
- **Copy and paste**: copy a selection to paste into a spreadsheet, or paste a block of cells from
  one at the selected cell, as one undoable step.
- CSV and TSV files are fully editable. An edited text cell that starts like a formula (`=`, `+`,
  `-`, or `@`) is saved with a leading `'`, so a spreadsheet won't run it.
- Parquet files are read-only.

### Excel formulas

An `.xlsx` data file keeps its formulas. In the grid, formula cells show their result in italics,
with the formula as a tooltip. Edit one and you see `=` and the formula; change it, or change a cell
it depends on, and every dependent cell recalculates as you go. Saving writes only the cells you
changed back into the workbook, with their new results, and asks Excel to recalculate when it next
opens the file.

Date cells and the first cell of a shared (filled-down) formula stay locked. A workbook too large to
recalculate quickly opens for editing values only.

### Data files in exports

What happens to a data file depends on the format:

| Format                                          | The data file…                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ZIP and `.dbk` containers                       | Travels inside, at the same path                                                                              |
| HTML with assets (`.html.zip`) and HTML bundles | Travels beside the page, so the link still works                                                              |
| XLSX and CSV                                    | Becomes its full table of values; XLSX puts it back at its `sheet` and `anchor`. Formulas become their values |
| Single-file HTML and EPUB                       | Stays behind; the export warns that the link won't resolve                                                    |
| DOCX and PDF                                    | Stays behind; the heading and link remain                                                                     |
| PPTX                                            | Stays behind; the heading remains                                                                             |

[Import and export](import-export.md) has the full picture for every format.

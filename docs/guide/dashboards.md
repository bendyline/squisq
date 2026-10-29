---
title: Dashboards
description: Arrange every block of a document on one canvas — choose a layout and a cell style, pin blocks to cells, and export the result as an image.
---

# Dashboards

A dashboard puts your whole document on one screen. Each block gets a cell in a grid or mosaic,
is drawn at that cell's size, and sits under a title band with the document's name. There is no
timeline and nothing to click through — it is a status wall, a one-page summary, or a picture
to share.

```markdown preview=dashboard
---
title: Harbor Operations — May
---

## On-time departures {[statHighlight]}

**96%** of ferry sailings left within five minutes of schedule.

## Arrivals by week {[lineChart]}

| Week | Boats |
| ---- | ----- |
| 1    | 212   |
| 2    | 248   |
| 3    | 231   |
| 4    | 295   |

## Notices

- South pier closed for resurfacing until the 20th
- Fuel dock open 06:00–21:00
- New mooring fees from June

## Slack water {[definitionCard]}

The short pause between tides, when the current stops.

## From the harbormaster {[quote]}

> Busiest May in a decade, and not one missed sailing. — Ines Duarte
```

To see a document as a dashboard in the editor, open the **Use** view and choose **Dashboard**
from the mode menu, or set `display-mode: dashboard` in its frontmatter. See
[Display modes](display-modes.md#dashboard).

## How a dashboard is built

- **The blocks are the slideshow's.** Each block uses the same template it has as a slide, so a
  tag you chose for the slideshow carries over. The cover slide is not shown.
- **Each block is drawn for its cell.** A block in a tall, narrow cell lays itself out for a
  tall, narrow space, rather than shrinking a full slide.
- **The title band** shows the document's title across the top. A first block that only
  repeats the title is folded into the band.
- **There is no clock.** Videos show a still frame and narration does not play.

## Layouts

A layout is a set of cells. The built-in layouts, from fewest cells to most:

| Layout    | Id          | Cells | Arrangement                              |
| --------- | ----------- | ----- | ---------------------------------------- |
| Focus     | `focus-1`   | 1     | One block fills the dashboard            |
| Split     | `split-2`   | 2     | Two blocks side by side                  |
| Hero + 2  | `hero-left` | 3     | A large lead block with two companions   |
| Grid 2×2  | `grid-2x2`  | 4     | Four blocks in a balanced grid           |
| Hero band | `hero-top`  | 4     | A wide lead band with three blocks below |
| Mosaic    | `mosaic-5`  | 5     | A hero block beside a 2×2 grid           |
| Grid 3×2  | `grid-3x2`  | 6     | Six blocks in three columns              |
| Grid 3×3  | `grid-3x3`  | 9     | Nine blocks in a square grid             |
| Grid 4×3  | `grid-4x3`  | 12    | Twelve blocks in four columns            |
| Grid 4×4  | `grid-4x4`  | 16    | Sixteen blocks — the densest wall        |

### Automatic layout

Unless you choose one, the dashboard picks the **smallest layout that holds every block**: three
blocks get Hero + 2, five get Mosaic, seven get Grid 3×3 (with two cells left empty). Hero band
is never picked automatically — four blocks get Grid 2×2 — but you can always choose it.

Blocks fill cells in document order, so the first block takes the first (and in the hero
layouts, largest) cell. Put the block you want to lead with first.

A document with more than 16 blocks shows its first 16 in Grid 4×4; the rest are left off. Any
layout you choose that has fewer cells than the document has blocks does the same.

### Choosing a layout

In the editor, Dashboard mode adds a **Layout** picker to the toolbar: **Auto** or any layout,
listed with its number of cells, plus your own layouts under **Custom**. Your choice is saved to
the frontmatter:

```yaml
---
title: Harbor Operations — May
squisq-dashboard-layout: hero-top
---
```

`auto` (the default) picks by block count. An id that matches no layout falls back to automatic.

```markdown preview=dashboard
---
title: Storm Watch
squisq-dashboard-layout: hero-top
---

## Gale warning until 18:00 {[statHighlight]}

**48 knots** forecast at the harbor mouth this afternoon.

## Boats in harbor {[statHighlight]}

**212** vessels moored inside the breakwater.

## Ferry {[statHighlight]}

**3** sailings cancelled.

## Advice

Double your lines and keep clear of the outer wall.
```

### Orientation

The dashboard takes the shape of the editor's **Format** setting — landscape, portrait, square,
or 4:3. Some layouts have their own portrait arrangement (Hero + 2, Hero band, and Mosaic stack
their hero above the rest); the others turn their grid on its side. Square uses the landscape
arrangement.

## The title band

The band shows the document's frontmatter `title`, or the file's name when there is none. Turn it
off with the **Title** checkbox in the toolbar, or in the frontmatter:

```yaml
squisq-dashboard-title: false
```

`true`, `yes`, `on`, and `show` turn it on; `false`, `no`, `off`, and `hide` turn it off. With no
title to show, there is no band and the cells use the full height of the canvas.

## Cell styles

The layout decides where cells go; the **style** decides how each one is dressed. Pick a
**Style** in the toolbar, or set `squisq-dashboard-style`:

| Style        | Value    | Looks like                                                         |
| ------------ | -------- | ------------------------------------------------------------------ |
| Basic        | `basic`  | Blocks fill their cells edge to edge (the default)                 |
| Cards        | `card`   | Each block on a raised, rounded card over a slightly tinted canvas |
| Panels       | `panel`  | Flat outlined panels with an accent rule                           |
| Accent cards | `accent` | Cards tinted with the theme's accent colors in rotation            |

Every style takes its colors, corners, and accents from the [theme](themes.md), so cards in
Gezellig look like Gezellig. The plural spellings (`cards`, `panels`, `accents`) work too.

```markdown preview=dashboard
---
title: Fuel Dock — Week 18
squisq-dashboard-style: card
---

## Diesel sold {[statHighlight]}

**18,200** liters, up 9% on last week.

## Petrol sold {[statHighlight]}

**6,450** liters, about the same as last week.

## Boats served {[statHighlight]}

**412** boats refueled, most of them before 08:00.

## Note

The second pump is back in service after Tuesday's repair.
```

The same dashboard with `squisq-dashboard-style: panel`:

```markdown preview=dashboard nosource
---
title: Fuel Dock — Week 18
squisq-dashboard-style: panel
---

## Diesel sold {[statHighlight]}

**18,200** liters, up 9% on last week.

## Petrol sold {[statHighlight]}

**6,450** liters, about the same as last week.

## Boats served {[statHighlight]}

**412** boats refueled, most of them before 08:00.

## Note

The second pump is back in service after Tuesday's repair.
```

And with `squisq-dashboard-style: accent`:

```markdown preview=dashboard nosource
---
title: Fuel Dock — Week 18
squisq-dashboard-style: accent
---

## Diesel sold {[statHighlight]}

**18,200** liters, up 9% on last week.

## Petrol sold {[statHighlight]}

**6,450** liters, about the same as last week.

## Boats served {[statHighlight]}

**412** boats refueled, most of them before 08:00.

## Note

The second pump is back in service after Tuesday's repair.
```

## Cell zoom

A short block in a big cell can look lost, so the dashboard enlarges the type of short,
text-led blocks — plain content, lists, quotes, definitions, facts, and dates — to 1.5× or 2×.
To keep the dashboard looking even, it uses at most one enlarged size alongside the normal
size. Statistics, charts, images, diagrams, and maps already fill their cells and always stay at
1×.

To turn this off and draw every cell at its normal size:

```yaml
squisq-dashboard-zoom: off
```

`auto` is the default. A [custom layout](#custom-layouts-and-pinned-blocks) can also set the
zoom of individual cells.

## Custom layouts and pinned blocks

When no built-in layout fits, define your own in the frontmatter under
`squisq-dashboard-layouts`. Each layout has a name (lowercase letters, digits, and hyphens), a
label for the picker, and its cells. A cell gives its position and size as percentages of the
area under the title band, and can **pin** a block to itself by number.

```markdown preview=dashboard
---
title: Harbor at a Glance
squisq-dashboard-layout: harbor-wall
squisq-dashboard-layouts: |-
  {
    "harbor-wall": {
      "label": "Harbor wall",
      "cells": {
        "landscape": [
          { "x": "0%", "y": "0%", "width": "64%", "height": "100%", "block": 3 },
          { "x": "66%", "y": "0%", "width": "34%", "height": "49%" },
          { "x": "66%", "y": "51%", "width": "34%", "height": "49%" }
        ]
      }
    }
  }
---

## Boats in harbor {[statHighlight]}

**212** vessels moored tonight.

## Free moorings {[statHighlight]}

**18** of 230 moorings are free tonight.

## Tonight's arrivals {[dataTable]}

| Vessel        | Berth | Due   |
| ------------- | ----- | ----- |
| Marta Grace   | North | 19:40 |
| Island Ferry  | Ferry | 20:15 |
| Northern Star | Fuel  | 21:05 |
| Little Auk    | South | 22:30 |
```

Here the table, the third block, is pinned to the big left cell; the two unpinned cells take the
remaining blocks in order.

| Field                       | What it sets                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`                     | The name shown in the Layout picker (required)                                                                                                                              |
| `description`               | An optional one-line description                                                                                                                                            |
| `cells`                     | `landscape` (required), plus optional `portrait` and `square` arrangements with the same number of cells. Without `portrait`, the landscape cells are turned on their side. |
| `x`, `y`, `width`, `height` | A cell's position and size, as percentages (`"64%"`)                                                                                                                        |
| `block`                     | Pin a block to this cell by its position in the document, starting at 1. A block can be pinned to more than one cell.                                                       |
| `zoom`                      | Pin the cell's type size: `1`, `1.5`, or `2` (or `100`, `150`, `200`). Pinned cells skip automatic zoom, and automatic zoom matches their size.                             |
| `titleSlot`                 | Move or resize the title band: `{ "placement": "bottom", "height": "12%" }` (height up to 40%)                                                                              |
| `auto`                      | `false` keeps the layout out of automatic choice                                                                                                                            |

A layout can have up to 32 cells. Custom layouts are listed under **Custom** in the Layout
picker, take part in automatic choice (ahead of a built-in layout with the same number of
cells), and win if you give one a built-in layout's name. A malformed layout is ignored.

> [!TIP]
> Write the JSON across several lines under `squisq-dashboard-layouts: |-`, as above, or all on
> one line after the key. Each field also has a two-letter short name — `lb` (label), `ce`
> (cells), `ls` (landscape), `wd` (width), `hg` (height), `bk` (block), `zo` (zoom), and so on —
> which keeps a one-line layout compact.

## Exporting a dashboard image

In the editor, Dashboard mode has an **Export dashboard as image** button. The dialog offers:

- **Format** — PNG, JPEG, or WebP.
- **Resolution** — a named size or your own width and height:

  | Resolution  | Size      |
  | ----------- | --------- |
  | HD          | 1280×720  |
  | Full HD     | 1920×1080 |
  | 4K UHD      | 3840×2160 |
  | Square      | 1080×1080 |
  | Square 2K   | 2160×2160 |
  | Portrait    | 1080×1920 |
  | Portrait 4K | 2160×3840 |
  | 4:3         | 1440×1080 |

  A custom size can be 64 to 7,680 pixels on each side, up to about 33 million pixels in all.

- **Layout**, **Style**, and **Title** — starting from the dashboard's current settings.

From the command line, `squisq image` renders the same dashboard to a PNG:

```bash
squisq image harbor-report.md --resolution 4k --style card --layout mosaic-5
```

`--resolution` takes `hd`, `fhd` (the default), `4k`, `square`, `square-2k`, `portrait`,
`portrait-4k`, or `standard`; `--width` and `--height` set a custom size instead. `--title` and
`--no-title` override the title band, and `--theme` renders it in another theme. Without
`--layout` or `--style`, the document's own settings apply. See the [command line](cli.md) for
every option.

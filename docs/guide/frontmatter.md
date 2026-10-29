---
title: Frontmatter
description: Every frontmatter key Squiggly Square reads — document basics, themes, templates, covers, video, dashboards, proofing, and page templates — with values, defaults, and examples.
---

# Frontmatter

**Frontmatter** is a block of settings at the very top of a document, between two lines of three
dashes. It applies to the whole document and is never shown as content.

```markdown preview cover
---
title: Harbor Survey 2026
subtitle: A season of measurements from the north breakwater
squisq-theme: gezellig
---

## Why we measured

Silt has been building up along the north wall since the winter storms.
```

You rarely need to type frontmatter yourself. The editor writes most of these keys when you
change a setting — the theme picker, the **Cover slide** control, **Document settings** — and
leaves out any setting that's at its default, so a document carries only what you chose.

## Writing frontmatter

- One `key: value` per line. Keys are case-sensitive and lowercase.
- Text needs no quotes. Quote a value that would otherwise read as a number or as `true` or
  `false`: `title: "2026"`. (An unquoted `title: 2026` is read as a number, and a title must be
  text, so it's ignored.)
- `true` and `false` are true and false. Words like `yes`, `no`, `on`, and `off` are text, but
  most keys below accept them anyway.
- A line that starts with `#` is a comment.
- A value can run over several lines with `|-`, followed by indented lines. The custom template
  and theme keys use this for readable JSON.
- If a key appears twice, the last one wins.

Many keys also accept an older name without the `squisq-` prefix (`theme`, `cover-slide`,
`dashboard-layout`, and so on). Use the `squisq-` names; when both are present, the `squisq-` key
is the one that counts. The editor removes the old name when it saves a setting.

## A complete example

```yaml
---
title: Harbor Survey 2026
subtitle: A season of measurements from the north breakwater
author: Ines Duarte
display-mode: slideshow
document-render-as: landscape
squisq-theme: documentary
squisq-motion: documentary
squisq-auto-templates: true
squisq-cover-slide: true
squisq-cover-template: bigText
squisq-cover-duration: 3
squisq-captions: social
squisq-video-loop: false
squisq-dashboard-layout: auto
squisq-dashboard-style: card
squisq-dashboard-title: true
squisq-proofing: true
squisq-proof-dialect: British
squisq-proof-dictionary: breakwater, Duarte, Lind
---
```

Most documents need two or three of these. Your own keys can sit alongside them — anything
Squiggly Square doesn't recognize is kept untouched for other tools to read.

## Where a key takes effect

Some keys travel with the document everywhere it goes — the player, exports, and the
[command line](cli.md). Others are **editor settings**: they choose how the editor opens and
previews the document, and exports ignore them. Each table below says which is which.

## Document basics

| Key                  | What it does                                                                         | Values                                                                                                                  | Default                                         | Applies     |
| -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------- |
| `title`              | The document's title, used for the cover, the dashboard title band, and page headers | Text                                                                                                                    | The first top-level heading, else the file name | Everywhere  |
| `subtitle`           | The cover's subtitle                                                                 | Text                                                                                                                    | The first paragraph under the title heading     | Everywhere  |
| `author`             | The author of an EPUB e-book                                                         | Text                                                                                                                    | None                                            | EPUB export |
| `display-mode`       | Which display mode the editor's Use view opens in                                    | See below                                                                                                               | `slideshow`                                     | Editor      |
| `document-render-as` | The stage shape for slides, video, and dashboards                                    | `landscape` (or `16:9`, `widescreen`), `portrait` (`9:16`, `vertical`, `stories`), `square` (`1:1`), `standard` (`4:3`) | `landscape`                                     | Editor      |

`display-mode` values, case-insensitive:

| Value                                           | Opens in                                  |
| ----------------------------------------------- | ----------------------------------------- |
| `slideshow`, `slides`, `presentation`, `deck`   | **Slideshow**                             |
| `video`                                         | **Video**                                 |
| `page`, `paged`, `linear`                       | **Page** — the designed, scrolling page   |
| `document`, `scroll`, `reader`, `plain`, `html` | **Document** — the plain, text-first view |
| `dashboard`, `dash`                             | **Dashboard**                             |
| `flashcards`, `flashcard`, `study`, `quiz`      | **Flashcards**                            |
| `narrate`, `teleprompter`, `prompter`           | **Narrate**                               |

The editor never writes `display-mode` or `document-render-as`: choosing a mode or a shape in
the Use view lasts for your session only. Add the keys yourself to make a document always open
that way. See [Display modes](display-modes.md).

## Theme

| Key                    | What it does                                                                                     | Values                                                           | Default                             | Applies    |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------- | ---------- |
| `squisq-theme`         | The theme the document is drawn in                                                               | A theme id (below), or the id of a custom theme in this document | `standard`                          | Everywhere |
| `squisq-custom-themes` | Themes you designed, stored in the document                                                      | Written by the theme designer                                    | None                                | Everywhere |
| `squisq-motion`        | How much the document moves: whether charts grow, numbers count up, and diagrams draw themselves | `calm`, `documentary`, `vibrant`                                 | The theme's own choice, else `calm` | Everywhere |

The built-in theme ids:

```squisq-docs
theme-list
```

Write the id exactly as shown, in lowercase with hyphens. The editor's preview also forgives
`Warm Earth` or `warm earth`, but exports and the command line need the exact id, and an unknown
id falls back to `standard`. `theme` and `themeId` are older names for `squisq-theme`.

`squisq-custom-themes` holds the full definition of each theme you make with **Create custom
theme** in the editor. Let the editor write it; see [custom themes](themes.md#custom-themes).
`squisq-motion` must be one of the three names exactly, in lowercase.

## Templates

| Key                       | What it does                                                                        | Values                                                 | Default | Applies    |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ | ------- | ---------- |
| `squisq-auto-templates`   | Turns [automatic templates](markup.md#automatic-templates) on or off                | `false`, `off`, `no`, or `0` turn them off (lowercase) | On      | Everywhere |
| `squisq-custom-templates` | Block designs you made, stored in the document so `{[yourName]}` tags work anywhere | Written by the template designer                       | None    | Everywhere |

```yaml
---
squisq-auto-templates: false
---
```

See [Custom templates](custom-templates.md) for designing your own blocks.

## Cover slide

The cover is built from the document's title, subtitle, and first image (see
[the cover](markup.md#the-cover)). These keys are set by the **Cover slide** control in the Use
view.

| Key                     | What it does                                                                                    | Values                                                                                                                            | Default   |
| ----------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `squisq-cover-slide`    | Whether the cover is shown                                                                      | `true` or `false` (also `yes`/`no`, `on`/`off`, `show`/`hide`)                                                                    | `true`    |
| `squisq-cover-template` | How the cover looks                                                                             | `cover` (hero cover), `title`, `sectionHeader`, `imageWithCaption` (needs a picture), `bigText`, `bigTextImage` (needs a picture) | `cover`   |
| `squisq-cover-duration` | Seconds the cover stays up in Video mode and video exports                                      | `0` to `60`                                                                                                                       | `2`       |
| `squisq-cover-playback` | In video, whether the story waits for the cover (`preroll`) or starts underneath it (`overlay`) | `preroll`, `overlay`                                                                                                              | `preroll` |

These apply in the editor, the player, and video exports. PowerPoint export also honors
`squisq-cover-slide`, written as `true`/`false`, `yes`/`no`, or `on`/`off`.

## Video and presentation

| Key                         | What it does                                                                        | Values                                                                                                      | Default        | Applies                                             |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------- |
| `squisq-transform`          | A **Summarize** style that turns the document's highlights into slides              | `documentary`, `magazine`, `data-driven`, `narrative`, `minimal`, `headings-and-features`, `dynamic-slides` | None           | Editor (`dynamic-slides` travels with the document) |
| `squisq-captions`           | Captions in Video mode                                                              | `standard`, `social` (short, two-line captions), or `off`                                                   | `standard`     | Editor                                              |
| `squisq-video-loop`         | Whether Video mode starts over when it reaches the end                              | `true` or `false`                                                                                           | `false`        | Editor                                              |
| `squisq-video-presentation` | Where timed video clips appear: behind the slide, filling the frame, or in a corner | `background`, `full-frame`, `picture-in-picture`                                                            | `background`   | Everywhere                                          |
| `squisq-pip-size`           | Picture-in-picture size                                                             | `small`, `large`                                                                                            | `small`        | Everywhere                                          |
| `squisq-pip-shape`          | Picture-in-picture shape                                                            | `square`, `wide`                                                                                            | `square`       | Everywhere                                          |
| `squisq-pip-position`       | Picture-in-picture corner                                                           | `top-left`, `top-right`, `bottom-left`, `bottom-right`                                                      | `bottom-right` | Everywhere                                          |

`squisq-captions` takes text, so write `off` rather than `false`. Summarize styles never change
your Markdown; they change only what the Use view presents. See [Display modes](display-modes.md)
and [Narration](narration.md).

## Dashboards

These keys shape [Dashboard](dashboards.md) mode — the player's dashboard, the editor, and
dashboard image exports — and are set by the Layout, Style, and Title controls in the Use view.

| Key                        | What it does                                             | Values                                                                                                                                                                | Default |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `squisq-dashboard-layout`  | Which arrangement of cells to use                        | `auto`, a built-in layout (`focus-1`, `split-2`, `hero-left`, `grid-2x2`, `hero-top`, `mosaic-5`, `grid-3x2`, `grid-3x3`, `grid-4x3`, `grid-4x4`), or one of your own | `auto`  |
| `squisq-dashboard-style`   | How each cell is dressed                                 | `basic`, `card`, `panel`, `accent`                                                                                                                                    | `basic` |
| `squisq-dashboard-title`   | Whether the document title runs across the top           | `true` or `false` (also `show`/`hide`)                                                                                                                                | `true`  |
| `squisq-dashboard-zoom`    | Whether short blocks get larger type to fill their cells | `auto` or `off`                                                                                                                                                       | `auto`  |
| `squisq-dashboard-layouts` | Your own layouts, stored in the document                 | See [Dashboards](dashboards.md)                                                                                                                                       | None    |

With `auto`, the dashboard picks the smallest built-in layout that fits your blocks. Blocks beyond
a layout's last cell aren't shown.

## Proofing

These keys control spelling and grammar checking in the editor (see
[proofing](editor.md#spelling-and-grammar)). They don't affect how the document looks anywhere.

| Key                       | What it does                               | Values                                                    | Default                       |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------- | ----------------------------- |
| `squisq-proofing`         | Turns checking on or off for this document | `true` or `false` (also `yes`/`no`, `on`/`off`)           | The editor's own setting (on) |
| `squisq-proof-dialect`    | Which English spelling to check against    | `American`, `British`, `Australian`, `Canadian`, `Indian` | `American`                    |
| `squisq-proof-dictionary` | Words to accept in this document           | Words separated by commas or spaces                       | None                          |

**Add to document word list** in the proofing menu appends to `squisq-proof-dictionary` for you.
Because entries are split at spaces, each word of a name is added separately. Findings you
dismiss with **Ignore** are never written into the document.

## Page templates

| Key                      | What it does                                                  | Values                                                                                                                              | Default |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `squisq-output-template` | The HTML page template an app publishes this document through | A path relative to this document, a path starting with `/` from the top of its folder, or `none` to skip the app's default template | None    |

This key is read by apps that publish documents as HTML pages through a template, not by the demo
editor or the command line. See [HTML page templates](page-templates.md).

## Keys that tools write

You may see a few more keys in documents produced by importers and apps. They're managed for you;
leave them as they are.

| Key                                                                                       | Written by                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `squisq-outside-in`, `squisq-output`, `squisq-output-format`, `squisq-updatefrommarkdown` | Apps that keep a Markdown source beside a Word, PowerPoint, PDF, Excel, CSV, or HTML file, to link the two                                      |
| `squisq-presentation`, `squisq-presentation-hints`                                        | Apps that save a **Dynamic slides** presentation with the document. The editor clears `squisq-presentation` when you change the Summarize style |

Importing a PowerPoint deck also writes `squisq-theme`, `squisq-custom-themes`, and
`squisq-custom-templates` from the deck's own design; see [Import and export](import-export.md).

## Data

There are no frontmatter keys for data. Spreadsheets and CSV files are referenced from a block's
tag instead, such as `{[dataTable src=…]}`; see [data files](data-and-charts.md#data-files).

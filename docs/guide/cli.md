---
title: The command line
description: Install the squisq command and use it to convert, render, tidy and check Squiggly Square documents from a terminal.
---

# The command line

The `squisq` command does from a terminal what the editor's export menus do: turn a document into
Word, PowerPoint, PDF, HTML, EPUB, a spreadsheet, a video or an image, and bring Word, PowerPoint,
PDF, Excel, CSV and HTML files back as Markdown. It's handy for batch jobs, build scripts and CI.

```bash
squisq convert harbor-survey.md -o harbor-survey.docx
```

## Install

Install the command globally with npm:

```bash
npm install -g @bendyline/squisq-cli
squisq --version
```

Or run it without installing, through `npx`:

```bash
npx @bendyline/squisq-cli convert harbor-survey.md -o harbor-survey.pdf
```

It needs Node.js 22.22.2 or later in the 22 line, 24.15.0 or later in the 24 line, or 26 and up.

### What each command needs

Converting documents needs nothing else. Rendering does:

| Command                                         | Needs               |
| ----------------------------------------------- | ------------------- |
| `convert` to documents, `transform`, `validate` | Node.js only        |
| `video`, and `convert -f mp4` or `-f gif`       | FFmpeg and Chromium |
| `image`, and `convert -f png`                   | Chromium            |

- **Chromium** is the headless browser that draws each frame. Install it with
  `npx playwright install chromium`.
- **FFmpeg** encodes video. `squisq` uses the program named by the `SQUISQ_FFMPEG` environment
  variable if you set it, then `ffmpeg` on your `PATH`, then the `ffmpeg-static` npm package if
  you've installed it. Install FFmpeg with `brew install ffmpeg` (macOS), `sudo apt install ffmpeg`
  (Ubuntu) or `winget install ffmpeg` (Windows).

Run [`squisq doctor`](#squisq-doctor) to check both.

## What you can give it

Every command takes a path to one of these:

| Input                                                      | What happens                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A Markdown file (`.md`)                                    | Read as-is. Images, audio, video and data files it references beside it are brought along. |
| `.docx`, `.pptx`, `.pdf`, `.xlsx`, `.csv`, `.html`, `.htm` | Imported to Markdown first, as described in [Import and export](import-export.md).         |
| A container (`.zip`, `.dbk`)                               | Unpacked with all its media, data files and history.                                       |
| A folder                                                   | Every file in it is read, and the document is found inside.                                |
| A Doc JSON file (`.json`)                                  | A document already in Squiggly Square's internal form.                                     |

In a folder or container, the document is the first of `doc.json`, `story.json`, `index.md`,
`doc.md` and `document.md` that exists, else the first `.md` file at the top level. A bare
Markdown file also picks up audio files sitting in the same folder and their `.timing.json`
sidecars, so a [narrated document](narration.md) renders with its voice.

### Output never overwrites

No command replaces an existing file unless you pass `--overwrite` (or `transform --in-place`,
which rewrites its input on purpose). `convert` checks every output
before it starts, so a run that would clobber a file stops at once and exits with status 1.

Progress and status lines go to standard error. Only the results you'd pipe — `transform`'s
Markdown and `validate --json` — go to standard output.

## squisq convert

Convert a document to one or more formats.

```bash
squisq convert harbor-survey.md -o harbor-survey.docx         # one file; format from the extension
squisq convert harbor-survey.md -f pptx,pdf -d exports        # chosen formats into a folder
squisq convert harbor-survey.md                               # the standard set, beside the input
squisq convert harbor-survey.md -t documentary -f pptx        # in a theme
squisq convert harbor-survey.md --transform magazine -f pptx  # restyled as a magazine deck
squisq convert board-deck.pptx -o board-deck.md               # a deck into Markdown
squisq convert board-deck.pptx -o board-deck.dbk              # ...keeping its slide pictures
squisq convert fees.xlsx -o fees.md --no-xlsx-formulas        # a workbook, without formulas tables
squisq convert field-trip/ -f html,epub -d site               # a folder of Markdown and images
```

| Option                   | What it does                                                                                   | Default                 |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------- |
| `-o, --output <file>`    | Write one file. The format comes from its extension (`.html.zip` means `htmlzip`).             | —                       |
| `-f, --formats <list>`   | Comma-separated format ids to write (see below).                                               | The standard set        |
| `-d, --output-dir <dir>` | Folder for the outputs, named `<input name>.<extension>`.                                      | The input's folder      |
| `--overwrite`            | Replace files that already exist.                                                              | Off                     |
| `-t, --theme <id>`       | Render in a [theme](themes.md): a built-in id or a custom theme in the document's frontmatter. | The document's theme    |
| `--transform <style>`    | Restyle the document with a transform style before exporting (see below).                      | None                    |
| `--no-auto-templates`    | Don't pick [blocks automatically](markup.md#automatic-templates) for headings without a tag.   | Automatic               |
| `--no-infer-theme`       | Importing a `.pptx`: don't turn the deck's colors and fonts into a custom theme.               | Inferred                |
| `--no-infer-layouts`     | Importing a `.pptx`: don't tag slides with matching blocks or make custom templates.           | Inferred                |
| `--no-xlsx-regions`      | Importing a `.xlsx`: one table per sheet, instead of one per block of cells.                   | Split                   |
| `--no-xlsx-formulas`     | Importing a `.xlsx`: leave out the companion formulas tables.                                  | Included                |
| `--animations`           | MP4 and GIF: turn slide animations and transitions on.                                         | On for MP4, off for GIF |
| `--no-animations`        | MP4 and GIF: turn them off.                                                                    |                         |

`-o` can't be combined with `-f` or `-d`. An unknown or repeated format id stops the run before
anything is written — `-f docx,pfd` fails with `Unknown format: "pfd" (did you mean "pdf"?)`.

### Format ids

| Id        | Writes                                                            |
| --------- | ----------------------------------------------------------------- |
| `docx`    | Word document                                                     |
| `pptx`    | PowerPoint deck, one slide per block                              |
| `pdf`     | PDF                                                               |
| `html`    | One self-contained web page with the player, opening in Page view |
| `htmlzip` | `.html.zip`: the page, the player script, and every file it uses  |
| `epub`    | EPUB 3 e-book                                                     |
| `dbk`     | Container: the Markdown and all its files, zipped                 |
| `md`      | Markdown                                                          |
| `xlsx`    | Excel workbook of the document's tables                           |
| `csv`     | The document's first table                                        |
| `mp4`     | Video (needs FFmpeg and Chromium)                                 |
| `gif`     | Animated GIF, silent (needs FFmpeg and Chromium)                  |
| `png`     | Picture of the dashboard (needs Chromium)                         |

With neither `-o` nor `-f`, `convert` writes the standard set: `docx`, `pptx`, `pdf`, `html`,
`htmlzip`, `epub` and `dbk`. It never renders video or images unless you ask.

`-f mp4`, `gif` and `png` use fixed defaults — MP4 at 1920×1080 and 30 frames per second, GIF at
960×540 and 10, PNG at 1920×1080 with the document's own dashboard settings. For control over size, captions,
quality or layout, use [`squisq video`](#squisq-video) and [`squisq image`](#squisq-image).

> [!TIP]
> Converting an imported file to `md` writes the Markdown alone; pictures and data files that came
> out of the import aren't written beside it. Convert to `dbk` (or `-o name.zip`) to keep them.
> And `-f md` next to a `.md` input would name the output after the input itself — use `-d` to
> write it somewhere else.

### Transform styles

`--transform` (on `convert`, `video` and `image`) rebuilds the document as slides in a style. It
doesn't touch your file.

| Style                   | What it does                                                               |
| ----------------------- | -------------------------------------------------------------------------- |
| `documentary`           | Conservative: highlights only the strongest stats, dates and quotes        |
| `magazine`              | Visual variety with pull quotes, facts and rich image layouts              |
| `data-driven`           | Aggressively highlights statistics, comparisons and timelines              |
| `narrative`             | Story-driven, with timeline events, quotes and impact moments              |
| `minimal`               | Short highlights and a single brief line per section                       |
| `headings-and-features` | Headings with their images, videos and diagrams; no body prose             |
| `dynamic-slides`        | Generates concise slides and diagrams from the current text and your hints |

Don't confuse these with [`squisq transform`](#squisq-transform), which rewrites the Markdown text
itself.

## squisq video

Render a document to an MP4 video or an animated GIF. A headless browser draws every frame and
FFmpeg encodes them; MP4 carries the narration and media audio, and GIF has no sound.

```bash
squisq video harbor-survey.md                                   # harbor-survey.mp4 beside it
squisq video harbor-survey.md harbor-survey.gif                 # the extension picks GIF
squisq video harbor-survey.md --quality high --fps 60
squisq video harbor-survey.md --orientation portrait --captions social -o reel.mp4
squisq video harbor-survey.md -t cinematic --motion vibrant --cover-preroll 1.5
squisq video harbor-survey.md --format gif --max-colors 128 --dither bayer --bayer-scale 2
squisq video long-tour.md --frames-dir frames                   # keep every frame
squisq video long-tour.md --frames-dir frames --resume          # reuse them after a stop
```

| Option                      | What it does                                                                               | Default                           |
| --------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| `[output]`, `-o, --output`  | Output path ending in `.mp4` or `.gif`. Give one or the other, not both.                   | `<input name>.mp4`                |
| `--format <format>`         | `mp4` or `gif`. Must agree with the output's extension.                                    | From the extension, else `mp4`    |
| `--fps <number>`            | Frames per second: 1–120 for MP4, 1–100 for GIF.                                           | 30 for MP4, 10 for GIF            |
| `--quality <level>`         | MP4 only: `draft`, `normal` or `high`.                                                     | `normal`                          |
| `--orientation <orient>`    | `landscape` or `portrait`.                                                                 | `landscape`                       |
| `--width`, `--height <px>`  | Override the size. Must be an even number of pixels, for MP4 and GIF alike.                | 1920×1080 MP4, 960×540 GIF        |
| `--captions <style>`        | `off`, `standard`, or `social` (Reels-style, at most two lines).                           | `off` for MP4, `standard` for GIF |
| `--animations`              | Turn slide animations and transitions on.                                                  | On for MP4, off for GIF           |
| `--no-animations`           | Turn them off. Media and timing keep playing.                                              |                                   |
| `--motion <profile>`        | Motion profile: `calm`, `documentary` or `vibrant`.                                        | The document's, then the theme's  |
| `--cover-preroll <seconds>` | How long the cover slide shows before the story starts.                                    | 2                                 |
| `-t, --theme <id>`          | Render in a theme.                                                                         | The document's theme              |
| `--transform <style>`       | Restyle with a [transform style](#transform-styles) first.                                 | None                              |
| `--no-auto-templates`       | Don't pick blocks automatically for untagged headings.                                     | Automatic                         |
| `--overwrite`               | Replace an existing output file.                                                           | Off                               |
| `--loop <count>`            | GIF only: `0` repeats forever, `-1` plays once, or a repeat count up to 65535.             | 0                                 |
| `--max-colors <count>`      | GIF only: palette size, 2–256.                                                             | 256                               |
| `--dither <algorithm>`      | GIF only: `bayer`, `sierra2_4a` or `none`.                                                 | `sierra2_4a`                      |
| `--bayer-scale <number>`    | GIF only: strength of `bayer` dithering, 0–5.                                              | 3                                 |
| `--frame-transport <mode>`  | MP4 only: `pipe` streams frames to FFmpeg as they're drawn; `memory` holds them all first. | `pipe`                            |
| `--capture-format <format>` | MP4 only: each frame captured as `png` or `jpeg`. Needs `pipe`.                            | `png` for `high`, else `jpeg`     |
| `--frames-dir <dir>`        | MP4 only: save every frame here and keep it after the render. Needs `pipe`.                | —                                 |
| `--resume`                  | MP4 only: reuse frames an identical earlier render saved in `--frames-dir`.                | Off                               |

Sizes and other settings are checked before the document is read or the browser starts, so a typo
fails in a second rather than after a long render. Documents with Mermaid diagrams are rendered
with a player that includes Mermaid, so the diagrams appear in the video.

## squisq image

Render a document's [Dashboard](dashboards.md) — every block arranged on one canvas — to a PNG.

```bash
squisq image quarterly-review.md                                 # quarterly-review.png, 1920×1080
squisq image quarterly-review.md review-4k.png --resolution 4k
squisq image quarterly-review.md --resolution square --layout grid-2x2
squisq image quarterly-review.md --style card -t gezellig
squisq image quarterly-review.md --width 1280 --height 900 --no-title
```

| Option                     | What it does                                                                                           | Default                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------- |
| `[output]`, `-o, --output` | Output path ending in `.png`. Give one or the other, not both.                                         | `<input name>.png`          |
| `--resolution <preset>`    | A named size (below).                                                                                  | `fhd`                       |
| `--width`, `--height <px>` | A custom size; give both, and not with `--resolution`. 64–7680 pixels a side, at most 33.2 megapixels. | —                           |
| `--layout <id>`            | A dashboard layout: a built-in id, a custom layout in the document, or `auto`.                         | The document's, else `auto` |
| `--style <variant>`        | How each cell is dressed: `basic`, `card`, `panel` or `accent`.                                        | The document's setting      |
| `--title`, `--no-title`    | Show or hide the title band.                                                                           | The document's setting      |
| `--format <format>`        | Output format; `png` is the only one.                                                                  | `png`                       |
| `-t, --theme <id>`         | Render in a theme.                                                                                     | The document's theme        |
| `--transform <style>`      | Restyle with a [transform style](#transform-styles) first.                                             | None                        |
| `--no-auto-templates`      | Don't pick blocks automatically for untagged headings.                                                 | Automatic                   |
| `--overwrite`              | Replace an existing output file.                                                                       | Off                         |

| Resolution    | Size      |
| ------------- | --------- |
| `hd`          | 1280×720  |
| `fhd`         | 1920×1080 |
| `4k`          | 3840×2160 |
| `square`      | 1080×1080 |
| `square-2k`   | 2160×2160 |
| `portrait`    | 1080×1920 |
| `portrait-4k` | 2160×3840 |
| `standard`    | 1440×1080 |

The built-in layouts are `focus-1`, `split-2`, `hero-left`, `grid-2x2`, `hero-top`, `mosaic-5`,
`grid-3x2`, `grid-3x3`, `grid-4x3` and `grid-4x4`; `auto` picks the smallest one that fits your
blocks. Unlike video, odd sizes are fine. [Dashboards](dashboards.md) explains layouts, styles and
the frontmatter that sets them.

## squisq transform

Tidy a Markdown file's text in place or into a new file — one-time clean-ups rather than a change of
look.

```bash
squisq transform field-notes.md --ops unwrap                     # print the result
squisq transform field-notes.md --ops unwrap,cleanup > tidy.md
squisq transform field-notes.md --ops wrap --width 100 --in-place
squisq transform field-notes.md --ops cleanup,condense -o compact.md
```

| Operation  | What it does                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `unwrap`   | Joins hard-wrapped lines so each paragraph is one line. Hard line breaks stay.                          |
| `wrap`     | Wraps paragraph text at `--width` columns on word boundaries. Code, tables and headings aren't touched. |
| `cleanup`  | Rewrites the file in the standard house style: bullets, emphasis, headings, table padding and spacing.  |
| `condense` | Removes table padding and decorative dividers, keeping all the content. Put it after `cleanup`.         |

| Option                | What it does                                                  | Default         |
| --------------------- | ------------------------------------------------------------- | --------------- |
| `--ops <list>`        | Required. Operations to apply, in order, separated by commas. | —               |
| `--width <n>`         | Column width for `wrap`, 20–500.                              | 80              |
| `-o, --output <file>` | Write the result to a file instead of standard output.        | Standard output |
| `--in-place`          | Rewrite the input file. Can't be combined with `-o`.          | Off             |
| `--overwrite`         | Let `-o` replace an existing file.                            | Off             |

Each operation checks that its result still means the same document as its input. If it can't
prove that, the command writes nothing and exits with status 1. A file it can't read exits with
status 2.

## squisq validate

Check a document for mistakes without opening a browser: misspelled block tags (with a suggestion),
block parameters that are unknown, invalid or missing, tags that didn't parse, malformed heading
attributes, connections to blocks that don't exist, duplicate block ids, data fences that won't
parse, and images missing from the document's folder.

```bash
squisq validate harbor-survey.md
squisq validate field-trip.dbk --strict
squisq validate harbor-survey.md --json > report.json
```

```text
warning  line 3  [unknown-template] Unknown template "barCart" — the block will render as a plain fallback card. Did you mean "barChart"?
warning  line 11  [missing-asset] Referenced asset "images/harbor-chart.png" was not found in the bundle

0 error(s), 2 warning(s), 0 info
```

| Option     | What it does                                                          |
| ---------- | --------------------------------------------------------------------- |
| `--json`   | Print the findings as JSON on standard output, for scripts and tools. |
| `--strict` | Fail on warnings as well as errors.                                   |

It exits with 0 when there are no errors, 1 when there are errors (or warnings, with `--strict`),
and 2 when it can't read the input. Information-level notes never fail a run.

## squisq doctor

Check that everything rendering needs is installed.

```bash
squisq doctor
```

```text
Node:     v24.21.0
ffmpeg:   /opt/homebrew/bin/ffmpeg (source: path) — ffmpeg version 8.1
Chromium: available (…/chrome-mac-arm64/Google Chrome for Testing.app/…)
video/gif (ffmpeg + Chromium): ready
image PNG (Chromium only):     ready

✓ All checks passed
```

It reports the Node version, where FFmpeg was found (`env`, `path` or `ffmpeg-static`) and its
version, and whether Chromium launches — with the install command for anything missing. It exits
with 0 only when both FFmpeg and Chromium are ready. An `SQUISQ_FFMPEG` that points at something
that doesn't run is reported as a failure, never skipped.

## For developers

The same conversions and renders are available as a library, `@bendyline/squisq-cli/api`, so a
Node program can call them without starting a process. See
[the CLI API guide](../developers/guides/cli-api.md).

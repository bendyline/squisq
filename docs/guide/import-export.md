---
title: Import and export
description: Which file formats Squiggly Square reads and writes, what survives each conversion, and how to export from the editor or the command line.
---

# Import and export

A Squiggly Square document is Markdown, and every conversion runs through that Markdown. Importing a
Word file turns it into Markdown you can edit; exporting turns your Markdown into a Word file, a
deck, a PDF, a web page, an e-book, a spreadsheet, a video, or an image. Structure and most
formatting come through — headings, emphasis, lists, tables, links, images, footnotes — but no
conversion is a perfect round trip, so the sections below say what each format keeps.

## Formats at a glance

| Format                            | Import                   | Export                      | CLI format id |
| --------------------------------- | ------------------------ | --------------------------- | ------------- |
| Markdown (`.md`)                  | Yes                      | Yes                         | `md`          |
| Word (`.docx`)                    | Yes                      | Yes                         | `docx`        |
| PowerPoint (`.pptx`)              | Yes, with theme + layout | Yes, one slide per block    | `pptx`        |
| PDF (`.pdf`)                      | Yes, best-effort         | Yes                         | `pdf`         |
| HTML, one file (`.html`, `.htm`)  | Yes                      | Yes, with the player inside | `html`        |
| HTML with assets (`.html.zip`)    | —                        | Yes                         | `htmlzip`     |
| Plain HTML and linked-doc bundles | (read as HTML)           | Editor and developer API    | —             |
| EPUB e-book (`.epub`)             | —                        | Yes                         | `epub`        |
| Excel (`.xlsx`)                   | Yes, split into tables   | Yes, tables only            | `xlsx`        |
| CSV (`.csv`)                      | Yes                      | Yes, first table only       | `csv`         |
| TSV (`.tsv`)                      | Editor only              | —                           | —             |
| Parquet (`.parquet`)              | Editor only, as data     | —                           | —             |
| Container (`.zip`, `.dbk`)        | Yes                      | Yes                         | `dbk`         |
| MP4 video                         | —                        | Yes                         | `mp4`         |
| Animated GIF                      | —                        | Yes, silent                 | `gif`         |
| PNG dashboard image               | —                        | Yes                         | `png`         |

"Editor" means the demo editor at the site root; the CLI columns are the
[`squisq convert`](cli.md#squisq-convert) format ids.

## Exporting from the editor

The demo editor's top bar has three file controls.

- **Export…** opens **Export with Options**: choose a **Format** — Word, PowerPoint, PDF,
  Standalone HTML, HTML + Assets (.zip), Content Zip (.zip), or Video / Animated GIF — then a
  **Theme** and an optional **Transform** style, and click **Export**. For the two HTML formats you
  also pick a **Style**: **Rendered** (the interactive player, with a **Mode** of Document or
  Slideshow) or **Plain** (semantic HTML with no scripts, shown in a live preview beside the
  settings). With Plain and HTML + Assets, **Export linked documents** appears when the workspace
  holds other Markdown files; it follows your links to them and bundles every page.
- **↓ Download** offers quick, no-options downloads — Markdown, Word, PowerPoint, PDF, Plain Text,
  Content Zip, Standalone HTML, HTML Zip — plus **Export with options...** and
  **Video / Animated GIF**.
- **↑ Upload** imports a file (see [Importing into the editor](#importing-into-the-editor)).

Use **Export…** for the fullest result: it lets you choose a theme and a transform, and it draws
your diagrams as pictures for Word, PowerPoint and PDF, which can't draw them on their own.

**Video and GIF** open a separate dialog with a format, preset, quality, frame rate, orientation,
captions, audio and animation settings. It renders in the browser — no install needed.

**Images** come from the preview's display modes. In [Dashboard](display-modes.md#dashboard) mode,
**Export dashboard as image** saves the whole dashboard as PNG, JPEG or WebP at a named resolution
or a custom size. In Slideshow, Video and Page modes, the **Cover slide** menu has **Export cover as image…**.

EPUB, XLSX and CSV aren't in the editor's export menus; use the [command line](cli.md) for them.

## Importing into the editor

**↑ Upload** accepts Markdown and text (`.md`, `.markdown`, `.txt`) as-is, and converts `.docx`,
`.pptx`, `.xlsx`, `.pdf`, `.csv`, `.tsv`, `.parquet`, `.html`, `.htm`, `.zip` and `.dbk` to
Markdown, with a progress dialog while it works. Images and other files that come out of the
document — slide pictures, a workbook kept as a data file — become the document's attachments, so
the Markdown's links resolve.

- A CSV, TSV or Parquet file opens as a document whose content _is_ that file: a
  `{[dataTable src=…]}` block pointing at the file, kept under the document's
  `<docname>_files/data/` folder. See [Data files](data-and-charts.md#data-files).
- An XLSX workbook keeps small tables inline and keeps big ones as a data file.
- A PDF with no text layer (a scan) imports empty, and the editor tells you so.

## Format by format

### Word (DOCX)

**Export** writes a Word document styled with your theme's colors and fonts.

- Footnotes become real Word footnotes.
- A [hosted video](media.md#hosted-videos) becomes a Word online video — a poster picture that
  Word can play, linked to the video page, with a caption that names it. Readers that can't play
  it show the linked poster.
- [SVG pictures](diagrams.md#svg-pictures) are embedded as vector art, with a PNG fallback beside
  them for older readers.
- Images stored with the document are embedded.
- Block tags like `{[quote]}` don't change the layout: Word gets the content as a document, and the
  tags aren't printed.
- Diagrams, trees, timelines and Mermaid fences export as their text unless pictures are drawn for
  them, which the editor's **Export…** dialog does.

**Import** reads headings, paragraph text with bold, italic, strikethrough and inline code, links,
lists, tables, block quotes, code blocks, footnotes and endnotes (both as Markdown footnotes), and
embedded images. A Word online video comes back as a link to the video page. A picture that was an
SVG comes back as its PNG fallback.

### PowerPoint (PPTX)

**Export** builds the same deck the [slideshow](display-modes.md#slideshow) shows: one slide per
block, plus the cover slide. Text, shapes and lines stay editable, and type is sized the way the
slideshow sizes it.

- The theme's colors and fonts go into the deck's own theme, and slide backgrounds become real
  PowerPoint backgrounds, so you can click straight through to the content.
- A hosted video becomes a poster picture that opens the video page when clicked.
- SVG pictures are embedded as vector art with a PNG fallback.
- Drawings, timelines and box diagrams become native shapes. Mermaid needs a picture; the editor's
  **Export…** dialog draws one.
- Footnotes are dropped, with a warning.

> [!NOTE]
> Apple's Quick Look shows every gradient as a flat color. Check gradient backgrounds in
> PowerPoint itself.

**Import** turns each slide into a `##` section: the slide's title (or "Slide 3" when it has no
title placeholder), its body text as a list, its tables as tables, and its pictures. By default it
also reads the deck's design:

- **Theme** — the deck's colors and fonts become a [custom theme](themes.md#custom-themes) stored in
  the document's frontmatter and selected as the document theme.
- **Layouts** — slides are tagged with the built-in block their layout matches (`title`,
  `sectionHeader`, `twoColumn`, `leftFeature`, `rightFeature`, `imageWithCaption`, `photoGrid`),
  and distinctive layouts become [custom templates](custom-templates.md).

From the CLI, `--no-infer-theme` and `--no-infer-layouts` turn these off. Pictures on slide layouts
and masters, charts and SmartArt aren't imported. A deck that Squiggly Square exported imports back
as text and pictures, not as your original Markdown.

### PDF

**Export** lays the document out on white pages for printing. Your theme sets the text, heading and
link colors when they're readable on white; the type is PDF's standard fonts, with an embedded
Unicode font for scripts and symbols they can't show. Most emoji and CJK text are replaced, with a
warning.

- Footnote markers print as raised numbers, and each note prints with its number where you wrote
  it — usually the end of the document.
- PNG and JPEG images that stand alone in a paragraph are drawn; other images print as an
  `[Image: …]` note with their alt text.
- Diagrams and SVG pictures print as their source text unless pictures are drawn for them — the
  editor's **Export…** dialog draws all of them.

**Import** is best-effort, because a PDF stores positioned text, not structure. Headings are guessed
from font size, and tables, code blocks, block quotes and links are detected heuristically. Raster
images are extracted and placed after the last text from their page.

### HTML

There are several HTML exports.

| Export                                | What you get                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| One file (`html`)                     | The document and the player in a single `.html` file, with images and media embedded. Opens anywhere, works offline. |
| With assets (`htmlzip`)               | A `.html.zip` holding `index.html`, the player script, and images, audio and data files as separate files.           |
| Plain HTML (editor)                   | Semantic HTML with your theme's styles and no scripts, matching the editor's Document preview.                       |
| Linked documents (editor, plain HTML) | Every document your links reach, each rendered to a page, with `.md` links rewritten to `.html`, in one zip.         |

The player-based exports open in the [Page](display-modes.md#page) view by default; the editor's
**Mode** setting can make them a slideshow instead. Hosted videos play in all of them.

> [!WARNING]
> Mermaid diagrams don't draw in HTML exports: the exported player leaves Mermaid out to stay small,
> and the page shows "Mermaid could not render this diagram" in their place. Draw complex diagrams
> as [box diagrams](diagrams.md#box-diagrams) if the document is headed for HTML.

**Import** cleans the HTML of scripts and anything unsafe, then converts it. A page's footnotes
section — the kind GitHub, Pandoc and EPUB files mark up — comes back as Markdown footnotes, and a
YouTube, Vimeo, Loom or Wistia `<iframe>` comes back as a link to the video.

### EPUB

**Export** writes an EPUB 3 e-book, with chapters split at `#` and `##` headings, your theme's
styles, and images included. Footnotes appear at the end of each chapter as e-book footnotes,
numbered across the whole book. SVG pictures are packaged as SVG images. Hosted videos stay links.
There's no EPUB import.

### Excel (XLSX)

**Import** treats a worksheet as a page of separate tables, not one grid. Each block of cells
surrounded by empty space becomes its own block, tagged with the sheet and cell it came from:

```markdown preview
# Harbor ledger

## Moorings {[dataTable sheet=Harbor anchor=A1]}

| Berth | Vessel | Fee |
| ----- | ------ | --- |
| A1    | Gull   | 120 |
| A2    | Tern   | 95  |

## Fuel {[dataTable sheet=Harbor anchor=E1]}

| Month | Litres |
| ----- | ------ |
| May   | 4200   |
| June  | 5100   |
```

- A title cell above a table becomes the block's heading. Otherwise the heading names the sheet and
  cell, like `Harbor — E1`.
- A table with formulas gets a companion table, tagged `role=formulas`, whose columns are the sheet's
  column letters and whose cells hold the formulas (`=B2*C2`).
- Leftover single cells on a sheet are gathered into one `Cell | Value` table, tagged `role=loose`.
- Superscript and subscript text, such as a footnote marker, is kept as `<sup>` and `<sub>`.
- A very large table stays in the original workbook, kept as a data file beside the document and
  referenced from a `{[dataTable src=…]}` block — see [Data files](data-and-charts.md#data-files).

From the CLI, `--no-xlsx-regions` imports each sheet as one table and `--no-xlsx-formulas` leaves
out the formulas tables.

**Export** writes only tables; everything else is left out, with a warning that counts it. A table
tagged with `sheet` and `anchor` goes back to that sheet and cell; an untagged table gets its own
sheet, named after the heading above it. When any table is tagged, number-looking cells are written
as numbers; otherwise every cell is written as text. A `{[dataTable src=…]}` block exports the data
file's full values, but not its formulas.

### CSV and TSV

**Import** reads one table. A CSV with more than 100 rows (or over 256 KB) is kept as a data file
beside the document; from the editor, opening any CSV or TSV does that. TSV import is in the editor
only.

**Export** writes the document's first table, flattened to plain text, and warns when there are more
tables or none. A `{[dataTable src=…]}` block exports the data file's full values.

### Parquet

The editor opens a `.parquet` file the same way as a CSV: as a document showing the file in a data
table, read-only. There's no Parquet export.

### Containers (ZIP and .dbk)

A container is a ZIP of your document together with everything it uses: images, audio, video, data
files under `_files/data/`, and version history. It's the one export that loses nothing, so use it
to move a document between machines or to keep what an import extracted. The CLI's `dbk` format
writes it (`-o trip.zip` works too), and the editor's **Content Zip** writes the document with its
attachments.

When you import a container, the document inside is found in this order: `doc.json` or `story.json`,
then `index.md`, `doc.md`, `document.md`, then the first `.md` file at the top level.

### Markdown

Markdown export writes the Markdown text alone. When you import a Word file, deck or workbook and
export Markdown from the CLI, the extracted images and data files aren't written next to it —
export a container instead to keep them.

### MP4 and GIF

**MP4** renders the [video](display-modes.md#video) view frame by frame, with narration and media
audio mixed in; from the CLI it's 1920×1080 (or 1080×1920 portrait) at 30 frames per second by
default. **GIF** is silent and smaller; from the CLI it's 960×540 at 10 frames per second, with
captions on and animations off. Both are in the editor's Video /
Animated GIF dialog and in [`squisq video`](cli.md#squisq-video). See [Narration](narration.md) for
narrated video.

### PNG dashboard images

A PNG is a picture of the [Dashboard](dashboards.md) view: every block arranged on one canvas. The
editor saves PNG, JPEG or WebP; the CLI saves PNG with [`squisq image`](cli.md#squisq-image).

## What travels with your document

| Feature                                     | Word                 | PowerPoint            | PDF                       | HTML                                   | EPUB             | XLSX, CSV        |
| ------------------------------------------- | -------------------- | --------------------- | ------------------------- | -------------------------------------- | ---------------- | ---------------- |
| [Theme](themes.md)                          | Colors and fonts     | Colors, fonts, slides | Colors (when readable)    | Full theme                             | Styles           | —                |
| Footnotes                                   | Word footnotes       | Dropped               | Raised numbers and notes  | Footnotes                              | E-book footnotes | — (superscripts) |
| [Hosted videos](media.md#hosted-videos)     | Online video         | Linked poster         | Link                      | Player                                 | Link             | —                |
| [SVG pictures](diagrams.md#svg-pictures)    | Vector, PNG fallback | Vector, PNG fallback  | Source text, or a picture | Picture                                | SVG image        | —                |
| [Diagrams](diagrams.md)                     | Text, or a picture   | Native shapes         | Text, or a picture        | Drawn (not Mermaid)                    | Text             | —                |
| [Data files](data-and-charts.md#data-files) | Heading and link     | Heading               | Heading and link          | Link works in `htmlzip`; not in `html` | Link (broken)    | Full values      |

"Or a picture" means the exporter needs a drawing of the diagram, which the editor's **Export…**
dialog makes and the command line doesn't. A container (`.dbk`) keeps every feature, since it holds
the Markdown and its files unchanged.

## From the command line

`squisq convert` reads any importable file and writes any export format, so you can script every
conversion on this page:

```bash
squisq convert survey.md -o survey.docx          # one file; format from the extension
squisq convert survey.md -f pptx,pdf,epub -d out  # several formats into a folder
squisq convert ledger.xlsx -o ledger.md           # a workbook into Markdown
squisq convert deck.pptx -o deck.dbk              # keep the slide pictures too
squisq video survey.md survey.mp4                 # render the video
squisq image survey.md --resolution 4k            # render the dashboard
```

[The command line](cli.md) covers every command and flag. Developers can call the same converters
from code; see [Converting documents](../developers/guides/conversion.md).

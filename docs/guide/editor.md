---
title: The editor
description: A complete tour of the Squiggly Square editor as the demo ships it — the Write, Source, and Use views, the toolbar and Insert menu, block and theme pickers, attachments, proofing, recording, and keyboard shortcuts.
---

# The editor

The [editor](/) at the root of this site is the full Squiggly Square editor running in your
browser. This page walks through everything in it. If you haven't used it yet,
[Getting started](getting-started.md) is a shorter, hands-on introduction.

Apps that build the editor in can turn features on and off, so an editor elsewhere may look a
little different. This tour describes the demo exactly.

## The top bar

The strip across the top belongs to the demo site, not the editor. It's where you load, save,
and export documents.

| Control                                             | What it does                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docs**                                            | Opens this documentation                                                                                                                                                         |
| **Sample**                                          | Loads a sample document, grouped by topic. The first, **About SquigglySquare (squisq)**, opens by default                                                                        |
| **Show Debug**                                      | Shows the parsed document structure beside the editor, for the curious                                                                                                           |
| **Advanced…**                                       | Chooses the spreadsheet calculation engine for data cards                                                                                                                        |
| **Find**                                            | Opens find and replace (see [Find and replace](#find-and-replace))                                                                                                               |
| **JSON Editor**, **Image Editor**, **Code Context** | Switch the page to demos of other Squisq components; click again to return                                                                                                       |
| **Auto**, **Light**, **Dark**                       | The editor's own color mode                                                                                                                                                      |
| **Write** · Text, Spacing, Theme                    | Text size, line spacing, and how much of the document's theme the Write view borrows                                                                                             |
| **Theme...**                                        | A quick theme customizer for the demo (see [Themes](#themes))                                                                                                                    |
| **Export…**                                         | Export with options: Word, PowerPoint, PDF, standalone HTML, HTML with assets, a content zip, or video                                                                           |
| **↓ Download**                                      | One-click downloads: Markdown, Word, PowerPoint, PDF, plain text, content zip, standalone HTML, HTML zip, or **Video / Animated GIF**                                            |
| **↑ Upload**                                        | Opens a Markdown, text, Word, PowerPoint, Excel, PDF, CSV, TSV, Parquet, HTML, or zip file in place of the current document. With a Storage slot selected, it also adds pictures |
| **Storage**                                         | Ten save slots in your browser. Pick a slot, then **Save**, **Load**, or **Clear**                                                                                               |

Your document lives in the page's memory. Reloading the page, or picking another sample, discards
unsaved changes — save to a **Storage** slot or download a copy first.

## Views

The tabs at the top left of the editor switch between three views of the same document:

| Tab                                    | What it's for                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Write**                              | Visual editing, like a word processor. Headings, lists, tables, and pictures appear formatted |
| **Source**                             | The Markdown itself, with syntax colors and suggestions as you type tags                      |
| **Use** (named after the current mode) | The finished document — as a slideshow, page, video, dashboard, and more                      |

The third tab shows the name of the display mode you're in — **Slideshow** until you choose
another. Click the **▾** beside it, or click the tab again while you're in it, to pick a mode.
Switch views with Ctrl+Shift+1, 2, and 3 (⌘⇧1, 2, and 3 on a Mac).

Changes in one view appear in the others immediately. Write and Source edit the same Markdown,
and Write leaves the parts of your file you didn't touch exactly as they were.

### Layouts: document, block at a time, timeline

**View options** (the eye icon) → **View** changes how Write and Source lay out the document:

- **Document** — the whole document in one scrolling column. The default.
- **Block-at-a-time** — one block on a card, with **Previous**, **Next**, a "Block N of M"
  counter, and **Add block**.
- **Timeline** — a card for the selected block above a timeline of every block and media clip.
  Drag a block's right edge to change its duration, drag clips to move them, drag the playhead to
  scrub, and use **Play**, **Zoom in**, and **Zoom out**. Each block's **⋯** menu sets its
  duration, start time, and transition, or turns on **Autotime block**. The toolbar above the
  track shows or hides the **Video monitor** and **Video composition** panes.

## The toolbar

In Write and Source, the toolbar shows formatting buttons from left to right:

| Group     | Buttons                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Format    | **Bold**, **Italic**, **Strikethrough**                                                              |
| Lists     | **Bullet list**, **Numbered list**                                                                   |
| Structure | **Heading 1**, **Heading 2**, **Heading 3** — H4 to H6 appear once the document uses the level above |
| More      | **Blockquote**, **Inline code**, **Superscript**, **Subscript**, **Horizontal rule**                 |
| Insert    | **+** opens the [Insert menu](#the-insert-menu)                                                      |

In Source, these buttons type the Markdown for you, with placeholder text to replace.

More controls appear when the caret is somewhere that needs them:

- **Block: …** and **Transition: …** when the caret is in a heading — see
  [Choosing a block's template](#choosing-a-blocks-template).
- **Table:** buttons to add or delete rows and columns, or the whole table, when the caret is in
  a table (Write view).
- **Decrease indent** and **Increase indent** in a list (Write view).

On the right are **Custom layouts** (your own block designs), **Transform** (Source view only),
**View options**, **Document settings**, and the paperclip that shows and hides **Attachments**.
When the toolbar runs out of room, buttons fold into a **···** menu, least-used first.

## The Insert menu

**+** opens the Insert menu. When text is selected, it starts with **Convert** options that turn
the selection into a **Table** or **Task List**.

| Item                                    | Inserts                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Link**                                | A link, through a dialog with Text and URL fields                                                                                     |
| **Table**                               | A starter table                                                                                                                       |
| **Task List**                           | A checklist                                                                                                                           |
| **Chart** ›                             | A chart block with a starter table: Column, Bar, Line, Area, Pie, Donut, or Scatter. Edit the table to change the chart               |
| **Diagram**                             | A box-and-line diagram you can edit on a canvas — see [Diagrams](diagrams.md)                                                         |
| **Complex Diagram (Mermaid)** ›         | A Mermaid diagram, from flowcharts and sequence diagrams to Gantt charts, mind maps, and Sankey diagrams                              |
| **Tree**                                | A file or outline tree                                                                                                                |
| **Timeline**                            | A timeline of dated events                                                                                                            |
| **Drawing**                             | A free-form canvas of shapes — see [Drawing](../blocks/drawing.md)                                                                    |
| **Layout**                              | A block of freely placed text and pictures — see [Layout](../blocks/layout.md)                                                        |
| **Image/Media**                         | A picture, video, or audio file from your computer, stored with the document                                                          |
| **File**                                | Any file, stored with the document and linked by name; spreadsheets and CSV files become [data blocks](data-and-charts.md#data-files) |
| **Online Video (YouTube, Vimeo, etc.)** | A hosted video, from its link or embed code — see [hosted videos](media.md#hosted-videos)                                             |
| **Emoji**                               | An emoji or a Font Awesome icon, from a searchable picker                                                                             |
| **Record media**                        | A recording from your microphone, camera, or screen — see [Recording](#recording)                                                     |
| **Document narration**                  | A narration take that plays across the whole document                                                                                 |
| **Code Snippet** ›                      | A code block in one of 23 languages, or generic code                                                                                  |

## Choosing a block's template

Every heading starts a block, and a block's template decides how it looks. There are three ways
to choose one:

- **The heading badge (Write view).** A small badge at the end of the heading shows its template
  — or **Block** when it has none. Click it. By default the badge appears on the heading you're
  in or hovering over; **View options** → **Show block tags** can show it always, or never.
- **The toolbar.** With the caret in a heading, click **Block: …** (Write or Source).
- **Typing the tag.** In Source, type `{[` at the end of a heading and the editor suggests
  template names, then each template's parameters and values.

The block type gallery has a search box, a **— none —** entry for a plain heading, and sections
for **Suggested Block Types** (picked from what's under the heading), **Block Types**, **Custom**,
and **Needs Additional Content** (templates that need something the block doesn't have yet, like
an image). Each card is a live thumbnail of _your_ block in that design.

Choosing a template writes the tag onto the heading, such as `## Results {[statHighlight]}`.
Switching templates keeps the block's timing, transition, and build settings and drops the old
template's parameters.

**Your own block types.** In the gallery opened from a heading badge, **+ New block type** opens
the layout designer, where you place text and pictures with placeholders for the block's title
and content, then **Save to this doc** or **Save to library** (your browser). The **Custom
layouts** toolbar button lists them. See [Custom templates](custom-templates.md).

### Block properties

Next to the heading badge in Write is a sliders badge. It opens **Block properties**:

| Field                                           | Sets                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Transition**                                  | How the block arrives, with a direction and duration where they apply                                   |
| **Build**                                       | Reveal the content in steps: Default, Show all, Each list item, Each list branch, or Each content chunk |
| **Entrance**, **Build time**, **Earlier items** | When a build is on: how each step appears, how long it takes, and whether earlier steps stay or dim     |
| **Duration**                                    | Seconds the block plays in Video mode; empty means automatic                                            |
| **Start time**                                  | Pins the block's start on the timeline                                                                  |

These write the [block settings](tags.md#block-settings) into the heading for you. The
**Transition: …** toolbar control and its searchable picker set the same transition.

## Themes

A theme dresses the whole document: colors, fonts, and motion. You choose it in the **Use** view:

- **Theme:** in the Use toolbar opens the theme picker, a grid of the built-in themes with their
  colors. Choosing one writes `squisq-theme` into the document's frontmatter.
- The **pencil** beside it (**Edit this theme**) opens the theme designer on a copy of the
  current theme.
- **+ Create custom theme…** at the bottom of the picker opens the designer from scratch.

The designer docks beside the preview, so you see each change live. It has a name, a **Base
theme** to inherit motion and layout from, **Import from file** (pull colors and fonts from a
Word, PowerPoint, or Excel file — a PowerPoint deck's slide layouts come along as custom
layouts), **Colors**, **Accents**, **Typography**, and **Style** (corner radius, animation, text
shadow, contrast, and image grade). Save to the document or to your browser's library. See
[Themes](themes.md).

**Document settings** also has a **Theme** picker, with a **Default** entry that removes the
document's theme choice.

> [!NOTE]
> The demo's own **Theme...** button in the top bar is a separate, quick customizer. Once you
> edit anything in it, its theme **replaces the document's theme in every view** until you click
> **Reset** in that panel. If the theme picker seems to have no effect, check there.

## Outline and block previews

**View options** has two side panes:

- **Show outline** — the document's headings as a tree on the left. Click a heading to jump to
  it, drag one to move its whole section, and use the arrows to promote or demote it.
- **Show block previews** — a small preview of each block beside the text; click one to scroll
  to it. In the block-at-a-time and timeline layouts, it shows a large preview of the current
  block instead.

**On a narrow screen** (720 pixels wide or less) both panes are hidden. On a touch screen, swipe in
from the right edge of the editor to pull out the **navigation sheet**: it opens on the
**Outline**, and turning your swipe downward partway opens **Previews** instead. Swipe it back
to the right, tap the document beside it, press Escape, or pick a section to close it.

## Attachments and drag-and-drop

Pictures, recordings, and data files you add are stored _with_ the document. The paperclip on the
toolbar shows and hides the **Attachments** panel, with a count of the files.

The panel lists each file with a thumbnail or icon, its size, a download button, and an
**Unused** badge if nothing in the document refers to it. Click a picture to see it full size, or
a video or audio file to play it. Use **+ Upload** to add files, or **Record** to make a
recording. Drag a file from the panel into the text to insert it.
Right-click a file to remove it — which also removes it from the document.

Dropping files onto the editor:

- **Pictures, video, and audio** dropped into the Write view are uploaded and inserted where you
  drop them.
- Other drops — and any drop in Source — show three targets: **Media** (add to the attachments),
  **Insert** (insert at the cursor), and **Replace** (replace the whole document).
- **Markdown, text, and Word files** insert their content; **Replace** swaps the document for the
  first one.
- **Spreadsheets and CSV files** are stored beside the document and inserted as a
  [data block](data-and-charts.md#data-files), shown in Write as a live grid you can sort and
  filter (and, for CSV and Excel files, edit).
- **Anything else** is attached and linked by its file name.

You can also paste a picture from the clipboard into the Write view. Copy and paste a picture,
video, or audio clip between documents, and its file comes along.

## Find and replace

The **Find** button in the demo's top bar opens the find bar in place of the formatting toolbar:

- Type in **Find in document**; the count shows "N of M".
- **Aa** matches case and **ab** matches whole words.
- Enter and Shift+Enter move to the next and previous match; Esc closes the bar.
- The **▸** toggle opens **Replace**, with **Replace** (Enter) and **Replace all** (Ctrl+Enter).

Find works in all three views; in the Use view it highlights matches in the preview, without
Replace. The demo doesn't bind Ctrl+F (⌘F) to this bar: in Source, Ctrl+F opens the code
editor's own find box, and in Write it opens your browser's.

## Spelling and grammar

The demo checks spelling and grammar as you type, in Write and Source:

- **Red** wavy underlines are spelling, **green** wavy underlines are grammar, and **blue**
  dotted underlines are style suggestions.
- **Hover** an underline to see what's wrong and up to three suggestions you can click, with
  **Ignore**, **Add to dictionary**, and **Add to document word list** below them.
- **Right-click** an underline for the full menu: every suggestion, **Ignore**, **Add to
  dictionary** (saved in your browser, for every document), and **Add to document word list**
  (saved in this document's `squisq-proof-dictionary`).
- The **status bar** shows the number of issues; click it to open the **Proofing** panel, which
  lists every finding with **Previous finding** and **Next finding** buttons.
- **View options** → **Check spelling & grammar** turns checking on or off for this session.
  **Document settings** → **Proofing** and **Proofing dialect** save the choice in the document.

Code blocks and tags are never checked. Ignored findings are remembered in your browser, not in
the document. See the `squisq-proof…` keys in [Frontmatter](frontmatter.md#proofing).

## The Transform menu

In the Source view, the wand icon (**Transform**) rewrites the Markdown source in one step:

| Item                    | Does                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Unwrap paragraphs**   | Joins hard-wrapped lines so each paragraph is one line (hard breaks are kept)                                         |
| **Wrap at width**       | Wraps paragraph text at 60, 80, 100, or 120 characters, or a width you type; code, tables, and headings are untouched |
| **Clean up formatting** | Rewrites the document in a consistent house style: bullets, emphasis, headings, table padding, spacing                |
| **Condense formatting** | Removes table padding and decorative dividers, keeping all content                                                    |

The menu also reports how the document is currently wrapped and marks the matching item
**Current**. A transform that can't prove it would leave the document's meaning unchanged does
nothing and says so. Each one is a single undo step. Transforms need the **Document** layout.

## Recording

The demo can record from your microphone, camera, and screen, and stores each recording with the
document.

- **Insert → Record media** (or **Record** in the Attachments panel) opens **Record media**.
  Choose the sources — **Microphone** and **Camera**, **System audio** and **Screen** — then
  **Start preview**, **Record**, **Stop**, and **Save to document** (or **Discard & re-record**).
  Recording both camera and screen saves two files, inserted as a screen recording with your
  camera in a corner.
- **Insert → Document narration** records a take that plays from the start of the document across
  every block.
- **Show narration mode** puts a teleprompter of your script beside the camera, and **Show slides
  mode** shows your slides one at a time with each block's text as speaker notes. With document
  narration, the moments you advance the slides become the blocks' timings, unless you clear
  **Update block timings when I save this narration**.

System audio needs a desktop Chromium browser. See [Media](media.md) and
[Narration](narration.md). Dictation is not part of the demo; it appears only in apps that supply
a speech recognizer.

## The Use view

The Use view presents the finished document. Pick a display mode from the **▾** menu:

| Mode           | What you see                                      |
| -------------- | ------------------------------------------------- |
| **Slideshow**  | Designed slides, one at a time                    |
| **Flashcards** | Study cards with step-by-step reveals and quizzes |
| **Video**      | An automatically timed presentation, with audio   |
| **Page**       | The fully designed, scrolling page                |
| **Dashboard**  | Every block arranged on one canvas                |
| **Document**   | A clean, text-first document                      |
| **Narrate**    | A voice-paced teleprompter                        |

The toolbar above the preview changes with the mode. Depending on the mode, it offers:

- **Aspect ratio** — 16:9, 1:1, 9:16, or 4:3.
- **Theme:** — the theme picker and its pencil (see [Themes](#themes)).
- **Summarize:** — turns the document's highlights into slides in a chosen style (Dynamic slides,
  Documentary, Magazine, Data-Driven, Narrative, Minimal, or Headings and features). Your
  Markdown is not changed.
- **Cover slide** — show or hide the cover, choose its **Appearance** and **Duration**, choose
  whether an exported video waits for it, and **Export cover as image…**.
- **Captions:** and **Loop** (Video) — standard or social-style captions, and whether the video
  starts over.
- **Video:** — when the document has timed video: behind the slide, full frame, or picture in
  picture with a size, shape, and corner.
- **Layout:**, **Style:**, and **Title** (Dashboard) — the cell arrangement, cell dressing, and
  title band, plus **Export dashboard as image**.
- **Present** — fill the app's canvas, open a synced audience window, or go full screen. Esc
  exits.
- **Print** — a print preview, with 1, 2, or 9 slides per page in Slideshow mode.

The theme, summarize, cover, caption, loop, video, and dashboard choices are saved in the
document's frontmatter; the mode and aspect ratio last for your session. See
[Display modes](display-modes.md) for each mode in depth.

**Narrate** has its own controls: start and pause, restart, a countdown, a speed in words per
minute, **Voice pace** (the prompter follows your voice), text size, mirroring, a reading guide,
**Pop out** into its own window, and **⏺ Record** to record your narration as you read.

## Document settings

The file icon on the toolbar opens **Document settings**:

| Field                | Sets                                                          |
| -------------------- | ------------------------------------------------------------- |
| **Title**            | The document's title. Leave it blank to use the first heading |
| **Subtitle**         | Text shown on the cover                                       |
| **Theme**            | The document's theme, or **Default** for none                 |
| **Transform**        | The Summarize style used in the Use view                      |
| **Captions**         | Default, Standard, or Social                                  |
| **Proofing**         | Default, On, or Off for this document                         |
| **Proofing dialect** | American, British, Australian, Canadian, or Indian English    |

**Save** writes them into the document's [frontmatter](frontmatter.md).

## View options

The eye icon on the toolbar:

| Option                        | Choices                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| **View**                      | Document, Block-at-a-time, or Timeline (see [Layouts](#layouts-document-block-at-a-time-timeline)) |
| **Show outline**              | The outline pane                                                                                   |
| **Show block previews**       | The block preview pane                                                                             |
| **Show block tags**           | Heading badges: No inline block tags, Selected/hovered block, or Always show                       |
| **Show status bar**           | The word-count bar at the bottom                                                                   |
| **Check spelling & grammar**  | Proofing on or off                                                                                 |
| **Editor styling from theme** | How much the Write view looks like the document: Don't inherit, Fonts only, or Fonts & colors      |

## Status bar

The bar along the bottom counts words, characters, lines, and blocks, shows the proofing count,
and shows **⚠ Error** if the document can't be read (hover it for the reason). On narrow screens
some counts are hidden.

## The right-click menu

Right-click in Write or Source (or press the context-menu key or Shift+F10) for **Cut**, **Copy**,
and **Paste**, plus:

- **In a table** (Write): insert or delete rows and columns.
- **In a list** (Write): decrease or increase the indent.
- **On a timed audio or video clip**: **Edit clip…**, which opens audio cleanup, timing, and
  frame-crop tools — see [Media](media.md).
- **On a proofing underline**: the proofing menu.

Hovering a picture in Write shows an **Edit** button for the image editor and a corner handle to
resize it (double-click the handle to reset).

## Keyboard shortcuts

"Mod" is ⌘ on a Mac and Ctrl elsewhere.

**Anywhere in the editor**

| Keys                        | Does                                           |
| --------------------------- | ---------------------------------------------- |
| Mod+Shift+1, 2, 3           | Switch to Write, Source, or Use                |
| ← → Home End                | Move between the view tabs, when one has focus |
| Shift+F10, context-menu key | Open the right-click menu                      |
| Esc                         | Close a menu, dialog, or presentation          |

**Write view**

| Keys                     | Does                               |
| ------------------------ | ---------------------------------- |
| Mod+B, Mod+I             | Bold, italic                       |
| Mod+Shift+S              | Strikethrough                      |
| Mod+E                    | Inline code                        |
| Mod+. and Mod+,          | Superscript, subscript             |
| Mod+1 to Mod+6           | Heading 1 to 6                     |
| Mod+Shift+8, Mod+Shift+7 | Bullet list, numbered list         |
| Mod+Shift+B              | Blockquote                         |
| Mod+Alt+C                | Code block                         |
| Tab, Shift+Tab           | Indent or outdent a list item      |
| Shift+Enter              | Line break within a paragraph      |
| Mod+K                    | Insert or edit a link (Source too) |
| Mod+Z, Mod+Shift+Z       | Undo, redo                         |

**Find bar** — Enter and Shift+Enter for the next and previous match, Ctrl+Enter to replace
all, Esc to close.

**Use view**

| Mode       | Keys                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Slideshow  | → ↓ or Space for the next slide or build step, ← for the previous, ↑ for the slide picker, Home and End for the first and last |
| Video      | Space to play or pause, ← and → to skip 10 seconds                                                                             |
| Flashcards | ← and → (or Space, Enter) to move between cards, 1–9 to choose an answer                                                       |
| Narrate    | ↑ to start, ↓ or Esc to pause, ← and → to nudge the text back or forward, `[` and `]` to change the speed, M to mirror         |

The diagram, tree, and timeline editors have their own keys — Delete to remove a selected item,
Enter to add the next tree item, Tab to indent it — described in [Diagrams](diagrams.md).

## Not in the demo

Apps that build the editor in can add features the demo leaves off: **version history**
(automatic snapshots you can revert to), **dictation**, `@`-mentions, links between documents in
a workspace, and HTML page templates in Document settings. See the
[developer guide to the editor](../developers/guides/editor.md).

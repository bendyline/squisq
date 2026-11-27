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

The editor has three views of the same document:

| View                                   | What it's for                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Write**                              | Visual editing, like a word processor. Headings, lists, tables, and pictures appear formatted |
| **Source**                             | The Markdown itself, with syntax colors and suggestions as you type tags                      |
| **Use** (named after the current mode) | The finished document — as a slideshow, page, video, dashboard, and more                      |

The button at the top left shows the view you're in — **Write** (or the edit view you're in,
such as **Blocks**), **Source**, or the Use mode, such as **Slideshow** — and opens the
[View menu](#the-view-menu), where you choose another. Switch views with Ctrl+Shift+1, 2, and 3
(⌘⇧1, 2, and 3 on a Mac): Write, Source, and Use. Each returns to the view as you left it — Write
in its edit view, Use in its mode.

### The View menu

The view button opens the **View** menu. It has three columns:

- **Navigation**, on the left — the app's own navigation panes, such as its file list, when the
  app offers them, then **Outline**. They're listed in the order they sit on screen, left to right.
- **Views**, in the middle — every view, under **Edit** (Write, Source, Blocks, Timeline,
  Summaries) and **Use** (Slideshow, Video, Page, Document, Dashboard, Narrate, Flashcards). Each
  group checks the mode its shortcut returns to, and the view on screen is highlighted. Choosing a
  view switches to it.
- **Panes**, on the right — **Block previews** and **Status bar**; **Show block tags** (No inline
  block tags, Selected/hovered block, or Always show); and **Check spelling & grammar** when the
  app offers proofing.

The checkboxes leave the menu open as you click, so you can change several at once.

Use the arrow keys to move in the menu: up and down within a column, left and right between
columns. On a narrow screen the columns stack, views first. How much the Write view takes on the
theme's look is in [Document settings](#document-settings), under **Editor**.

Changes in one view appear in the others immediately. Write and Source edit the same Markdown,
and Write leaves the parts of your file you didn't touch exactly as they were.

### Edit views: Write, Source, Blocks, Timeline, Summaries

The **Edit** views in the View menu choose how you edit, and the view button is named after
your choice. Source always shows the whole file: switching to it from Blocks or Timeline opens it at the block
you were on, and switching back opens Write on the block holding the Source cursor.

- **Write** — the whole document in one scrolling column. The default.
- **Source** — the Markdown text of the whole file. Write keeps the mode it was in, so Ctrl+Shift+1
  (⌘⇧1) returns to it.
- **Blocks** — one block on a card, with **Previous**, **Next**, a "Block N of M"
  counter with the block's heading, and **Add block**. They sit in the middle of the
  [status bar](#status-bar), or under the card when the status bar is hidden.
- **Timeline** — a card for the selected block above a timeline of every block and media clip.
  Drag a block's right edge to change its duration, drag clips to move them, drag the playhead to
  scrub, and use **Play**, **Zoom in**, and **Zoom out**. Each block's **⋯** menu sets its
  duration, start time, and transition, or turns on **Autotime block**. The toolbar above the
  track shows or hides the **Video monitor** and **Video composition** panes.
- **Summaries** — how the slideshow and video summarize your text. Choose a style from the
  **Summary style** dropdown, which says what each one does:
  - **None** — each section is one slide, as you wrote it. The default.
  - **Custom** — concise slides and diagrams generated from your text, which you adjust slide by
    slide in the designer below the choice. Set the **Summary length**, which lists each choice
    with the number of slides it makes — **Key points** (one to three slides per section, showing
    what an audience should keep while the narration tells the rest; the default), **One slide
    per section**, or one of three lengths that **follow the text** with a slide every paragraph,
    every few sentences, or nearly every sentence — and whether to **Add
    supporting slides**; these sit on one row with the style and the designer's actions, and wrap
    in a narrow panel. Then pick a slide from the list, where each section of your
    document sits beside the slides made from it (in a narrow window, from the **Slide** menu
    with **Previous** and **Next**, or with ← and →). For the slide you picked, you
    can hide it, set the **Slides for this section** (how many slides tell that section,
    whatever the summary length), choose its section's **Layout preference** — including **As authored**, which
    shows the section as you wrote it, and, for a chart, table, diagram or other picture,
    **On the last slide of** the section before it, which draws it there instead of on a slide
    of its own (it stays in the list without a number, tagged with the slide carrying it, and
    says why when it cannot be carried) — and, under **Customize slide wording**, rewrite the
    slide's headline and highlights (**Use automatic wording** takes yours away). Changing the
    wording of a slide the AI suggested makes all of that slide's wording yours, and suggesting
    again keeps it. **Reset design** returns every slide to its automatic summary. Apps that
    connect an AI add **Suggest with AI**, which proposes a layout and shorter wording for each
    slide. Each change is saved as you make it, in the document itself: a section's slide
    wording, AI suggestions and hidden slides as `{[summary]}` blocks under it (see
    [Accessory blocks](markup.md#accessory-blocks)), its layout on its heading. Write folds a
    section's summaries into one **Slide summaries** row you can open; Source folds each. Ctrl+Z
    in Write undoes a change. Your wording for a section's first slide stays when you edit the
    section's text; your wording for its other slides, an AI suggestion or a hidden slide applies
    only while its passage is unchanged, and a list of summaries **not in use** lets you remove
    the ones that no longer apply.
  - **Documentary**, **Magazine**, **Data-Driven**, **Narrative**, **Minimal**, or **Headings and
    features** — the document re-cut into a presentation in that style. Below the choice are the
    slides it makes, each beside the section it came from; slides a style adds around your text,
    such as a closing title, are set apart.

  Your Markdown and narration are not changed; the choice is saved in the document's
  frontmatter. Formatting buttons are hidden while Summaries is open.

- **Study cards** — flashcards and quiz questions kept with each section (see
  [Study cards](markup.md#study-cards)). The sections of the document are listed with their card
  counts; pick one to see and edit its cards beside it. **Add flashcard** and **Add quiz question**
  open a new card, saved once it has a question and an answer (or two choices with the right one
  marked); a card's fields save when you leave them; **Remove card** deletes it. A section whose
  text changed after AI wrote some of its cards says so, with **Keep all** and, in apps that
  connect an AI, **Regenerate**. Apps that connect an AI add **Generate for this section** and
  **Generate for all sections without cards**, with a **Make** choice of flashcards, quiz
  questions or both; progress and **Stop** take the button's place, and cards are saved a
  section at a time, so stopping keeps what was made. **Study these cards** opens Use ›
  Flashcards. In a narrow window the section list becomes a **Section** menu.

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

In Write, including its Blocks and Timeline layouts, **Undo** and **Redo** come first, just after
the view button. They are dimmed when there is nothing to undo or redo, and they stay on the toolbar
however narrow it gets. Undo covers the text on screen: in Blocks and Timeline, moving to another
block, or switching between Write and Blocks, starts the history afresh.

More controls appear when the caret is somewhere that needs them:

- **Block: …** and **Transition: …** when the caret is in a heading — see
  [Choosing a block's template](#choosing-a-blocks-template).
- **Table:** buttons to add or delete rows and columns, or the whole table, when the caret is in
  a table (Write view).
- **Decrease indent** and **Increase indent** in a list (Write view).

On the right are the quick tools — the microphone for dictation and **Transform** (Source view
only) — then the paperclip that shows and hides **Attachments**. After a divider
come the document actions: **Document settings**, **Custom layouts** (your own block designs), and
**Version history** when the app keeps versions, followed by any the app adds, such as export.

When the toolbar runs out of room, formatting buttons fold into a **···** menu, least-used first.
The document actions fold together into a single **Document actions** menu; choosing an action
that has its own menu opens it in place, with a back row to return.

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
  in or hovering over; **View** → **Show block tags** can show it always, or never.
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

The [View menu](#the-view-menu) shows two side panes: **Outline** under **Navigation**, and
**Block previews** under **Panes**.

- **Outline** — the document's headings as a tree on the left. Click a heading to jump to
  it, drag one to move its whole section, and use the arrows to promote or demote it.
- **Block previews** — a small preview of each block beside the text; click one to scroll
  to it. In the Blocks and Timeline modes, it shows a large preview of the current block
  instead.

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
editor's own find box, and in Write it opens your browser's. In Write, Find and Replace leave slide summaries and study cards alone — they are folded
away and are not your text — while Source finds them like any other line.

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
- **View** → **Check spelling & grammar** turns checking on or off for this session.
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

System audio needs a desktop Chromium browser, and Screen needs a desktop browser: phones and
tablets offer only the microphone and camera. See [Media](media.md) and
[Narration](narration.md). Dictation is not part of the demo; it appears only in apps that supply
a speech recognizer.

## The Use view

The Use view presents the finished document. Pick a display mode under **Use** in the
[View menu](#the-view-menu):

| Mode           | What you see                                      |
| -------------- | ------------------------------------------------- |
| **Slideshow**  | Designed slides, one at a time                    |
| **Video**      | An automatically timed presentation, with audio   |
| **Page**       | The fully designed, scrolling page                |
| **Document**   | A clean, text-first document                      |
| **Dashboard**  | Every block arranged on one canvas                |
| **Narrate**    | A voice-paced teleprompter                        |
| **Flashcards** | Study cards with step-by-step reveals and quizzes |

The toolbar above the preview changes with the mode. Depending on the mode, it offers:

- **Aspect ratio** — 16:9, 1:1, 9:16, or 4:3.
- **Block:** (Slideshow) — the block type of the slide on screen. Pick another from the gallery
  to restyle that slide without going back to Write; the choice is saved as the heading's
  `{[…]}` tag. It is greyed out on the cover and while a
  [Summaries](#edit-views-write-source-blocks-timeline-summaries) style is choosing the layouts.
- **Theme:** — the theme picker and its pencil (see [Themes](#themes)).
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

The theme, cover, caption, loop, video, and dashboard choices are saved in the
document's frontmatter; the mode and aspect ratio last for your session. See
[Display modes](display-modes.md) for each mode in depth.

**Narrate** has its own controls: start and pause, restart, a countdown, a speed in words per
minute, **Voice pace** (the prompter follows your voice), text size, mirroring, a reading guide,
**Pop out** into its own window, and **⏺ Record** to record your narration as you read.

## Document settings

The file icon on the toolbar opens **Document settings** (on a narrow toolbar, it's in the
**Document actions** menu):

| Field                | Sets                                                          |
| -------------------- | ------------------------------------------------------------- |
| **Title**            | The document's title. Leave it blank to use the first heading |
| **Subtitle**         | Text shown on the cover                                       |
| **Theme**            | The document's theme, or **Default** for none                 |
| **Transform**        | The summary style (see Edit › Summaries)                      |
| **Captions**         | Default, Standard, or Social                                  |
| **Proofing**         | Default, On, or Off for this document                         |
| **Proofing dialect** | American, British, Australian, Canadian, or Indian English    |
| **Properties**       | The document's own keys, such as `author` or `tags`           |

**Save** writes them into the document's [frontmatter](frontmatter.md). When a document has
properties, the Write view also shows them in a **Properties** pill in the tray above the page,
where each change is saved as you leave its row. See
[your own keys](frontmatter.md#your-own-keys).

Below them, **Editor** holds your own preference for this editor, which is not saved in the
document:

| Field                         | Sets                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| **Editor styling from theme** | How much the Write view looks like the document: Don't inherit, Fonts only, or Fonts & colors |

## Status bar

The bar along the bottom shows what belongs to the view on screen:

- On the left, it counts words, characters, lines, and blocks, and shows the proofing count.
- In the middle, the view's own position and controls. **Slideshow** puts the previous and next
  arrows and the slide number with its title there (click the number for a list of every slide),
  plus the build steps when a slide has them. **Video** puts its playback controls there in one
  row: play/pause, restart, the time, the timeline (click to jump, or use the arrow keys; hover for the
  slide at that point), the slide number, and captions. **Narrate** puts its toolbar there:
  **Start**, **Restart**, **Countdown**, **Record**, and **Pop out**. **Flashcards** puts
  **Shuffle**, **Restart**,
  **Previous**, the card number with a progress bar, and the card's actions there: **Reveal**,
  then **Again** and **Next**. **Blocks** and **Timeline** put the block navigation there. They
  sit in the middle so a phone's rounded corners can't cut into them, and hold still as you go:
  **Reveal** and **Next** land on the same spot.
- On the right, **⚠ Error** if the document can't be read (hover it for the reason).

In Slideshow, Video, Narrate, and Flashcards the counts give way to the view's controls, since they describe
the Markdown rather than what's on screen. On narrow screens some counts are hidden, and all of them
give way when a view has controls in the middle. Hide the bar from the View menu's **Panes**, and
Slideshow, Video, Narrate, Flashcards, and Blocks show their controls on the slide, the video, under
the prompter, on the deck, and on the card instead, as they do while presenting.

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

| Keys                        | Does                                      |
| --------------------------- | ----------------------------------------- |
| Mod+Shift+1, 2, 3           | Switch to Write, Source, or Use           |
| ↓ on the view button        | Open the View menu; arrows move within it |
| Shift+F10, context-menu key | Open the right-click menu                 |
| Esc                         | Close a menu, dialog, or presentation     |

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

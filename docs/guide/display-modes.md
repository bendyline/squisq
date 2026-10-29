---
title: Display modes
description: Present one document as a slideshow, a timed video, a scrolling page, a one-canvas dashboard, a flashcard deck, a plain document, or a teleprompter script.
---

# Display modes

You write a document once. A **display mode** decides how it is presented: as slides you click
through, a video that plays itself, a page you scroll, a dashboard that shows everything at once,
and more. Switching modes never changes your Markdown — every mode reads the same headings, tags,
and body text.

Here is one short document as a slideshow:

```markdown preview
---
title: Harbor Survey 2026
---

# Harbor Survey 2026 {[title subtitle="A season of tides, boats, and early mornings"]}

## 1,284 boats {[statHighlight]}

**1,284** vessels passed the breakwater this spring — the busiest season on record.

## Busiest berths {[barChart]}

| Berth | Arrivals |
| ----- | -------- |
| North | 412      |
| Ferry | 365      |
| Fuel  | 298      |
| South | 209      |

## What the harbormaster said {[quote]}

> The tide doesn't care about your schedule. You learn to keep its. — Ines Duarte, harbormaster
```

The same source as a [page](#page), where each block becomes a section of a scrolling page:

```markdown preview=page nosource
---
title: Harbor Survey 2026
---

# Harbor Survey 2026 {[title subtitle="A season of tides, boats, and early mornings"]}

## 1,284 boats {[statHighlight]}

**1,284** vessels passed the breakwater this spring — the busiest season on record.

## Busiest berths {[barChart]}

| Berth | Arrivals |
| ----- | -------- |
| North | 412      |
| Ferry | 365      |
| Fuel  | 298      |
| South | 209      |

## What the harbormaster said {[quote]}

> The tide doesn't care about your schedule. You learn to keep its. — Ines Duarte, harbormaster
```

And as a [dashboard](#dashboard), with every block on one canvas under the document's title:

```markdown preview=dashboard nosource
---
title: Harbor Survey 2026
---

# Harbor Survey 2026 {[title subtitle="A season of tides, boats, and early mornings"]}

## 1,284 boats {[statHighlight]}

**1,284** vessels passed the breakwater this spring — the busiest season on record.

## Busiest berths {[barChart]}

| Berth | Arrivals |
| ----- | -------- |
| North | 412      |
| Ferry | 365      |
| Fuel  | 298      |
| South | 209      |

## What the harbormaster said {[quote]}

> The tide doesn't care about your schedule. You learn to keep its. — Ines Duarte, harbormaster
```

## Choosing a mode

| Mode                      | Use it for                                                      | `display-mode` values                           |
| ------------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| [Slideshow](#slideshow)   | Presenting designed slides one at a time                        | `slideshow`, `slides`, `presentation`, `deck`   |
| [Video](#video)           | A presentation that plays itself, timed to narration or reading | `video`                                         |
| [Page](#page)             | A designed, scrolling web page                                  | `page`, `paged`, `linear`                       |
| [Dashboard](#dashboard)   | Every block arranged on one canvas                              | `dashboard`, `dash`                             |
| [Flashcards](#flashcards) | Studying with reveal cards and quizzes                          | `flashcards`, `flashcard`, `study`, `quiz`      |
| [Document](#document)     | Reading a clean, text-first version                             | `document`, `scroll`, `html`, `plain`, `reader` |
| [Narrate](#narrate)       | Reading the document aloud from a voice-paced teleprompter      | `narrate`, `teleprompter`, `prompter`           |

**In the editor**, open the **Use** view and pick a mode from the menu beside its tab. The tab
takes the name of the mode you are in (**Slideshow**, **Page**, …), and choosing a mode from the
menu also switches to the Use view, so it works from Write and Source too. The mode you pick
lasts for the session; it does not change the document.

**In the document**, set the mode it opens in with the `display-mode` frontmatter key:

```yaml
---
title: Harbor Survey 2026
display-mode: dashboard
---
```

Values are not case-sensitive. A document with no `display-mode` opens as a slideshow in the
editor. Each mode's settings sit in the toolbar above the preview, and most of them are saved to
the document's frontmatter when you change them — the [frontmatter reference](frontmatter.md)
lists every key.

> [!NOTE]
> `display-mode` is a hint to the editor and other apps that open the document. Exports choose
> their own rendition: a PowerPoint file is always slides, a PNG image is always the dashboard,
> and so on. See [Import and export](import-export.md).

## Slideshow

The slideshow shows one block at a time and waits for you. Nothing advances on its own, so it is
the mode for presenting live. Use the on-screen controls or the keyboard: →, ↓, or Space moves
forward, ← moves back, Home and End jump to the first and last slides, and ↑ opens a list of
slides to jump to.

Each heading becomes a slide, styled by its tag or by an
[automatic template](markup.md#automatic-templates). If you set up
[progressive builds](tags.md#block-settings), a slide reveals its pieces one step at a time
before moving on.

Settings in the toolbar:

- **Format** — the slide shape: landscape (16:9), portrait (9:16), square, or standard (4:3).
  Set the document's default with `document-render-as` (`landscape`, `portrait`, `square`,
  `standard`).
- **Theme** — see [Themes](themes.md).
- **Summarize** — re-cut the document into a presentation in a style such as Documentary,
  Magazine, Data-Driven, or Minimal, without changing your source (saved as
  `squisq-transform`).
- **Cover** — the title slide generated from the document's opening: whether it appears
  (`squisq-cover-slide`), its design (`squisq-cover-template`), and, for video, how long it stays
  up (`squisq-cover-duration`) and whether the story waits for it (`squisq-cover-playback`).
- **Video** — appears when the document contains video clips; see [Video](#video).

The slideshow is also what a PowerPoint export and an HTML slideshow export contain, one slide per
block.

## Video

Video mode plays the document like a film: play and pause, a scrub bar, and slides that advance
on their own. Space plays and pauses; ← and → skip back and forward ten seconds. When the
document has [narration](narration.md), each block stays up for as long as you speak about it.
Without narration, each block gets an estimated reading time — or the time you give it with
`duration=` in its [block settings](tags.md#block-settings).

Use it to rehearse timing, to share a self-running presentation, and to preview what an MP4 or
GIF export will look like.

Video mode has the slideshow's settings plus captions and looping:

| Setting  | What it does                                                                                                                                                                                                                        | Frontmatter key                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Captions | Off, **Standard** (a caption band), or **Social** (large captions a few words at a time)                                                                                                                                            | `squisq-captions` (`off`, `standard`, `social`)                                           |
| Loop     | Start again when playback ends                                                                                                                                                                                                      | `squisq-video-loop` (`true`)                                                              |
| Video    | How [video clips](media.md#audio-and-video-clips) sit in the frame: **Behind** the slide, **Full frame**, or **Picture in picture** with a size, shape, and corner. Shown in Slideshow and Video when the document has video clips. | `squisq-video-presentation`, `squisq-pip-size`, `squisq-pip-shape`, `squisq-pip-position` |

To turn the video into a file, see [Import and export](import-export.md) or the
[command line](cli.md).

## Page

Page mode turns the document into a designed, scrolling web page. Blocks become sections of
different heights — a hero at the top, bands for statistics and quotes, side-by-side features,
galleries, tables — and the theme decides the page's personality: its column width, heading
style, section backgrounds, and image frames. Diagrams, maps, and charts stay pictures inside
the page.

```markdown preview=page cover
---
title: North Breakwater Repairs
---

# North Breakwater Repairs

Six weeks of work on the outer wall, and what it means for everyone who uses the harbor.

## Work begins in March {[statHighlight]}

**March 4** is the first day crews close the outer walkway.

## What changes for boaters

- The fuel dock stays open every day.
- Ferry berths move to the south pier for six weeks.
- Night arrivals radio the harbor office before entering.
```

Use it for reports, articles, and anything people will read on a screen at their own pace. A
single-file HTML export contains this page. [Page view](page-mode.md) explains how blocks map to
sections and how each theme dresses them.

## Dashboard

Dashboard mode arranges every block on one canvas: a grid or mosaic of cells, each block drawn
at its cell's size, with the document's title in a band across the top. There is no timeline
and nothing to click through.

```markdown preview=dashboard
---
title: Ferry Operations — Week 18
---

## On-time departures {[statHighlight]}

**96%** of sailings left within five minutes of schedule.

## Riders by day {[columnChart]}

| Day | Riders |
| --- | ------ |
| Mon | 1840   |
| Tue | 1795   |
| Wed | 1910   |
| Thu | 2050   |
| Fri | 2480   |

## Notes from the dock {[quote]}

> Friday's extra sailing paid for itself by noon. — Sam Okafor, operations lead
```

Use it for status walls, one-page summaries, and social images. Its toolbar adds a **Layout**
picker, a cell **Style**, a **Title** switch, and a button to export the dashboard as an image.
[Dashboards](dashboards.md) covers layouts, styles, zoom, and image export.

## Flashcards

Flashcards turn the document into a study deck. Each card shows a question; **Reveal** shows the
answer, and you mark it **Again** or **Next**. At the end you see how many you remembered and can
retry the ones you missed. **Shuffle** and **Restart** sit above the deck, and the arrow keys,
Space, and Enter move through it.

You don't need special markup — ordinary headings already make cards:

```markdown
---
title: Knots for New Crew
display-mode: flashcards
---

## Which knot makes a fixed loop that won't slip?

The bowline.

## What is a cleat hitch for?

### Answer

Tying a line to a cleat on the dock, quickly and securely.

## Quick quiz {study=multiple-choice-flashcard}

You can untie this one even after it has been loaded.

### Which knot is easy to untie after carrying a load?

### Clove hitch

### Bowline {correct=true}

### Square knot
```

How headings become cards:

- **A heading with a body** is a card: the heading is the question, the body is the answer.
- **A heading with one sub-heading named Answer** (or Back, Solution, Explanation) is a card:
  the parent is the question and the sub-heading is the answer.
- **A heading with no body over several cards** is a group, and its cards join the deck.
  `{study=group}` marks one explicitly.
- **`{study=flashcard}`** on a heading makes it one card even when it has several sub-headings:
  the first sub-heading is the question, the rest are the answer, and the heading's own body is
  shown as an explanation.
- **`{study=multiple-choice-flashcard}`** (or `{study=quiz}`) makes a multiple-choice card: the
  first sub-heading is the question and each later one is a choice. Mark the right one with
  `{correct=true}`; if none is marked, the first choice is correct. Choices are shuffled, number
  keys pick one, and the heading's body is shown as the explanation after you answer.

When a heading's shape is ambiguous, mark it with `{study=…}` and it becomes exactly what you
asked for. Flashcards have only the **Theme** and **Summarize** settings.

## Document

Document mode shows a clean, text-first version: headings, paragraphs, lists, and tables as
plain HTML, without slide designs. Use it to proofread and to see what a plain HTML export
looks like. It is also the version an [HTML page template](page-templates.md) wraps in your own
site.

## Narrate

Narrate turns the editor into a teleprompter for reading the document aloud. The script scrolls
past an eye line and highlights the word you are on. With **Voice pace** on, it listens through
your microphone and follows your speed, stopping when you stop; with it off, it scrolls at the
**Speed** you set, in words per minute. You can mirror the text for a beam-splitter rig, add a
countdown, change the type size, and pop the prompter out into a small window to keep it beside
your camera.

When the app supports recording, Narrate also records your take and times each block to your
voice, so [Video](#video) mode and video exports play in step with it. See
[Narration](narration.md).

Narrate needs a microphone for voice pacing. An app embedding the editor can turn the mode off;
a document that asks for `display-mode: narrate` then opens in Video mode instead.

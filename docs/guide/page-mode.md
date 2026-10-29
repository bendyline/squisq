---
title: Page view
description: How a document becomes a designed, scrolling web page, and how each theme art-directs it.
---

# Page view

Page view turns your document into a scrolling web page instead of a deck of slides. Each block
becomes a **section** that is as tall as its content needs: a hero at the top, a band for a big
number, a pull quote, an image beside its story, a table, a list. The theme decides how those
sections look, so the same Markdown can read like a magazine feature, a field report, or a
terminal readout.

```markdown preview=page cover
---
title: The North Breakwater
subtitle: A field report from six weeks of repairs
---

# The North Breakwater

## Why the wall needed work

Winter storms opened three gaps in the outer wall. By February, waves were reaching the fuel dock on every high tide, and the harbor office closed the walkway to the light.

## 1,200 tonnes {[statHighlight]}

**1,200 tonnes** of new armor stone now face the open water.

## Mornings on the wall {[leftFeature]}

![Boats moored inside the breakwater](images/harbor.svg)

Crews started at first light, when the tide was lowest and the stone barges could reach the seaward face.

## What the foreman said {[quote]}

> We built it to be boring. Nobody should think about this wall for fifty years. — Mara Lindqvist, site foreman

## The schedule {[dataTable]}

| Week | Work                        | Walkway |
| ---- | --------------------------- | ------- |
| 1–2  | Remove damaged stone        | Closed  |
| 3–4  | Place new armor stone       | Closed  |
| 5    | Rebuild the walkway surface | Partial |
| 6    | Lighting and railings       | Open    |

## What changes for boaters

- The fuel dock stays open every day.
- Ferry berths move to the south pier until week five.
- Night arrivals radio the harbor office before entering.
```

To see it in the editor, open the **Use** view and choose **Page** from the mode menu, or set
`display-mode: page` in the frontmatter. See [Display modes](display-modes.md#page).

## How blocks become sections

Every block maps to one kind of section. Tagged blocks follow their tag; untagged headings
follow their content — a heading over a list becomes a list section, for example — through
[automatic templates](markup.md#automatic-templates).

| Section       | What it looks like                                    | Blocks                                                                                                          |
| ------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Hero          | A large title, often over or beside an image          | The [cover](#the-cover), `title`, `bigText`                                                                     |
| Banner        | A full-width chapter divider                          | `sectionHeader`                                                                                                 |
| Prose         | The heading and its body, as written                  | `content` and plain headings, plus `topFeature`, `bottomFeature`, `mediaOnly`                                   |
| Stat band     | Large numerals with their labels                      | `statHighlight`, `comparisonBar`                                                                                |
| Quote band    | A pull quote with its attribution                     | `quote`, `pullQuote`, `fullBleedQuote`, `transcript`, `videoPullQuote`                                          |
| Feature split | An image beside its text                              | `leftFeature`, `rightFeature`                                                                                   |
| Media figure  | One image or video with its caption                   | `imageWithCaption`, `videoWithCaption`                                                                          |
| Gallery       | A grid of images                                      | `photoGrid`                                                                                                     |
| Callout       | A boxed fact or definition                            | `factCard`, `definitionCard`                                                                                    |
| Card grid     | Two cards side by side                                | `twoColumn`                                                                                                     |
| Item list     | A styled list                                         | `list`                                                                                                          |
| Timeline rail | A dated milestone                                     | `dateEvent`                                                                                                     |
| Table         | A full-width table                                    | `dataTable`                                                                                                     |
| Canvas        | The block's slide drawing, scaled to the page's width | `diagram`, `tree`, `timeline`, `map`, `drawing`, `layout`, every chart, [custom templates](custom-templates.md) |

A few things to know:

- **Pictures stay pictures.** Diagrams, maps, trees, timelines, charts, and custom templates are
  drawn exactly as on a slide and placed in the page at their natural shape. A chart block with
  no table it can chart becomes a prose section instead.
- **Nothing is dropped.** Images, video, and diagrams in a block's body that its section doesn't
  use are placed after the section's own content.
- **Nesting is kept.** A `###` under a `##` is its own section, in document order.
- **`topFeature`, `bottomFeature`, and `mediaOnly` read as prose.** A page reads top to bottom,
  so their heading, body, and media appear in the order you wrote them.

## The cover

The hero at the top of the page is the document's **cover**, built from its opening:

- **Title** — the frontmatter `title`, else the document's top-level heading.
- **Subtitle** — the frontmatter `subtitle`, else the first paragraph under that heading.
- **Image** — the first image anywhere in the document, if there is one. The image also stays
  where you put it, so a picture in the third section appears in the hero and again in its
  section.

When the document opens with a heading that only restates the cover — its title and that first
paragraph — the heading's section is folded into the cover, so nothing appears twice:

```markdown preview=page cover
# Harbor Survey 2026

A season of tides, boats, and early mornings at the north breakwater.

## 1,284 boats {[statHighlight]}

**1,284** vessels passed the breakwater this spring — the busiest season on record.
```

The **Cover** switch in the Use view's toolbar turns the cover off (saved as
`squisq-cover-slide: false`); the same switch controls the slideshow's cover slide.

## How themes art-direct the page

Each theme carries a **page style**: a design family and a set of choices about the page as a
whole. You don't set these in your document — you choose a theme, and its page style comes with
it.

| Choice            | What it decides                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Design family     | The overall personality: clean, editorial, brutalist, terminal, cinematic, documentary, organic, or soft                            |
| Hero style        | Stacked and centered, split beside an image, full-bleed, letterboxed, or oversized type                                             |
| Headings          | The label above each heading (none, a kicker, "01 —" numbering, or a `[mono tag]`), the size of the type, uppercase, and underlines |
| Background rhythm | Whether sections sit on one flat ground, alternate, sit in tinted panels, or break into accent-colored bands                        |
| Accent rotation   | Whether sections all use the primary color or cycle through the theme's [color schemes](themes.md#color-schemes)                    |
| Image framing     | Flush, rounded, bordered, polaroid, letterboxed wide, or round-cornered                                                             |
| Rhythm and detail | Column widths, spacing between sections, dividers, shadows, quote marks, numeral style, and a background pattern                    |

The built-in themes each have their own:

| Theme         | Family      | Hero           | Headings                        | Backgrounds   | Accents       | Images         |
| ------------- | ----------- | -------------- | ------------------------------- | ------------- | ------------- | -------------- |
| Standard      | clean       | stacked        | kicker                          | alternating   | cycle         | rounded        |
| Standard Dark | clean       | stacked        | kicker                          | tinted panels | cycle         | rounded        |
| Documentary   | documentary | letterbox      | numbered, display size          | flat          | primary only  | letterboxed    |
| Minimalist    | clean       | stacked        | no label, display size          | flat          | primary only  | flush          |
| Bold          | brutalist   | oversized type | kicker, oversized, uppercase    | accent bands  | cycle         | bordered       |
| Morning Light | soft        | split          | kicker                          | tinted panels | alternate two | rounded        |
| Tech Dark     | terminal    | stacked        | mono tag                        | tinted panels | primary only  | bordered       |
| Magazine      | editorial   | split          | kicker, display size            | flat          | alternate two | flush          |
| Cinematic     | cinematic   | full-bleed     | kicker, display size, uppercase | flat          | primary only  | letterboxed    |
| Warm Earth    | organic     | stacked        | kicker, accent underline        | tinted panels | alternate two | polaroid       |
| Gezellig      | soft        | stacked        | kicker                          | tinted panels | alternate two | round-cornered |

Some themes add touches of their own: Magazine gives the first prose section a drop cap and
alternates the sides of its feature images, Documentary sets quotes in an editorial style, and Tech
Dark frames diagrams, trees, and timelines like a terminal window.

Here is one short page in **Magazine**:

```markdown preview=page cover theme=magazine
---
title: Night Ferry
subtitle: Notes from the last crossing of the season
---

# Night Ferry

## Leaving the harbor

The last ferry of the season left at 22:10 with eleven passengers, two bicycles, and a crate of apples for the island shop.

## 41 minutes {[statHighlight]}

**41 minutes** from the north pier to the island landing, against a falling tide.

## On deck {[rightFeature]}

![Open water under a clear sky](images/ocean.svg)

Most people stayed inside. The ones who didn't watched the harbor lights shrink to a single line.

## The captain's view {[quote]}

> The last crossing is always the quiet one. Everyone is a little sad and nobody says so. — Captain Jo Arenas
```

And the same page in **Bold**:

```markdown preview=page cover theme=bold nosource
---
title: Night Ferry
subtitle: Notes from the last crossing of the season
---

# Night Ferry

## Leaving the harbor

The last ferry of the season left at 22:10 with eleven passengers, two bicycles, and a crate of apples for the island shop.

## 41 minutes {[statHighlight]}

**41 minutes** from the north pier to the island landing, against a falling tide.

## On deck {[rightFeature]}

![Open water under a clear sky](images/ocean.svg)

Most people stayed inside. The ones who didn't watched the harbor lights shrink to a single line.

## The captain's view {[quote]}

> The last crossing is always the quiet one. Everyone is a little sad and nobody says so. — Captain Jo Arenas
```

A [custom theme](themes.md#custom-themes) inherits its page style from the base theme you build
it on.

## Accent colors on the page

Themes that rotate accents give each accent-bearing section — stat bands, quotes, callouts,
lists — the next color scheme in turn, so a long page doesn't wear a single color. To pin one
section's color, give its block a `colorScheme`; that section keeps it and the rotation carries
on around it.

```markdown preview=page
## Tide gauge {[statHighlight colorScheme=teal]}

**4.2 m** between the lowest and highest tide this month.

## Slack water {[definitionCard colorScheme=purple]}

The short pause between tides, when the current stops and the harbor goes still.

## Harbor rules

- Keep to five knots inside the breakwater.
- Fly a flag when your boat is anchored outside a berth.
```

## Page view and HTML export

A single-file HTML export of your document contains this page — the same sections, with the
player built in so diagrams, video, and audio still work — in one file you can put anywhere. The
plain HTML export is the simpler [Document](display-modes.md#document) rendition — headings,
paragraphs, and tables with light styling, and no player — and it is the one an
[HTML page template](page-templates.md) places inside your own site's page. See
[Import and export](import-export.md).

---
template: diagram
description: The Diagram block turns box-and-line art drawn in a code fence into a clean, themed diagram of connected nodes.
---

# Diagram

Use Diagram for a process, a system, or any set of things joined by arrows: how a manuscript
reaches print, how sensors feed a dashboard, who hands work to whom. You draw it as plain-text
box art in a code fence, the kind you'd sketch in an email or get from an AI assistant, and the
block draws it again as real boxes and arrows in your theme. The fence stays the source, so the
diagram still reads as a sketch anywhere Markdown is shown.

````markdown preview
## How a manuscript reaches print {[diagram background=surface]}

```diagram
┌────────────┐      ┌─────────────┐      ┌────────────┐
│ Submission │─────▶│ Peer review │─────▶│ Copyedit   │
└────────────┘      └─────────────┘      └────────────┘
                           │                   │
                           ▼                   ▼
                    ┌─────────────┐      ┌────────────┐
                    │ Revisions   │      │ Print      │
                    └─────────────┘      └────────────┘
```
````

## How it reads your section

- **The fence** — one code fence of box art in the body. Each closed box is a node and its text
  is the label. Lines between boxes are connections, and an arrowhead (`▶ ◀ ▲ ▼`, or ASCII
  `> < ^ v`) marks direction. A box drawn around other boxes is a group. Both box-drawing
  characters (`┌─┐│└┘`) and plain ASCII (`+-+|`) work.
- **Labels on lines** — text set into a line, as in `── sends ──▶`, or beside a vertical line,
  as in `│ approves`, labels that connection.
- **Heading** — the title above the diagram.
- **Other text** — up to three lines of the section's prose appear as a muted caption under the
  diagram. Pictures and videos in the body get a small inset of their own.

The diagram is scaled to fit the slide, keeping the positions you drew: boxes to the right stay
to the right. In [page view](../guide/display-modes.md#page) it's drawn just as on the slide.

### Getting a fence recognized

Tag the fence ` ```diagram ` and it is always read as a diagram, even one with a single box.
Untagged fences, and fences tagged `text`, `txt`, `plaintext`, `plain`, or `ascii`, are read as
diagrams only when they clearly are: at least two boxes, and nothing that looks like a table or
prose. A fence that is the whole body of a section becomes a Diagram block without the
`{[diagram]}` tag. In the editor, editing a diagram on its canvas tags its fence `diagram` for
you.

## Examples

### Labeled connections

````markdown preview
## Who handles a submission {[diagram background=surface]}

```diagram
┌──────────┐              ┌──────────┐
│ Author   │── submits ──▶│ Editor   │
└──────────┘              └────┬─────┘
                               │ approves
                               ▼
                          ┌──────────┐
                          │ Printer  │
                          └──────────┘
```
````

### Groups

A box around other boxes becomes a translucent group card with its label at the top.

````markdown preview
## The sensor network {[diagram background=surface]}

```diagram
┌──────────────────────────────────────────┐
│ Harbor district                          │
│  ┌──────────┐        ┌──────────┐        │
│  │ Sensors  │───────▶│ Gateway  │        │
│  └──────────┘        └────┬─────┘        │
└───────────────────────────┼──────────────┘
                            ▼
                     ┌──────────────┐
                     │ City servers │
                     └──────────────┘
```
````

### Text without boxes

Bare words joined by `|` rails and `+---+` branches are drawn as boxes too.

````markdown preview
## From station to forecast {[diagram background=surface]}

```diagram
Weather stations
       |
       v
   Data hub
       |
+------+------+
|             |
v             v
Forecast    Archive
```
````

### Restyling the nodes and lines

````markdown preview
## From seed to harvest {[diagram background=surface nodeShape=pill colorScheme=green lineStyle=dashed]}

```diagram
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Seed     │────▶│ Seedling │────▶│ Harvest  │
└──────────┘     └──────────┘     └──────────┘
```
````

## Parameters

```squisq-docs
template-params
```

The template reads these keys from the tag:

| Parameter     | What it does                                           | Values                                                 |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `title`       | Replaces the heading as the title; `title=""` hides it | Text                                                   |
| `colorScheme` | Colors the nodes and lines from the theme's palette    | A theme color-scheme name, such as `blue` or `green`   |
| `nodeShape`   | Node outline                                           | `rounded` (default), `pill`                            |
| `lineStyle`   | Line pattern for every connection                      | `solid` (default), `dashed`, `dotted`                  |
| `endStyle`    | Marker at the end of each arrow (default `arrow`)      | `arrow`, `open`, `diamond`, `circle`, `square`, `none` |
| `startStyle`  | Marker at the start of every line (default `none`)     | `arrow`, `open`, `diamond`, `circle`, `square`, `none` |
| `background`  | Paints the theme's surface behind the diagram          | `surface`                                              |

Lines without an arrowhead in your art never get an end marker. Connections in a fence always
run in right-angled segments, the way you drew them.

## Tips

- **Add `background=surface` for a slide of its own.** A diagram paints no background, so in the
  slideshow it sits on a black backdrop, where a light theme's dark title is hard to read.
  `background=surface` paints the theme's surface behind it, as every example on this page does.
- **Line up your box edges.** Each box needs straight sides and four corners. When the art is
  too ragged to read, the fence is shown as code instead; in the editor's Write view, a
  **Repair as diagram** button offers to redraw it cleanly.
- **Let the editor do the drawing.** In the Write view the diagram becomes a canvas: drag boxes,
  draw connections, and rename nodes, and the fence text is rewritten to match.
- **Keep labels short.** A node label is sized to its box; two or three words per box read best.
- **Need other diagram types?** Sequence diagrams, state charts, and Gantt charts are better as
  [Mermaid](../guide/diagrams.md#mermaid) fences, which can go in any section.
- **Older documents** that built a diagram from sub-headings, one node per heading, still
  display, but the canvas edits only the fence form.

## Related

- [Box diagrams](../guide/diagrams.md#box-diagrams) — the full fence syntax
- [Tree](tree.md) — for hierarchies such as folders and outlines
- [Timeline](timeline.md) — for events along a time axis
- [Drawing](drawing.md) — free-form shapes with exact positions

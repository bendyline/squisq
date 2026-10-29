---
template: drawing
description: The Drawing block draws shapes and connectors from its sub-headings, one shape per sub-heading, scaled to fit the slide.
---

# Drawing

Use Drawing for sketches made of shapes: an org chart, a floor plan in boxes, a system with
databases and clouds. Each sub-heading under the block is one shape, its heading text is the
label, and arrows can join shapes by name. You place shapes in your own units and the block
scales the whole drawing to fit the slide, so you never think in pixels. For box art you'd rather
type as a picture, use [Diagram](diagram.md); for exact pixel placement of text and images, use
[Layout](layout.md).

```markdown preview theme=standard-dark
## Newsroom structure {[drawing]}

### Editor in chief {#eic} {[rectangle x=260 y=0 width=220 height=90 borderRadius=12]}

### Metro desk {#metro} {[rectangle x=0 y=240 width=220 height=90 borderRadius=12]}

### Features {#features} {[rectangle x=520 y=240 width=220 height=90 borderRadius=12]}

### {[arrow from=eic to=metro]}

### {[arrow from=eic to=features]}
```

## How it reads your section

- **Sub-headings** — each one directly under the Drawing heading is a shape. Its tag names the
  shape and carries position, size, and style; its heading text is the label in the middle.
- **Text under a sub-heading** — a smaller caption just below the shape.
- **Ids** — `{#name}` on a sub-heading gives the shape a name that connectors can point at.
- **Connectors** — a `{[line …]}` or `{[arrow …]}` sub-heading with `from=` and `to=` joins two
  shapes by id, trimmed to meet their edges. Its heading text, if any, labels the connector.
- **Position** — `x` and `y` place a shape's top-left corner in your own units. Shapes without
  both are laid out in a grid below the placed ones.
- **Heading** — the title above the drawing.
- **The block's own text** — up to three lines of prose written directly under the Drawing
  heading appear as a muted caption beneath the drawing.

The drawing is scaled as a whole to fit the slide and centered with its title. In
[page view](../guide/display-modes.md#page) it's drawn just as on the slide.

## Examples

### Many kinds of shape

Beyond rectangles and circles, a drawing knows `cylinder`, `cloud`, `diamond`, `hexagon`,
`star`, `callout`, and more.

```markdown preview theme=standard-dark
## How the tide app works {[drawing fill="#1a365d"]}

### Phone app {#app} {[rectangle x=0 y=60 width=200 height=110 borderRadius=16]}

### Tide service {#api} {[cloud x=320 y=40 width=240 height=150]}

### Gauge readings {#db} {[cylinder x=680 y=40 width=170 height=150]}

### asks {[arrow from=app to=api]}

### reads {[arrow from=api to=db]}
```

### Connector styles

`lineStyle`, `endStyle`, `startStyle`, and `routing` change how a connector is drawn.

```markdown preview theme=standard-dark
## Who approves a grant {[drawing]}

### Applicant {#applicant} {[rectangle x=0 y=0 width=200 height=90]}

### Review panel {#panel} {[diamond x=320 y=-30 width=200 height=150]}

### Board {#board} {[rectangle x=640 y=0 width=200 height=90]}

### Revise {#revise} {[rectangle x=320 y=220 width=200 height=90]}

### {[arrow from=applicant to=panel]}

### approve {[arrow from=panel to=board]}

### send back {[arrow from=panel to=revise lineStyle=dashed routing=orthogonal]}
```

### Captions under shapes

Text under a shape's sub-heading becomes a caption beneath it.

```markdown preview theme=standard-dark
## Stations on the Ridgeline Trail {[drawing]}

### Trailhead {#start} {[circle x=0 y=0 width=120 height=120]}

Parking, water

### Lake camp {#camp} {[circle x=320 y=0 width=120 height=120]}

Mile 6

### Summit {#top} {[star x=640 y=0 width=120 height=120 fill="#92400e"]}

Mile 11

### {[line from=start to=camp]}

### {[line from=camp to=top]}
```

## Parameters

```squisq-docs
template-params
```

The Drawing heading's tag reads these keys:

| Parameter     | What it does                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | Replaces the heading as the title; `title=""` hides it                                                                                       |
| `fill`        | Default fill for shapes that don't set their own (default: none)                                                                             |
| `stroke`      | Default outline and connector color                                                                                                          |
| `colorScheme` | The theme color scheme whose text color outlines shapes and connectors when `stroke` isn't set; without it, the theme's first scheme is used |

Each shape's sub-heading takes:

| Key                                 | What it does                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `x`, `y`                            | Top-left corner, in your own units                                            |
| `width` (or `w`), `height` (or `h`) | Size; rectangles default to 160 × 90 and circles to 120 × 120                 |
| `fill`, `stroke`, `strokeWidth`     | Colors and outline width                                                      |
| `borderRadius`                      | Rounds a rectangle's corners                                                  |
| `dasharray`                         | Dash pattern for the outline, such as `8 4`                                   |
| `from`, `to`                        | On a `line` or `arrow`: the ids of the shapes it joins                        |
| `startStyle`, `endStyle`            | Connector end markers: `arrow`, `open`, `diamond`, `circle`, `square`, `none` |
| `lineStyle`                         | `solid`, `dashed`, or `dotted`                                                |
| `routing`                           | `straight` (default), `orthogonal`, or `curved`                               |

Shape names: `rectangle` (`rect`, `square`), `circle` (`ellipse`, `oval`), `line`, `arrow`,
`text`, `path`, `triangle`, `right-triangle`, `diamond`, `pentagon`, `hexagon`, `octagon`,
`star`, `star4`, `star6`, `parallelogram`, `trapezoid`, `plus`, `chevron`, `arrow-right`,
`arrow-left`, `arrow-up`, `arrow-down`, `double-arrow`, `callout`, `cylinder`, `cloud`, `heart`,
and `lightning`.

## Tips

- **Mind the background.** A drawing paints no background of its own, so in the slideshow it
  sits on a black backdrop. With a light theme, its title, labels, and default outlines are dark
  on black and hard to read, which is why the examples here use the Standard Dark theme. With a
  light theme, give shapes light fills so their labels stay readable.
- **Sketch on a small grid.** Units are your own, so round numbers such as 0, 200, 400 keep
  shapes aligned; the drawing is scaled to fit either way.
- **Name every shape you connect.** A connector whose `from` or `to` doesn't match an id is
  dropped and reported as a warning.
- **Use light fills.** Labels use the shape's own `stroke` color, or else the theme's text color,
  so pale fills keep them readable.
- **Arrange it visually.** In the editor's Write view the drawing becomes a canvas where you can
  drag, resize, and connect shapes; the sub-headings are rewritten to match.

## Related

- [Diagram](diagram.md) — boxes and arrows typed as plain-text art
- [Layout](layout.md) — text, images, and shapes at exact slide positions
- [Box diagrams](../guide/diagrams.md#box-diagrams) and [Mermaid](../guide/diagrams.md#mermaid) —
  other ways to draw

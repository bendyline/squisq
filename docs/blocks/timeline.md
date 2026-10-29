---
template: timeline
description: The Timeline block draws events along one or more horizontal tracks, written as plain-text rails in a code fence.
---

# Timeline

Use Timeline to show when things happen: the phases of a renovation, a product's releases, two
days of a backpacking trip. You draw the timeline as a rail of dashes and dots in a code fence,
and the block draws it again with markers, labels, and callouts in your theme. Several rails
become parallel tracks on a shared scale, and you can link events across tracks. For a single
important date, [Date Event](dateEvent.md) is simpler.

````markdown preview
## Renovating the Central Library {[timeline]}

```timeline
Library: ● Design :: spring 2024 ──────● Demolition :: winter ──────● Steel frame :: summer 2025 ──────◆ Reopening :: fall 2026 ───►
```
````

## How it reads your section

- **The fence** — one code fence in the body. Each line with a rail is a track.
- **Rails** — runs of `─` (or `-`) with markers on them. A rail can end in an arrow (`►`, `▶`,
  `→`, or `>`), and text after the arrow labels the rail's end.
- **Markers** — `●` draws a filled dot, `○` a hollow one, and `◆` a diamond. In plain ASCII, use
  `*` and `o`.
- **Event text** — the words after a marker are its label. Add `::` and more words for a short
  description, as in `● Design :: spring 2024`.
- **Track names** — text before a colon at the start of the line, as in `Library:`, names the
  track.
- **Labels above the rail** — instead of writing labels inline, you can put them on the line just
  above the rail, each starting in its marker's column.
- **Links between tracks** — give events ids with `{#id}`, then add a line such as
  `branch: v1 -> hotfix : security patch` to draw a labeled link from one to the other.
- **Heading** — the title above the timeline.
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports keep it.

Events are placed by their column in the fence, so the spacing you draw is the spacing you get,
and markers in the same column on different tracks line up. Labels alternate above and below the
rail to keep neighbors apart. In [page view](../guide/display-modes.md#page) the timeline is drawn
just as on the slide.

### Getting a fence recognized

Tag the fence ` ```timeline ` and it is always read as a timeline, even with a single event. A
section whose body is only an untagged timeline fence, or one tagged `text`, `txt`, `plaintext`,
`plain`, or `ascii`, becomes a Timeline block automatically when the art clearly is one. With the
`{[timeline]}` tag on the heading, those fences get the same relaxed reading as a
` ```timeline ` fence.

## Examples

### Labels above the rail

Short labels such as years can sit above their markers.

````markdown preview
## Milestones in flight

```timeline
          1903          1927           1947          1969
──────────●─────────────●──────────────●─────────────●──────►
```
````

### Two tracks

Each line is its own track, on the same scale.

````markdown preview
## Two days on the Enchantments loop

```timeline
Day 1: ● Trailhead :: 7 a.m. ────● Lake camp :: 4 p.m. ──►
Day 2: ● Aasgard Pass :: 9 a.m. ─────● Snow Lakes :: noon ──────● Trailhead :: 6 p.m. ──►
```
````

### A link between tracks

`{#id}` names an event, and a `branch:` line links two of them.

````markdown preview
## How the 1.0 hotfix shipped {[timeline colorScheme=purple]}

```timeline
Main:    ● 1.0 {#v1} ──────────● 1.1 {#v11} ──────────● 2.0 {#v2} ───►
Hotfix:  ● 1.0.1 {#fix} ──────────────────────────────────────────────►
branch: v1 -> fix : security patch
```
````

## Parameters

```squisq-docs
template-params
```

- `colorScheme` colors the tracks, markers, and links.
- `tracks` and `links` are filled in from the fence; you never set them in the tag.

## Tips

- **Keep labels short.** A word or two per event, plus a short description, reads best;
  crowded events push their labels together.
- **Space events by time.** Because columns set positions, more dashes between two events means
  more time between them on the slide.
- **Write ids in lowercase without spaces.** `{#v1}` and `{#fix}` are easy to reference in a
  `branch:` line; a link whose ids don't match any event is skipped and reported as a warning.
- **Edit it on the canvas.** In the editor's Write view, click a marker to edit its event, or
  add a point on the rail; the fence text is rewritten to match.

## Related

- [Timelines](../guide/diagrams.md#timelines) — the full fence syntax
- [Date Event](dateEvent.md) — one date, big
- [Diagram](diagram.md) — boxes and arrows
- [Tree](tree.md) — hierarchies such as folders and outlines

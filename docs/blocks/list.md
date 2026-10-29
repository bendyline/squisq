---
template: list
description: The List block shows the list in your section as large, evenly spaced items under the heading.
---

# List

List takes the bulleted or numbered list in your section and gives each item room to breathe —
large type, a clean marker column, and a staggered entrance. It is for the three-to-five-point
slide: things to bring, steps to follow, reasons to care.

Choose it over [Content](content.md) when the list is the point and the prose around it can go.
If the paragraphs matter too, use Content, which shows both.

```markdown preview
## Before you set out {[list]}

- Check the tide table for the crossing
- Pack two liters of water per person
- Tell someone your route and return time
```

## How it reads your section

- **Heading** — the list title, above the items.
- **List** — every item of every list in the body, in order. A bulleted list keeps bullets; a
  numbered list shows `1.` `2.` `3.` Bold, italics, and links inside an item are kept.
- **Nested items** — shown as extra lines inside their parent item, without their own markers.
- **Paragraphs and other prose** — not drawn on the slide. They still count toward the slide's
  timing and the teleprompter in [Narrate](../guide/display-modes.md#narrate), and they stay in
  Word, PDF, and EPUB exports.
- **An image** — the first one becomes an accent strip down the left edge (along the bottom on a
  portrait stage), and the list shifts over to make room.

A heading whose body is only a list becomes a List automatically, so the tag is optional there.
See [automatic templates](../guide/markup.md#automatic-templates).

## Examples

### Numbered steps

A numbered Markdown list shows numbers.

```markdown preview
## Launch checklist {[list]}

1. Freeze the release branch
2. Run the full regression suite
3. Publish the release notes
4. Announce it in the community forum
```

### With an accent image

```markdown preview
## On the trail {[list]}

![Old-growth forest](images/forest.svg)

- Stay on marked paths
- Pack out everything you pack in
- Give wildlife at least 30 meters
```

### Revealed one at a time

`build=items` brings the items in one by one as you advance — useful when you talk through each
point. See [block settings](../guide/tags.md#block-settings).

```markdown preview
## Why the levy matters {[list build=items]}

- It replaces the 1962 pump station
- It protects 4,000 homes from a 100-year flood
- It costs each household about $9 a month
```

### On a dashboard

On a [dashboard](../guide/display-modes.md#dashboard), short lists get larger type so they fill
their cells.

```markdown preview=dashboard
## Bring {[list]}

- Water, two liters
- Rain shell
- Headlamp

## Leave behind {[list]}

- Drones
- Speakers
- Single-use plastic
```

## Parameters

```squisq-docs
template-params
```

These are the values `{[list]}` reads from its tag. Each is plain text, and a misspelled key is
silently ignored rather than reported:

| Parameter        | What it does                                                                                   | Values                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `title`          | The title above the items, in place of the heading                                             | Text                                                                                                               |
| `ordered`        | `ordered=true` numbers the items even when the Markdown list has bullets                       | `true`                                                                                                             |
| `colorScheme`    | The section's accent color in [page view](../guide/display-modes.md#page); slides don't use it | A [color scheme](../guide/themes.md#color-schemes) name such as `blue`, `green`, `purple`, `red`, `orange`, `teal` |
| `imageTreatment` | Regrades the accent image for this block, overriding the theme                                 | `none`, `mono`, `duotone`, `warm`, `cool`                                                                          |

The items always come from the list in the body — an `items=` value on the tag is not read. (A
`json data` fence with an `items` array can supply them instead; see "Structured data fences" in
the [format specification](../SquigglySquare.md).) `ordered=false` has no effect from a tag: to
show bullets, write the list with `-` markers.

## Tips

- Three to five items read best. Longer lists still fit — the layout first pulls the title up,
  then shrinks the type — but past a point the type gets too small to read from a distance, and the
  last items run off the slide.
- Keep each item to a line or two. If an item needs a paragraph, it probably wants its own slide.
- In [page view](../guide/display-modes.md#page), the list becomes an item list section with the
  formatting of each item intact.

## Related

- [Content](content.md) — the list together with the prose around it
- [Two Column](twoColumn.md) — exactly two items side by side
- [Tree](tree.md) — a deeply nested outline drawn as a tree
- [Timeline](timeline.md) — dated steps on a rail

---
template: dateEvent
description: The Date Event block puts a date front and center, with a description of what happened and an optional footer.
---

# Date Event

Date Event marks a moment: an opening day, a deadline, the morning the river crested. The date is
the hero, set large in a color that matches the mood, and the description reads beneath it like a
caption in a history book.

Use it for one milestone per slide. To show several dates in relation to each other, use a
[Timeline](timeline.md).

```markdown preview
## June 14, 2027 {[dateEvent mood=celebratory]}

The Riverside branch library opens its doors after a two-year renovation.
```

## How it reads your section

- **Heading** — the date. Write it however you'd say it: `June 14, 2027`, `Spring 1998`,
  `Day 12`. A long heading steps its size down to fit.
- **Body** — the description, left-aligned under the date. All of the body's text is used, as
  plain text.
- **`footer=`** — an optional muted line at the bottom of the lockup: a place, a source, a time.
- **`mood=`** — tints the date: `neutral` (blue, the default), `somber` (red), or `celebratory`
  (green). The slide's surface always comes from the theme.
- **An image** — the first one in the body becomes an accent strip down the left edge (along the
  bottom on a portrait stage), and the text moves over beside it.

## Examples

### A somber anniversary

```markdown preview
## February 8, 1998 {[dateEvent mood=somber footer="Ravenna Creek gauge station"]}

The creek crested at 14 feet overnight, flooding 300 homes along the lower valley.
```

### With an accent image

```markdown preview
## Day 12 {[dateEvent footer="Upper basin camp, 3,100 m"]}

![The ridge at sunrise](images/mountains.svg)

We reached the col at dawn and saw the glacier for the first time.
```

### Portrait

```markdown preview aspect=portrait
## September 30 {[dateEvent footer="City Hall, Room 210"]}

Public comments on the waterfront plan close at 5 p.m.
```

## Parameters

```squisq-docs
template-params
```

`date` and `description` replace the heading and body when set on the tag. On light themes, the
mood color is deepened so the date keeps its contrast.

## Tips

- Always write a description. A heading-only Date Event repeats the date in the description slot
  on a slide.
- Keep the description to a sentence or two; it shrinks to fit, and clamps with an ellipsis only
  when it runs very long.
- On a [dashboard](../guide/display-modes.md#dashboard), a short Date Event renders with larger
  type to fill its cell.
- In [page view](../guide/display-modes.md#page), each Date Event becomes a milestone on a
  timeline rail, so a run of them reads as a chronology.

## Related

- [Timeline](timeline.md) — many dated events on one rail
- [Stat Highlight](statHighlight.md) — one big number instead of a date
- [Fact Card](factCard.md) — a headline fact with an explanation
- [Section Header](sectionHeader.md) — a divider between eras or chapters

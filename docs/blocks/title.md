---
template: title
description: The Title block opens a deck or a chapter with large centered title text and an optional subtitle.
---

# Title

Use Title for a typographic opener: the first slide of a talk, or the card that starts each chapter
of a longer deck. It draws only words — no picture — so it reads cleanly in every theme.

A slideshow already begins with an automatic cover built from your document's title, so you
rarely need Title for the very first slide. Reach for it inside the deck. If you want the opener
over a photo, use [Image with Caption](imageWithCaption.md) with `isTitle=true`, or
[Big Text](bigText.md) for a louder, thumbnail-style card.

```markdown preview
## Riverside Commons {[title subtitle="A public plan for the east bank, 2027–2035"]}
```

## How it reads your section

- **Heading** — the title, in the theme's title face. A long heading steps its size down so it
  never leaves the frame or runs into the subtitle.
- **`subtitle=`** — the line under the title. On a slide, this is the only way to add one.
- **Body** — not drawn on the slide. It still counts toward how long the slide stays up, it is
  what the [Narrate](../guide/display-modes.md#narrate) teleprompter shows for this block, and it
  stays in your Markdown, so Word, PDF, and EPUB exports include it.

In [page view](../guide/display-modes.md#page), Title becomes the page's lead hero. If you leave
out `subtitle=`, page view uses the first paragraph of the body as the subtitle instead.

## Examples

### Chapter opener

Give each chapter of a long deck its own Title card. A heading-only Title is fine.

```markdown preview
## Part two: the high meadows {[title]}
```

### Tinted glow

`backgroundColor` tints the soft glow behind the title. Any CSS color works.

```markdown preview
## Spring Volunteer Summit {[title subtitle="Saturday, April 18 · Ballard Community Hall" backgroundColor="#e8590c"]}
```

### Subtitle from the body, in page view

In page view the first paragraph becomes the subtitle, so you can write the opener as ordinary
prose and keep the tag bare.

```markdown preview=page
## Riverside Commons {[title]}

A public plan for the east bank, 2027–2035.
```

### Portrait

On a tall stage the title wraps and centers itself.

```markdown preview aspect=portrait
## The Night Market Returns {[title subtitle="Fridays in July"]}
```

## Parameters

```squisq-docs
template-params
```

`backgroundColor` colors the radial glow behind the title, not a solid fill — the slide's surface
always comes from the theme, so text stays readable. Without it the glow uses the theme's primary
color. `title=` replaces the heading text on the slide.

## Tips

- Keep the title to a few words and put the detail in `subtitle=`. A long title shrinks to fit,
  and a short one reads from across the room.
- The subtitle takes one line well and two at most; it steps its size down past that.
- For a section break with a colored band or a background photo, use
  [Section Header](sectionHeader.md) instead.
- Themes can hide the thin accent line above the title.

## Related

- [Section Header](sectionHeader.md) — a divider between sections, optionally over a photo
- [Big Text](bigText.md) — gigantic uppercase display type for covers and thumbnails
- [Image with Caption](imageWithCaption.md) — `isTitle=true` sets a title over a full-bleed photo
- [Tags](../guide/tags.md) and the [settings every block accepts](../guide/tags.md#block-settings)

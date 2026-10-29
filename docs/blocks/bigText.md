---
template: bigText
description: The Big Text block fills the frame with your heading in gigantic uppercase type, alone or over a full-bleed photo.
---

# Big Text

Big Text is the loudest block there is: the heading, uppercase, as large as the frame allows. It is
built for video thumbnails, social cards, and the one slide in a talk that has to land from the
back of the room.

Pick it over [Title](title.md) when the words should be the picture, and over
[Full Bleed Quote](fullBleedQuote.md) when the text is a name or a headline rather than a line
someone said.

```markdown preview
## We rebuilt the bridge {[bigText imageSrc=images/city.svg]}
```

## How it reads your section

- **Heading** — the display text, set in capitals and sized as large as the frame allows, less a
  small margin. The title wraps only between words, never inside one.
- **`imageSrc=`** — an optional full-bleed photo. A soft bloom tinted from the theme's background
  sits behind the words so they stay legible over any picture.
- **Body** — never drawn. Big Text shows the heading alone; anything you write below it feeds the
  slide's timing and the [Narrate](../guide/display-modes.md#narrate) teleprompter, and stays in
  Word, PDF, and EPUB exports.

Set the photo with `imageSrc=`. In a slideshow, an image in the body is not used as the
background — it appears in a framed box below the shrunken title instead.

## Examples

### No image

Without a photo, the words sit on the theme's surface with a soft glow of its primary color.

```markdown preview
## Open studio night {[bigText]}
```

### Frosted glass

`backdrop=frosted` leaves the photo clear and sets the title on a frosted-glass plate that hugs the
words.

```markdown preview
## Coastline 2040 {[bigText imageSrc=images/ocean.svg backdrop=frosted]}
```

### Title in the upper half

`placement=upper` fits the words into the top half of the frame — on a vertical video that keeps
them clear of captions burned into the bottom.

```markdown preview aspect=portrait
## Three days on the ridge {[bigText imageSrc=images/mountains.svg placement=upper]}
```

### A different theme

Big Text takes its face and colors from the theme, so the same words change character with it.

```markdown preview theme=bold
## Launch day {[bigText]}
```

## Parameters

```squisq-docs
template-params
```

Two more values shape the layout. They aren't in the parameter catalog yet, so
`squisq validate` reports them as unknown inputs, but the block reads them:

| Parameter   | What it does                                                                                               | Values                     |
| ----------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| `placement` | Where the title sits: the whole frame (default), or the top or bottom half                                 | `center`, `upper`, `lower` |
| `backdrop`  | What keeps the title legible over the photo: the tinted bloom (default) or a frosted plate. Needs an image | `bloom`, `frosted`         |

`ambientMotion` defaults to a slow zoom in whenever there's an image. `imageTreatment` (`none`,
`mono`, `duotone`, `warm`, `cool`) regrades the photo for this block.

## Tips

- Two to five short words is the sweet spot. Long titles still fit, but the type gets smaller
  with every word, and a single very long word limits the size of all of them.
- Busy photos fight the text. The bloom helps; `backdrop=frosted` helps more.
- In [page view](../guide/display-modes.md#page), Big Text becomes a lead hero band — the photo as
  its background when there is one, and still the title alone.

## Related

- [Title](title.md) — a quieter opener with a subtitle
- [Section Header](sectionHeader.md) — a divider over a photo or color band
- [Full Bleed Quote](fullBleedQuote.md) — a short dramatic line from the body
- [Themes](../guide/themes.md) — where Big Text gets its typeface and colors

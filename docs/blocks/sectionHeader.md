---
template: sectionHeader
description: The Section Header block marks a new part of your document with a large title on a colored band or over a background photo.
---

# Section Header

Section Header is a divider. It tells the audience "a new part starts here" and shows nothing but
the section's name — on a solid color between two thin rules, or over a full-bleed photo.

Choose it over [Title](title.md) when the slide separates parts of one talk rather than opening
it, and over [Big Text](bigText.md) when you want a calm break instead of a shout.

```markdown preview
## Part two: the high meadows {[sectionHeader imageSrc=images/mountains.svg]}
```

## How it reads your section

- **Heading** — the section title, centered. A long heading steps down in size and is bracketed by
  rules that follow its wrapped height.
- **`imageSrc=`** — the background photo, cropped to fill the slide with a slow zoom and a
  theme-tinted scrim behind the text. Without it the slide is a solid band from `colorScheme`.
- **Body** — not drawn. It still sets how long the slide stays up and what the teleprompter shows
  in [Narrate](../guide/display-modes.md#narrate), and it stays in Word, PDF, and EPUB exports.

> [!IMPORTANT]
> Put the background picture in `imageSrc=`, not in the body. In a slideshow, a Section Header
> whose body holds an image is shown as an [Image with Caption](imageWithCaption.md) slide —
> the photo full-bleed with the heading as its caption.

You rarely need to type this tag. A heading with only prose under it is the structural default,
and in a slideshow it renders as a [Content](content.md) slide so none of your words are lost. Tag
the heading `{[sectionHeader]}` when you really want the divider.

## Examples

### Solid color band

With no image, the band takes its color from `colorScheme`.

```markdown preview
## Budget and timeline {[sectionHeader colorScheme=green]}
```

### Photo with a gentle pan

`ambientMotion` changes the slow movement of the background photo.

```markdown preview
## Life on the waterfront {[sectionHeader imageSrc=images/harbor.svg ambientMotion=panLeft]}
```

### Black-and-white grade

`imageTreatment` regrades the photo for this one block — useful when a divider should feel quieter
than the slides around it.

```markdown preview
## Lessons from the 1998 flood {[sectionHeader imageSrc=images/city.svg imageTreatment=mono]}
```

### Portrait

```markdown preview aspect=portrait
## Day three: the summit {[sectionHeader imageSrc=images/mountains.svg]}
```

## Parameters

```squisq-docs
template-params
```

`colorScheme` only matters without an image: it sets the band and the title color. Scheme names
come from the theme — most themes have `blue` (the default), `green`, `purple`, `red`, `orange`,
and `teal`; see [color schemes](../guide/themes.md#color-schemes). `ambientMotion` only matters with
an image; without it the photo zooms in slowly. `imageTreatment` (`none`, `mono`, `duotone`,
`warm`, `cool`) overrides the theme's photo grade for this block.

## Tips

- Name sections the way a table of contents would: "Budget and timeline", not "Next, let's talk
  about money".
- Use one look for every divider in a deck — all photos, or all solid bands — so the rhythm reads
  as structure.
- In [page view](../guide/display-modes.md#page), a Section Header is a banner across the page,
  with the photo as its background when you set `imageSrc`.

## Related

- [Title](title.md) — the opening card for a deck or chapter
- [Big Text](bigText.md) — gigantic uppercase type, for covers and thumbnails
- [Image with Caption](imageWithCaption.md) — a photo with a caption band
- [Automatic templates](../guide/markup.md#automatic-templates) — what untagged headings become

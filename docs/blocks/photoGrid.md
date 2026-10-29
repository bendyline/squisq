---
template: photoGrid
description: The Photo Grid block tiles two to four photos across the slide, with the heading as a caption.
---

# Photo Grid

Use Photo Grid when one picture isn't enough: a field trip, a before-and-after, the four rooms
of an exhibit. It tiles up to four photos edge to edge and lays the heading over them as a
caption. For a single photo, use [Image with Caption](imageWithCaption.md); to pair one photo
with text, use [Left Feature](leftFeature.md) or [Right Feature](rightFeature.md).

You often don't need the tag at all. A section whose body is nothing but two to four images
becomes a photo grid on its own:

```markdown preview
## Field week at Cedar Lake

![The ridge above camp](images/mountains.svg) ![Old-growth cedars on the north shore](images/forest.svg) ![Morning on the lake](images/ocean.svg)
```

## How it reads your section

- **Images** — the first four images in the body, in the order you wrote them. Each fills its
  tile and is cropped to fit. The alt text isn't shown; it describes the photo for screen
  readers.
- **Heading** — the caption, in a translucent band across the lower part of the grid. Long
  captions shrink to fit on one line (two on a portrait slide).
- **Other text** — not drawn on the slide. A section with prose besides the images isn't picked
  as a photo grid automatically.

The tiles follow the number of photos:

| Photos | Landscape slide                                       | Portrait slide      |
| ------ | ----------------------------------------------------- | ------------------- |
| 1      | Fills the slide                                       | Fills the slide     |
| 2      | Side by side                                          | One above the other |
| 3      | One large photo on the left, two stacked on the right | Three stacked rows  |
| 4      | A 2×2 grid                                            | A 2×2 grid          |

In [page view](../guide/display-modes.md#page) the section becomes a gallery of the same photos
with the caption beneath.

> [!NOTE]
> In the slideshow, a section with an explicit `{[photoGrid]}` tag doesn't yet pick up the
> images in its body. Until it does, leave the tag off as above, or list the images in a
> `json data` fence as in [Setting the caption and motion](#setting-the-caption-and-motion).

## Examples

### Two photos

Two photos split the slide down the middle, a natural fit for then-and-now pairs.

```markdown preview
## The waterfront, then and now

![The harbor before the redevelopment](images/harbor.svg) ![The new downtown skyline from Pier 4](images/city.svg)
```

### Four photos

Four photos fill a 2×2 grid.

```markdown preview
## Open house at the maker space

![The team at the welcome table](images/team.svg) ![Benches in the wood shop](images/workshop.svg) ![The view from the rooftop deck](images/city.svg) ![The harbor from the loading dock](images/harbor.svg)
```

### Setting the caption and motion

With the tag you can set your own caption and give the first photo a slow zoom or pan. List the
photos in a `json data` fence, each with its `src` and `alt`.

````markdown preview
## Cedar Lake {[photoGrid caption="Cedar Lake field station, July" ambientMotion=zoomIn]}

```json data
{
  "images": [
    { "src": "images/mountains.svg", "alt": "The ridge above camp" },
    { "src": "images/forest.svg", "alt": "Cedars on the north shore" }
  ]
}
```
````

## Parameters

```squisq-docs
template-params
```

- `caption` defaults to the heading when the grid is picked automatically.
- `ambientMotion` moves only the first, largest photo; the others fade or wipe in one after
  another, depending on the theme.
- The `images` parameter doesn't accept a list of paths yet. Put the photos in the body, or in a
  `json data` fence as above.

## Tips

- **Choose photos that crop well.** Every tile is cropped to fill its space, so keep the subject
  near the middle of each photo.
- **Put the strongest photo first.** With three photos, the first gets the large tile on the
  left.
- **Keep the caption short.** It sits on one line over the photos and shrinks to fit.
- **Stop at four.** Photos after the fourth aren't shown. Split a bigger set across two
  sections.

## Related

- [Image with Caption](imageWithCaption.md) — one full-bleed photo with a caption
- [Media Only](mediaOnly.md) — the media fills the slide with no text
- [Bottom Feature](bottomFeature.md) — a headline and text above full-width media
- [Images](../guide/media.md#images) and
  [automatic templates](../guide/markup.md#automatic-templates)

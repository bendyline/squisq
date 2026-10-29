---
template: map
description: The Map block fills the slide with a map centered on a place you choose, with an optional title, caption, and markers.
---

# Map

Use Map to show where something is: the start of a hiking route, the sites in a field study,
the venue for an event. You give it a point and a zoom level, and it fills the slide with a map
drawn from free, open map tiles, with the heading as a title across the top.

```markdown preview
## Mount Rainier from Paradise {[map center="46.8529,-121.7604" zoom=12]}
```

## How it reads your section

- **`center`** — the point the map is centered on, as `"latitude,longitude"` in decimal degrees.
  This is required: you can copy it from most map apps by right-clicking a spot.
- **`zoom`** — how close in to look. Always set it.
- **Heading** — the title, in a band across the top of the map.
- **Markers** — pins placed with a `json data` fence in the body (see
  [Pins on the map](#pins-on-the-map)).
- **Other text** — not drawn on the slide or in page view. It stays in your document, so Word
  and PDF exports keep it.

The map is put together from map tiles fetched from the style's provider when the slide is
shown, so a map needs an internet connection, and the tile provider's credit appears in the
corner. In [page view](../guide/display-modes.md#page) the map is drawn just as on the slide.

## Examples

### A road map with a caption

`mapStyle=road` uses OpenStreetMap's street map, and `caption` adds a line at the bottom.

```markdown preview
## The festival grounds {[map center="47.6205,-122.3493" zoom=15 mapStyle=road caption="Gates open at 10 a.m. on the Fisher Pavilion lawn"]}
```

### Pins on the map

List markers in a `json data` fence: each needs a `lat` and `lng`, and can carry a `label`, a CSS
`color`, and an `icon` of `pin`, `circle`, or `star`.

````markdown preview
## Ferry terminals on Elliott Bay {[map center="47.612,-122.43" zoom=11 mapStyle=road]}

```json data
{
  "markers": [
    { "lat": 47.6026, "lng": -122.3393, "label": "Colman Dock" },
    { "lat": 47.6229, "lng": -122.5103, "label": "Bainbridge Island", "color": "#2563eb" },
    { "lat": 47.5115, "lng": -122.4646, "label": "Vashon", "icon": "star" }
  ]
}
```
````

### Satellite imagery

`mapStyle=satellite` shows aerial imagery, which suits landscapes.

```markdown preview
## Crater Lake from above {[map center="42.9446,-122.109" zoom=12 mapStyle=satellite]}
```

## Parameters

```squisq-docs
template-params
```

How far a zoom level reaches, roughly:

| Zoom  | Shows                              |
| ----- | ---------------------------------- |
| 4–6   | A large country or a few states    |
| 8–10  | A metro region or a national park  |
| 11–13 | A city or a small town             |
| 14–16 | Neighborhood streets and buildings |

- `title` replaces the heading as the map's title; `title=""` shows the map alone.
- The map styles come from different providers: `terrain` (the default) from OpenTopoMap,
  `road` from OpenStreetMap, `satellite` from Esri, and `toner` and `watercolor` from Stadia
  Maps.
- `center` can also go in a data fence, as `"center": { "lat": 47.61, "lng": -122.33 }`.

## Tips

- **Stick to `terrain`, `road`, or `satellite` for documents you share.** Stadia Maps serves its
  `toner` and `watercolor` tiles only to sites registered with it, so elsewhere those styles can
  come back blank.
- **Zoom in a level past where you think.** A slide is smaller than a map app's window; a tighter
  zoom keeps the place recognizable.
- **Labels on markers are small.** They suit a few short names. Put longer descriptions in the
  caption or on the next slide.
- **Offline viewing.** Without a connection the map area stays a plain gray. Where the app
  showing the document blocks outside requests, it shows a notice in place of the map.

## Related

- [Image with Caption](imageWithCaption.md) — a photo of the place, captioned
- [Diagram](diagram.md) — boxes and arrows when geography doesn't matter
- [Tags](../guide/tags.md) — how parameters are written

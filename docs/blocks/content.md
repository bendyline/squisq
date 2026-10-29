---
template: content
description: The Content block shows a section's heading and its complete body — paragraphs, lists, links, and formatting — in a clean reading layout.
---

# Content

Content is the safe choice. It shows everything you wrote under the heading, in order, with lists,
bold, italics, and links intact. Nothing is summarized and nothing is dropped.

A plain heading with prose under it already renders as Content in a slideshow, so you only need the
tag to override something else — an automatic template, or a tag you want to back out of while you
draft. Choose a display block such as [Stat Highlight](statHighlight.md) or [Quote](quote.md) when
one striking thing should carry the slide; come back to Content when every sentence matters.

```markdown preview
## Where your donations went {[content]}

Every dollar raised this year went to three programs:

- **Food rescue** — 1.2 million meals recovered from grocers
- **Pantry network** — 14 new neighborhood pantries
- **Delivery** — weekly drop-offs for 600 homebound seniors
```

## How it reads your section

- **Heading** — the title, top left.
- **Body** — all of it, top to bottom: paragraphs, bulleted and numbered lists (nesting kept),
  blockquotes, tables, and inline formatting and links. Blank-line spacing follows your
  source.
- **Media** — an image, video, [Mermaid diagram](../guide/diagrams.md#mermaid), or
  [SVG picture](../guide/diagrams.md#svg-pictures) in the body gets its own framed area on the
  slide, and the text makes room for it. A diagram's source or a video link isn't repeated as
  text, but an image's alt text stays in the body as a line of its own.

The type steps down as the body grows, so a long section still fits; past a few hundred words it
gets small. When that happens, split the section in two.

## Examples

### With an image

The text column narrows to make room for the picture.

```markdown preview
## The new pier {[content]}

Construction starts in March. The pier adds forty boat slips and a public fishing deck, and replaces the 1962 timber structure that failed inspection last fall.

![The north pier at low tide](images/harbor.svg)
```

### Revealed point by point

A [build](../guide/tags.md#block-settings) reveals the body a piece at a time. With
`build=items`, the opening sentence shows at once and the list arrives one item at a time.

```markdown preview
## Before the vote {[content build=items]}

Three questions the council still needs answered:

1. What does the second phase cost?
2. Who maintains the new plantings?
3. How do we measure success after year one?
```

### In page view

Page view shows a Content block as ordinary prose under its heading, with the formatting intact.

```markdown preview=page
## Getting to the summit {[content]}

Leave the trailhead by 5 a.m. The last two kilometers climb 400 meters over loose scree, and afternoon storms build quickly above the treeline.

- Carry two liters of water
- Turn back by 1 p.m., **summit or not**
```

## Parameters

```squisq-docs
template-params
```

`title=` replaces the heading on the slide; the body always comes from the section.

## Tips

- Content is the right first draft for a generated deck: everything is visible, so you can see
  which slides deserve a more visual template.
- On a [dashboard](../guide/display-modes.md#dashboard), a short Content block automatically
  renders with larger type so it doesn't look lost in its cell.
- Write each paragraph as a single line. A slide keeps the line breaks inside a paragraph, so a
  paragraph hard-wrapped at 80 columns breaks on the slide at the same places.
- For media that should span the full width, try [Top Feature](topFeature.md) or
  [Bottom Feature](bottomFeature.md). They lay out the same text the same way, without repeating
  the image's alt text.

## Related

- [List](list.md) — just the list, large and spaced out
- [Fact Card](factCard.md) — a headline fact with an explanation
- [Two Column](twoColumn.md) — two short items side by side
- [Automatic templates](../guide/markup.md#automatic-templates) — what untagged headings become

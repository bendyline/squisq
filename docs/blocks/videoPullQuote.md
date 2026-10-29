---
template: videoPullQuote
description: The Video Pull Quote block sets a large quotation over a silent, full-bleed video clip from your document.
---

# Video Pull Quote

Use Video Pull Quote for the line you want people to remember, set over moving footage: a
voice from an interview over the place they talk about, a mission statement over the work
itself. The clip fills the slide behind a dark wash, plays silently, and the quote sits on top
with its attribution. It's the moving-picture version of [Pull Quote](pullQuote.md), which uses
a still photo.

The background must be a video file stored with your document, such as a clip you recorded in
the editor or uploaded. This example names a clip that isn't on this site, so the preview shows
its poster frame, the still a video displays before it plays:

```markdown preview
## Voices from the waterfront {[videoPullQuote attribution="Marisol Vega, harbor pilot"]}

> Every ship that comes in here, I've met a mile out. You learn this water like a neighbor.

<video src="media/pilot-interview.mp4" poster="images/harbor.svg"></video>
```

## How it reads your section

- **Quote** — the first block quote in the body. Without one, the body text is used, and
  without body text, the heading.
- **Video** — the first video file in the body: a `<video>` tag (what the editor's recorder and
  Insert → Image/Media write) or a link to an `.mp4`, `.webm`, `.mov`, `.m4v`, or `.ogv` file.
  Its `poster` image shows until the clip starts.
- **Attribution** — the `attribution=` parameter only. A `— Name` line inside the quote is read
  as part of the quote.
- **Heading** — not drawn when there's a quote. It names the section in the outline and in
  exports.

The clip starts at its beginning and plays, muted, for as long as the slide is up. Without a
video file, the quote appears on the theme's surface, like a Pull Quote with no photo.

In [page view](../guide/display-modes.md#page) the section becomes a full-width quote band over
the same clip.

## Examples

### A link to the clip

A plain link to a video file works as well as a `<video>` tag, though a link can't carry a
poster.

```markdown
## From the night shift {[videoPullQuote attribution="Dev Okafor, line cook"]}

> The kitchen is loudest at 2 a.m., and that's when it's most like a family.

[Night shift in the kitchen](media/night-shift.mp4)
```

### Choosing part of a clip

The `data-squisq-video-clip-start` and `data-squisq-video-clip-end` attributes pick which part
of the clip plays, in seconds: here, from 0:42 to 0:51.

```markdown
## Why we build {[videoPullQuote attribution="Ana Ruiz, founder"]}

> We make tools we'd want to use on our worst day.

<video src="media/founder-interview.mp4" poster="media/founder-still.jpg"
  data-squisq-video-clip-start="42" data-squisq-video-clip-end="51"></video>
```

## Parameters

```squisq-docs
template-params
```

The template reads these keys from the tag:

| Parameter     | What it does                                              |
| ------------- | --------------------------------------------------------- |
| `attribution` | The speaker or source, shown under the quote after a dash |
| `text`        | Replaces the quote read from the body                     |

The background clip has no tag parameter; it always comes from the body.

## Tips

- **Hosted videos don't work as the background.** A YouTube or Vimeo link plays in its own
  interactive player, which can't sit behind text; in this block it appears as a small inset
  player in a corner of the slide. For a hosted video, use
  [Video with Caption](videoWithCaption.md).
- **Keep the quote short.** One or two sentences read well over moving footage. Long quotes
  shrink and are cut off.
- **Choose calm footage.** The dark wash keeps text readable, but busy, high-contrast motion
  still competes with it.
- **The clip is silent.** Narration is the only sound while the slide plays.

## Related

- [Pull Quote](pullQuote.md) — the same lockup over a still photo
- [Quote](quote.md) and [Full Bleed Quote](fullBleedQuote.md) — quotes without a background
- [Video with Caption](videoWithCaption.md) — a video with a caption
- [Audio and video clips](../guide/media.md#audio-and-video-clips)

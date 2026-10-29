---
template: videoWithCaption
description: The Video with Caption block plays one video, from YouTube, Vimeo, Loom, Wistia, or a clip in your document, with the heading as its caption.
---

# Video with Caption

Use Video with Caption when a section is about one video: a talk, a product demo, a short film.
The player takes most of the slide and the heading becomes its caption. Paste a link to the
video's page and that's all it needs. To set a video under a headline and some text, use
[Top Feature](topFeature.md) or [Bottom Feature](bottomFeature.md); to let it fill the slide
with no caption, use [Media Only](mediaOnly.md).

```markdown preview
## Sintel, the Blender Foundation's open movie {[videoWithCaption]}

https://www.youtube.com/watch?v=eRsGyueVLvQ
```

A section whose body is only a video link gets this template automatically, so the tag is
optional here.

## How it reads your section

- **Video** — the first video in the body. That can be:
  - a link to a video page on YouTube, Vimeo, Loom, or Wistia, on its own line, either bare or
    as `[title](url)` — see [hosted videos](../guide/media.md#hosted-videos);
  - a video file in your document, as a `<video>` tag (what the editor's recorder and
    Insert → Image/Media write) or a link to an `.mp4`, `.webm`, or similar file.
- **Heading** — the caption.
- **Link text** — when the video is written as `[title](url)`, the title labels the player:
  it's shown on the poster frame and read by screen readers.
- **Other text** — not drawn on the slide.

A hosted video plays in its provider's own player, framed on the slide with the caption beneath
it, so the caption never covers the controls. A video file fills the whole slide and the caption
sits in a translucent band over it.

In [page view](../guide/display-modes.md#page) the section becomes a figure: the player with the
caption under it.

## Examples

### A titled link

Write the link as `[title](url)` to label the player. The heading is still the caption.

```markdown preview
## Spring, from the Blender Studio {[videoWithCaption]}

[Spring — Blender Open Movie](https://www.youtube.com/watch?v=WhWc3b3KhnY)
```

### Your own caption

`caption=` replaces the heading as the caption, so the heading can stay short for the outline.

```markdown preview
## Keynote {[videoWithCaption caption="Opening keynote, Animation Summit 2025"]}

https://www.youtube.com/watch?v=R6MlUcmOul8
```

### A video file in your document

A clip stored with your document plays full-bleed, with the caption over it. `poster` sets the
still shown before it plays.

```markdown
## Launching the survey boat {[videoWithCaption captionPosition=top]}

<video src="media/launch.mp4" poster="media/launch-still.jpg" controls></video>
```

## Parameters

```squisq-docs
template-params
```

- `videoSrc` is normally read from the body; set it only to override the video.
- `captionPosition`, `clipStart`, `clipEnd`, `posterSrc`, and `videoCredit` apply to video files.
  A hosted player always shows its caption below the frame and starts where the link says.
- `clipStart` and `clipEnd` are in seconds. Without `clipEnd`, a clip plays for the length of the
  slide.

## Tips

- **Use the page link.** Copy the address from the video's page (or its Share button). The
  player is always built from the video's id, so tracking parameters in the link don't matter.
- **Start partway in.** A YouTube link with a start time (`?t=90`) starts the player there.
- **Exports show a still.** Video exports and image captures draw a poster frame in place of a
  hosted player, and Word gets a real online video.
- **One video per section.** Only the first video is used; put others in their own sections.

## Related

- [Video Pull Quote](videoPullQuote.md) — a quote over a background video
- [Media Only](mediaOnly.md) — the video fills the slide, with no caption
- [Image with Caption](imageWithCaption.md) — the same layout for a photo
- [Hosted videos](../guide/media.md#hosted-videos) and
  [audio and video clips](../guide/media.md#audio-and-video-clips)

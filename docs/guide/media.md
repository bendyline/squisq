---
title: Images and media
description: Add pictures, online videos, and timed audio and video clips to a document, and record your own in the editor.
---

# Images and media

A document's pictures, recordings, and other files live beside it, and the Markdown refers to them
by path. Online videos are links to the video's page. Clips that play on the presentation's clock
are tags in the section they belong to.

## Images

Write an image the usual Markdown way: alt text in brackets, the path in parentheses.

```markdown preview
## The north pier at dawn

![Fishing boats moored along the north pier](images/harbor.svg)

The pier was rebuilt in 2019 and now berths forty-two boats.
```

A section with one image becomes a feature slide automatically, with the picture on one side and
the text on the other; two or more images become a [photo grid](../blocks/photoGrid.md). Any block
that shows a picture can take it from the body, so `![…](…)` is usually all you need. See
[automatic templates](markup.md#automatic-templates) and the media blocks in the
[block gallery](../blocks/index.md).

### Alt text

The text in brackets is the picture's accessible name: screen readers read it, exports carry it,
and it is what appears when the picture can't be shown. Describe what the picture shows and why it
matters, not "image of". A picture that is pure decoration can have empty alt text, `![](…)`.

### Paths

A relative path (`images/harbor.svg`) points at a file stored with the document — in the editor,
the files in the Files panel. A full `https://` address points at a picture on the web. It shows in
the editor and the player, but exports never download pictures from the web, so keep any picture an
export needs with the document.

### Size

Markdown has no syntax for an image's size. In the Write view, drag an image's corner to resize it;
double-click the handle to go back to its natural size. A resized image is written as an HTML
`<img>` tag, which every Markdown viewer understands:

```html
<img src="images/harbor.svg" alt="Fishing boats moored along the north pier" width="320" height="213">
```

The size applies wherever the document reads as flowing text — the Write, Page, and Document views
and plain HTML. A slide sizes each picture to fit its layout.

### Animated images

An animated GIF, WebP, or APNG plays like any image. In the Write view and in the Page view's text,
it gets a play/pause button; it starts paused for readers whose system asks for reduced motion.

### SVG files

An `.svg` file works as an image too. Squiggly Square cleans every SVG before showing it — no
scripts, no links to other files — and keeps the file's own colors. To write the SVG into the
document instead of attaching a file, use an SVG fence; see [SVG pictures](diagrams.md#svg-pictures).

### Adding images in the editor

- **Insert → Image/Media** picks a file from your computer.
- **Drag** files onto the editor to store them and insert them at the caret.
- **Paste** a picture — a screenshot, or an image copied from another app.
- **The Files panel** lists every file stored with the document, with thumbnails, sizes, and a badge
  on any file the document doesn't use. Upload from there, or drag a file from the panel into the
  text.

Images are inserted as their own paragraph. Video and audio files are inserted as players (see
[Audio and video tags](#audio-and-video-tags)), and a data file as a table reference (see
[Data files](data-and-charts.md#data-files)). Any other file — a ZIP, a PDF — is stored beside the
document and inserted as a link to it. **Insert → File** accepts any kind of file and handles it the
same way.

### Copying media between documents

Select an image, video, or audio clip in the Write view and press **Ctrl/⌘+C** or **Ctrl/⌘+X** (or
right-click it and choose **Copy** or **Cut**). Paste into the same document and it refers to the
same file; paste into another document and the file is copied there too, renamed if that name is
taken. Copying an image also puts the picture itself on the clipboard, so you can paste it into
other apps.

### Editing an image

Click **Edit** on a PNG, JPEG, or WebP image in the Write view to open the image editor. Add text,
shapes, other images, and red markup arrows, boxes, and notes as layers; crop; then choose **Save and
close**. The edited picture replaces the file. When the app keeps the document's files together, as
the demo editor does, the layers are kept too, so you can come back and change them. SVGs and animated images have no **Edit** button, because saving would flatten them
into a still picture.

## Hosted videos

To show a YouTube, Vimeo, Loom, or Wistia video, put a link to its page in a paragraph of its own:

```markdown preview
## Watch the short film

[Big Buck Bunny, from the Blender Foundation](https://www.youtube.com/watch?v=aqz-KE-bpKQ)
```

The link text is the video's title: readers who can't see the player hear it, and exports use it
where they name the video. A bare URL works too:

```markdown preview
## Watch the short film

The Blender Foundation made this short with open-source tools.

https://youtu.be/aqz-KE-bpKQ?t=30
```

Squiggly Square recognizes watch pages, short links (`youtu.be/…`), YouTube Shorts, live streams and
playlists, unlisted Vimeo links, Loom share pages, and Wistia media pages. A start time in the link
(`?t=60`, `#t=1m30s`) is kept. A link inside a sentence, a list, or a quote stays an ordinary link.

A section whose body is only a video becomes a [video with caption](../blocks/videoWithCaption.md)
slide, with the heading as its caption. A video beside other content goes into the slide's media
area, as in the second example.

Wherever a player isn't possible, the video is still a working link. That is the point of writing it
as a link: any Markdown viewer shows something useful.

| Where                      | A hosted video shows as                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Write view                 | The player above the link paragraph, which stays editable as the caption                    |
| Slides and dashboards      | The player on the current slide; a picture of the video in thumbnails and previews          |
| Page view and HTML exports | The player                                                                                  |
| Document view              | A linked card with the video's thumbnail, where the provider offers one                     |
| DOCX                       | A Word online video: a picture of the video that Word can play, with a caption linked to it |
| PPTX                       | A picture of the video that opens its page when clicked                                     |
| PDF and EPUB               | The link                                                                                    |
| MP4, GIF, and PNG          | A still placeholder: online videos don't play inside an exported video                      |

The player is built from the video's id on the provider's own site — for YouTube, its
privacy-enhanced `youtube-nocookie.com` player — never from the address as written.

In the Write view, **Insert → Online Video** opens a dialog: paste a link or the provider's embed
code, check the preview, and optionally add a title, which becomes the link text. With the caret on
a video paragraph, the same command edits that video. Pasting a provider's `<iframe>` embed code
into the Write view turns it into a link paragraph, and an `<iframe>` already in the document gets a
**Use a link instead** button.

Importing an HTML page or a Word document turns its embedded videos back into links.

## Audio and video clips

Clips play on the presentation's clock: they start with their section, at a moment you choose, and
play in the Video view and in exported video. Write a clip as a tag on a line of its
own in the section's body:

```markdown
## Arrival at the north pier

The ferry docks while the gulls circle.

{[audio src=audio/gulls.mp3 startAt=2 clipStart=4 clipEnd=0:12]}
```

`{[audio …]}` and `{[video …]}` make an audio or video clip; `{[media …]}` means the same as
`{[audio …]}`. A section can have several clips. The clip's tag never appears as text.

### Clip settings

| Setting       | What it does                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src`         | The media file. Required                                                                                                   |
| `startAt`     | When the clip starts, counted from the start of its section (default `0`). `startTime` also works                          |
| `clipStart`   | Where in the file to start playing — trims the beginning                                                                   |
| `clipEnd`     | Where in the file to stop — trims the end. Without it the clip plays until the file or the section ends                    |
| `spillover`   | `true` lets the clip keep playing after its section ends                                                                   |
| `anchor`      | `document` makes the clip span the whole document (also written `span=document`)                                           |
| `placement`   | Video only: `pip` (or `picture-in-picture`) for a small window in a corner, `overlay` (or `full-frame`) to cover the slide |
| `pipPosition` | `top-left`, `top-right`, `bottom-left`, or `bottom-right`                                                                  |
| `pipSize`     | `small` or `large`                                                                                                         |
| `pipShape`    | `square` or `wide`                                                                                                         |
| `lockToBlock` | Placed video only. `false` frees the video from its section, so it can run across later sections                           |

Times can be seconds (`5`, `5.5`), minutes and seconds (`1:30`, `01:30.500`), or milliseconds
(`1500ms`). A clip with `startAt=5` in a section that starts at 3:30 plays at 3:35. To control when a
section itself starts and how long it shows, see [block settings](tags.md#block-settings).

A video clip without `placement` follows the document's own video setting, `squisq-video-presentation`
in the [frontmatter](frontmatter.md): `background` (the default) plays it behind the slide,
`full-frame` over it, and `picture-in-picture` in a corner. `squisq-pip-size`, `squisq-pip-shape`, and
`squisq-pip-position` set the default window.

### A clip for the whole document

A clip with `anchor=document` plays from the start of the document across every section — a
narration or a soundtrack. Put it before the first heading:

```markdown
{[audio src=audio/harbor-tour.mp3 anchor=document]}

# Harbor tour

## Arrival
```

Its `startAt` counts from the start of the document. Recording a narration in the editor writes this
tag for you; see [Narration](narration.md).

### Audio and video tags

The editor's recorder, dropped files, and **Insert → Image/Media** write HTML tags rather than clip
tags:

```html
<video src="video/deck-tour.webm" controls width="480"></video>

<audio src="audio/foghorn.webm" controls></audio>
```

A plain `<video>` is part of its section's content: a section whose body is only a video becomes a
video slide, and in flowing text it is a player. In the Write view, a video's placement buttons
choose **In layout**, **PIP**, or **Overlay**. **PIP** and **Overlay** turn it into a timed clip
written with the same settings as HTML attributes:

```html
<video src="video/captain.webm" controls data-squisq-video-placement="picture-in-picture"></video>
```

A placed video is locked to its section: it starts with it and stops when it ends. Turn off **Lock
to block** to move and resize it freely on the editor's Timeline (View → Timeline), where it can
run across several sections.

### Trims, fades, and cleanup

Edits to a clip never change the file; they are more settings on the tag, applied as it plays and
when you export.

| Setting   | What it does                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `cuts`    | Ranges of the file to skip, as `start-end` pairs: `cuts="12.4-13.1 40.2-41"`                          |
| `gain`    | Volume change in decibels, from −60 to +24                                                            |
| `fadeIn`  | Seconds to fade in at the start                                                                       |
| `fadeOut` | Seconds to fade out at the end                                                                        |
| `crop`    | Video only: the part of the frame to keep, as fractions `x y width height`: `crop="0.1 0.05 0.8 0.9"` |
| `fx`      | Audio cleanup: `highpass`, `denoise`, `debreath`, and `loudness`, each with an optional value         |

```markdown
{[audio src=audio/interview.webm fx="highpass:80 denoise:0.8 loudness:-16" cuts="12.4-13.1" fadeOut=0.5]}
```

On an `<audio>` or `<video>` tag the same settings are attributes: `data-squisq-audio-gain="-3"`,
`data-squisq-video-fade-in="0.5"`.

You rarely type these. In the Write view, click the edit button on an audio or video player, or
right-click it and choose **Edit clip…**, to open an editor with these tabs:

- **Audio cleanup** — **Clean up voice**, **Levels only**, or **None**, then fine-tune the rumble
  filter, noise reduction, breath reduction, and loudness (with targets for web and podcast,
  streaming, and broadcast). The cleaned-up sound is rendered in the background and kept beside the
  document; the original file is untouched.
- **Timing** — **Find pauses** shortens every pause longer than the length you choose, and you can
  set the volume and fades.
- **Frame** (video) — crop to a free shape or to 16:9, 1:1, 9:16, or 4:3.

**Apply** writes the settings onto the tag in one undoable step. For a screen recording with a
camera beside it, the cleanup and cuts apply to both files. Developers can find the full recipe format in
[Media edits](../media-edits.md).

## Recording in the editor

Use **Insert → Record media** to record from your microphone, camera, or screen, without leaving the
editor. Choose the sources:

| Sources                           | You get                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Microphone                        | An audio file and an `<audio>` player                                                                            |
| Camera (with microphone)          | A video file and a `<video>` player                                                                              |
| Screen (with microphone)          | A screen recording and a `<video>` player                                                                        |
| Camera and Screen together        | Two files: the screen as an overlay and the camera as a picture-in-picture window on top, timed to play together |
| System audio, with another source | The sound your computer is playing, mixed into the recording (desktop Chrome and Edge)                           |

The recording is saved with the document — audio under `audio/`, video under `video/` — in the
format your browser records: WebM in Chrome, Edge, and Firefox, MP4 in Safari. The dialog's
microphone and camera menus appear when you have more than one device to choose from.

To narrate the whole document, use **Insert → Document narration** or the Narrate view instead;
both are covered in [Narration](narration.md).

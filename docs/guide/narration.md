---
title: Narration
description: Record a voice-over for a whole document, read it from a voice-paced teleprompter, and export it as a narrated video with captions.
---

# Narration

A narration is one recording that runs under your whole document. When it plays, each block
appears as your voice reaches it, and the captions follow your words. You record it in the editor,
reading from a teleprompter or talking over your slides, and Squiggly Square works out when each
block starts.

## Two ways to record

|                             | Narrate view                                  | Insert → Document narration                                              |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| Where you find it           | **Use** tab → **Narrate**                     | **Insert** menu → **Document narration**                                 |
| What you read from          | A voice-paced teleprompter                    | The teleprompter, your slides, both, or nothing                          |
| What it captures            | Your microphone, plus your camera if you like | Microphone, camera, screen, and system audio (desktop Chromium browsers) |
| How blocks get their timing | Your voice is aligned to the script           | Your slide advances, in slides mode                                      |
| Captions                    | Follow your recorded words                    | Keep their reading-time estimates                                        |

Use the **Narrate** view for a voice-over you read word for word. Use **Document narration** for a
talking-head or screen recording, especially when you want to click through the slides as you
talk.

Both need an editor that can store media files with the document, as the Squiggly Square editor
does. Recordings use the browser's own format: WebM in Chrome, Edge, and Firefox, MP4 in Safari.

## The teleprompter

The **Narrate** view turns your document into a teleprompter script: each block's heading followed
by its prose. Pictures, diagrams, and other media are left out, because you don't read them aloud.
The word you're on is highlighted at the eye line, and the script scrolls to keep it there.

To open a document straight into this view, set `display-mode: narrate` in its frontmatter
(`teleprompter` and `prompter` mean the same). See also [display modes](display-modes.md#narrate).

### Voice-paced scrolling

With **Voice pace** on (the default), the prompter listens to your microphone. It moves at your
speaking rate while you talk and stops within a fraction of a second when you pause, so you can
take a breath or think without losing your place. The **Speed** setting still counts: the scroll
rate blends the speed you set with the rate it hears. With Voice pace off, or when no microphone is
available, the script scrolls at the set speed.

| Control                            | What it does                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Start** / **Pause**, **Restart** | Roll the prompter, pause it, or go back to the top                                                                |
| **Countdown**                      | Off, 3, 5, or 10 seconds before it starts rolling (default 3)                                                     |
| **Speed**                          | Your base reading rate, 80–260 words per minute (default 150)                                                     |
| **Voice pace**                     | Follow your voice. **Sens.** sets how readily it hears speech; you can also pick a microphone and watch its level |
| **Aa**                             | Text size                                                                                                         |
| **Mirror**                         | Flip the text for a beam-splitter teleprompter rig                                                                |
| **Guide**                          | Show the eye-line marker                                                                                          |
| **Pop out**                        | Move the prompter into its own window so it can sit next to your camera                                           |

**Pop out** offers what your browser supports: a floating window that stays on top (Chrome, Edge,
and recent Firefox), a read-only picture-in-picture window (Safari), or an ordinary popup window.
**Bring back** docks it again.

### Keyboard and mouse

| Key       | Action                                 |
| --------- | -------------------------------------- |
| `↑` / `↓` | Start / stop the prompter              |
| `←` / `→` | Back or forward one word               |
| `[` / `]` | Slower / faster by 10 words per minute |
| `M`       | Mirror                                 |
| `Esc`     | Pause                                  |

The mouse wheel also nudges the position a word at a time, pressing the wheel starts or stops the
prompter, and double-clicking a word jumps to it.

## Record in the Narrate view

1. Open the **Use** tab and choose **Narrate**.
2. Check **camera** if you also want a video of yourself. It's saved as a separate file.
3. Press **⏺ Record**. The countdown runs, then the prompter rolls as you read.
4. Press **⏹ Stop** when you finish. Squiggly Square spends a moment aligning the take.
5. Review it. You see the take's length and how many syllables were aligned, and an audio player
   that scrolls the prompter as you scrub. You can download backups of the audio, camera video, and
   timing file.
6. Choose **Save narration**, **Retake**, or **Discard**.

Saving stores the recording under `audio/` and adds one line to the top of the document, just
after the frontmatter:

```markdown
---
title: Harbor survey, spring 2026
---

{[audio src=audio/narration-20261028-091500.webm anchor=document]}

# Harbor survey, spring 2026
```

`anchor=document` makes the clip run under the whole document instead of one block (see
[audio and video clips](media.md#audio-and-video-clips)). If you recorded your camera, its video
goes on the line below. Recording stops by itself at about 900 MiB; the take is kept, so you can
still save it.

You get the same voice-aligned recording from **Insert → Record media** with **Show narration
mode** checked.

## Record a document narration

**Insert → Document narration** opens the recording dialog with your microphone and camera
selected. Turn on any of **Microphone**, **Camera**, **System audio**, and **Screen**, choose
**Start preview**, then **Record**. When you stop, review the take and choose **Save to document**
or **Discard & re-record**.

Two checkboxes add panels beside the camera preview. You can use both at once:

- **Show narration mode** shows the teleprompter as a reading aid. It paces itself from the audio
  you're recording, and the take starts after its countdown.
- **Show slides mode** shows your slides one at a time, with each block's prose underneath as
  speaker notes.

The recording goes at the top of the document's first block, right after its first heading, so it
starts when playback starts:

| What you recorded | What's added                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| Audio only        | A `{[audio src=… anchor=document]}` line                                     |
| Camera, or screen | A full-frame video that plays over every slide                               |
| Camera and screen | Two files: the screen full-frame, your camera as a picture-in-picture bubble |

### Slides mode

In slides mode, move through the deck with **Previous slide** and **Next slide**, or click the
slide and use the arrow keys, Space, Page Up, and Page Down. If a slide has build steps (parts
that appear one at a time), Next reveals them before moving on.

While you record, each slide is timed from the moment you **first** show it. Going back to an
earlier slide doesn't change its time, and the slide on screen when you press **Record** starts at
the beginning. When you stop, the review step offers **Update block timings when I save this
narration**, checked by default. Leave it checked, and saving times every block, and every build
step you revealed, to your clicks. Uncheck it to save only the recording.

> [!NOTE]
> A slide you never showed gets no time and is skipped during playback. The review step warns you,
> for example "2 of 14 slides were never shown".

**Insert → Record media** offers slides mode too, as a presenter aid, but only a document
narration saves the slide timings.

## How timing works

Once a narration has timing, the blocks play to it. In the **Use** tab's **Video** mode the
narration starts at the beginning and each block appears when your voice gets there. Exports and
the timeline follow the same timing.

### Where the timing comes from

- **Alignment** (the Narrate view). Squiggly Square listens to the syllables and pauses in your
  take and matches them against the script, which yields a time for every word and every block.
  It works best when you read the script as written.
- **Your slide advances** (slides mode). The block times are what you did, not a guess, but there
  are no word times.
- **Speech recognition**, when your app provides it. In the Write view, a narration appears in the
  **Document media** tray at the top. Open it and choose **Update timings from audio**. The
  recording is transcribed and its words are matched to the document, which copes with ad-libs
  and skipped passages. This is also how you time a document narration recorded without slides
  mode.
- **Generated narration** from an app (see [below](#generated-narration)).

### The timing file

Timing is stored in a small file beside the recording, named after it:
`audio/narration-20261028-091500.webm.timing.json`. It holds the text that was narrated, the take's
length, a time for each word when those were measured, a time range for each block, and how the
timing was produced. You never need to edit it. Keep it with the recording: when you share the
document as a ZIP or `.dbk` container, the recording and its timing travel together.

### When you edit after recording

You can keep editing. Squiggly Square matches each timed range to a block by the block's identity,
then by its wording, then by its order. A block you add later has no range: it keeps its own
length and starts where the block before it ends. If you trim the narration or cut pauses out of it
([media edits](media.md#audio-and-video-clips)), the block times and captions shift to match.

### Pin a block's timing

A timing you set yourself always wins. Give a heading a `duration=` or `startTime=` setting, such
as `## Tide tables {[duration=12]}` or `{[statHighlight duration=8]}`, and that value replaces the
narration's for that block (see [block settings](tags.md#block-settings)). Each setting overrides
only itself: a pinned `duration` keeps the narration's start, and later blocks move with the pinned
block's new end. The recorded voice keeps its own schedule, so a pin that disagrees with the take
by more than a second makes playback drift from the voice after that block. Dragging a block's
length in the **Timeline** view (**View** menu) writes the same `duration` pin.

## Captions

Every document gets captions estimated from its reading time. When a narration has word timings, from
alignment, speech recognition, or a generated narration, the captions are rebuilt from those
words, so they stay in step with the voice. A slide-advance narration keeps the estimates.

There are two caption styles:

| Style    | What it looks like                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Standard | Small white text on a dark badge at the top of the frame                                                                            |
| Social   | Large centered words, two to six at a time on at most two rows, with the word being spoken highlighted in the theme's primary color |

In **Video** mode, the **Captions** control in the preview toolbar switches between them. Clicking
the active one turns captions off. The choice is saved in the frontmatter as
`squisq-captions: off`, `standard` (the default), or `social`. The social style takes its font and
letter case from the theme.

## Retakes

To redo a take in the Narrate view, choose **Retake** before saving, or simply record and save
again later. Saving replaces the narration line at the top of the document instead of adding a
second one, and replaces the camera video on the line below it. A document narration likewise
replaces the narration it wrote at the top of the first block. Media you placed elsewhere in the
document is never touched.

> [!TIP]
> The two ways write to different places: the Narrate view at the very top of the document,
> Document narration below the first heading. If you switch from one to the other, delete the old
> narration line first, or both recordings play at once.

## Export a narrated video

In the Squiggly Square editor, choose **↓ Download → Video / Animated GIF**. The export follows
the narration's timing.

- **MP4** includes the document's audio, narration included, unless you uncheck **Include audio**
  under **Advanced options**.
- **Animated GIF** is always silent.
- **Captions** (under **Advanced options**): None, Standard, or Social. They're drawn into the
  frames. The **Social portrait** preset combines a vertical frame with social captions.

From the command line, render the document's container so the recording comes along, for example
`squisq video harbor-survey.zip --captions social`. See the [command line](cli.md).

Squiggly Square's editor doesn't offer an audio-only download, but apps built on Squisq can export
a document's narration as M4A, Opus, or WAV. Developers, see
[generated narration and audio export](../narration-and-audio-export.md).

## Generated narration

Squisq doesn't include a speech synthesizer, but an app can generate a narration from your text
with one and save it the same way a recording is saved: an audio file, its timing file, and the
`{[audio … anchor=document]}` line. The timing file records that it was generated. Block and
sentence boundaries are exact, because each was synthesized separately, and word times are
estimated. From there, playback, captions, and export work exactly as they do for a recording.

Developers adding generated narration or audio export to an app, see
[generated narration and audio export](../narration-and-audio-export.md).

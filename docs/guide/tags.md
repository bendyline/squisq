---
title: Tags
description: The complete reference for Squiggly Square tags — template tags and their parameters, the settings every block accepts, standalone tags, media clips, inline icons, and attribute blocks.
---

# Tags

A **tag** is a short instruction in squiggly square brackets, `{[` … `]}`. On a heading it picks
the block's template and settings; elsewhere it can add a heading-less block, a timed media clip,
or an inline icon. This page is the complete reference. For a gentler introduction, start with
[How the format works](markup.md); for the formal grammar, see the
[format specification](../SquigglySquare.md).

## The shape of a tag

```markdown
## Heading text {[templateName key=value otherKey="a value with spaces"]}
```

- **`templateName`** — which template draws the block, such as `quote` or `statHighlight`. Every
  built-in template is listed in the [block gallery](../blocks/index.md).
- **`key=value` parameters** — optional. Template parameters fill in the template's inputs; the
  [block settings](#block-settings) (timing, transitions, builds) work on every template.
- **Parameters only** — leave out the name to keep the block's current template and just apply
  settings: `## Opening remarks {[duration=8]}`.

```markdown preview
## The harbor at first light {[imageWithCaption imageSrc=images/harbor.svg caption="The north breakwater, just after six" captionPosition=top]}
```

Template names and parameter names are case-sensitive: `{[statHighlight]}` works, `{[StatHighlight]}`
doesn't.

## Where tags are recognized

| Where you put it                                                        | What it means                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| At the end of a heading                                                 | The block's template and settings                                                     |
| A paragraph that is only `{[templateName …]}`                           | A heading-less block — see [Standalone tags](#standalone-tags)                        |
| The last thing in an untagged section's body                            | The section's tag — see [tags in a section's body](markup.md#tags-in-a-sections-body) |
| A paragraph that is only `{[audio …]}`, `{[video …]}`, or `{[media …]}` | A timed media clip — see [Timed media clips](#timed-media-clips)                      |
| At the end of a child heading inside `{[drawing]}` or `{[layout]}`      | A shape or layer — see [Shapes and layers](#shapes-and-layers)                        |
| In body text, when the name is an icon                                  | An inline icon — see [Inline icons](#inline-icons)                                    |

Anywhere else, `{[…]}` stays as literal text. In particular, a tag in the _middle_ of a heading
(`## The {[quote]} section`) isn't a tag, and a tag-only paragraph inside a list item,
blockquote, or table cell isn't lifted into a block. `squisq validate` points these out (see
[Checking your tags](#checking-your-tags)).

> [!WARNING]
> A tag at the end of a heading is always read as a template, so an icon there doesn't work:
> `## Ship it {[rocket]}` asks for a template named `rocket`. Keep icons in body text (see
> [Inline icons](#inline-icons)).

## Parameter values

| Write                       | When                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `columns=3`                 | A value with no spaces, quotes, or brackets needs no quotes                                 |
| `caption="Beach at sunset"` | Quote values that contain spaces, `]`, `}`, or commas                                       |
| `caption='The "new" quay'`  | Use single quotes around a value that contains double quotes, and vice versa                |
| `attribution=O'Brien`       | An apostrophe inside an unquoted value is just a character                                  |
| `note="a \*starred\* word"` | Backslash-escape Markdown characters (`*`, `_`, `` ` ``, `~`) — a heading is still Markdown |

Inside a quoted value, a backslash escapes the same kind of quote (`"She said \"hi\""`), but
switching quote styles is easier to read and survives copying between tools.

Every parameter needs an `=`. A bare word after the template name, such as `useTopLayer` on its
own, is ignored; write `useTopLayer=true`.

**Typed values.** Parameters arrive as text, and each template converts the ones it knows:

| Kind                | Write                      | Used by, for example                         |
| ------------------- | -------------------------- | -------------------------------------------- |
| Number              | `zoom=9`, `leftValue=42`   | `map`, `comparisonBar`                       |
| True or false       | `showLegend=false`         | the chart blocks, `imageWithCaption isTitle` |
| Latitude, longitude | `center="47.6,-122.3"`     | `map`                                        |
| Label and sublabel  | `left="Before\|5.1 m"`     | `twoColumn` — the `\|` splits the two parts  |
| List                | `valueColumns="2024,2025"` | the chart blocks                             |

```markdown preview
## A decade of silt {[twoColumn left="2016|5.1 m channel depth" right="2026|4.2 m channel depth"]}
```

Each [block page](../blocks/index.md) lists its template's parameters and their allowed
values. Values that don't fit in one line — a list of map markers, rows for a table —
go in a ` ```json data ` or ` ```yaml data ` fence in the block's body instead; the
block pages show how.

**The tolerant parts.** A doubled closer (`{[quote]}]}`) is read as one tag. An unclosed quote
doesn't break the heading, though the value keeps the stray quote mark. An unknown template
name doesn't break the document: the slide falls back to a plain heading design, and
`squisq validate` reports the name with a suggestion.

**The canonical form.** When Squiggly Square writes a tag back out — for example, after you
change a block in the editor's Write view — it tidies the parameters: double quotes by default,
single quotes when the value contains a double quote, no quotes when none are needed, and exactly
one `]}`. What you type in the Source view is left as you typed it.

## Block settings

Every block accepts these settings, whatever its template. Put them in the heading's tag, either
with a template or on their own:

```squisq-docs
block-settings
```

`x`, `y`, and `connectsTo` position and connect the child headings inside a canvas block such as
[Diagram](../blocks/diagram.md); the rest apply to any block.

The same settings also work in a heading's `{…}` attribute block (see
[Attribute blocks](#attribute-blocks)): `## Opening remarks {duration=8}`. When a setting appears
in both places with different values, the attribute block wins.

### Timing

`duration` and `startTime` place a block on the timeline that **Video** mode and video exports
play. A slideshow ignores them — you advance it yourself.

```markdown
## Welcome aboard {[title duration=4]}

## Safety briefing {[list duration=01:30]}

- Life jackets are under every seat
- Stay seated while the launch is moving
```

Times can be seconds (`5`, `5.5`), minutes and seconds (`01:30`, `01:30.500`), or milliseconds
(`1500ms`). When you don't set a duration, a block lasts as long as its text takes to read — at
least 3 seconds — and a block with no body text lasts 5 seconds. Each block starts where the
previous one ends unless you pin its `startTime`. The editor's **Timeline** view sets these by
dragging; see [Display modes](display-modes.md#video).

### Transitions

`transition` sets how a block arrives from the one before it. `transitionDirection` picks a
direction for the transitions that have one, and `transitionDuration` sets its length (the default
is 0.7 seconds).

```markdown preview
## Leaving the harbor {[content transition=push transitionDirection=left]}

The launch rounds the breakwater and turns north.

## Open water {[content transition=dissolve transitionDuration=1.5]}

Past the last buoy the swell picks up and the gulls fall behind.
```

Without a `transition`, each slide after the first fades in. `transition=none` cuts straight to
the block. The full list of transitions is in the table above; the editor's **Transition** picker
groups them by style.

### Builds

A **build** reveals a block's content in steps: each press of the next-slide key shows one more
piece, and in Video mode the steps play on their own.

```markdown preview
## Before we sail {[list build=items buildEffect=fadeIn]}

- Check the weather report
- Fuel and inspect the launch
- File the trip plan with the harbor office
```

| `build`    | Reveals                                                           |
| ---------- | ----------------------------------------------------------------- |
| `items`    | Each list item, in reading order, parents before their children   |
| `branches` | Each top-level list item together with everything nested under it |
| `chunks`   | Each paragraph, list, or table of the body as one step            |
| `off`      | Everything at once                                                |

`buildEffect` sets how each step enters, `buildDuration` how long its entrance takes (default
`0.4` seconds), and `buildPrevious=dim` fades the earlier steps. Builds work on blocks that show
their body as text — `{[content]}`, `{[list]}`, and untagged sections. On other templates the
content simply appears complete.

### Color schemes

`colorScheme` isn't a block setting, but many templates take it as a parameter to choose one of
the theme's accent colors.

```markdown preview
## 4.2 m {[statHighlight stat="4.2 m" description="average channel depth at low tide" colorScheme=teal]}

## Part two: the dredging plan {[sectionHeader colorScheme=orange]}
```

Most built-in themes name their schemes `blue`, `green`, `purple`, `red`, `orange`, and `teal`;
the Gezellig theme uses `terracotta`, `sage`, `amber`, `plum`, `ink`, and `cream`. A name the
active theme doesn't have falls back to its first scheme, so a document never breaks when you
switch themes. The templates that take `colorScheme` list it on their block pages; see
[color schemes](themes.md#color-schemes) for how themes define them.

### Other shared parameters

Three more parameters work with every built-in template:

| Parameter        | What it does                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `imageTreatment` | Overrides the theme's photo grade for this block's pictures: `none`, `mono`, `duotone`, `warm`, or `cool` |
| `useTopLayer`    | `false` hides the document's top persistent layers on this block                                          |
| `useBottomLayer` | `false` hides the document's bottom persistent layers on this block                                       |

## Standalone tags

A tag doesn't need a heading. A paragraph that contains nothing but a template tag starts a
**heading-less block**. Everything after it, up to the next heading or the next standalone tag,
becomes that block's body.

```markdown preview
## Results

{[statHighlight stat="89%" description="of skippers rated the new berths good or better"]}

{[quote quote="Finally, somewhere to tie up on a busy morning." attribution="Ines Duarte, harbormaster"]}
```

That makes three slides: the **Results** heading, a stat, and a quote — no extra headings
needed. A standalone tag takes the same parameters and settings as a heading tag, and a `title`
parameter gives the block a title. Body content attaches to the tag above it:

```markdown preview
{[quote]}

> The tide doesn't care about your schedule. You learn to keep its. — Ines Duarte
```

A few things to know:

- Only paragraphs at the top level of the document count. Inside a list item or a blockquote,
  the tag stays as text.
- `audio`, `video`, and `media` aren't template names here — those tags are
  [media clips](#timed-media-clips).
- A **single** tag at the very end of an untagged section is read as that section's own tag
  instead (see [tags in a section's body](markup.md#tags-in-a-sections-body)). Standalone blocks
  come from two or more tags, or a tag with content after it.

## Timed media clips

A paragraph that is only an `{[audio …]}` or `{[video …]}` tag attaches a timed clip to the block
it's in (`{[media …]}` is another name for an audio clip). The clip plays while the block is on
screen in Video mode and video exports:

```markdown
## The foghorn

The horn on the north light sounds every thirty seconds in fog.

{[audio src=audio/foghorn.mp3 startAt=2]}
```

The main parameters are `src` (required), `startAt` (seconds into the block), `clipStart` and
`clipEnd` (which part of the file to play), `spillover=true` (keep playing past the block's end),
and `anchor=document` (play across the whole document, such as a full narration). Video clips
also take `placement=picture-in-picture` or `placement=overlay`. See
[audio and video clips](media.md#audio-and-video-clips) for the details and the editor's tools.

A hosted video isn't a tag at all: a paragraph that is only a YouTube or Vimeo link becomes a
player. See [hosted videos](media.md#hosted-videos).

## Inline icons

In body text — paragraphs, list items, and table cells — a tag whose name is a
[Font Awesome Free](https://fontawesome.com/search?ic=free) icon draws that icon:

```markdown preview
## Get involved

- {[github]} Code and issue tracker
- {[fa-brands:discord]} The volunteer chat
- {[ship]} Harbor tours every Saturday
- {[fa-regular:star]} Spring cleanup sign-up
```

- **Bare names** such as `{[github]}`, `{[ship]}`, or `{[anchor]}` work when only one icon family
  has that name.
- **Qualified names** pick the family when more than one has it: `{[fa-solid:star]}`,
  `{[fa-regular:star]}`, `{[fa-brands:discord]}`. The short prefixes `solid:`, `regular:`, and
  `brands:` work too. Names such as `star`, `user`, `heart`, and `clock` exist in both the solid
  and regular families, so they always need a prefix.
- **Template names win.** A bare tag whose name is also a template — `{[list]}`, `{[map]}`,
  `{[tree]}`, `{[timeline]}` — is never an icon. Use the qualified form, `{[fa-solid:list]}`.
- **Unknown names stay as text**, so you can still write `{[sic]}` in prose. `squisq validate`
  flags them in case they're typos.
- **Keep them out of headings.** At the end of a heading an icon is read as a template (see the
  warning above), and anywhere else in a heading it's left out of slide and page titles, which
  show the heading's text only.

The editor's **Emoji** picker (Insert menu) searches icons too and inserts the right form for you.

## Shapes and layers

Inside a `{[drawing]}` or `{[layout]}` block, each child heading is one shape or layer, and its tag
names the primitive and its geometry:

```markdown
## Harbor office {[drawing]}

### Harbormaster {#hm} {[rectangle x=40 y=20 width=160 height=70]}

### Dock crew {#crew} {[rectangle x=40 y=160 width=160 height=70]}

### manages {[arrow from=hm to=crew]}
```

These shape tags are recognized only on a drawing's or layout's children. See
[Drawing](../blocks/drawing.md) and [Layout](../blocks/layout.md) for every shape, layer, and
parameter.

## Attribute blocks

A heading can also end with a Pandoc-style attribute block in single braces, before or after its
tag:

```markdown
## Harbormaster {#harbormaster .featured} {[factCard]}

## Dock crew {[factCard]} {#dock-crew duration=6}
```

| In the attribute block | What it does                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `#id`                  | Fixes the block's id, so links and diagram connections can point at it                 |
| `.class`               | Adds a class name to the block, for hosts and custom styling                           |
| A block setting        | `duration=6`, `transition=fade`, and the rest of the [block settings](#block-settings) |
| Any other `key=value`  | Kept with the block as extra information for apps that read it                         |

Without an `#id`, a block's id comes from its heading text in lowercase with hyphens
(`## Dock crew` becomes `dock-crew`), with `-2`, `-3`, and so on added to repeats.

## Legacy names

Documents written for earlier versions keep working. These old template names are read as the
new ones; choosing a template in the editor writes the new name:

| Old name                      | Current name |
| ----------------------------- | ------------ |
| `titleBlock`                  | `title`      |
| `quoteBlock`                  | `quote`      |
| `mapBlock`                    | `map`        |
| `listBlock`                   | `list`       |
| `diagramBlock`, `diagramNode` | `diagram`    |

## Checking your tags

The [command-line tool](cli.md) checks a document and reports problems with line numbers:

```bash
squisq validate harbor-survey.md
```

Among the things it reports:

| Diagnostic            | Means                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `unknown-template`    | The tag names no built-in, legacy, or document-defined template, with a suggestion when one is close            |
| `unknown-input`       | A parameter the template doesn't have — often a typo, such as `colour`                                          |
| `invalid-input-value` | A value outside the allowed set, such as `captionPosition=left`                                                 |
| `missing-input`       | A required input that neither the tag nor the body supplies                                                     |
| `invalid-attribute`   | A malformed setting in a `{…}` attribute block, such as `{duration=soon}`                                       |
| `unparsed-annotation` | `{[…]}` text that wasn't recognized: broken quoting, a tag inside a list item or blockquote, or an unknown icon |

Add `--strict` to make warnings fail the run, or `--json` for machine-readable output. The full
list of diagnostics is in the [format specification](../SquigglySquare.md).

> [!NOTE]
> Two gaps to know about. A malformed setting inside a `{[…]}` tag, such as
> `{[content duration=soon]}`, is ignored without a warning, so check values carefully there. And
> `squisq validate` reports `unparsed-annotation` for a tag at the end of a body paragraph even
> though that tag is applied (see [tags in a section's body](markup.md#tags-in-a-sections-body));
> moving the tag onto the heading clears the warning.

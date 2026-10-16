# Progressive builds

Slide and video views can reveal a block's content in steps. Configure a heading
with block metadata, or use **Block properties → Build** in the editor.

```markdown
## Our approach {[list build=branches buildEffect=fadeInUp]}

- Discover
  - Interview customers
  - Review existing data
- Deliver
  - Prototype
  - Test
```

`branches` reveals Discover and its descendants together, then Deliver and its
descendants. `items` reveals each item in reading order, with parents before
children. `chunks` reveals each top-level prose block, list, or table together.
`off` shows the completed content. Omitting `build` preserves the template's
existing behavior, including its decorative entrance animations.

Builds currently target the `list` and `content` templates. A template without
supported targets renders its complete content and returns an
`unsupported-build` materialization diagnostic. Media placed separately from a
text body remains visible throughout.

| Parameter       | Values                                        | Default                    |
| --------------- | --------------------------------------------- | -------------------------- |
| `build`         | `off`, `items`, `branches`, `chunks`          | Existing template behavior |
| `buildEffect`   | `appear`, `fadeIn`, `fadeInUp`, `slideIn`     | `fadeInUp`                 |
| `buildDuration` | Nonnegative seconds or a time such as `400ms` | `0.4` seconds              |
| `buildPrevious` | `keep`, `dim`                                 | `keep`                     |

The heading and surrounding prose stay visible in list-item modes. Unrevealed
fragments keep their layout space, preserve numbering and rich inline formatting,
and are hidden from focus and accessibility navigation. Dimming keeps ancestors
of the current item readable. Reduced motion makes reveals instantaneous.

## Slide navigation

Next reveals a step, then advances to the next slide after the last step.
Previous reverses a step; moving to the previous slide shows its completed build.
An advance during an entrance finishes that entrance first. **Show all** reveals
the complete slide. Direct slide selection starts that slide's builds again.

Build entrances run on a local clock while the slide's audio remains paused.
`PlaybackState.buildStep` is the number of revealed steps; `buildCount` is the
total. Host controls receive `nextBuild`, `previousBuild`, and `showAllBuilds`
through `onControlsReady`. Explicit slide navigation remains separate.

## Video and narration

Video and GIF playback evaluate the same steps against block-local time. Seeking
to a timestamp produces the same build state regardless of earlier frames.
`animationsEnabled={false}` disables entrance motion while keeping reveal timing.
Use `buildsEnabled={false}` on `DocPlayer`, standalone mount options, or render
HTML options to show completed content throughout.

Timing uses recorded build advances when available, then exact narration-word
matches, then reading-length estimates. Narration alignment requires the
canonical source script to match the take. Summarized display wording without
an exact source match uses estimated timing. Dynamic presentation hints accept
the same `BuildSpec` per source block and inherit heading settings otherwise.

In the recorder's slides panel, stepping through builds records their first
showing alongside the slide advances. The optional `builds` array in the existing
v3 narration sidecar carries block ID, step index, source text, and take-relative
seconds. It survives the save/download paths and is mapped through narration
trim and cuts. Source mismatches discard the observations. Unobserved steps use
estimated timing so they still appear.

Builds fit within the resolved block duration. Short intervals shorten entrances
and may combine reveals; `resolveBuildTimeline().compressed` reports inadequate
reading time. A deck containing builds bypasses the automatic split/merge pacing
passes so those passes cannot replay or remove steps. Builds never extend audio.

## Rendering and extension points

Core exports `BuildSpec`, `BuildStep`, `BuildCursor`, and `BuildTiming` from
`@bendyline/squisq/schemas`. Pure planning and evaluation helpers live under
`@bendyline/squisq/doc`: `planContentBuilds`, `blockBuildSteps`,
`resolveBuildTimeline`, `buildCursorAtTime`, `buildTargetState`, and
`resolveDocBuildTiming`.

The typed block setting is serialized through normal heading metadata. Generated
steps, source anchors, and resolved timing are projection-only. Templates expose
semantic steps on `TextLayer.content.buildSteps` and associate generated HTML
fragments with zero-based `data-squisq-build-step` indices. A nested item's target
wraps its own marker and content, leaving descendants independently addressable.

`BlockRenderer` defaults to the completed state. Its `buildPlayback` prop accepts
`'all'`, `'timed'`, or `{ revealed, progress }`. The public `useBuildNavigation`
hook supplies the manual cursor for custom presenters. Pages, dashboards,
thumbnails, and static document exports retain completed content. PowerPoint
currently exports the completed slide; native PowerPoint build animations and
layouts that enlarge the active branch remain separate extensions.

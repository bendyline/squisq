---
template: process
description: The Process block draws an ordered process as numbered stages joined by arrows.
---

# Process

Process shows the steps in your section as numbered stages on a track, each joined to the next by
an arrow. It is for things that happen in order: how something works, how something is made, how
an event unfolded.

Choose it over [Cards](cards.md) when the order matters, and over [Cycle](cycle.md) when the
process ends rather than starting again.

```markdown preview
## How the body fights an infection {[process]}

1. Recognize: white blood cells spot the invader
2. Multiply: they multiply and attack it
3. Stand down: their numbers dwindle once it is gone
4. Keep watch: a few remain, and the person is immune
```

## How it reads your section

- **Heading** — the headline above the stages, with the theme's accent rule.
- **List** — one stage per item, up to six. `Label: detail` sets the label bold above its detail.
- **No list** — each paragraph becomes a stage.
- **Layout** — up to four short stages run across the slide, words beneath each number; more
  stages, longer ones, or a portrait stage stack down a rail with the words beside each number.

## Revealed one at a time

`build=items` brings the stages in one by one. In a dynamic-slides deck each stage appears as the
narration reaches it, and a passage whose sentences open "First… Then… Finally…" is drawn as a
process automatically.

```markdown preview
## Splashdown {[process build=items]}

- Separation: the service module falls away
- Re-entry: the heat shield faces forward
- Parachutes: they open at 195 hours, 13 minutes
- Recovery: 13 miles from USS Hornet
```

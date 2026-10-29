---
template: transcript
description: The Transcript block shows one beat of a conversation — a speaker's avatar and name beside a message bubble — with thought, tool, and handoff variants.
---

# Transcript

Transcript turns a line of dialogue into a slide: who said it, and what they said, in a chat-style
bubble. String several together and an interview, a radio exchange, or a recorded agent session
plays back one beat at a time.

Use it when the speaker matters as much as the words. For a single memorable line with no
back-and-forth, [Quote](quote.md) or [Pull Quote](pullQuote.md) reads better.

```markdown preview
## Dr. Amara Osei {[transcript text="The north cores came back two degrees warmer than last spring. We re-run them tonight." meta="Field station, 07:15"]}
```

## How it reads your section

- **Heading** — the speaker's name, unless you set `speaker=`.
- **`text=`** — the message in the bubble. The bubble grows with the text, up to about seven
  lines.
- **`speakerImage=`** — the avatar. Without one, the speaker gets a circle with their initials, so
  a transcript never depends on having pictures.
- **Body** — not drawn on the slide. Put the message in `text=`.

[Page view](../guide/display-modes.md#page) shows each beat as a quote attributed to the speaker.
There, when `text=` is absent, the block's blockquote — or else its paragraphs — becomes the
message.

## Examples

### A thought

`variant=thought` mutes the bubble, sets the message in italics, and adds "thinking" after the
name.

```markdown preview
## Planning agent {[transcript variant=thought text="The ferry timetable changes in June, so the shuttle loop needs two schedules."]}
```

### A tool call

`variant=tool` shows the tool's name as a monospace chip, the message in monospace, and an optional
result line under the bubble.

```markdown preview
## Planning agent {[transcript variant=tool toolName=search_permits text="Harbor Street, January to June 2027" resultText="14 permits found, 3 still in review"]}
```

### A handoff

`counterpartName` turns the beat into a handoff from one speaker to another: both avatars side by
side, each named, with the message centered beneath them.

```markdown preview
## Handoff {[transcript speaker="Research agent" counterpartName="Writing agent" text="Here are the five strongest sources. Draft the summary for the council packet."]}
```

### The other side, with a picture

`side=right` moves the speaker to the right, the way a chat shows the other person.
`speakerImage=` replaces the initials with a picture.

```markdown preview
## Jonah Reyes {[transcript side=right speakerImage=images/avatar.svg text="Copy that. Moving the buoy line two hundred meters east." meta="Day 4, 06:40"]}
```

## Parameters

```squisq-docs
template-params
```

`toolName` and `resultText` only appear with `variant=tool`. With `counterpartName` set, the slide
uses the handoff layout instead: `side`, the tool chip, and the result line don't apply there.
`colorScheme` colors the tool chip and the outline of a tool call's bubble.

## Tips

- Write each beat as its own heading, one speaker per heading. The deck then advances turn by turn.
- Keep `meta=` short — a timestamp or a step number. It sits in the bottom-right corner.
- Avatars are drawn inside a small square, so a square picture works best.
- Quote a value that has spaces. A message that itself contains double quotes goes in single
  quotes: `text='The sign said "Closed for the season."'`.

## Related

- [Quote](quote.md) — a single attributed quote
- [Pull Quote](pullQuote.md) — a quote over a full-bleed photo
- [Content](content.md) — the whole section, when the exchange is long
- [Tags](../guide/tags.md) — how tag values and quoting work

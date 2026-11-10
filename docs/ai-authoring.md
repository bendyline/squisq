# AI authoring

Squisq renders slides; products built on it let a model choose and word them. Qualla's video
director writes a whole story's shot list as template blocks; DocBlocks' presentation refiner
picks a layout and words a headline and points for each slide. Both used to describe the
templates in their own prompts and check the model's output with their own code, so a new
template, a better check or a lesson learned reached only one of them. The shared pieces now
live here, and each product renders its prompts from them and holds its output to them.

## What an author is told

`@bendyline/squisq/doc` exports the guide (`core/src/doc/templates/authoringGuide.ts`):

- `TEMPLATE_GUIDES`: for authors that write template blocks, the fields each template takes as an
  author writes them, with their limits, and when the template earns its place.
  `templateCatalog(entries, { source })` renders the lines a prompt lists. A product passes its
  own entry for a template it uses its own way (Qualla's maps depend on pre-rendered images).
- `PRESENTATION_LAYOUT_GUIDE`: what each presentation layout shows, for authors that fill a
  headline and up to four points. `PRESENTATION_LAYOUT_LABELS` names each layout for a picker
  (a label and one line on what it shows), so a product that lets a person choose a slide's
  layout does not keep its own list.
- `AUTHORING_TRICKS`: craft that makes slides good rather than merely valid. Each names the
  templates it concerns, so `authoringTricks({ templates })` gives a prompt only the tricks for
  the templates it offers; `authoringTricks({ surface: 'summary' })` gives the tricks written for
  headline-and-points authors. DocBlocks renders every summary trick, so a new one reaches its
  prompt without a DocBlocks change; Qualla lists the tricks it uses by id.

Text may name a slide's material as `{source}`; each product renders it in its own word
("article", "passage").

The templates that draw a handful of ideas all take the same input, `items` written
`Label: detail`, so an author learns one form: `cards`, `process`, `cycle`, `layers`, `stats`
(each item `Figure: what it measures`), `pyramid`, `funnel`, `hub`, `venn` (two sets and a
`Both:` item) and `matrix` (exactly four). A `diagram`'s nodes need no `x` or `y`: written
without them, the diagram places its nodes from its edges, so an author states relationships and
never computes coordinates.

To add a trick, write it once in `AUTHORING_TRICKS` with the templates it concerns. Good tricks
are specific and checkable by eye: "a chain is a process, not a diagram", "a range is not one
value". Rules a product enforces itself (image keys, how its beats anchor) stay in its prompt.

## What a list is a picture of

Without a model, the same choice is made from what the author wrote. `classifyListShape`
(`@bendyline/squisq/recommend`) reads a list's heading and items and names the relationship and
the template that draws it: a numbered list is a `process`, dated items a timeline, figures
`stats`, a heading that says "cycle" a `cycle`. A `strong` result rests on the author's own words
or structure and is applied by `markdownToDoc`'s automatic templates; a `weak` one is only
offered in the template picker. A host that plans slides from its own outline can call it with
`{ heading, items, ordered }` and get the same answer.

## What the output is held to

`@bendyline/squisq/transform` exports the grounding checks (`core/src/transform/grounding.ts`).
They report; the caller decides what to drop.

- `ungroundedNumber`: every number shown is stated in the source, in digits or words, commas
  ignored ("1400" matches "1,400"; "10" matches "ten"; "14" does not match "1,400").
- `isVerbatimQuote`: a quotation is the source's own words.
- `isGroundedParaphrase`: a label, point or item may trim and reorder, but its numbers and two
  thirds of its distinctive words come from the source.
- `restatesHeadline`: a point that only repeats its headline.
- `rangeEndOnly`: a number the source gives only as one end of a range ("3 to 7 miles deep"),
  which a count-up or a single bar would misstate.

A model that chooses a template and leaves out what it draws does not produce a blank slide. A
`{[twoColumn]}` with no columns, a `{[photoGrid]}` with no picture or a `{[list]}` over prose is
drawn as ordinary content, and `materializeBlockLayers` returns a `template-drew-nothing`
diagnostic for it (`expandDocBlocks` passes it to `onDiagnostic`). Sample values are never drawn
beside a body, so nothing reaches the screen that the source did not say. Count those diagnostics
to see how often a prompt picks a template it does not fill.

## Timing slides to narration

`@bendyline/squisq/timing` answers when narration speaks a phrase or a character
(`phraseStartTime`, `wordTimeAt`) from any `{ sourceText, bookmarks }` word timing: TTS
bookmarks or an aligned recording. Concept slides that reveal one item at a time are timed
with `matchPointsToSentences` and `conceptRevealTiming` (`@bendyline/squisq/transform`), the
same code the presentation compiler uses; see [Progressive builds](progressive-builds.md).

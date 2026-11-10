# AI authoring

Squisq renders slides; products built on it let a model choose and word them. Qualla's video
director writes a whole story's shot list as template blocks; DocBlocks' presentation designer
has a model word each slide of a deck, and its document tools let an agent write Markdown that
Squisq draws. All of them used to describe the templates in their own prompts and check the
model's output with their own code, so a new template, a better check or a lesson learned
reached only one of them. The shared pieces now live here, and each product renders its prompts
from them and holds its output to them.

## What an author is told

`@bendyline/squisq/doc` exports the guide (`core/src/doc/templates/authoringGuide.ts`). There are
three kinds of author, and each is told what it needs:

- **An author that writes template blocks** gets `TEMPLATE_GUIDES`: the fields each template
  takes as an author writes them, with their limits, and when the template earns its place.
  `templateCatalog(entries, { source })` renders the lines a prompt lists. A product passes its
  own entry for a template it uses its own way (Qualla's maps depend on pre-rendered images).
- **An author that fills a headline and up to four points** gets `PRESENTATION_LAYOUT_GUIDE`:
  what each presentation layout shows. `PRESENTATION_LAYOUT_LABELS` names each layout for a
  picker (a label and one line on what it shows), and `presentationLayoutNeeds(layout)` says what
  a slide must have for it to apply ("exactly 4 points"), so a product that lets a person choose
  a slide's layout keeps no list of its own.
- **An author that writes plain Markdown** gets `markdownShapeGuide()`: what in a heading and a
  list makes Squisq draw a picture, with no annotation. `markdownShapeSummary()` is the same rule
  in one paragraph, and `markdownShapeExample(template)` a worked heading and list for one
  template. The tests run every example through the classifier, so the guide cannot promise a
  drawing Squisq does not make.

`AUTHORING_TRICKS` is craft that makes slides good rather than merely valid. Each trick names the
templates it concerns, so `authoringTricks({ templates })` gives a prompt only the tricks for the
templates it offers; `authoringTricks({ surface: 'summary' })` gives the tricks written for
headline-and-points authors and `{ surface: 'storyboard' }` the ones for an author that only
chooses each slide's layout. DocBlocks renders every summary trick, so a new one reaches its
prompt without a DocBlocks change; Qualla lists the tricks it uses by id.

Text may name a slide's material as `{source}`; each product renders it in its own word
("article", "passage").

To add a trick, write it once in `AUTHORING_TRICKS` with the templates it concerns. Good tricks
are specific and checkable by eye: "a chain is a process, not a diagram", "a range is not one
value". Rules a product enforces itself (image keys, how its beats anchor) stay in its prompt.

## What each concept template takes

The templates that draw a handful of ideas all take the same input, `items` written
`Label: detail`, so an author learns one form: `cards`, `process`, `cycle`, `layers`, `stats`
(each item `Figure: what it measures`), `pyramid`, `funnel`, `hub`, `venn` (two sets and a
`Both:` item) and `matrix` (exactly four). How many items, in what order, and what else each
takes is data (`core/src/doc/templates/conceptSpecs.ts`), not prose repeated in every prompt:

- `CONCEPT_SPECS[template]` gives the item range, the item form, the order when the drawing
  depends on it, and the inputs beyond `title` and `items` (a hub's `center`, a matrix's axes).
  The guides above render their counts from it with `conceptItemCount`, so a prompt and a check
  cannot disagree. A summary slide holds four points, which is why its guide says "3–4" where the
  template takes "3–6".
- `conceptItemsProblem(template, items)` says why items do not meet that contract, in a sentence
  a validator can log and a correction prompt can quote ("matrix takes exactly 4 items and this
  has 3"). A host that validates a model's blocks needs no table of its own.
- `conceptDowngrade(template, items)` says what a template draws when it cannot draw its own
  picture. A template never draws a broken diagram: a matrix without four ideas draws cards, a
  cycle too short for a ring a process. The templates call this function, so it cannot disagree
  with them, and `markdownToDoc` reports an annotated block it applies to as a
  `template-shape-unmet` diagnostic, which tells an author that `{[matrix]}` over three items was
  not drawn and why.

A matrix whose four items each say where they stand on the same two measures ("Quick wins: low
effort, high impact") names its own axes. `readMatrixItems` reads them and the panel each item
belongs in; `markdownToDoc` uses it to name the axes of a Markdown matrix, and a deck's author
check (below) uses it to put a model's points in the right panels. A `diagram`'s nodes need no
`x` or `y`: written without them, the diagram places its nodes from its edges.

## What a list is a picture of

Without a model, the same choice is made from what the author wrote. `classifyListShape`
(`@bendyline/squisq/recommend`) reads a list's heading and items and names the relationship and
the template that draws it: a numbered list is a `process`, dated items a timeline, figures
`stats`, a heading that says "cycle" a `cycle`. A `strong` result rests on the author's own words
or structure and is applied by `markdownToDoc`'s automatic templates; a `weak` one is only
offered in the template picker. A host that plans slides from its own outline can call it with
`{ heading, items, ordered }` and get the same answer.

`shapeIsStated(template, { heading, passage, items })` is the other direction, for an author
that has already chosen. Cards, a process, a hub and key numbers claim little beyond what their
items say and always pass. A cycle, layers, a pyramid, a funnel, a Venn diagram and a matrix
assert how the ideas relate, so the source has to say so: that the stages come round again, that
there is a hierarchy, that the two share something. When it does not,
`unstatedShapeFallback(template)` names what to draw instead (cards, or a process).

## Wording a deck with a model

`createPresentationPlan` makes a deck from prose on its own. A host with a model can improve it:
the model plans every slide's layout together, then words each slide. Everything about that
exchange except the transport is in `@bendyline/squisq/transform`
(`core/src/transform/presentationAuthor.ts`), so every host asks the same questions:

```ts
const asked = presentationSlidesToWord(plan);
const planned = presentationUsesStoryboard(asked)
  ? readPresentationStoryboardReply(
      await chat(presentationStoryboardPrompt(), presentationStoryboardRequest(plan, asked)),
      plan,
      asked,
    )
  : new Map();
for (const index of asked) {
  let context = { planned: planned.get(index) };
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = presentationSlideRequest(plan, index, context);
    const read = readPresentationSlideReply(
      await chat(presentationSlidePrompt(), request),
      plan,
      index,
    );
    if (read.beat) {
      beats[index] = read.beat;
      break;
    }
    context = presentationRetryContext(context, read);
  }
}
```

- The prompts are rendered from the layout guide and the tricks above, so a layout added to
  Squisq reaches them. `PRESENTATION_SLIDE_FORMAT` and `PRESENTATION_STORYBOARD_FORMAT` are JSON
  schemas for a host that can enforce structured output; `PRESENTATION_AUTHOR_LIMITS` holds the
  sizes the prompts assume.
- `presentationSlidesToWord` leaves out slides a model should not word: an authored section, a
  hidden slide, a passage too long for a small model, and a passage that addresses the model
  ("ignore all previous instructions"), which keeps its automatic slide.
- `readPresentationSlideReply` returns the slide or a `problem` in words a correction can quote,
  with its `kind`: the reply was not the JSON asked for, the layout cannot be filled from what it
  wrote, or it says something the passage does not. `presentationRetryContext` turns that into the
  second request, and stops asking for a planned layout the passage could not fill.
- The reader repairs what a small model gets nearly right rather than refusing it: a key number
  written as a sentence ("Retention rose to 71%") has its figure lifted to the front, and dated
  points that end with their year are led by it, so a process draws them as a timeline.

A plan's beat can carry what a layout draws beyond its points: `center` on a hub, `xAxis` and
`yAxis` on a matrix (`presentationBeatExtras`). They are saved only on the layout that draws them.

The automatic plan keeps a short tail with its slide. A section a little longer than one slide
is not cut into a slide and a one-sentence remainder, so a cycle keeps the sentence that closes
it and a matrix its fourth panel, and the model sees the whole shape.

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

`groundPresentationBeat(beat, passage, { heading })` applies them to one slide of a deck, and is
what `readPresentationSlideReply` holds a reply to. An invented number, a point in words the
passage does not use, or one end of a range as a key number refuses the slide. A shape the
passage does not state does not: the wording is good and only the claim is not, so the slide is
drawn as cards or a process, and the change is reported in `notes`. It works the other way too.
A model that plays safe with cards over ideas whose shape the source states (a section called
"The water cycle" that says the cycle repeats) gets the drawing a list under that heading would
get, by the same `strong` reading and only on the source's own evidence.

A model that chooses a template and leaves out what it draws does not produce a blank slide. A
`{[twoColumn]}` with no columns, a `{[photoGrid]}` with no picture or a `{[list]}` over prose is
drawn as ordinary content, and `materializeBlockLayers` returns a `template-drew-nothing`
diagnostic for it (`expandDocBlocks` passes it to `onDiagnostic`). Sample values are never drawn
beside a body, so nothing reaches the screen that the source did not say. Count those diagnostics,
and `template-shape-unmet`, to see how often a prompt picks a template it does not fill.

## Timing slides to narration

`@bendyline/squisq/timing` answers when narration speaks a phrase or a character
(`phraseStartTime`, `wordTimeAt`) from any `{ sourceText, bookmarks }` word timing: TTS
bookmarks or an aligned recording. Concept slides that reveal one item at a time are timed
with `matchPointsToSentences` and `conceptRevealTiming` (`@bendyline/squisq/transform`), the
same code the presentation compiler uses; see [Progressive builds](progressive-builds.md).

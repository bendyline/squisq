# Review — host integration guide

Review generalizes proofing. Where proofing asks "is this word wrong?", a
review provider may also ask "is this paragraph clear?" — and the two differ in
ways the proofing contract cannot express.

A proofing engine is cheap, local, and answers in milliseconds, so
`lint(text)` takes one flat string and returns the whole answer at once. A
reviewer built on a language model is none of those things. It is slow enough
that results must arrive as they are found, expensive enough that an abandoned
pass must actually stop, and it wants document structure rather than a
concatenated string. Its suggestion is frequently a rewritten paragraph, which
a span replacement cannot represent.

So review adds three things proofing does not have: **streaming**,
**cancellation**, and **block structure**.

Proofing is not deprecated and nothing about it changes. A `ProofingProvider`
is adapted into this pipeline, so there is one renderer rather than two.

## The contract

Plain data in `@bendyline/squisq/review`, the provider interface in
`@bendyline/squisq-editor-react/review`. Both are pure enough to implement
against a test fake.

```ts
import type { ReviewProvider } from '@bendyline/squisq-editor-react/review';

const houseStyle: ReviewProvider = {
  id: 'house-style',
  label: 'House style',
  hue: 'assist',
  debounceMs: 12_000,

  async *review(request, signal) {
    for (const block of request.blocks) {
      if (signal.aborted) return;
      const findings = await check(block.text);
      yield {
        type: 'findings',
        findings: findings.map((f) => ({
          id: `${block.key}:${f.at}`,
          source: 'house-style',
          start: block.offset + f.at,
          end: block.offset + f.at + f.length,
          blockKey: block.key,
          severity: 'suggestion',
          category: 'clarity',
          message: f.message,
          rationale: f.why,
          originalText: f.text,
          suggestions: [{ text: f.rewrite, kind: 'replaceBlock', label: 'Tighten' }],
        })),
      };
    }
    yield { type: 'done' };
  },
};
```

Four details carry weight.

**`id` is a namespace.** It prefixes decoration keys and groups the panel, so
two providers reporting the same span never collide.

**`debounceMs` is per provider**, because the right answer differs by an order
of magnitude. Proofing re-runs 450 ms after a keystroke. A model that takes
seconds and occupies the device's accelerator should not, and a shared delay
would have to be wrong for one of them.

**`signal` must be honoured promptly.** The editor aborts as soon as the
document changes. Findings computed against text that no longer exists are not
merely useless: emitted, they put a squiggle on an unrelated word.

**`blockKey` outlives `start`/`end`.** A span goes stale the moment the user
types; the block does not. A finding that can still be navigated to is worth
more than one that can only be discarded.

### Suggestions

`replaceBlock` is the kind proofing lacks. A reviewer asked to improve a
sentence rewrites the sentence, and forcing that into a span replacement is what
produces mangled half-edits. `replace`, `remove` and `insertAfter` mean what
they do in proofing.

## Running a proofing engine through it

```ts
import { createProofingReviewProvider } from '@bendyline/squisq-editor-react/review';

const providers = [createProofingReviewProvider(harperProvider), houseStyle];
```

The adapter joins the blocks the way proofing's own orchestration does, lints
once, and maps each finding back to its block. Linting joined rather than block
by block is deliberate: a grammar engine reads across a paragraph boundary, and
a per-block call would lose every finding that spans one. A finding that
straddles the join belongs to no block and is dropped, because it is an artefact
of joining rather than something the author wrote.

The adapter does not own the provider's lifetime. A host that passed an instance
keeps its warm engine across shell remounts, exactly as before.

## Colour

Findings draw in their provider's `hue`. Three are proofing's existing colours;
`assist` is the fourth, at `--squisq-review-assist`, for a provider whose
findings are suggestions rather than mistakes.

The hue is not the severity. Severity orders findings within a provider; the hue
says which provider they came from. Reusing the style blue for a model's opinion
would make an opinion and a rule violation look identical, which is the one
distinction a reader most needs.

## Host panels

`EditorShell` takes a `sidePanelSlot`, rendered as a flex sibling of the editor
so opening it reflows rather than covers. That is the seam for a host's own
review drawer, assistant, or inspector. Without it a host has to portal into a
DOM node it owns and give up the editor context on the way.

## Reading and replacing a selection

A host driving review actions needs the selection, and should not have to reach
into Tiptap or Monaco to get it. `useEditorContext()` exposes:

- `getSelection()` — the selected text and which surface reported it, or null in
  Preview where there is nothing to act on.
- `replaceSelection(markdown)` — one undoable edit in both surfaces. Returns
  false when the surface cannot be edited, so a caller can offer to switch views
  rather than silently drop the text.
- `getBlockAtCursor()` — exact in Source view. **Null in Write view**, where
  there is no public mapping from a ProseMirror position back to a markdown
  offset. Returning a plausible-but-wrong block would have a caller edit the
  wrong paragraph, so it returns nothing instead. Anchor on a finding's
  `blockKey` where you need the block in both views.
- `selectionVersion` — a counter bumped on every selection change, so a toolbar
  can gate on "is there a selection" without subscribing to editor internals or
  re-rendering on every keystroke inside one.

## Wiring it up

```tsx
<EditorShell
  reviewProviders={[createProofingReviewProvider(harper), houseStyle]}
  sidePanelSlot={<MyOwnDrawer />}
/>
```

Absent or empty means no review at all: nothing is scheduled and no provider is
constructed, the same capability-injection semantics as `proofing`.

Each provider is scheduled independently — its own debounce, its own
single-flight pass, its own abort. A change arriving mid-pass coalesces into
exactly one trailing pass rather than queueing one per keystroke, and a pass
whose document moved under it is discarded rather than drawn.

Findings render three ways: as marks in whichever surface can place them, in a
grouped panel docked beside the editor, and through `useReviewState()` for a
host that wants to render its own. The panel groups by provider rather than
merging into one document-ordered list, because a spelling mistake and "this
section buries its point" interleaved by position read as noise.

## Where marks can be drawn

Source view is exact: a finding's offsets and Monaco's model index the same
string.

Write view is not. Its ProseMirror document differs from the source — frontmatter
is stripped, prose may be rewrapped, markup is marks rather than characters — and
there is no published mapping from a source offset back to a position. So the
Write view anchors on the finding's own text, **and only when that text appears
exactly once**. An ambiguous match draws nothing, deliberately: marking a
different paragraph than the one reviewed is worse than marking none, and the
panel still lists the finding with navigation.

## Status

Implemented: the contract, the proofing adapter, the panel slot, the selection
actions, the fourth hue, multi-provider scheduling, both decoration surfaces,
and the grouped panel.

Proofing still runs on its own pipeline rather than through `reviewProviders`.
The adapter exists and is tested, so the migration is available whenever it is
wanted; until then the two coexist, with review registering its own plugin key
and its own decorations. Hover cards are Monaco's in Source view and absent in
Write view, where proofing has a bespoke tooltip that review does not yet share.
Applying a suggestion from the panel is not wired — the decoration lookup
(`reviewDecorationById`) that makes it safe after edits is exported and tested,
but no UI calls it yet.

---
title: Adding a block template
description: How a built-in block template is wired into Squisq — the repository workflow, every file a new template touches, the checks that catch a missed step, and its gallery page and visual review.
---

# Adding a block template

A block template is a pure function that turns one block's inputs into layers. Adding a built-in one
takes nine required steps across core, the editor, and the docs, and the repository has a guard
for almost every one of them. This guide walks through the whole change.

> [!IMPORTANT]
> Squisq does not accept code pull requests. To ask for a new template upstream, open a proposal: a
> Markdown document in `specs/` describing the problem, the behavior you want, examples, and
> acceptance criteria. See [CONTRIBUTING.md](../../../CONTRIBUTING.md) and the
> [`specs/` guide](../../../specs/README.md). The steps below are for working in your own checkout or
> fork, and they make a good checklist for a proposal's acceptance criteria.

> [!TIP]
> If you only need a new layout for your own documents, you don't need a fork. A custom template
> lives in the document's frontmatter and works in the editor, the player, and every export. See
> [Custom templates](../../guide/custom-templates.md).

## Work in the repository

Squisq is an npm-workspaces monorepo. Install with the `install:safe` script, never a bare
`npm install`:

```bash
git clone https://github.com/bendyline/squisq.git
cd squisq
npm run install:safe   # npm install + the allowlisted install scripts
npm run build          # every package, in dependency order
npm test               # the vitest suite
npm run dev            # watchers + the demo editor on http://localhost:5199
```

`.npmrc` sets `ignore-scripts=true`, so a bare `npm install` succeeds but leaves esbuild's native
binary missing, and the next build fails. `install:safe` runs the allowlisted install scripts
afterwards. Before adding or updating any dependency, read
[the dependency rules](../../dependencies.md).

| Command                           | What it does                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `npm run build:core`              | Rebuild only `@bendyline/squisq` (also `build:react`, `build:editor`, …) |
| `npm run typecheck`               | `tsc -b` across every package, no output                                 |
| `npm run lint`                    | ESLint                                                                   |
| `npm run format` / `format:check` | Prettier write / check                                                   |
| `npm run docs:check`              | Build the documentation site and list broken links and examples          |
| `npm run screenshots:swatches`    | Render every template in every theme against realistic content           |

The demo site serves the editor from each package's built `dist/`, so rebuild a package (or keep
`npm run dev`'s watchers running) before checking a change in the browser.

## What a template is

A template is `(input, context) => Layer[]`: no side effects, no state, data in and layers out.
`input` is the block's typed inputs (from the heading, the body, and `{[…]}` parameters); `context`
carries the theme, the viewport and its orientation, a font scale, layout hints, and the motion
profile. Read [Templates](../concepts/templates.md) for the model and
[Document model](../concepts/document-model.md) for the layer types.

The steps below add a hypothetical `callout` template, written `## Bring a tide table {[callout tone=warning]}`.

## The nine steps

Every built-in template needs all nine. Unless a row says otherwise, its file is under
`packages/core/src/doc/templates/`. The last column names the check that fails when you skip the
step.

| #   | Change                              | File                                            | Caught by                        |
| --- | ----------------------------------- | ----------------------------------------------- | -------------------------------- |
| 1   | Input interface                     | `packages/core/src/schemas/BlockTemplates.ts`   | typecheck, after step 4          |
| 2   | Add it to the `TemplateBlock` union | same file                                       | typecheck, after step 4          |
| 3   | The template function               | `calloutBlock.ts`                               | —                                |
| 4   | Register it                         | `registry.ts`                                   | `npm run typecheck`              |
| 5   | Label and description               | `metadata.ts`                                   | `templateMetadata.test.ts`       |
| 6   | Picker entry with an icon           | `packages/editor-react/src/TemplatePicker.tsx`  | `templatePickerMetadata.test.ts` |
| 7   | Tests                               | `packages/core/src/__tests__/templates.test.ts` | review                           |
| 8   | Parameter descriptors               | `inputDescriptors.ts`                           | nothing                          |
| 9   | Gallery page                        | `docs/blocks/callout.md`                        | `docsSite.test.ts`               |

Four more registries also have to list the new id; `npm test` fails until they do. They're covered
[after the nine steps](#four-more-registries).

The core tests live in `packages/core/src/__tests__/`, the picker test in
`packages/editor-react/src/__tests__/`, and the docs test in `packages/site/src/__tests__/`.

### Steps 1 and 2: declare the input

Add an interface that extends the file's `BaseTemplateBlock` (id, duration, audio segment,
transition, build settings, and the rest every block carries), with a literal `template` id, then
add it to the `TemplateBlock` discriminated union in the same file:

```ts
/** Callout - a short highlighted note. */
export interface CalloutInput extends BaseTemplateBlock {
  template: 'callout';
  /** The note text */
  text: string;
  /** Visual tone (default 'info') */
  tone?: 'info' | 'warning';
}

export type TemplateBlock =
  | TitleBlockInput
  // …
  | CalloutInput;
```

### Step 3: write the function

Templates draw through the theme rather than hard-coded values, so every built-in theme dresses
them. The helpers in `packages/core/src/doc/utils/themeUtils.ts` cover fonts, sizes, surfaces,
shadows, and entrances:

```ts
// packages/core/src/doc/templates/calloutBlock.ts
import type { Layer } from '../../schemas/Doc.js';
import type { CalloutInput, TemplateContext } from '../../schemas/BlockTemplates.js';
import {
  getThemeFont,
  motionEntrance,
  shouldUseShadow,
  themedFontSize,
  themedSurfaceGradient,
} from '../utils/themeUtils.js';
import { createBackgroundLayer } from './captionUtils.js';

export function calloutBlock(input: CalloutInput, context: TemplateContext): Layer[] {
  const { theme } = context;
  return [
    createBackgroundLayer('bg', themedSurfaceGradient(context)),
    {
      type: 'text',
      id: 'text',
      content: {
        text: input.text,
        style: {
          fontSize: themedFontSize(48, context, true),
          fontFamily: getThemeFont(context, 'title'),
          color: input.tone === 'warning' ? theme.colors.warning : theme.colors.text,
          textAlign: 'center',
          shadow: shouldUseShadow(context),
          shrinkToFit: true,
        },
      },
      position: { x: '50%', y: '50%', width: '80%', anchor: 'center' },
      animation: motionEntrance(context, { type: 'fadeIn', duration: 1 }),
    },
  ];
}
```

Rules every built-in follows:

- Use `theme.colors.*`, `resolveColorScheme(context, name)`, `themedSurfaceGradient`, and
  `themedScrim` instead of literal colors or black scrims, which break light and warm themes.
- Size type with `themedFontSize(basePx, context, isTitle)`, designed against 1920 × 1080; it
  respects the theme's type scale and the viewport.
- Use `shouldUseShadow(context)` rather than `shadow: true`.
- Compose for `context.orientation` (`landscape`, `portrait`, `square`) and `context.layout`, since
  the same block renders on every stage shape and inside dashboard cells.

### Step 4: register it

Import the function in `registry.ts` and add it to `templateRegistry` under its canonical short id
(`callout: calloutBlock`). The registry's type is a mapped type over the `TemplateBlock` union, so
`npm run typecheck` fails until the union and the registry agree.

### Step 5: label and description

Add a `TEMPLATE_METADATA` entry in `metadata.ts`: the `label` and one-sentence `description` the
editor's template picker and the docs gallery show. The object's order is the gallery order, and
`templateMetadata.test.ts` fails unless it lists exactly the registry's ids.

### Step 6: the editor's template picker

Add an entry to `TEMPLATE_ENTRIES` in `TemplatePicker.tsx`, in the same position as in
`TEMPLATE_METADATA`, with the same `label` and `description`, and a small SVG `icon` built from the
file's `TemplateIcon` helper. The picker test fails on a missing entry, a different order, drifted
text, or a missing icon.

### Step 7: tests

Cover representative inputs in `templates.test.ts`: the expected layers for a typical block, every
orientation, empty and very long text, and each parameter. The tests in that file show how to
materialize a block with a test theme and viewport.

### Step 8: parameters

Add a `TEMPLATE_INPUT_DESCRIPTORS.callout` entry listing each `{[…]}` parameter: its `key`, a
`description`, a `coerce` kind (`string`, `number`, `boolean`, `latLng`, `labeledPair`,
`stringList`), a closed `values` list for enums, and `required` where it applies:

```ts
callout: [
  { key: 'text', description: 'The note text', required: true },
  { key: 'tone', description: 'Visual tone', values: ['info', 'warning'] },
],
```

No test notices a missing entry: the template still renders, but `tone=warning` stays an untyped
string, `lintTemplateParams` never flags a typo, and the template's gallery page says it takes no
parameters.

### Step 9: the gallery page

Every built-in template needs a page at `docs/blocks/<id>.md` with frontmatter `template: <id>` and
at least one ` ```markdown preview ` example; `docsSite.test.ts` fails without it. The site adds the
description, the tag, and the body policy automatically, generates the parameter table from step
8's descriptors, and uses the first live example as the template's thumbnail in the gallery. The
page conventions are in [`docs/_theme/README.md`](https://github.com/bendyline/squisq/blob/main/docs/_theme/README.md).

````markdown
---
template: callout
description: A short highlighted note that stands on its own slide.
---

# Callout

Use a callout for one sentence the audience must not miss.

```markdown preview
## Bring a tide table {[callout tone=warning]}

The north channel dries at low water.
```
````

Check each example with `npm run docs:check -- --layers blocks/callout.md`, which prints the
template every block resolved to and the layers it drew.

### Four more registries

Each of these has a guard test that compares it with the registry, so `npm test` fails until the
new id is in all four:

- **`TEMPLATE_AUTHORING_METADATA`** (`authoringMetadata.ts`): the template's `role` (which gallery
  group it joins), its `bodyPolicy` (`complete`, `derived`, `ignored`, or `structured` — how much of
  the section body it shows), `safeForContentFirst: false` (only `content` may be `true`), and
  `placement: 'heading'`.
- **`TEMPLATE_TOKEN_NAMES`** (`templateNames.ts`): reserves the id so a bare `{[callout]}` is read as
  a block tag rather than an inline icon. It is a hard-coded set to keep the markdown parser free of
  import cycles, which is why a test compares it with the registry.
- **`BLOCK_MEDIA_LAYOUT_POLICIES`** (`mediaLayoutPolicy.ts`): what happens to images and video in
  the block's body — whether the template places them itself or leaves room for them, and in which
  arrangement for each stage shape. Copy the entry of the closest existing template and adjust its
  `summary`.
- **`sectionExtractors`** (`packages/core/src/doc/page/sectionExtractors.ts`): how the block renders
  in Page mode; see below.

| Registry                      | Test                                | Also typed against the ids |
| ----------------------------- | ----------------------------------- | -------------------------- |
| `TEMPLATE_AUTHORING_METADATA` | `templateAuthoringMetadata.test.ts` | yes                        |
| `TEMPLATE_TOKEN_NAMES`        | `templateTokenNames.test.ts`        | no                         |
| `BLOCK_MEDIA_LAYOUT_POLICIES` | `mediaLayoutPolicy.test.ts`         | yes                        |
| `sectionExtractors`           | `materializePageSections.test.ts`   | no                         |

#### Page mode

Page mode renders blocks as scrolling HTML sections, not slides. Add a `SectionExtractor` to
`sectionExtractors` that maps your input onto one of the existing section kinds, a variant of it,
and its slots:

```ts
const callout: SectionExtractor = (input) => {
  const c = input as CalloutInput;
  return { kind: 'callout', variant: 'fact', slots: { body: { text: c.text } } };
};
```

Templates whose output is inherently spatial (charts, diagrams, maps) use the existing
`canvas-embed` kind instead, which embeds the slide rendering responsively. See
[Projections](../concepts/projections.md).

## Optional wiring

None of these are enforced, but most templates need at least the first:

- **Deriving inputs from Markdown.** `deriveTemplateInputs` in `packages/core/src/doc/templateInputs.ts`
  maps a heading and its body onto inputs — `factCard`, for example, takes the heading as `fact` and
  the body as `explanation`. Without a case for your id, the template receives only its parameters.
- **Geometry-bound text.** If text is positioned against drawn marks (axes, legends, labels on
  shapes), add the id to `GEOMETRY_BOUND_TEMPLATES` in `registry.ts` so the slideshow's
  grow-text-to-fit pass leaves its sizes alone.
- **Renames.** When a template replaces an older id, add the old one to `TEMPLATE_ALIASES` in
  `templateNames.ts` so existing documents still resolve; a test checks every alias target exists.
- **Swatch seed.** A `TEMPLATE_SEEDS` entry in `packages/site/src/swatches/content.ts` gives the
  swatch harness a fitting heading, parameters, and media; without one it uses a generic heading.
- **Template counts.** Update the template counts in the repository's `CLAUDE.md`.

## Review it visually

The swatch harness renders every template in every built-in theme against a library of realistic
bodies — short and long prose, lists, tables, quotes, code, images, right-to-left and CJK text — and
measures the result for text leaving the frame, overlapping text, clipped or tiny type, fallback
cards, and body prose a full-body template failed to show:

```bash
npm run screenshots:swatches -- --template callout
npm run screenshots:swatches -- --template callout --orientation portrait,square --keep
npm run screenshots:swatches -- --template callout --theme bold,gezellig --montage
```

It renders workspace source directly, so you don't rebuild between runs. Results land in
`reports/swatches/latest/` (ignored by Git): open `index.html` for the filterable contact sheet and
read `summary.md` for the worklist of problems. `--keep` re-renders the subset you asked for and
merges it into the previous report, which is the loop for fixing one template. Variants your
template cannot use structurally are skipped unless you pass `--all-variants`.

`npm run screenshots:templates` is the quicker contact sheet: one hand-built fixture per template.

## Before you finish

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
npm run docs:check
```

## Related

- [Templates](../concepts/templates.md) and [Themes](../concepts/themes.md) — the concepts behind
  this change
- [Block gallery](../../blocks/index.md) — every built-in template
- API reference: [template registry](../../API.md#template-registry)

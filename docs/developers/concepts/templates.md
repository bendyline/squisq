---
title: Templates
description: How block templates work — pure functions from inputs to layers, the registry and template context, materializeBlockLayers, input derivation and coercion, metadata, and document-scoped custom templates.
---

# Templates

A template decides how one block looks. Authors pick one with a tag on a heading —
`## Water quality {[statHighlight]}` — and Squisq ships 38 built-in templates; see the
[block gallery](../../blocks/index.md). This page covers how templates work underneath, for
developers who render, inspect, or extend them.

## Templates are pure functions

Every built-in template is a function from a typed input and a context to an array of layers:

```ts
type TemplateFunction<T extends TemplateBlock> = (input: T, context: TemplateContext) => Layer[];
```

No state, no side effects, no DOM, no network. The same input and context always produce the same
layers, so a template runs identically in the browser player, a Web Worker, a Node exporter, and a
test. You can call one directly:

```ts
import { templateRegistry } from '@bendyline/squisq/doc';
import {
  createTemplateContext,
  resolveTheme,
  type StatHighlightInput,
} from '@bendyline/squisq/schemas';

const input: StatHighlightInput = {
  template: 'statHighlight',
  id: 'water',
  duration: 5,
  audioSegment: 0,
  stat: '92%',
  description: 'of samples passed',
};
const context = createTemplateContext(resolveTheme('documentary'), 0, 1);

templateRegistry.statHighlight(input, context).map((layer) => layer.id);
// ['bg', 'stat', 'description']
```

Calling the registry gives you the template's raw output. To render a block the way the player
does, use `materializeBlockLayers` (below), which adds the theme's render style, persistent layers,
rich media from the block body, and failure handling.

## The registry

`templateRegistry` maps each canonical template id to its function. Around it,
`@bendyline/squisq/doc` exports:

| Export                                       | Use                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getAvailableTemplates()`                    | The 38 built-in ids                                                                        |
| `hasTemplate(name)`                          | Whether a name (or a legacy alias) is a built-in                                           |
| `resolveTemplateName(name)`                  | Map a legacy spelling (`titleBlock`) to its canonical id (`title`)                         |
| `buildRegistry(customTemplates)`             | A registry with document-scoped custom templates merged in; built-ins win name collisions  |
| `CONTAINER_TEMPLATES`, `isContainerTemplate` | `diagram`, `drawing`, and `layout`, which draw their child blocks as part of the canvas    |
| `TABLE_FED_TEMPLATES`                        | `dataTable` and the seven charts, which read the first table in the block body             |
| `GEOMETRY_BOUND_TEMPLATES`                   | Templates whose text is tied to drawn geometry, so renderers never scale their text to fit |

The registry is never mutated. Custom templates are merged per call, so documents on one page
can't leak templates into each other.

## The template context

The context carries everything a template needs besides its input. Create one with
`createTemplateContext(theme, blockIndex, totalBlocks, viewport?, { motion? })`.

| Field                       | What it is                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `theme`                     | The full `Theme` — colors, typography, style, render style, color schemes                      |
| `viewport`                  | The target canvas, such as `VIEWPORT_PRESETS.landscape` (1920×1080) or `.portrait` (1080×1920) |
| `orientation`               | `landscape`, `portrait`, or `square`, derived from the viewport                                |
| `fontScale`                 | The font scale for this viewport                                                               |
| `layout`                    | Layout hints for the orientation, with the theme's `renderStyle.layoutOverrides` applied       |
| `blockIndex`, `totalBlocks` | Where the block sits in the sequence                                                           |
| `children`                  | The block's child blocks, for container templates                                              |
| `block`                     | The source block, for custom templates' placeholder tokens                                     |
| `motion`                    | The resolved motion profile (how much charts grow, numbers count, text enters)                 |

Templates read the theme through helpers in `@bendyline/squisq/doc` rather than hard-coding colors
or sizes: `resolveColorScheme(context, name)`, `themedFontSize(px, context, isTitle)`,
`getThemeFont(context, 'title' | 'body' | 'mono')`, `themedSurfaceGradient(context)`,
`themedScrim(context)`, `shouldUseShadow(context)`, `themedEntrance(context, layerType, fallback)`,
`themedImageTreatment(context, override)`, and `getTemplateHint(context, template, key, fallback)`.
That is what lets one template look native in every [theme](themes.md).

## `materializeBlockLayers`

`materializeBlockLayers(block, options)` is the public way to turn any block into layers. Every
renderer and exporter goes through it, so its output is exactly what the player draws.

```ts
import { materializeBlockLayers } from '@bendyline/squisq/doc';
import { VIEWPORT_PRESETS, resolveTheme } from '@bendyline/squisq/schemas';

// block: any DocBlock; doc: the Doc it belongs to
const result = materializeBlockLayers(block, {
  theme: resolveTheme('gezellig'),
  viewport: VIEWPORT_PRESETS.portrait,
  customTemplates: doc.customTemplates,
});

result.layers; // Layer[], back to front
result.source; // 'template' | 'authored' | 'rich-content' | 'fallback' | 'empty'
result.diagnostic; // present when the template was unknown, threw, or returned no array
```

It accepts any `DocBlock`: a block from `markdownToDoc` or `buildPreviewDoc`, a typed
`TemplateBlock`, or a raw block with its own `layers`. Options:

| Option                      | Default                      | Effect                                                                         |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `theme`                     | `DEFAULT_THEME` (`standard`) | The theme templates read                                                       |
| `viewport`                  | `VIEWPORT_PRESETS.landscape` | The canvas templates compose for                                               |
| `persistentLayers`          | the theme's                  | Replace the theme's persistent layers, or `false` to omit them                 |
| `blockIndex`, `totalBlocks` | `0`, `1`                     | Position in the sequence                                                       |
| `customTemplates`           | none                         | Document-scoped templates, usually `doc.customTemplates`                       |
| `failureMode`               | `'fallback'`                 | A failed template draws a visible fallback card; `'empty'` returns no layers   |
| `motion`                    | the theme's profile          | Override the motion profile                                                    |
| `mediaAspectRatios`         | none                         | Known aspect ratios of images, videos, and diagrams, so their regions fit them |

Failures are data, not console output: an unknown template, a template that throws, or one that
returns something other than an array comes back as a `diagnostic` with a code
(`unknown-template`, `template-error`, `invalid-template-result`).

## Where inputs come from

An author writes a heading, a body, and maybe a tag. The template receives typed inputs. Three
sources fill them, merged in this order, later ones winning:

1. **Derived from the section.** The heading text and body supply natural inputs — the heading
   becomes `title`, a leading number becomes `stat` with the rest of the sentence as
   `description`, a blockquote becomes `quote`, a list becomes `items`.
   `deriveTemplateInputs(template, headingText, contents)` does this.
2. **Structured data.** A ` ```json data ` or ` ```yaml data ` fence under the heading, or (for
   table-fed templates) the first table, lands in `block.templateData` with real types.
3. **Tag parameters.** `{[statHighlight detail="Up from 81% last year"]}` lands in
   `block.templateOverrides` as strings, then is coerced to each input's declared type.

```markdown preview
## Summer clarity {[statHighlight]}

**92%** of water samples passed the clarity test.

## Summer clarity, with context {[statHighlight detail="Up from 81% last year" colorScheme=green]}

**92%** of water samples passed the clarity test.
```

### Input descriptors, coercion, and linting

`TEMPLATE_INPUT_DESCRIPTORS[id]` describes each tag parameter a template accepts: its `key`, a
`description`, a `coerce` kind (`string`, `number`, `boolean`, `latLng`, `labeledPair`,
`stringList`), a closed set of `values` or a free-form `valueHint`, and whether it is `required`.
`BASE_INPUT_DESCRIPTORS` lists the parameters every template accepts. Two functions use them:

```ts
import { coerceTemplateParams, lintTemplateParams } from '@bendyline/squisq/doc';

coerceTemplateParams('barChart', { stacked: 'true', unit: '%' });
// { input: { stacked: true, unit: '%' }, warnings: [] }

lintTemplateParams('barChart', { stackd: 'true', showLegend: 'maybe' });
// [ { kind: 'unknown-input', key: 'stackd', suggestion: 'stacked', message: '… Did you mean "stacked"?' },
//   { kind: 'invalid-input-value', key: 'showLegend', message: '"showLegend": not a boolean ("maybe") …' } ]
```

`coerceTemplateParams` never throws: a value that doesn't coerce stays a string and produces a
warning. `lintTemplateParams` is what `validateMarkdownSource` reports as `unknown-input`,
`invalid-input-value`, and `missing-input` diagnostics. Block settings that every block accepts
(`duration`, `transition`, and the rest — see
[Block settings](../../guide/tags.md#block-settings)) are recognized and never flagged.

A template with no descriptors entry accepts its parameters as untyped strings and is exempt from
linting. Today that is `factCard`, `fullBleedQuote`, `list`, `definitionCard`, `videoPullQuote`,
`diagram`, `layout`, and `drawing`.

## Metadata

Two catalogs describe the built-ins, keyed by template id:

- **`TEMPLATE_METADATA`** — `{ label, description }` for pickers and galleries. The editor's
  template picker reads it.
- **`TEMPLATE_AUTHORING_METADATA`** — how a template treats content, for tools and agents that
  choose templates: `role` (`opener`, `divider`, `content`, `highlight`, `quote`, `comparison`,
  `event`, `media`, `data`, `spatial`), `bodyPolicy` (`complete` — the whole body is shown, as in
  `content`; `derived` — inputs are extracted from it, as in `statHighlight`; `structured` — it
  reads a table or other structure, as in the charts; `ignored` — the body isn't shown, as in
  `title`), `safeForContentFirst` (whether it is a safe loss-averse default), and `placement`.

```ts
import { TEMPLATE_AUTHORING_METADATA, TEMPLATE_METADATA } from '@bendyline/squisq/doc';

TEMPLATE_METADATA.statHighlight.label; // 'Stat Highlight'
TEMPLATE_AUTHORING_METADATA.statHighlight.bodyPolicy; // 'derived'
TEMPLATE_AUTHORING_METADATA.content.safeForContentFirst; // true
```

## Custom templates

A document can carry its own templates. A `CustomTemplateDefinition` is a named list of layers,
positioned in percentages so it fits any viewport, whose text and image fields can hold
placeholder tokens — `{title}`, `{content}`, `{children}`, `{image:1}`, `{attr:key}`, each with an
optional `|default` — resolved against the block at render time. A layer can also `repeat` once per
image, child block, or list item.

```ts
import type { CustomTemplateDefinition } from '@bendyline/squisq/schemas';
import { writeCustomTemplatesToFrontmatter } from '@bendyline/squisq/doc';
import { setFrontmatterValues } from '@bendyline/squisq/markdown';

const harborHero: CustomTemplateDefinition = {
  name: 'harbor-hero',
  label: 'Harbor hero',
  viewport: { width: 1920, height: 1080 },
  layers: [
    {
      id: 'bg',
      type: 'shape',
      position: { x: '0%', y: '0%', width: '100%', height: '100%' },
      content: { shape: 'rect', fill: '#0b3954' },
    },
    {
      id: 'headline',
      type: 'text',
      position: { x: '8%', y: '40%', width: '84%', height: '20%' },
      content: { text: '{title}', style: { fontSize: 96, color: '#ffffff' } },
    },
  ],
};

const source = setFrontmatterValues(
  '## Tide report {[harbor-hero]}\n\nThe tide turns at 10:30.\n',
  {
    'squisq-custom-templates': writeCustomTemplatesToFrontmatter([harborHero])!,
  },
);
```

The definitions ride in the `squisq-custom-templates` frontmatter key as compact JSON, so the
document stays self-contained for export and sharing. `markdownToDoc` decodes them into
`doc.customTemplates` (`readCustomTemplatesFromFrontmatter` does the same on raw frontmatter, and
`validateCustomTemplateDefinition` from `@bendyline/squisq/schemas` checks one). Pass
`doc.customTemplates` to `materializeBlockLayers` and `expandDocBlocks`, and the `{[harbor-hero]}`
heading resolves to it; `materializePageSections`, `materializeDashboard`, and `DocPlayer` read it
from the document themselves. A custom template whose name matches a built-in is ignored.

Authors design custom templates in the editor; see [Custom templates](../../guide/custom-templates.md).

## Adding a built-in template

Built-ins live in `packages/core/src/doc/templates/`. Adding one touches nine places — the input
type, the union, the function, the registry, metadata, the editor's picker, tests, input
descriptors, and a gallery page — and skipping one breaks the build, fails a test, or leaves the
template missing from the editor. Follow
[Contributing templates](../guides/contributing-templates.md).

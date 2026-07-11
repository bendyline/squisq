# @bendyline/squisq

Headless utilities for doc/block rendering, spatial math, Markdown parsing, and storage. Framework-agnostic — runs in the browser or Node.js with zero framework dependencies.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq)](https://www.npmjs.com/package/@bendyline/squisq)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq
```

## What's Inside

| Module       | Description                                                                      |
| ------------ | -------------------------------------------------------------------------------- |
| **schemas**  | Type definitions — `Doc`, `BlockTemplate`, `Viewport`, `Theme`, `LayoutStrategy` |
| **doc**      | Template registry, 24 block templates, animation/theme utilities                 |
| **markdown** | Markdown parsing, stringifying, AST types (`MarkdownDocument`), tree utilities   |
| **spatial**  | Haversine distance, Geohash encode/decode                                        |
| **storage**  | `StorageAdapter` interface, Memory + LocalStorage + LocalForage adapters         |

## New in this release

The Squiggly Square markdown standard (see [`docs/SquigglySquare.md`](../../docs/SquigglySquare.md)) gained several authoring capabilities:

- **[Standalone annotations](../../docs/SquigglySquare.md#standalone-annotations)** — a top-level paragraph that is exactly `{[templateName …]}` becomes a heading-less template block; the body that follows it is its contents.
- **[Inline attribute coercion](../../docs/SquigglySquare.md#inline-attribute-coercion)** — `{[map center="47.6,-122.3" zoom=9]}` and `{[twoColumn left="Espresso|Bold"]}` now render without a data fence (typed via `TEMPLATE_INPUT_DESCRIPTORS`).
- **[Validation additions](../../docs/SquigglySquare.md#validation)** — new `unknown-input` / `invalid-input-value` / `missing-input` warnings plus `possible-data-fence` / `conflicting-annotation-key` info diagnostics (a new `info` severity).
- **[YAML data fences](../../docs/SquigglySquare.md#structured-data-fences)** now accept one level of nested mappings (a `map` `center` can be pure YAML).
- **[Multi-line frontmatter](../../docs/SquigglySquare.md#multi-line-frontmatter)** — `squisq-custom-templates` / `squisq-custom-themes` can be authored as pretty JSON via YAML literal block scalars (`key: |-`).
- **Custom-template tokens v2** (see [`docs/SquigglySquare.md`](../../docs/SquigglySquare.md), "Registering custom templates") — `{attr:key}`, pipe defaults on every token, and per-layer `repeat` with `{item}` / `{index}` tokens.

New `@bendyline/squisq/doc` exports powering the above: `coerceTemplateParams`, `lintTemplateParams`, `TEMPLATE_INPUT_DESCRIPTORS`, and `replaceDataFence`.

## Subpath Imports

Import only what you need:

```ts
import type { Doc, BlockTemplate, Theme } from '@bendyline/squisq/schemas';
import { materializeBlockLayers, expandDocBlocks } from '@bendyline/squisq/doc';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { encodeGeohash, haversineDistance } from '@bendyline/squisq/spatial';
import { LocalStorageAdapter } from '@bendyline/squisq/storage';
```

Or import everything from the root:

```ts
import { parseMarkdown, haversineDistance, materializeBlockLayers } from '@bendyline/squisq';
```

## Quick Examples

### Parse Markdown

```ts
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';

const doc = parseMarkdown('# Hello\n\nSome content');
console.log(doc.children); // AST nodes

const md = stringifyMarkdown(doc);
```

### Spatial Utilities

```ts
import { encodeGeohash, haversineDistance } from '@bendyline/squisq/spatial';

const distanceKm = haversineDistance({ lat: 47.6, lng: -122.3 }, { lat: 37.7, lng: -122.4 });
const hash = encodeGeohash(47.6, -122.3, 7);
```

### Materialize a Block

```ts
import { materializeBlockLayers } from '@bendyline/squisq/doc';

const result = materializeBlockLayers(block, {
  theme,
  viewport,
  customTemplates: doc.customTemplates,
});

render(result.layers);
if (result.diagnostic) report(result.diagnostic);
```

The canonical materializer handles authored layers, built-in and document-scoped
templates, theme motion, and persistent layers. Failed templates produce a
visible fallback plus a structured diagnostic by default; pass
`failureMode: 'empty'` when a host deliberately wants no fallback UI.

### Theme System

```ts
import {
  compileTheme,
  createThemeRegistry,
  getAvailableThemes,
  resolveTheme,
} from '@bendyline/squisq/schemas';

const themes = getAvailableThemes(); // 11 built-in themes
const theme = resolveTheme('cinematic');

// Host-level custom themes live in an explicit caller-owned registry.
const registry = createThemeRegistry([
  compileTheme({ id: 'brand', name: 'Brand', seedColors: { primary: '#6633cc' } }),
]);
const brand = resolveTheme('brand', registry);
```

## Related Packages

| Package                                                                                        | Description                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)               | React components for rendering docs         |
| [@bendyline/squisq-formats](https://www.npmjs.com/package/@bendyline/squisq-formats)           | DOCX, PDF, HTML import/export               |
| [@bendyline/squisq-editor-react](https://www.npmjs.com/package/@bendyline/squisq-editor-react) | React editor with raw/WYSIWYG/preview modes |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

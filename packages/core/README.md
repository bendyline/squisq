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
| **doc**      | Template registry, 17 block templates, animation/theme utilities                 |
| **markdown** | Markdown parsing, stringifying, AST types (`MarkdownDocument`), tree utilities   |
| **spatial**  | Haversine distance, Geohash encode/decode                                        |
| **storage**  | `StorageAdapter` interface, Memory + LocalStorage + LocalForage adapters         |

## Subpath Imports

Import only what you need:

```ts
import type { Doc, BlockTemplate, Theme } from '@bendyline/squisq/schemas';
import { getLayers, expandDocBlocks } from '@bendyline/squisq/doc';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { haversineDistance, geohashEncode } from '@bendyline/squisq/spatial';
import { LocalStorageAdapter } from '@bendyline/squisq/storage';
```

Or import everything from the root:

```ts
import { parseMarkdown, haversineDistance, getLayers } from '@bendyline/squisq';
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
import { haversineDistance, geohashEncode } from '@bendyline/squisq/spatial';

const meters = haversineDistance(47.6, -122.3, 37.7, -122.4);
const hash = geohashEncode(47.6, -122.3, 7);
```

### Theme System

```ts
import { resolveTheme, getAvailableThemes } from '@bendyline/squisq/schemas';

const themes = getAvailableThemes(); // 8 built-in themes
const theme = resolveTheme('cinematic');
```

## Related Packages

| Package                                                                                        | Description                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)               | React components for rendering docs         |
| [@bendyline/squisq-formats](https://www.npmjs.com/package/@bendyline/squisq-formats)           | DOCX, PDF, HTML import/export               |
| [@bendyline/squisq-editor-react](https://www.npmjs.com/package/@bendyline/squisq-editor-react) | React editor with raw/WYSIWYG/preview modes |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

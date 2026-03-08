# squisq

[![CI](https://github.com/bendyline/squisq/actions/workflows/ci.yml/badge.svg)](https://github.com/bendyline/squisq/actions/workflows/ci.yml)
[![npm @bendyline/squisq](https://img.shields.io/npm/v/@bendyline/squisq)](https://www.npmjs.com/package/@bendyline/squisq)
[![npm @bendyline/squisq-react](https://img.shields.io/npm/v/@bendyline/squisq-react)](https://www.npmjs.com/package/@bendyline/squisq-react)
[![npm @bendyline/squisq-formats](https://img.shields.io/npm/v/@bendyline/squisq-formats)](https://www.npmjs.com/package/@bendyline/squisq-formats)
[![npm @bendyline/squisq-editor-react](https://img.shields.io/npm/v/@bendyline/squisq-editor-react)](https://www.npmjs.com/package/@bendyline/squisq-editor-react)

Open-source monorepo providing reusable libraries for document/block rendering, spatial utilities, and format conversion. Framework-agnostic at the core, with a React component layer on top.

## Packages

| Package                                                   | Description                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`@bendyline/squisq`](packages/core)                      | Headless utilities — schemas, templates, spatial math, Markdown, storage |
| [`@bendyline/squisq-react`](packages/react)               | React components — DocPlayer, BlockRenderer, layers, hooks               |
| [`@bendyline/squisq-formats`](packages/formats)           | Format converters — DOCX, PDF, OOXML import/export                       |
| [`@bendyline/squisq-editor-react`](packages/editor-react) | React editor shell — raw/WYSIWYG/preview modes                           |

## Quick Start

```bash
npm install @bendyline/squisq @bendyline/squisq-react
```

```tsx
import { DocPlayer } from '@bendyline/squisq-react';
import '@bendyline/squisq-react/styles';

function App() {
  return <DocPlayer doc={myDoc} />;
}
```

### Subpath Imports

Each package exposes targeted subpath entries so you can import only what you need:

```ts
import type { Doc, BlockTemplate } from '@bendyline/squisq/schemas';
import { haversineDistance } from '@bendyline/squisq/spatial';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import { markdownDocToDocx } from '@bendyline/squisq-formats/docx';
```

## Development

```bash
# Install dependencies
npm install

# Build all packages (sequential, respects dependency order)
npm run build

# Run unit tests
npm test

# Run E2E tests (starts the dev site automatically)
npm run test:e2e

# Start the dev site
npm run dev

# Typecheck all packages
npm run typecheck

# Lint & format
npm run lint
npm run format:check
```

## Architecture

- **Templates are pure functions** — `(input, context) => Layer[]`, no side effects
- **SVG-based rendering** — blocks render as SVG for resolution independence
- **ESM only** — all packages output ES modules via tsup
- **Subpath exports** — consumers import only what they need
- **React, not Preact** — targets standard React; compatible via preact/compat

## Live Demo

[**bendyline.github.io/squisq**](https://bendyline.github.io/squisq/)

## License

[MIT](LICENSE) — Copyright (c) 2026 Bendyline

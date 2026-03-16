# @bendyline/squisq-editor-react

React editor shell for Squisq documents with three integrated views: a Monaco-powered raw Markdown editor, a Tiptap WYSIWYG rich text editor, and a live block preview. Switching between views keeps the document in sync automatically.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-editor-react)](https://www.npmjs.com/package/@bendyline/squisq-editor-react)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq-editor-react @bendyline/squisq @bendyline/squisq-react
```

**Peer dependencies:** `react` and `react-dom` (v18 or v19).

## Quick Start

```tsx
import { EditorShell } from '@bendyline/squisq-editor-react';
import '@bendyline/squisq-editor-react/styles';

function App() {
  return <EditorShell initialMarkdown="# Hello World" />;
}
```

## Editor Views

| View        | Powered By    | Description                                           |
| ----------- | ------------- | ----------------------------------------------------- |
| **Raw**     | Monaco Editor | Full Markdown source editing with syntax highlighting |
| **WYSIWYG** | Tiptap        | Rich text editing with a formatting toolbar           |
| **Preview** | DocPlayer     | Live rendered block preview with theme selection      |

## Components

| Component        | Description                                                      |
| ---------------- | ---------------------------------------------------------------- |
| `EditorShell`    | Top-level editor — combines all three views with a view switcher |
| `EditorProvider` | Context provider for editor state management                     |

## Context API

Use `useEditorContext()` to access editor state and actions from child components:

```tsx
import { EditorProvider, useEditorContext } from '@bendyline/squisq-editor-react';

function MyComponent() {
  const { state, actions } = useEditorContext();
  // state.markdown, state.view, state.doc
  // actions.setMarkdown(), actions.setView()
}
```

## Styles

Import the editor CSS:

```ts
import '@bendyline/squisq-editor-react/styles';
```

## Related Packages

| Package                                                                              | Description                                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)                 | Headless core — schemas, templates, spatial, markdown, storage |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)     | React components for rendering docs                            |
| [@bendyline/squisq-formats](https://www.npmjs.com/package/@bendyline/squisq-formats) | DOCX, PDF, HTML import/export                                  |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

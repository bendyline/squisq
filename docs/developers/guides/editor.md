---
title: Embedding the editor
description: Add the Squisq editor to a React app, wire its storage, history, proofing, and other capabilities, and talk to it from your own UI.
---

# Embedding the editor

`EditorShell` from `@bendyline/squisq-editor-react` is the whole editor in one component: the
**Write** view (rich text), the **Source** view (Markdown in Monaco), and the **Use** view (the
slideshow, page, dashboard, and other renditions), with the toolbar, outline, and status bar. This
guide gets it running, then walks through its props by capability.

## Install

```bash
npm install @bendyline/squisq @bendyline/squisq-react @bendyline/squisq-editor-react monaco-editor@0.50.0
```

`react` and `react-dom` 18 or 19 and `monaco-editor` `~0.50.0` are peer dependencies; Tiptap
ships as a regular dependency. Monaco loads lazily, the first time someone opens the Source view or
a code block, but your bundler must handle Monaco's ESM build, which imports CSS files. Vite does
this with no configuration, and the examples below assume Vite.

## A minimal editor

Load both stylesheets and wire Monaco's workers once, in your entry file:

```tsx
// main.tsx
import { createRoot } from 'react-dom/client';
import { configureMonacoWorkers } from '@bendyline/squisq-editor-react/monaco-workers';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import '@bendyline/squisq-react/styles';
import '@bendyline/squisq-editor-react/styles';
import { App } from './App';

configureMonacoWorkers({
  editor: EditorWorker,
  json: JsonWorker,
  css: CssWorker,
  html: HtmlWorker,
  ts: TsWorker,
});

createRoot(document.getElementById('root')!).render(<App />);
```

Then render the shell:

```tsx
// App.tsx
import { useCallback, useState } from 'react';
import { EditorShell } from '@bendyline/squisq-editor-react';

const STARTER = `# Harbor survey, spring

## Moorings {[statHighlight]}

**42** moorings inspected, six chains replaced
`;

export function App() {
  const [source, setSource] = useState(STARTER);
  const handleChange = useCallback((next: string) => setSource(next), []);

  return <EditorShell initialMarkdown={source} onChange={handleChange} height="100vh" />;
}
```

What each piece does:

| Piece                                   | Why                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@bendyline/squisq-editor-react/styles` | The editor's chrome, panels, and widgets.                                                                                                                                                                                                                    |
| `@bendyline/squisq-react/styles`        | The player inside the Use view and the previews. The editor stylesheet doesn't include it.                                                                                                                                                                   |
| `configureMonacoWorkers`                | Gives Monaco its language-service workers. Only `editor` is required. Without the call, highlighting and editing still work on the main thread; only JSON/CSS/HTML/TypeScript IntelliSense in code files is missing. Call it before the first editor mounts. |
| `initialMarkdown`                       | The starting document. Read once, on mount.                                                                                                                                                                                                                  |
| `onChange`                              | Receives the full Markdown source after every change, and once on mount.                                                                                                                                                                                     |
| `height`                                | CSS height of the shell (default `'100vh'`).                                                                                                                                                                                                                 |

The `?worker` imports are Vite syntax. With another bundler, pass constructors that create the same
five Monaco worker scripts; `configureMonacoWorkers` only needs `new () => Worker` for each.

## Content and change handling

`EditorShell` is uncontrolled: it owns the document once it mounts. To load a different document,
remount it with a new `key`, or replace the content from inside with `useEditorContext()` (see
[Talk to the editor](#talk-to-the-editor)).

| Prop                     | Default      | What it does                                                                                                                 |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `initialMarkdown`        | `''`         | The starting Markdown.                                                                                                       |
| `initialView`            | `'wysiwyg'`  | `'wysiwyg'` (Write), `'raw'` (Source), or `'preview'` (Use).                                                                 |
| `onChange`               | —            | `(source: string) => void`, called with the whole source.                                                                    |
| `articleId`              | `'untitled'` | An id for the document, passed to proofing storage and the generated `Doc`.                                                  |
| `fileName`               | —            | The file the content represents. A non-Markdown extension (`deploy.ts`) switches to a code editor with only the Source view. |
| `language`               | —            | A Monaco language id that overrides the one `fileName` implies.                                                              |
| `basePath`               | `'/'`        | Prefix for relative media paths in previews when there's no media provider.                                                  |
| `preserveSourceWrapping` | `true`       | Edit hard-wrapped prose as whole paragraphs in Write view and re-wrap it on save.                                            |
| `onLinkClick`            | —            | `(href) => boolean \| undefined`. Return `false` to let the browser follow the link; anything else means you handled it.     |

The Write view saves only what an edit touched, so an untouched document round-trips byte for
byte.

## Media and the workspace

Two props connect the editor to files:

- `workspaceContainer` — a `ContentContainer` for the folder the document lives in: its media, its
  `_files/` sidecar, version snapshots, data files, narration timing sidecars.
- `mediaProvider` — how media paths resolve to URLs and where dropped or recorded files are written.

Pass the container and let the shell derive the provider. That keeps reads and writes in one
namespace:

```tsx
import { useMemo } from 'react';
import { EditorShell } from '@bendyline/squisq-editor-react';
import { MemoryContentContainer } from '@bendyline/squisq/storage';

export function WorkspaceEditor({
  markdown,
  onChange,
}: {
  markdown: string;
  onChange: (source: string) => void;
}) {
  const workspace = useMemo(() => new MemoryContentContainer(), []);
  return (
    <EditorShell
      initialMarkdown={markdown}
      onChange={onChange}
      workspaceContainer={workspace}
      allowVersioning
      versionBasename="harbor-survey"
      versioningAutoSaveIdleMs={10_000}
      versioningPrunePolicy={{ type: 'keep-last-n', n: 20 }}
      onSaveVersion={(result) => {
        if (result.saved) console.warn(`Snapshot ${result.version?.timestamp}`);
      }}
    />
  );
}
```

With a container and no `mediaProvider`, the shell calls `createMediaProviderFromContainer` for you,
so dropping an image stores it in the container and inserts a reference. If you do pass your own
provider, derive it from the same container (`createMediaProviderFromContainer(container)`):
recordings, image edits, and narration write through the provider and are read back through the
container, so two separate stores lose files without any error.

| Prop                    | Default         | What it does                                                                                                      |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `workspaceContainer`    | —               | The document's folder.                                                                                            |
| `mediaProvider`         | derived         | Passing it, even as `null`, shows the Attachments toggle. `null` disables media storage.                          |
| `mediaEditRenders`      | owned           | The processed-audio render manager for media edits; `null` turns media edits off ([guide](../../media-edits.md)). |
| `showFilesToggle`       | with a provider | Show the toolbar's Attachments toggle (the files attached to this document).                                      |
| `showFilesWhenNotEmpty` | `false`         | Open the Attachments panel when it gains files.                                                                   |
| `allowBinaryDownloads`  | `true`          | Offer downloads from the Attachments panel.                                                                       |

Containers come in several kinds — in memory, `localStorage`, IndexedDB, a zip — described on the
[storage concept page](../concepts/storage.md).

## Version history

`allowVersioning` stores snapshots at `.versions/<basename>.<timestamp>.md` inside the
`workspaceContainer` and adds a version history panel to the toolbar. It does nothing without a
container.

| Prop                       | Default                          | What it does                                                   |
| -------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `allowVersioning`          | `false`                          | Turn history on.                                               |
| `versionBasename`          | the container's document name    | The `<basename>` in snapshot names.                            |
| `versioningAutoSaveIdleMs` | `5000`                           | Snapshot after this much idle time. `0` turns auto-save off.   |
| `versioningPrunePolicy`    | `{ type: 'keep-last-n', n: 50 }` | Applied after each saved snapshot.                             |
| `onSaveVersion`            | —                                | Called after every attempt, saved or skipped, with a `reason`. |

> [!IMPORTANT]
> The basename comes from the container's primary document (`index.md`, `doc.md`, … at its root).
> If the container holds no Markdown file — common when the document itself lives elsewhere — pass
> `versionBasename`, or every snapshot is skipped with the reason `'no-document'`.

To snapshot from your own save flow, call `saveVersion({ content: markdownSource })` from the
context. Without `content`, it reads the container's document, which may be older than the editor.

## Proofing

Grammar and spellcheck run on [harper.js](https://github.com/Automattic/harper), an optional peer
you install and serve yourself. Pass a provider and the squiggles, hover cards, and findings panel
appear; leave it out and no engine code loads.

```tsx
import { createHarperProofingProvider } from '@bendyline/squisq-editor-react';

const proofing = createHarperProofingProvider({ wasmUrl: '/harper/harper_wasm_bg.wasm' });
// <EditorShell proofing={proofing} … />
```

| Prop                                                | Default | What it does                                                                              |
| --------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `proofing`                                          | `null`  | A provider instance (you own its lifetime) or a factory (the shell disposes it).          |
| `proofingDefaultEnabled`                            | `true`  | Check documents by default. Frontmatter and the View menu override it.                    |
| `proofingSpellingEnabled`, `proofingGrammarEnabled` | `true`  | Show each tier of findings.                                                               |
| `proofingIgnoreStore`                               | `null`  | Where dismissed findings persist, per document. Without it, Ignore lasts for the session. |

The [proofing guide](../../proofing.md) covers serving the WASM, CSP, dictionaries, and storage.

## Speech input

`speechInput` takes a `SpeechInputProvider` (or a factory) and adds a microphone button to the Write
and Source views; recognized phrases are inserted as plain text at the caret. Squisq ships no
recognizer, so the provider wraps whichever engine you choose. Without the prop there's no button
and no capture code loads. It's ignored when `readOnly` is set. See the
[speech input guide](../../speech-input.md).

## Recording and narration

| Prop             | Default | What it does                                                                                               |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `allowRecording` | `true`  | The toolbar's recorder (microphone, camera, screen). Shown only when there's a media provider.             |
| `allowNarrate`   | `true`  | The Narrate teleprompter under the Use view. Recording from it also needs `allowRecording` and a provider. |

Recordings are stored through the media provider, with timing sidecars beside them. The
[narration guide](../../guide/narration.md) describes what authors do; the
[narration and audio export guide](../../narration-and-audio-export.md) covers host integration.

## Calculation engine

Spreadsheet formulas in data cards run on the in-house engine from `@bendyline/squisq-calc` by
default. `calcEngineFactory` swaps it — for example, to run it in a worker, as the demo site does:

```tsx
import type { CalcEngineFactory } from '@bendyline/squisq-editor-react';
import CalcWorker from '@bendyline/squisq-calc/worker?worker';

const calcEngineFactory: CalcEngineFactory = async (config) => {
  const calc = await import('@bendyline/squisq-calc');
  try {
    return await calc.createWorkerCalcEngine({ ...config, workerFactory: () => new CalcWorker() });
  } catch {
    return calc.createInHouseEngine(config);
  }
};
// <EditorShell calcEngineFactory={calcEngineFactory} … />
```

Install `@bendyline/squisq-calc` to import it directly. If the factory throws, the editor falls back
to the in-house engine. The IronCalc backend and the data card itself are covered in the
[data and calculation guide](../../data-and-calc.md).

## Links, wiki links, and mentions

| Prop                   | What it does                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `linkSchemes`          | Extra URL schemes the link dialog accepts, such as an app's own `myapp:` links. `javascript:`, `vbscript:`, and `data:` are refused regardless. |
| `wikiLinks`            | A `WikiLinkSupport` that resolves and opens `[[article]]` links to neighboring documents.                                                       |
| `documentLinkProvider` | `(query) => Promise<DocumentLinkCandidate[]>` — adds a "Browse documents" picker to the link dialog.                                            |
| `mentionProvider`      | `(query) => Promise<MentionCandidate[]>` — typing `@` opens suggestions and inserts `@[Label](scheme:id)`.                                      |

A `WikiLinkSupport` needs two methods; `suggest` and `resolve` are optional:

```tsx
import type { WikiLinkSupport } from '@bendyline/squisq/markdown';

const wikiLinks: WikiLinkSupport = {
  // Never create anything here. Reject on a failed read rather than returning false.
  exists: (target) => workspace.has(target),
  // Validate the target, save the current document, create exclusively, then navigate.
  open: (target, { create }) => workspace.open(target, create),
};
```

Targets are document-relative names like `reference/tides`; `wikiLinkPath(target)` turns one into a
validated `.md` path. The [wiki links reference](../../API.md#wiki-article-links) lists the rules.

## Page templates

When your app publishes documents into HTML page templates (the `squisq-output-template`
frontmatter key), pass `pageTemplates` and Document settings gains a Page template field:

```tsx
import type { PageTemplateSettings } from '@bendyline/squisq-editor-react';

const pageTemplates: PageTemplateSettings = {
  // Called each time Document settings opens.
  listTemplates: async () =>
    (await workspace.templates()).map((path) => ({ value: path, label: path })),
  defaultLabel: 'Site default (_templates/post.html)',
};
```

Keep the object stable across renders. [Page templates](../../guide/page-templates.md) explains the
templates, and [Publishing static sites](static-sites.md) shows how to render them.

## Themes

| Prop                | What it does                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `defaultThemeId`    | The theme for documents that name none. A document's own `squisq-theme` always wins.                             |
| `defaultThemeLabel` | The picker label for that fallback, shown as "Workspace default (Documentary)". Defaults to `'Default'`.         |
| `themeOverride`     | A `Theme` that replaces the document's theme in previews, without changing the document — for live theme design. |
| `themeInheritance`  | How much of the theme the Write view mirrors: `'none'`, `'fonts'` (default), or `'fonts-colors'`.                |
| `colorScheme`       | `'light'` or `'dark'` for the editor's own chrome. Unrelated to the document theme.                              |

With `defaultThemeId` set, the theme pickers offer the default as its own entry (which removes the
document's theme key) and write every other choice explicitly, `standard` included. To restyle the
editor's chrome to match your app, see [Theming the editor chrome](../../theming.md).

## Panels and narrow screens

| Prop                                         | Default             | What it does                                                                                                                                                                                    |
| -------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inlinePreview`, `inlinePreviewWidth`        | `false`, `320`      | A gutter beside the Write view with a small preview card per block.                                                                                                                             |
| `outline`, `outlineWidth`                    | `false`, responsive | The heading outline on the left.                                                                                                                                                                |
| `navigationSheet`, `onNavigationSheetChange` | managed             | Below about 720px the outline and previews move into a sheet that swipes in from the right edge. Pass `'outline'`, `'previews'`, or `null` to control it (to close it from a Back button, say). |
| `blockTagVisibility`                         | `'active'`          | When template tags show on headings: `'none'`, `'active'`, or `'always'`.                                                                                                                       |
| `viewPreferences`, `onViewPreferencesChange` | —                   | All the View-menu toggles as one serializable object, for persisting them.                                                                                                                      |
| `showStatusBar`                              | `true`              | The word-count and status bar.                                                                                                                                                                  |
| `defaultViewportPreset`                      | `'landscape'`       | The slide shape when neither the document nor the user picked one.                                                                                                                              |

## Read-only and compact embeds

| Prop                                                                   | What it does                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `readOnly`                                                             | Neither view accepts edits. The toolbar still renders; hide it yourself for a pure viewer.    |
| `showPlayTab`                                                          | `false` hides the Use view.                                                                   |
| `hostMode="chat"`                                                      | A message composer: stays in Write view, hides the view tabs and document-level controls.     |
| `submitOnEnter`                                                        | Enter calls this instead of inserting a line break; Cmd/Ctrl+Enter inserts one.               |
| `minHeight`, `maxHeight`                                               | Grow with the content between these heights instead of using `height`.                        |
| `placeholder`, `thinMargins`, `fullWidth`                              | Empty-state text, tighter padding, and an edge-to-edge Write view instead of a centered page. |
| `showFormattingControls`, `showInsertControls`                         | Hide the formatting buttons or the Insert menu.                                               |
| `allowPresentationWindow`, `allowPresentationFullscreen`, `allowPrint` | Turn off the audience window, full screen, or printing where your host can't support them.    |
| `writeCanvasSettings`, `uxFont`                                        | Text size and line spacing for the Write view; the font for the editor's chrome.              |

## Extend the chrome

Three toolbar slots (`toolbarSlotLeft`, `toolbarSlotAfterActions`, `toolbarSlotRight`),
`statusBarSlotRight`, and `sidePanelSlot` (a panel docked beside the editor that reflows it) all
render inside the editor's context, so your components there can call `useEditorContext()`. Other
host props: `findMode`, `onFindModeChange`, `findRequest`, and `findShortcut` for search;
`fenceRenderers` for your own code-fence widgets; `reviewProviders` for review engines (see the
[review guide](../../review.md)); `codeContext` for notes in the Source view; and
`saveCoverImageOutput` and `saveDashboardImageOutput` to route image exports through your own save
flow.

## Talk to the editor

`useEditorContext()` returns the editor's state and actions side by side. Call it from a component
rendered in a slot:

```tsx
import { EditorShell, useEditorContext } from '@bendyline/squisq-editor-react';

function SaveButton({ onSave }: { onSave: (markdown: string) => Promise<void> }) {
  const { markdownSource, saveVersion } = useEditorContext();
  return (
    <button
      type="button"
      onClick={async () => {
        await onSave(markdownSource);
        await saveVersion({ content: markdownSource });
      }}
    >
      Save
    </button>
  );
}

export function EditorWithSave({ onSave }: { onSave: (markdown: string) => Promise<void> }) {
  return (
    <EditorShell initialMarkdown="# Field notes" toolbarSlotRight={<SaveButton onSave={onSave} />} />
  );
}
```

The fields you'll use most:

| Field                                                | What it is                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `markdownSource`, `doc`, `parseError`                | The current source, its parsed `Doc`, and the last parse error.                         |
| `activeView`, `setActiveView`                        | The view, and switching it.                                                             |
| `setMarkdownSource(source)`                          | Replace the source and re-parse.                                                        |
| `replaceAll(text)`                                   | Replace the content as one undoable step in Write and Source views.                     |
| `insertAtCursor(text)`, `replaceSelection(markdown)` | Edit at the caret or selection.                                                         |
| `insertBlockAfterCursor(block)`                      | Insert a Markdown block after the caret's block, as one undo step.                      |
| `applySourceEdits(edits, { baseSource })`            | Apply offset-based edits to the source as one undo step; refuses if the source changed. |
| `getSelection()`, `getBlockAtCursor()`               | Read the selection, or the block at the caret (Source view only).                       |
| `saveVersion(options)`, `versioning`                 | Snapshot now; the version manager.                                                      |
| `setFindMode(active)`                                | Open or close Find.                                                                     |
| `dictation`                                          | `{ active, available, toggle }` when speech input is wired, else `null`.                |
| `tiptapEditor`, `monacoEditor`                       | The live editor instances, when their view is mounted.                                  |

`useEditorContext()` throws outside the editor. To build your own layout instead of the shell's,
`EditorProvider` and the individual views (`WysiwygEditor`, `RawEditor`, `PreviewPanel`) are exported
too; the `@bendyline/squisq-editor-react/shell` subpath collects them.

## A complete reference: the demo site

The demo editor at the root of this site is a plain Vite app. Its wiring is worth reading in full:

| File                                                                        | Shows                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`main.tsx`](../../../packages/site/src/main.tsx)                           | The stylesheet imports and the Monaco worker setup, before the app mounts.                                                                                                                                        |
| [`setupMonacoWorkers.ts`](../../../packages/site/src/setupMonacoWorkers.ts) | `configureMonacoWorkers` with Vite `?worker` imports.                                                                                                                                                             |
| [`App.tsx`](../../../packages/site/src/App.tsx)                             | One `ContentContainer` per workspace with the provider derived from it, a `key` to remount on each new document, the calc factory (worker or IronCalc), `themeOverride` from the theme customizer, and find mode. |
| [`harperConfig.ts`](../../../packages/site/src/harperConfig.ts)             | A module-level proofing provider that survives remounts, an app dictionary, and an ignore store in `localStorage`.                                                                                                |

## Pitfalls

- **The preview has no styles.** Import `@bendyline/squisq-react/styles` as well as the editor's.
- **Changing `initialMarkdown` does nothing.** It's read once. Remount with a `key`, or call
  `setMarkdownSource` from the context.
- **`onChange` fires on mount and whenever it changes identity.** Pass a stable callback
  (`useCallback`) so it runs only for real edits.
- **History never saves.** There's no Markdown file in the container to name snapshots after. Pass
  `versionBasename`.
- **Dropped images vanish, or recordings lose their timing.** The media provider and the container
  point at different stores. Pass only `workspaceContainer`, or derive the provider from it.
- **Monaco fails to build.** Your bundler isn't processing CSS imported from `node_modules`.
- **Proofing or a factory restarts on every remount.** Create provider instances at module scope,
  as the demo site does, so a `key` change doesn't throw away a warm engine.

## Related

- [API reference: `EditorShell`](../../API.md#editorshell) and [Context](../../API.md#context)
- [The editor, for authors](../../guide/editor.md)
- [Rendering documents in React](rendering.md) — the player the Use view is built on
- [Architecture](../concepts/architecture.md)

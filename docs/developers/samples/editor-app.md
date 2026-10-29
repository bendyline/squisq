---
title: Editor app
description: A complete browser editor built on EditorShell, with images, localStorage saving, version history, and DOCX, PDF, and HTML export.
---

# Editor app

Field Notes is a full Squisq editor in about 250 lines of your own code. It has the Write, Source, and preview views, accepts dropped and inserted images, saves everything to `localStorage` a second after you stop typing, keeps a version history you can browse and revert, and exports the document as Word, PDF, or a single web page.

What it demonstrates:

- `EditorShell` from `@bendyline/squisq-editor-react`, with its styles.
- Wiring Monaco's language-service workers with Vite's `?worker` imports and `configureMonacoWorkers`.
- One `MemoryContentContainer` as the workspace, with a `MediaProvider` made from it, so the document, its images, and its version snapshots live in one place.
- Saving that workspace with `LocalStorageAdapter` and restoring it on load.
- Version history with `allowVersioning`.
- An Export menu in the editor's toolbar, built on `convert()` from `@bendyline/squisq-formats/registry` and loaded only when used.

## Files

```text
field-notes/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
└── src/
    ├── main.tsx
    ├── monacoWorkers.ts
    ├── workspace.ts
    ├── exportDocument.ts
    └── App.tsx
```

**`package.json`**

```json
{
  "name": "field-notes-editor",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@bendyline/squisq": "2.13.6",
    "@bendyline/squisq-editor-react": "2.13.11",
    "@bendyline/squisq-formats": "2.8.7",
    "@bendyline/squisq-react": "2.12.18",
    "@bendyline/squisq-video-react": "2.5.19",
    "monaco-editor": "0.50.0",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/react": "18.3.31",
    "@types/react-dom": "18.3.7",
    "@vitejs/plugin-react": "6.1.1",
    "typescript": "5.9.3",
    "vite": "8.3.4"
  }
}
```

**`vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { rnnoiseWasmPlugin } from '@bendyline/squisq-video-react/vite';

export default defineConfig({
  // rnnoiseWasmPlugin ships the audio-cleanup WASM once instead of twice.
  plugins: [react(), rnnoiseWasmPlugin()],
  worker: { format: 'es', plugins: () => [rnnoiseWasmPlugin()] },
  optimizeDeps: {
    // These packages start workers from URLs relative to their own files,
    // which Vite's dependency pre-bundling would break in dev.
    exclude: ['@bendyline/squisq-calc', '@bendyline/squisq-video-react'],
  },
});
```

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

**`index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Field Notes</title>
    <style>
      body {
        margin: 0;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`src/main.tsx`**

```tsx
import './monacoWorkers';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@bendyline/squisq-react/styles';
import '@bendyline/squisq-editor-react/styles';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**`src/monacoWorkers.ts`**

```ts
// Monaco's language services run in web workers that your bundler builds.
// Vite's `?worker` suffix turns each import into a Worker constructor;
// configureMonacoWorkers maps Monaco's language labels onto them.
import { configureMonacoWorkers } from '@bendyline/squisq-editor-react/monaco-workers';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

configureMonacoWorkers({
  editor: EditorWorker,
  json: JsonWorker,
  css: CssWorker,
  html: HtmlWorker,
  ts: TsWorker,
});
```

**`src/workspace.ts`**

```ts
// The workspace is one MemoryContentContainer: the document (index.md), the
// images and recordings the editor stores beside it, and the version history
// under .versions/. Saving writes every file to localStorage as base64.
import { LocalStorageAdapter, MemoryContentContainer } from '@bendyline/squisq/storage';

export const DOCUMENT_PATH = 'index.md';

const store = new LocalStorageAdapter('field-notes:');
const KEY = 'workspace';

interface StoredFile {
  path: string;
  mimeType: string;
  base64: string;
}

export interface Workspace {
  container: MemoryContentContainer;
  markdown: string;
}

/** Restore the saved workspace, or start a new one from `starter`. */
export async function loadWorkspace(starter: string): Promise<Workspace> {
  const container = new MemoryContentContainer();
  for (const file of (await store.get<StoredFile[]>(KEY)) ?? []) {
    await container.writeFile(file.path, fromBase64(file.base64), file.mimeType);
  }
  let markdown = await container.readDocument();
  if (markdown === null) {
    markdown = starter;
    await container.writeDocument(markdown, DOCUMENT_PATH);
  }
  return { container, markdown };
}

/** Write the current text into the container, then save every file. */
export async function saveWorkspace(container: MemoryContentContainer, markdown: string) {
  await container.writeDocument(markdown, DOCUMENT_PATH);
  const files: StoredFile[] = [];
  for (const entry of await container.listFiles()) {
    const data = await container.readFile(entry.path);
    if (data) files.push({ path: entry.path, mimeType: entry.mimeType, base64: toBase64(data) });
  }
  // Throws a QuotaExceededError once the workspace passes the browser's
  // localStorage limit (about 5 MB).
  await store.set(KEY, files);
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
```

**`src/exportDocument.ts`**

```ts
import type { ContentContainer } from '@bendyline/squisq/storage';

export type ExportFormat = 'docx' | 'pdf' | 'html';

/**
 * Convert the document and download the result. Images come from the
 * workspace container, so pictures in the document are embedded.
 * Returns the converter's warnings (things it could not carry over).
 */
export async function exportDocument(
  markdown: string,
  container: ContentContainer,
  format: ExportFormat,
  baseName: string,
): Promise<string[]> {
  // Loaded on first use, so the converters stay out of the startup bundle.
  const { convert } = await import('@bendyline/squisq-formats/registry');
  const result = await convert({ kind: 'markdown', markdown, container, baseName }, format, {
    // A single-file web page embeds the standalone player.
    resolvePlayerScript: () =>
      import('@bendyline/squisq-react/standalone-source').then((m) => m.PLAYER_BUNDLE),
  });

  const url = URL.createObjectURL(new Blob([result.bytes.slice()], { type: result.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = result.suggestedFilename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return result.warnings;
}
```

**`src/App.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorShell } from '@bendyline/squisq-editor-react';
import { inferDocumentTitle, parseMarkdown } from '@bendyline/squisq/markdown';
import { createMediaProviderFromContainer } from '@bendyline/squisq/storage';
import { loadWorkspace, saveWorkspace, type Workspace } from './workspace';
import { exportDocument, type ExportFormat } from './exportDocument';

const STARTER = `---
title: Cedar Creek Trail Survey
---

# Cedar Creek Trail Survey

Notes from the October walk of the Cedar Creek loop.

## Trail condition {[statHighlight]}

**3 of 11** bridges need new decking before the spring opening.

## Findings

- Washout at mile 2.4, about two meters of tread lost
- Blowdown across the trail near the upper falls
- New trail markers holding up well
`;

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  useEffect(() => {
    void loadWorkspace(STARTER).then(setWorkspace);
  }, []);
  return workspace ? <Editor workspace={workspace} /> : <p>Loading…</p>;
}

function Editor({ workspace }: { workspace: Workspace }) {
  const { container } = workspace;
  // The media provider is a view of the same container, so an image you drop
  // into the editor is stored beside the document and saved with it.
  const mediaProvider = useMemo(() => createMediaProviderFromContainer(container), [container]);
  useEffect(() => () => mediaProvider.dispose(), [mediaProvider]);

  const markdownRef = useRef(workspace.markdown);
  const saveTimer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState('Saved');

  const save = useCallback(async () => {
    try {
      await saveWorkspace(container, markdownRef.current);
      setStatus('Saved');
    } catch (err: unknown) {
      setStatus(`Not saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [container]);

  // Save a second after the last keystroke.
  const handleChange = useCallback(
    (markdown: string) => {
      markdownRef.current = markdown;
      setStatus('Editing…');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void save(), 1000);
    },
    [save],
  );

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      const markdown = markdownRef.current;
      const title = inferDocumentTitle(parseMarkdown(markdown)) ?? '';
      const baseName =
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'document';
      setStatus(`Exporting ${format.toUpperCase()}…`);
      try {
        const warnings = await exportDocument(markdown, container, format, baseName);
        for (const warning of warnings) console.warn(warning);
        setStatus(warnings.length ? `Exported with ${warnings.length} warning(s)` : 'Exported');
      } catch (err: unknown) {
        setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [container],
  );

  return (
    <EditorShell
      initialMarkdown={workspace.markdown}
      articleId="field-notes"
      height="100vh"
      onChange={handleChange}
      mediaProvider={mediaProvider}
      workspaceContainer={container}
      // Snapshots go to .versions/ in the container on idle; the toolbar
      // gains a Version History panel. Save the workspace when one is taken.
      allowVersioning
      onSaveVersion={(result) => {
        if (result.saved) void save();
      }}
      toolbarSlotRight={<ExportMenu onExport={handleExport} />}
      statusBarSlotRight={<span>{status}</span>}
    />
  );
}

function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <select
      aria-label="Export"
      value=""
      disabled={busy}
      onChange={async (event) => {
        setBusy(true);
        await onExport(event.target.value as ExportFormat);
        setBusy(false);
      }}
    >
      <option value="" disabled>
        Export…
      </option>
      <option value="docx">Word (.docx)</option>
      <option value="pdf">PDF (.pdf)</option>
      <option value="html">Web page (.html)</option>
    </select>
  );
}
```

## Run it

```bash
npm install
npm run dev
```

Open the address Vite prints. Type in the Write view, wait a second, and reload: your text is still there. After five seconds without typing, the editor takes a version snapshot; open the toolbar's **Version history** button to compare or revert. The Export menu at the right end of the toolbar downloads `cedar-creek-trail-survey.docx`, `.pdf`, or `.html`, named from the document's title.

`npm run build` typechecks and writes a production build to `dist/`.

## How it works

### Dependencies

`monaco-editor` is a peer dependency of the editor (version `~0.50.0`), so you install it yourself; it powers the Source view and is loaded only when that view opens. Tiptap, which powers the Write view, is a regular dependency and arrives with the editor. `react` and `react-dom` are peers. `harper.js` is an optional peer used only for spellcheck and grammar, which this sample leaves off.

`@bendyline/squisq-formats` and `@bendyline/squisq-react` are listed because the app imports them directly, for export and for the player bundle a web page export embeds. `@bendyline/squisq-video-react` is listed because `vite.config.ts` imports its Vite plugin.

### Vite configuration

- `rnnoiseWasmPlugin()` belongs in both `plugins` and `worker.plugins`. The editor's audio cleanup uses RNNoise, whose WebAssembly is otherwise inlined twice, in a worker and in its fallback; with the plugin it ships once as a separate file. It is optional: without it everything still works, with a larger bundle.
- `worker.format: 'es'` builds workers as ES modules, which can load code on demand. This app builds without it, but the video exporter's encoding worker needs it, so set it now if you might add MP4 export later.
- `optimizeDeps.exclude` keeps Vite's development pre-bundling away from `@bendyline/squisq-calc` and `@bendyline/squisq-video-react`, which start workers from files beside their own code.

### Monaco workers

Monaco runs its language services, such as checking JSON and CSS code, in web workers that your bundler must build. Each `?worker` import gives Vite a worker constructor, and `configureMonacoWorkers` maps Monaco's language labels to them. Import `monacoWorkers.ts` before the editor mounts. Without it, Monaco still highlights and edits, and the `{[template]}` suggestions still work, but the language services stay off.

### One container for the whole workspace

`EditorShell` takes two related props. `workspaceContainer` is the folder the document lives in: version snapshots, narration timing files, and image edits are read from and written to it. `mediaProvider` is how the editor stores and shows media: inserting an image writes the file through it and the previews load it back through it. Making the provider from the container with `createMediaProviderFromContainer` keeps the two the same namespace, so a file written through one is found through the other. Call `dispose()` on the provider when you are done with it; it releases the object URLs it made for previews.

The container holds the document at `index.md` too. Versioning names its snapshots after that file (`.versions/index.<timestamp>.md`), and when it takes the first one it adds a `.gitignore` rule for `.versions/`, so the history stays out of Git if you ever write the folder to disk.

### Saving

`EditorShell` keeps the Markdown itself and reports every change through `onChange`. The app keeps the latest text in a ref and saves a second after the last change. `saveWorkspace` writes the text into the container, then stores every file in it (the document, images, `.gitignore`, and snapshots) as one JSON array through `LocalStorageAdapter`, with binary files as base64. On startup, `loadWorkspace` rebuilds the container from that array, or writes the starter document into a new one.

Version snapshots are written into the container without an `onChange`, so `onSaveVersion` saves again whenever a snapshot is taken.

`localStorage` holds about 5 MB per site, and base64 adds a third. A few photos will exceed that, and `saveWorkspace` throws the browser's quota error, which the status bar shows. For larger workspaces, store files in IndexedDB instead: `LocalForageAdapter` from `@bendyline/squisq/storage` has the same `get` and `set` methods and stores binary data without the base64 step.

### Version history

`allowVersioning` turns on snapshots and the history panel; it needs `workspaceContainer` and does nothing without it. By default the editor takes a snapshot after 5 seconds without changes (`versioningAutoSaveIdleMs`), skips one identical to the last, and keeps the newest 50 (`versioningPrunePolicy`). Reverting first snapshots the current text, then replaces the editor's content with the old version, which reaches the app through `onChange` and is saved like any edit.

### Export

`exportDocument` calls `convert()` with the current text and the workspace container. The container is why images appear in the exports: each format reads the image files it references from there. The web page format embeds the standalone player, so it needs `resolvePlayerScript`; the import inside it keeps the 2 MB player out of your bundle until someone exports HTML. The page opens in the scrolling page rendition. The registry, the formats, and the player are all loaded with `import()` on first use.

`convert()` returns `bytes`, a `mimeType`, a `suggestedFilename` built from the `baseName` you pass, and `warnings` about anything a format could not carry. The app logs warnings to the console and counts them in the status bar. Failures throw a `ConversionError`; see the [Node converter](node-converter.md) for its error codes.

> [!TIP]
> `new Blob([result.bytes.slice()])` copies the bytes into a plain `ArrayBuffer`. With TypeScript 5.9's DOM types, passing `result.bytes` directly is a type error.

### Toolbar and status bar slots

`toolbarSlotRight` places your own controls at the right end of the editor's toolbar, and `statusBarSlotRight` at the right of its status bar. Both render inside the editor, so `useEditorContext()` works in them if you need the editor's state there.

## Ideas for extending it

- **PowerPoint.** Add `pptx` to `ExportFormat` and the menu. The deck is the slideshow rendition, one slide per block.
- **Dark mode.** Pass `colorScheme="dark"` to restyle the editor's toolbar, menus, and panels. The document keeps its own theme. See [Editor chrome theming](../../theming.md).
- **Spellcheck.** Install `harper.js` and pass a provider through the `proofing` prop. See [Proofing](../../proofing.md).
- **More than one document.** Key the localStorage entry by document name, add a picker, and give `EditorShell` a new `key` when you switch, so it mounts fresh.
- **Back up to a file.** `containerToZip(container)` from `@bendyline/squisq-formats/container` packs the whole workspace into one ZIP, and `zipToContainer` reads it back.
- **Panels.** `outline` adds a heading outline beside the editor, and `inlinePreview` a gutter of small block previews beside the text.

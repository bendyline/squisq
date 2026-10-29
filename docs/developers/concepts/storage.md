---
title: Storage
description: Storage adapters, content containers, media providers, the sidecar folder conventions, version history, image-edit state, and ZIP serialization.
---

# Storage

A Squisq document is more than its Markdown. It has images and recordings beside it, narration
timing files, data tables, version snapshots, and image-edit state. Squisq keeps all of that in a
**content container** — a small async file system you can back with memory, IndexedDB, a real
folder, or a ZIP — and reaches it through a few interfaces from `@bendyline/squisq/storage`.

| Interface          | What it is                                                | Built-in implementations                                            |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `ContentContainer` | The files of one document: Markdown, media, sidecars      | `MemoryContentContainer`, `ScopedContentContainer`                  |
| `MediaProvider`    | Turns a relative media path into a URL a browser can show | `createMediaProviderFromContainer(container)`                       |
| `StorageAdapter`   | A key-value store for app state (not document files)      | `MemoryStorageAdapter`, `LocalStorageAdapter`, `LocalForageAdapter` |

## Content containers

```ts
import { MemoryContentContainer, scopeContainer } from '@bendyline/squisq/storage';

const workspace = new MemoryContentContainer();
await workspace.writeDocument('# Harbor survey\n\nFirst draft.\n', 'harbor-survey.md');
await workspace.writeFile('images/harbor.svg', svgBytes);

await workspace.getDocumentPath(); // 'harbor-survey.md'
await workspace.readDocument(); // '# Harbor survey\n\nFirst draft.\n'
(await workspace.listFiles('images/')).map((entry) => entry.path); // ['images/harbor.svg']
```

Paths are forward-slash, relative to the container root, with no leading slash. The interface:

| Method                                           | Behavior                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `readFile(path)`                                 | `ArrayBuffer`, or `null` when the file doesn't exist                                                      |
| `writeFile(path, data, mimeType?)`               | Create or overwrite; the MIME type is guessed from the extension when omitted                             |
| `writeFileExclusive?(path, data, mime?)`         | Optional: create only if absent, resolving `false` on a collision                                         |
| `removeFile(path)`                               | No-op when absent                                                                                         |
| `listFiles(prefix?)`                             | `ContentEntry[]` — `{ path, mimeType, size }` objects, not strings                                        |
| `exists(path)`                                   | Whether a file exists                                                                                     |
| `getDocumentPath()`                              | The primary Markdown file: `index.md`, then `doc.md`, then `document.md`, then the first root-level `.md` |
| `readDocument()`, `writeDocument(md, filename?)` | Read or write the primary document as text (`writeDocument` defaults to `index.md`)                       |

`MemoryContentContainer` copies bytes in and out, so callers can't mutate stored state by accident.
To store documents elsewhere — IndexedDB, the File System Access API, a server, a desktop folder —
implement the interface; `findDocumentPath(entries)` gives you the discovery rule.

`scopeContainer(parent, prefix)` returns a `ScopedContentContainer`: a view rooted at a subfolder,
so a component can read and write relative to its own root. Scopes nest, reject `..` and
backslashes, and never act as a document root (`getDocumentPath()` is `null`).

```ts
const sidecar = scopeContainer(workspace, 'harbor-survey_files');
await sidecar.writeFile('data/q3.csv', csvBytes); // stored at harbor-survey_files/data/q3.csv
```

## Media providers

Renderers don't read containers directly. They ask a `MediaProvider` to turn a path from the
document (`images/harbor.svg`) into a URL — `resolveUrl(path)` — and use `listMedia`, `addMedia`,
`removeMedia`, and `dispose` to manage assets.

`createMediaProviderFromContainer(container)` builds one over any container: it reads the bytes,
serves them as cached `blob:` URLs, and revokes them on `dispose()`. Give it to the React
components through `MediaContext`:

```tsx
import { useEffect, useMemo } from 'react';
import { DocPlayer, MediaContext } from '@bendyline/squisq-react';
import { createMediaProviderFromContainer, type ContentContainer } from '@bendyline/squisq/storage';
import type { Doc } from '@bendyline/squisq/schemas';

export function Viewer({ doc, workspace }: { doc: Doc; workspace: ContentContainer }) {
  const media = useMemo(() => createMediaProviderFromContainer(workspace), [workspace]);
  useEffect(() => () => media.dispose(), [media]);

  return (
    <MediaContext.Provider value={media}>
      <DocPlayer doc={doc} displayMode="slideshow" audioMode="synthetic" />
    </MediaContext.Provider>
  );
}
```

Without a provider, components resolve relative paths against their `basePath` prop (default
`'.'`) — fine for documents served next to their images.

### Why the workspace must be a container

Give the editor a `workspaceContainer` and derive its `mediaProvider` from that same container
with `createMediaProviderFromContainer` — never a provider backed by separate storage. Several
features write a file **beside** a media asset and later read it back: a narration take's
`.timing.json` (which re-times the blocks), image-edit sidecars, version snapshots. Those writes go through the provider and the reads go through the container; if the two
are not views of one namespace, the write lands where the read never looks, and the feature fails
with no error anywhere. The demo site swaps both together through one function for exactly this
reason (see the comments in [`App.tsx`](../../../packages/site/src/App.tsx)).

## Storage adapters

`StorageAdapter` is an async key-value interface — `get`, `set`, `remove`, `clear`, `keys`, and a
`supportsEnumeration` flag — for app state such as recent files or preferences, not document
files.

```ts
import { LocalForageAdapter } from '@bendyline/squisq/storage';

const prefs = new LocalForageAdapter({ name: 'harbor-app', prefix: 'prefs:' });
await prefs.set('recentDocuments', ['harbor-survey.md']);
await prefs.get<string[]>('recentDocuments');
```

`MemoryStorageAdapter` is in-memory, `LocalStorageAdapter(prefix?)` uses `localStorage`, and
`LocalForageAdapter({ name?, storeName?, prefix?, description? })` uses IndexedDB through
localForage.

## The sidecar convention

Files that belong to one document live in a folder named after it: `<docbasename>_files/` next to
`<docbasename>.md`. One folder name keeps a document and its assets together when you copy,
commit, or zip them.

```text
harbor-survey.md
harbor-survey_files/
  data/
    q3-samples.csv          ← data files referenced by {[dataTable src=…]}
.versions/
  harbor-survey.20261028T100000Z.md   ← version snapshots
.gitignore                  ← contains ".versions/"
```

| Convention                                                          | Helper                                                        | Used for                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `<docbasename>_files/data/<file>`                                   | `dataSidecarPrefix(basename)` (`/doc`)                        | CSV, TSV, XLSX, and Parquet tables; see [data files](../../guide/data-and-charts.md#data-files)          |
| `<imagebasename>_files/` with `state.json`, `assets/`, `.versions/` | `scopeContainer(parent, basename + '_files')`                 | Layered image edits                                                                                      |
| `<media>.timing.json` beside a recording                            | —                                                             | Narration timing that re-times blocks; see [Narration](../../guide/narration.md)                         |
| `.mediaEdits/`                                                      | `@bendyline/squisq/mediaEdit`                                 | Rendered audio for non-destructive media edits; see [Media edits](../../media-edits.md)                  |
| `.versions/<basename>.<timestamp>.md`                               | `@bendyline/squisq/versions`                                  | Document version snapshots                                                                               |
| `.versions/data/`                                                   | `buildDataBackupPath` (`/versions`)                           | Backups made before a data file is edited in place                                                       |
| `<Stem>_files/<slug>.md`                                            | `resolveOutsideInLayout` (`squisq-formats/outside-in-layout`) | The editable source of a rendered Office or HTML file; see [Formats](formats.md#the-outside-in-contract) |

## Version history

`@bendyline/squisq/versions` stores snapshots of the primary document inside the same container,
at `.versions/<basename>.<UTC timestamp>.md`, so history travels with the document through ZIP
export or a sidecar folder. Saving history also adds a `.versions/` rule to the container's root
`.gitignore`, keeping snapshots out of Git when the folder is committed.

```ts
import { DocumentVersionManager } from '@bendyline/squisq/versions';

const history = new DocumentVersionManager(workspace);

await history.saveVersion(); // reads the primary document; skips when unchanged
await history.saveVersion({ content: editorText }); // or snapshot text you hold

const versions = await history.listVersions(); // newest first
const text = await history.readVersion(versions[1]);

const result = await history.revertToVersion(versions[1], { content: editorText });
if (!result.reverted) console.warn('Revert declined:', result.reason);

await history.pruneVersions({ type: 'keep-last-n', n: 50 });
await history.coalesceVersions({ windowMs: 60_000 }); // collapse bursts of saves
```

`saveVersion` resolves `{ saved, version, reason }`, where `reason` is `'saved'`, `'unchanged'`
(identical to the newest snapshot), or `'no-document'`. Prune with `keep-last-n`, `older-than`, or
a `predicate`. The same operations exist as plain functions (`saveVersion(container, options)`,
`listVersions`, …) if you'd rather not hold a manager.

**Revert is fail-safe.** Before it replaces the document, `revertToVersion` snapshots the current
state, and if that snapshot can't be written it abandons the revert and resolves
`{ reverted: false, reason: 'snapshot-failed' }` rather than destroy work that exists nowhere
else. When your live document is in an editor buffer rather than the container, pass it as
`content` — otherwise the safety snapshot captures the stale bytes in the container, or finds no
document at all and the revert declines. Pass `snapshotCurrent: false` only when you have already
saved the current state yourself.

The editor wires this up for you: pass `allowVersioning` and a `workspaceContainer` to
`EditorShell` and it snapshots on idle and shows a version-history panel.

## Image-edit state

The image editor keeps a layered edit as JSON in the image's sidecar folder, next to a copy of the
source image, with its own history — the same shape as document versions, over `state.json`
instead of Markdown. `@bendyline/squisq/imageEdit` exports `readImageEditDoc` and
`writeImageEditDoc` (defaulting to `state.json`), layer operations (`addLayer`, `updateLayer`,
`reorderLayer`, `removeLayer`), `ImageEditVersionManager` and its function equivalents, and
`exportImageEditDoc` to rasterize the result. `revertToImageEditVersion` follows the same fail-safe
contract, with the live state passed as `doc`.

```ts
import { readImageEditDoc } from '@bendyline/squisq/imageEdit';
import { scopeContainer } from '@bendyline/squisq/storage';

const imageFiles = scopeContainer(workspace, 'harbor_files'); // for harbor.png
const edit = await readImageEditDoc(imageFiles); // null until the image has been edited
```

## ZIP and `.dbk` files

A container serializes to a ZIP whose entries are the container's paths, with
`@bendyline/squisq-formats/container`:

```ts
import { containerToZip, zipToContainer } from '@bendyline/squisq-formats/container';

const zip = await containerToZip(workspace); // Blob
const restored = await zipToContainer(zip); // MemoryContentContainer
await restored.getDocumentPath(); // 'harbor-survey.md'
```

`containerToZip(container, { compression })` uses `'DEFLATE'` or `'STORE'`. `zipToContainer`
accepts an `ArrayBuffer`, `Uint8Array`, or `Blob` and enforces safety limits on paths, entry and
total sizes, compression ratio, and checksums, throwing a `ZipSafetyError` with a `code` for an
archive that breaks them; pass `ZipSafetyLimits` to tighten or relax them.

A `.dbk` file is this ZIP under its own extension — the document, its media, its sidecars, and
its history in one file. The format registry reads and writes it as the `dbk` format, so
`convert({ kind: 'markdown', markdown, container }, 'dbk')` packages a document with its assets.

# Proofing (grammar + spellcheck) — host integration guide

Squisq's editor can proof documents — red squigglies for spelling/typos,
green for grammar, blue-dotted for style, in both the Write (Tiptap) and
Source (Monaco) views, with a right-click suggestions menu, a findings
panel, a StatusBar count, and per-doc settings. The engine is
[harper.js](https://github.com/Automattic/harper) (Apache-2.0, English
only, five dialects), compiled to WebAssembly and running fully offline
inside a Web Worker.

**Nothing is bundled.** harper.js is an _optional peer dependency_ of
`@bendyline/squisq-editor-react`, reached only through a dynamic
`import('harper.js')`. The capability follows the `ffmpegWasm`
precedent: the host installs the engine, serves its WASM same-origin,
and passes a provider into `EditorShell`. No provider → no proofing UI,
no engine bytes, ever. There is no CDN fallback.

## Wiring it up

```bash
npm install harper.js       # in the HOST app, not in squisq packages
```

```tsx
import { EditorShell, createHarperProofingProvider } from '@bendyline/squisq-editor-react';
// (also exported from the narrower '@bendyline/squisq-editor-react/proofing' entry)

const proofing = createHarperProofingProvider({
  wasmUrl: '/harper/harper_wasm_bg.wasm',   // root-relative is fine — absolutized internally
  initialWords: myAppDictionary,            // app-level accepted words
  onDictionaryWord: (word) => saveToAppDictionary(word),
});

<EditorShell proofing={proofing} proofingIgnoreStore={myIgnoreStore} … />
```

`proofing` accepts a **provider instance** or a **factory**:

- **Instance** — the host owns its lifetime. A module-scope singleton
  keeps the warm engine (~5 s cold WASM setup) alive across shell
  remounts. This is what the demo site does
  (`packages/site/src/harperConfig.ts`).
- **Factory** (`() => createHarperProofingProvider(…)`) — the shell
  creates the provider on first use and **disposes it on unmount**.
  Prefer this when different docs need different engine state.

Checking is **on by default when a provider is present**. Three layers
override it, most specific first:

1. The user's session toggle (View menu → "Check spelling & grammar").
2. Doc frontmatter: `squisq-proofing: false` (or `true`).
3. The shell prop `proofingDefaultEnabled={false}` — wire the capability
   but start off until users or docs opt in.

The engine loads only once a markdown document is actually active with
proofing effective — a code file, an opted-out doc, or a
`proofingDefaultEnabled: false` shell fetches nothing.

## Serving the WASM (read this — every item below was hit in practice)

1. **Serve BOTH binaries side by side.** The engine derives
   `harper_wasm_slim_bg.wasm` from the full binary's URL by filename
   substitution and loads the pair. Copy both
   `node_modules/harper.js/dist/harper_wasm_bg.wasm` and
   `…/harper_wasm_slim_bg.wasm` into the same served directory, and
   point `wasmUrl` at the **full** one. (~15.8 MB + ~15.6 MB raw,
   ≈7.6 MB each gzipped.)
2. **Correct MIME**: `application/wasm`. An SPA fallback that answers a
   missing `.wasm` path with `200 text/html` produces a confusing
   compile error rather than a clean 404 — make sure both files really
   exist at their URLs.
3. **CSP**:
   - `script-src` must include **`'wasm-unsafe-eval'`** (WASM
     compilation is refused without it — the failure mode is a stuck
     "Proofing…" status and a CSP violation in the console);
   - `worker-src` must allow **`blob:`** (the engine runs in an inlined
     blob worker, with a `data:` URL fallback);
   - the WASM is fetched from **inside** that worker — same-origin
     `connect-src 'self'` covers it.
4. **License**: harper.js is Apache-2.0 — ship its `LICENSE` beside the
   binaries (see the site's `harperCorePlugin`).

The reference implementation is the demo site:
`packages/site/vite.config.ts` (`harperCorePlugin` — dev + preview
middleware with MIME, `writeBundle` copy) plus
`packages/site/src/harperConfig.ts` (singleton provider, localStorage
app dictionary) and the CSP in `packages/site/index.html`.

## Per-doc settings (frontmatter)

| Key                       | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `squisq-proofing`         | Per-doc enable override (`true` / `false`)                                |
| `squisq-proof-dialect`    | `American` (default) / `British` / `Australian` / `Canadian` / `Indian`   |
| `squisq-proof-dictionary` | Comma-separated accepted words ("Add to document word list" appends here) |

The first two are editable in the Document Settings dialog; the word
list is written by the right-click menu (see below).

**Ignored findings are deliberately absent from this table.** They are
never written into the document — see "Dismissed findings" below.

## The two dictionary scopes

Accepting a word is a deliberate choice of _where_ it is remembered, and
the menu says which is which:

| Menu item                     | Where the word goes                                                                                           | Host callback            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Add to dictionary**         | The host's own storage, app-wide. Nothing is written to the document.                                         | `onDictionaryWord(word)` |
| **Add to document word list** | The document's `squisq-proof-dictionary` frontmatter — it travels with the file, through git, to other hosts. | none                     |

The split exists so an author always knows when a word is being recorded
_inside the file_. A shared document shouldn't silently accumulate one
person's spelling preferences, and an app-wide dictionary shouldn't
quietly edit documents.

**"Add to dictionary" is hidden when the host has nowhere to put the
word.** `createHarperProofingProvider` reports
`hasAppDictionary: config.onDictionaryWord != null`, and the editor
omits the item when that is `false`, leaving only the document word
list — so a word can never look saved app-wide and then reappear on the
next launch. If you implement `ProofingProvider` yourself, set
`hasAppDictionary` accordingly; leaving it `undefined` is treated as
capable.

Both paths accept the word in the running engine immediately, so the
squiggle clears either way. The doc word list is re-imported from
frontmatter on every load; the app dictionary comes back through
`initialWords`.

## Dismissed findings ("Ignore")

Ignoring a finding is a private editing preference — the author saying
"stop showing me this", not a statement about the document. So it is
**never written into the file**: a doc travelling through git must not
carry one person's dismissals to everyone else.

Instead the editor hands the state to the host, scoped per document:

```ts
import type { ProofingIgnoreStore } from '@bendyline/squisq-editor-react/proofing';

const myIgnoreStore: ProofingIgnoreStore = {
  // `doc` is { articleId, fileName? } — key by whichever suits you,
  // usually the workspace-relative file path.
  load: (doc) => myStorage.read(doc.fileName ?? doc.articleId),
  save: (doc, ignoredJson) => myStorage.write(doc.fileName ?? doc.articleId, ignoredJson),
};
```

Both hooks may be async. `ignoredJson` is the engine's **opaque**
export — it holds context hashes as integers above 2^53, so store it as
a string and hand it back verbatim; never `JSON.parse` it. What you are
storing is effectively "file path → the set of ignored content hashes",
which usually means a new per-user, per-workspace record rather than
anything that already exists.

**Omitting the store is fine** — Ignore still clears the squiggle, it
just lasts for the session. That is often right for a scratch buffer,
and unlike a dictionary word (which the user expects to persist) a
dismissal reads naturally as "not now".

The editor keeps the engine's ignore set matched to the active
document: before each pass it checks whether the engine still holds
_this_ document's ignores and re-syncs only when it doesn't. That
matters because a single warm provider is often shared across documents
and across several mounted shells — without it, one document's
dismissals would silently suppress findings in another. Sharing one
instance stays safe; the cost is a string comparison per pass.

## Implementing a custom provider

`ProofingProvider` (in `@bendyline/squisq-editor-react/proofing`) is a
plain-data contract — findings carry UTF-16 offsets into the exact
string that was linted, a category (`spelling` / `grammar` / `style`),
a message, and typed suggestions (`replace` / `remove` / `insertAfter`).
Anything that can produce that shape (a different engine, a service, a
test fake) can power the same UI; the pure helpers (category mapping,
`{[…]}` masking, joined-segment offset math, frontmatter codecs) live
in `@bendyline/squisq/proof`.

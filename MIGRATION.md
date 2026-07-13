# Squisq Migration Guide

## Next-major API cleanup (unreleased)

This release removes code-only compatibility shims and process-global
registries. The replacements are explicit, instance-scoped APIs. Persisted
document compatibility is intentionally different: historical Markdown,
frontmatter, transition, template-id, and encoded-layout spellings remain
readable. When an editor or serializer rewrites those values, it emits the
canonical spelling.

| Package      | Removed API                                                                        | Replacement                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| core         | `@bendyline/squisq/story`                                                          | `@bendyline/squisq/doc`                                                                                                         |
| core         | `getLayers(block, context)`                                                        | `materializeBlockLayers(block, options).layers`; pass `persistentLayers: false` when reproducing the old no-inheritance default |
| core         | `expandTemplateBlock`, `materializeTemplateLayers`                                 | `materializeBlockLayers` for layers; `expandDocBlocks` when timeline scheduling is also required                                |
| core         | exported `TEMPLATE_ALIASES` table                                                  | `resolveTemplateName(name)`; the compatibility table is internal                                                                |
| core         | `DocStylePreset`, `getDocStyleConfig`                                              | author `Theme.persistentLayers`, then use `resolvePersistentLayers` / `expandPersistentLayers`                                  |
| core         | `encodeLayersForFrontmatter`, `decodeLayersFromFrontmatter`                        | legacy `layers=` payload reading is internal to the editor migration path                                                       |
| core         | `PathLayer.content.arrow`                                                          | `startMarker` / `endMarker`; old serialized documents remain readable                                                           |
| core         | `registerTheme`, `unregisterTheme`, `getRegisteredThemes`, `lookupRegisteredTheme` | caller-owned `createThemeRegistry()` and its `register` / `unregister` / `get` / `list` methods                                 |
| core         | `registerTransformStyle`, `unregisterTransformStyle`                               | caller-owned `createTransformStyleRegistry()` and its methods, passed through `TransformOptions.registry`                       |
| react        | `VIEWPORT`                                                                         | `VIEWPORT_PRESETS.landscape` from `@bendyline/squisq/doc`                                                                       |
| react        | positional `useDocPlayback(doc, time, viewport, renderMode, theme, onSeek)`        | `useDocPlayback(doc, time, { viewport, theme, onSeek })`                                                                        |
| react        | standalone `mountStatic(element, doc, options)`                                    | `mount(element, doc, { ...options, mode: 'static' })`                                                                           |
| react        | `window.squisqPlayers` plus top-level render methods                               | React hosts use `onRenderAPIReady`; standalone hosts use the handle returned by `mount()` or `getHandle(element)`               |
| formats      | public `OoxmlPackage.zip` / manually constructed `OoxmlPackage`                    | `openPackage()` plus `getPartXml` / `getPartBinary`; all reads remain bounded                                                   |
| editor-react | `EditorShell.container`                                                            | `EditorShell.workspaceContainer`                                                                                                |
| editor-react | `EMOJI_CATEGORIES`, `ALL_EMOJIS`, `searchEmojis`                                   | `PICKER_CATEGORIES`, `ALL_PICKER_ENTRIES`, `searchPickerEntries`                                                                |
| editor-react | `setBlockAttrsTransition`                                                          | `setHeadingAttrsTransition`, which updates both canonical and legacy attribute channels safely                                  |
| editor-react | optional `BlockPropertiesPopover.onAnnotationChange`                               | required paired-channel callback; transitions are no longer written to the legacy channel alone                                 |
| editor-react | `DiagramRFNode`, `DiagramRFEdge`                                                   | `DiagramNode`, `DiagramEdge`                                                                                                    |
| CLI          | `--format <id>`                                                                    | `--formats <list>` for selected outputs, or `--output <file>` for one inferred format                                           |

The following are **not** removed document formats: legacy template ids such as
`titleBlock` and `diagramNode`; the transform value `dataDriven`; theme keys
`themeId` / `theme`; older transition spellings; heading-based diagrams; and
legacy custom-template or `layers=` payloads. Readers continue to accept them,
while public APIs and editor writes use canonical names. Do not remove these
reader paths without a separate, versioned document migration.

---

## Upgrading to Squisq v1.5

v1.5 ships a batch of API renames and a few removals across the published
packages. **Markdown document syntax is unchanged** — every `.md`, `.dbk`, and
frontmatter key that worked in 1.4 still parses and renders identically. The
breaking changes are all in the **TypeScript/JS API surface** and the **CLI
flags**.

This guide lists every old → new so a consumer can migrate mechanically. It is
organized by package. Additive-only changes (new power, no migration needed) are
collected at the end.

---

## `@bendyline/squisq-react`

`DocPlayer` moved off the legacy `script` naming and onto a `doc` / `markdown`
front door, and renamed its audio prop + type.

| Old (1.4)                       | New (1.5)                          | Notes                                                                                                                       |
| ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `<DocPlayer script={doc} />`    | `<DocPlayer doc={doc} />`          | `script` prop **removed** (no alias).                                                                                       |
| `audioProvider={ctrl}`          | `audioController={ctrl}`           | prop renamed on `DocPlayer` + `DocPlayerWithSidebar`.                                                                       |
| `import type { AudioProvider }` | `import type { AudioController }`  | type renamed (exported from the package root).                                                                              |
| `basePath="."` (required)       | `basePath` optional, default `'.'` | omit it entirely when assets are relative to the page.                                                                      |
| —                               | `markdown="# Hi"` (new prop)       | additive: pass raw markdown and the player parses it via `markdownToDoc(parseMarkdown(...))`. `doc` wins when both are set. |

```diff
-import { DocPlayer, type AudioProvider } from '@bendyline/squisq-react';
+import { DocPlayer, type AudioController } from '@bendyline/squisq-react';

-<DocPlayer script={myDoc} audioProvider={ctrl} basePath="." />
+<DocPlayer doc={myDoc} audioController={ctrl} />
```

`DocPlayerWithSidebar` took the identical `script` → `doc` and
`audioProvider` → `audioController` renames.

---

## `@bendyline/squisq-editor-react`

The shell's light/dark chrome prop was renamed to disambiguate it from the
`Theme` (document styling) props, and Monaco's editor theme got its own prop.

| Old (1.4)                       | New (1.5)                             | Notes                                                              |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| `<EditorShell theme="dark" />`  | `<EditorShell colorScheme="dark" />`  | prop renamed; `'light' \| 'dark'`.                                 |
| `import type { EditorTheme }`   | `import type { EditorColorScheme }`   | type renamed.                                                      |
| `<RawEditor theme="vs-dark" />` | `<RawEditor monacoTheme="vs-dark" />` | Monaco theme id, distinct from the shell's `colorScheme`.          |
| `useMediaRecorder(options)`     | `useMediaRecorder(options?)`          | the options argument is now optional (`useMediaRecorder()` works). |

```diff
-import { EditorShell, type EditorTheme } from '@bendyline/squisq-editor-react';
+import { EditorShell, type EditorColorScheme } from '@bendyline/squisq-editor-react';

-<EditorShell theme="dark" />
+<EditorShell colorScheme="dark" />
```

**`monaco-editor` is now an optional peer dependency**
(`peerDependenciesMeta.monaco-editor.optional = true`). WYSIWYG-only installs can
omit it; only the raw (Monaco) editor mode needs it. If you rely on the raw
editor, keep `monaco-editor` in your dependencies.

---

## `@bendyline/squisq-video-react`

The pre-built player script is now optional (the components fall back to the
bundled standalone player), and the export result carries audio provenance.

| Old (1.4)                 | New (1.5)                              | Notes                                                                         |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| `playerScript` (required) | `playerScript?` (optional)             | on `VideoExportButton` + `VideoExportModal`.                                  |
| —                         | `startExport(doc, config)`             | `useVideoExport().startExport` signature (confirmed): doc first, then config. |
| —                         | `VideoExportResult.audioIncluded`      | additive `boolean` — whether narration was muxed in.                          |
| —                         | `VideoExportResult.audioSkippedReason` | additive `string \| null` — why audio was dropped, when it was.               |

No code change required unless you passed `playerScript` positionally or
destructured the result expecting the old shape.

---

## `@bendyline/squisq-video`

| Old (1.4)                              | New (1.5)                                                     | Notes                                                                                    |
| -------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `import { … } from '.../encodeParams'` | `import { bitrateForQuality } from '@bendyline/squisq-video'` | the `encodeParams` module was **removed**; the bitrate helper is now a top-level export. |
| `QualityPreset` (fewer fields)         | `QualityPreset` (added fields)                                | additive — existing field reads keep working.                                            |

```diff
-import { computeBitrate } from '@bendyline/squisq-video/encodeParams';
+import { bitrateForQuality } from '@bendyline/squisq-video';

-const bitrate = computeBitrate(quality, w, h);
+const bitrate = bitrateForQuality(quality, w, h);
```

---

## `@bendyline/squisq-formats`

XLSX export is now **implemented** (tables-only). The functions used to be
throwing stubs typed to return `Blob`; they now return real bytes as
`Promise<ArrayBuffer>`.

| Old (1.4)                                        | New (1.5)                                       | Notes                                               |
| ------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------- |
| `markdownDocToXlsx(...) : Promise<Blob>` (threw) | `markdownDocToXlsx(...) : Promise<ArrayBuffer>` | now produces a real workbook (one sheet per table). |
| `docToXlsx(...) : Promise<Blob>` (threw)         | `docToXlsx(...) : Promise<ArrayBuffer>`         | same.                                               |

**Action:** any code that wrapped these in a `try/catch` to swallow the stub's
throw must now handle a resolved `ArrayBuffer` (wrap in `new Blob([buf])` if you
needed a Blob).

```diff
-try { await markdownDocToXlsx(md); } catch { /* stub, ignore */ }
+const buffer = await markdownDocToXlsx(md); // ArrayBuffer
+const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
```

---

## `@bendyline/squisq-cli`

**`-o` semantics changed.** In 1.4, `-o` was the output _directory_. In 1.5:

| Old (1.4)                        | New (1.5)                            | Notes                                                                 |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `-o, --output <dir>` (directory) | `-d, --output-dir <dir>` (directory) | the directory behavior moved to `-d`.                                 |
| —                                | `-o, --output <file>` (single file)  | `-o` is now a single output file; format inferred from its extension. |

```diff
-squisq convert deck.md -o ./out            # old: out dir
+squisq convert deck.md -d ./out            # new: out dir
+squisq convert deck.md -o ./out/deck.docx  # new: single file, format from extension
```

`--output` cannot be combined with `--formats` (a single file has one
format). New transitive dependency `@xmldom/xmldom` — no consumer action needed.

---

## `@bendyline/squisq` (core)

`generateSlideshow` was **removed** from `@bendyline/squisq/generate`. Migrate to
the two-step `markdownToDoc` + `applyTransform` pipeline:

```diff
-import { generateSlideshow } from '@bendyline/squisq/generate';
-const doc = generateSlideshow(markdown, { style: 'documentary' });
+import { markdownToDoc } from '@bendyline/squisq/doc';
+import { parseMarkdown } from '@bendyline/squisq/markdown';
+import { applyTransform } from '@bendyline/squisq/transform';
+const doc = applyTransform(markdownToDoc(parseMarkdown(markdown)), 'documentary');
```

`extractContent` and `stripMarkdown` (also on `@bendyline/squisq/generate`) are
**unchanged** — their output shapes remain a frozen external contract.

---

## Additive highlights (no migration required)

These are new in 1.5. Nothing to change; adopt when useful. See
[docs/API.md](docs/API.md) and [docs/SquigglySquare.md](docs/SquigglySquare.md)
for full details.

- **Format registry + `convert()`** — `@bendyline/squisq-formats/registry`
  exposes `convert(source, targetFormatId)`, `FormatRegistry`, `ConversionResult`,
  and `ConversionError` as a single programmatic front door across every format.
- **Standalone annotations** — a paragraph that is exactly a `{[template …]}`
  annotation becomes its own block (no heading required).
- **Inline attribute coercion** — `{[map center="47.6,-122.3" zoom=11]}` and
  friends: string params from `{[…]}` are coerced to the template's typed inputs
  (numbers, `lat/lng`, `label|sublabel` pairs, lists) with validation.
- **Custom-template `{attr:key|default}` + `repeat` tokens** — custom templates
  can read per-block annotation attributes and clone a layer once per image /
  list item / child.
- **Multi-line frontmatter** — frontmatter values may span multiple lines.
- **Browser MP4 with audio** — `@bendyline/squisq-video-react` now muxes
  narration audio into the exported MP4 (WebCodecs path), reporting the outcome
  via `VideoExportResult.audioIncluded` / `audioSkippedReason`.
- **PPTX image import** — `pptxToMarkdownDoc` / `pptxToContainer` now extract
  slide-level embedded images.
- **`squisq doctor`** — a CLI command that reports environment/runtime readiness
  for the conversion + video pipelines.

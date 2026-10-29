---
title: Formats
description: How Squisq converts between Markdown and DOCX, PPTX, PDF, HTML, EPUB, XLSX, and CSV — the format registry, convert(), errors, container imports and sidecars, the outside-in contract, and theme inference.
---

# Formats

`@bendyline/squisq-formats` converts documents to and from Word, PowerPoint, PDF, HTML, EPUB,
Excel, and CSV. Every converter goes through one pivot — core's `MarkdownDocument` — and one front
door, `convert()`. For task-by-task recipes, see the [Conversion guide](../guides/conversion.md);
this page explains the moving parts.

## Markdown is the pivot

No converter translates one format directly to another. Each importer produces a
`MarkdownDocument`; each exporter starts from one (plus the `Doc` built from it, for exporters that
render templates). DOCX to PPTX is DOCX → Markdown → PPTX.

```text
 .docx .pptx .pdf .xlsx .csv .html .dbk
        │  import
        ▼
  MarkdownDocument ──▶ markdownToDoc() ──▶ Doc
        │                                  │
        │  semantic exporters              │  rendering exporters
        ▼                                  ▼
  .md .docx .pdf .epub .xlsx .csv     .pptx .html (player) .html.zip
```

The pivot is why a format needs only an importer and an exporter, and why imported files land in
the editor as ordinary, editable Markdown.

## The registry

A `FormatRegistry` maps format ids to `FormatDefinition`s. `defaultRegistry()` returns one
preloaded with the built-ins; `BUILTIN_FORMAT_IDS` lists their ids. Converters load lazily through
`import()` inside each definition, so importing the registry doesn't bundle every converter.

| Id        | Extensions         | Import | Container import | Export | Templates on export |
| --------- | ------------------ | :----: | :--------------: | :----: | ------------------- |
| `md`      | `.md`, `.markdown` |   ✓    |                  |   ✓    | preserved           |
| `docx`    | `.docx`            |   ✓    |        ✓         |   ✓    | ignored             |
| `pdf`     | `.pdf`             |   ✓    |        ✓         |   ✓    | ignored             |
| `pptx`    | `.pptx`            |   ✓    |        ✓         |   ✓    | rendered            |
| `xlsx`    | `.xlsx`            |   ✓    |        ✓         |   ✓    | preserved           |
| `csv`     | `.csv`             |   ✓    |        ✓         |   ✓    | ignored             |
| `html`    | `.html`, `.htm`    |   ✓    |                  |   ✓    | rendered            |
| `htmlzip` | `.html.zip`        |        |                  |   ✓    | rendered            |
| `epub`    | `.epub`            |        |                  |   ✓    | ignored             |
| `dbk`     | `.dbk`, `.zip`     |        |        ✓         |   ✓    | preserved           |

The last column is each definition's `templateAnnotationHandling`: **rendered** formats draw the
templates (a PPTX slide, an HTML player), **preserved** formats keep the `{[…]}` tags in what they
write (Markdown; XLSX uses `sheet=`/`anchor=` to place tables), and **ignored** formats flatten
blocks to semantic content (headings, paragraphs, lists, tables).

You can add your own format. A definition needs an `id`, `label`, `mimeType`, and `extensions`,
plus whichever of `importDoc`, `importContainer`, and `exportDoc` it supports:

```ts
import {
  convert,
  defaultRegistry,
  type FormatDefinition,
} from '@bendyline/squisq-formats/registry';
import { extractPlainText } from '@bendyline/squisq/markdown';

const plainText: FormatDefinition = {
  id: 'txt',
  label: 'Plain text',
  mimeType: 'text/plain',
  extensions: ['.txt'],
  async exportDoc(input) {
    const nodes = input.markdownDoc?.children ?? [];
    const text = nodes.map((node) => extractPlainText(node)).join('\n\n');
    return {
      bytes: new TextEncoder().encode(text),
      mimeType: 'text/plain',
      suggestedFilename: '',
      warnings: [],
    };
  },
};

const registry = defaultRegistry();
registry.register(plainText);

const result = await convert(
  { kind: 'markdown', markdown: '# Harbor\n\nNorth **pier**.\n', baseName: 'harbor' },
  'txt',
  {
    registry,
  },
);
// result.suggestedFilename === 'harbor.txt'; the text is 'Harbor\n\nNorth pier.'
```

`createRegistry()` returns an empty registry when you want only your own formats. Registering an
existing id replaces it. `convert()` fills in `suggestedFilename` from the source's base name and
the definition's first extension.

## `convert()`

```ts
convert(source: ConvertSource, to: FormatId, options?: ConvertOptions): Promise<ConversionResult>
```

The **source** is one of three shapes:

| `kind`       | Fields                                                             | Notes                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'markdown'` | `markdown` (text or `MarkdownDocument`), `container?`, `baseName?` | Pass a `container` so exports can embed the document's images and media                                                                                      |
| `'doc'`      | `doc`, `container?`, `baseName?`                                   | A `Doc` you built or transformed                                                                                                                             |
| `'bytes'`    | `data` (`ArrayBuffer` or `Uint8Array`), `filename?`                | Another file. Its format comes from `options.from`, else the file extension, else the bytes (PDF and ZIP signatures); anything else is read as Markdown text |

The **result** is `{ bytes, mimeType, suggestedFilename, warnings }`. Warnings are non-fatal
fidelity notes — "XLSX export is tables-only; 2 non-table block(s) were omitted" — so surface
them to users.

Common **options**:

| Option                | Effect                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `themeId`             | Theme for the export, resolved against the document's custom themes, then `themeRegistry`, then built-ins        |
| `transformStyle`      | Apply a transform style (such as `'magazine'`) before exporting                                                  |
| `autoTemplates`       | `false` turns off content-aware template picking when the source becomes a `Doc`                                 |
| `title`               | Title metadata for formats that carry one                                                                        |
| `resolvePlayerScript` | Returns the standalone player bundle; required for `html` and `htmlzip`                                          |
| `formatOptions`       | Per-format option bags, keyed by format id — `{ pptx: { inferTheme: false } }`, `{ csv: { sidecar: 'always' } }` |
| `registry`            | Use your own registry                                                                                            |
| `limits`              | Override the input size and complexity safety limits (`false` only for trusted input)                            |
| `signal`              | An `AbortSignal` to cancel                                                                                       |

To export one source to several formats, `prepareConversion(source, options)` normalizes it once
and returns an object whose `convert(to)` you can call repeatedly.

### Errors

Every failure throws a `ConversionError` with a stable `code`, an optional `format`, and often a
`hint` with the fix:

| `code`               | When                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `unknown-format`     | No registered format has that id — the target, or a source format named with `from`         |
| `unsupported-input`  | The format can't be imported — `epub` and `htmlzip` are export-only                         |
| `unsupported-output` | The format can't be exported                                                                |
| `invalid-input`      | The source couldn't be read: a damaged file, or input over the safety limits                |
| `missing-dependency` | Something the conversion needs wasn't supplied — for example `resolvePlayerScript` for HTML |
| `conversion-failed`  | The converter itself failed; the original error is on `error.cause`                         |

```ts
import { ConversionError, convert } from '@bendyline/squisq-formats/registry';

try {
  await convert({ kind: 'markdown', markdown }, 'html');
} catch (error: unknown) {
  if (error instanceof ConversionError && error.code === 'missing-dependency') {
    console.error(error.hint);
    // "pass resolvePlayerScript, e.g. () => import('@bendyline/squisq-react/standalone-source').then(m => m.PLAYER_BUNDLE)"
  }
}
```

## Importing: documents and containers

A format can import two ways:

- **`importDoc`** returns a `MarkdownDocument` alone.
- **`importContainer`** returns a [`ContentContainer`](storage.md) holding the Markdown **and** the
  files that came with it: images extracted from a DOCX, PPTX, or PDF, and large tables written as
  [data files](../../guide/data-and-charts.md#data-files).

`convert()` uses `importContainer` whenever a format has one, so exports from an imported file keep
its media. When you want those files yourself — to open an import in the editor, say — call the
format's container function directly (`docxToContainer`, `pptxToContainer`, `pdfToContainer`,
`xlsxToContainer`, `csvToContainer`), use `registry.get(id)?.importContainer`, or convert to `dbk`
to get everything in one ZIP.

### Sidecars for large tables

Spreadsheets and CSV files can be too large to hold as a Markdown table. Their container importers
write the original file into `<docbasename>_files/data/` and leave a reference in the document:

```ts
import { csvToContainer } from '@bendyline/squisq-formats/csv';

// csvText: the file's contents (an ArrayBuffer or Blob works too)
const container = await csvToContainer(csvText, {
  sourceName: 'Pier Samples.csv',
  sidecar: 'always',
});
await container.getDocumentPath(); // 'pier-samples.md'
(await container.listFiles()).map((entry) => entry.path);
// ['pier-samples.md', 'pier-samples_files/data/Pier Samples.csv']
```

The document is one `{[dataTable src="pier-samples_files/data/Pier Samples.csv"]}` heading plus
a plain link to the file. `sidecar` is `'auto'` (the default: spill past the thresholds — XLSX
regions over `maxInlineRows` (100) or `maxInlineCells` (2,000); CSV files over `maxInlineRows`
(100) or `maxInlineBytes` (256 KiB)), `'always'`, or `'never'`. The document-only importers
(`csvToMarkdownDoc`, `xlsxToMarkdownDoc`) never spill, because they have nowhere to put the file.
Through `convert()`, pass these as `formatOptions.csv` or `formatOptions.xlsx`.

On export, formats handle data references differently: `htmlzip` and `dbk` carry the files,
`xlsx` re-embeds the full table at its recorded sheet and cell, and single-file HTML and EPUB warn
that the reference can't be resolved.

## The outside-in contract

Some hosts want the rendered file — `Tucson.pptx` — to stay the file users see and share, with its
editable Markdown kept out of the way beside it. The outside-in contract defines that layout:

```text
Tucson.pptx
Tucson_files/
  tucson.md               ← editable source, with frontmatter pointing back at ../Tucson.pptx
  .original/original.pptx ← the file as it was before the first edit
  hero.png                ← media extracted on import
```

`@bendyline/squisq-formats/outside-in-layout` holds the path rules and imports nothing, so a file
explorer or editor extension can bundle it for a few kilobytes:

```ts
import { resolveOutsideInLayout } from '@bendyline/squisq-formats/outside-in-layout';

const layout = resolveOutsideInLayout('reports/Tucson.pptx');
layout?.markdownPath; // 'reports/Tucson_files/tucson.md'
layout?.backupPath; // 'reports/Tucson_files/.original/original.pptx'
```

Supported targets are `html`, `docx`, `pdf`, `pptx`, `xlsx`, and `csv` (`OUTSIDE_IN_FORMAT_IDS`);
`isOutsideInTargetPath(path)` tells you whether a file qualifies, and
`chooseOutsideInMarkdownPath(layout, paths)` finds an existing source. `@bendyline/squisq-formats/outside-in`
adds the registry-backed half: `importOutsideInDocument({ data, targetPath })` returns the
Markdown (with the relationship recorded in its frontmatter), the media container, and warnings;
`renderOutsideInDocument({ markdown, targetPath, container })` regenerates the target (an HTML
target also needs `html.playerScriptPath`, the URL of a shared player script, and Word, PDF, and
PowerPoint targets picture their diagrams when given a `renderDiagram`). Regenerating
is opt-in: it throws `invalid-input` until the companion's frontmatter sets
`squisq-updatefrommarkdown: true` (`withOutsideInMarkdownEditing` toggles it), so an import never
overwrites the user's file by surprise. The host owns the file system and the order of writes.

## Theme and layout inference

Office files carry a theme — a color scheme and a pair of fonts — and PowerPoint files carry slide
layouts. `inferThemeFromFile(bytes, { format?, inferLayouts?, nameHint? })` from
`@bendyline/squisq-formats/infer` reads them and returns `{ theme, extraction, layouts?, warnings }`:
a compiled, validated Squisq `Theme`, the raw values it came from, and — for a PPTX with
`inferLayouts` — `CustomTemplateDefinition`s for its distinctive slide layouts.

```ts
import { inferThemeFromFile } from '@bendyline/squisq-formats/infer';

const { theme, warnings } = await inferThemeFromFile(deckBytes, { nameHint: 'Harbor deck' });
theme.id; // 'custom-harbor-deck'
```

It accepts DOCX, PPTX, and XLSX, and rejects PDF with `unsupported-input` (PDFs have no theme
tables). PPTX import applies inference automatically: the imported Markdown carries the deck's
theme in `squisq-custom-themes` and `squisq-theme`, slide headings get tags for the built-in
templates their layouts match, and distinctive layouts become custom templates in
`squisq-custom-templates`. Turn either off with `formatOptions: { pptx: { inferTheme: false, inferLayouts: false } }`.

## Browser and Node

The registry and every built-in converter run in both. Differences to plan for:

- **HTML export** needs the standalone player bundle. Pass
  `resolvePlayerScript: () => import('@bendyline/squisq-react/standalone-source').then((m) => m.PLAYER_BUNDLE)`
  — a lazy import, because the bundle is large.
- **PDF import** uses pdfjs. In the browser, register its worker once with `configurePdfWorker(url)`
  from `@bendyline/squisq-formats/pdf` before the first import (see
  [Installation](../installation.md#self-hosted-webassembly-and-workers)). In Node it runs without
  setup, though pdfjs may log warnings about optional canvas support. Extracting a PDF's embedded
  images encodes them through a canvas, so `pdfToContainer` needs a browser for that part.
- **Parquet** data files need the optional peer `hyparquet`; without it, a Parquet reference
  becomes a diagnostic instead of a table.
- **Video and images** — MP4, GIF, PNG — are not registry formats. The CLI's `createCliRegistry()`
  (from `@bendyline/squisq-cli/api`) adds them for Node, rendering through headless Chromium; in
  the browser, use `@bendyline/squisq-video-react`. See [Video and images](../guides/video-and-images.md).

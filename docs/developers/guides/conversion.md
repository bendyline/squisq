---
title: Converting formats
description: Convert documents between Markdown, Word, PowerPoint, PDF, Excel, CSV, HTML, EPUB, and Squisq containers from Node or the browser.
---

# Converting formats

`@bendyline/squisq-formats` turns a Squisq document into Word, PowerPoint, PDF, EPUB, Excel, CSV,
or HTML, and imports most of those back into Markdown. Every converter is plain JavaScript, so the
same code runs in Node and in the browser with no server or native binaries.

Start with `convert()`, the one front door over every format. Reach for the per-format functions
when you need an option `convert()` doesn't expose, or want to skip the Markdown round trip.

## Convert a document in one call

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { convert } from '@bendyline/squisq-formats/registry';

const markdown = await readFile('harbor-survey.md', 'utf8');
const result = await convert({ kind: 'markdown', markdown, baseName: 'harbor-survey' }, 'docx');

await writeFile(result.suggestedFilename, result.bytes); // harbor-survey.docx
for (const warning of result.warnings) console.warn(warning);
```

`convert(source, to, options?)` returns a `ConversionResult`:

| Field               | Type         | Meaning                                                             |
| ------------------- | ------------ | ------------------------------------------------------------------- |
| `bytes`             | `Uint8Array` | The encoded output                                                  |
| `mimeType`          | `string`     | The output's MIME type                                              |
| `suggestedFilename` | `string`     | `<baseName>.<ext>`, using the target's first extension              |
| `warnings`          | `string[]`   | Non-fatal fidelity notes, such as content a format couldn't express |

`convert`, `prepareConversion`, `ConversionError`, and the registry helpers are also exported from
the package root, `@bendyline/squisq-formats`.

In the browser, the source is usually a file the user picked:

```ts
import { convert } from '@bendyline/squisq-formats/registry';

async function wordToMarkdown(file: File): Promise<string> {
  const result = await convert(
    { kind: 'bytes', data: await file.arrayBuffer(), filename: file.name },
    'md',
  );
  return new TextDecoder().decode(result.bytes);
}
```

## Sources

`convert()` accepts three source shapes. Each is normalized into a `Doc` (and a Markdown AST where
there is one) plus a `ContentContainer` that carries media, before the target exporter runs.

| `kind`       | Fields                                                               | Use it for                                                                  |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `'markdown'` | `markdown` (string or `MarkdownDocument`), `container?`, `baseName?` | Markdown you have in hand                                                   |
| `'bytes'`    | `data` (`ArrayBuffer` or `Uint8Array`), `filename?`                  | Any file: `.docx`, `.pptx`, `.pdf`, `.xlsx`, `.csv`, `.html`, `.dbk`, `.md` |
| `'doc'`      | `doc` (`Doc`), `container?`, `baseName?`                             | A `Doc` you built or transformed yourself                                   |

`baseName` names the output (`'document'` when omitted). For a bytes source, the base name comes
from `filename`.

A bytes source's format is detected in this order: the `from` option, then the filename extension,
then the content — `%PDF` means PDF, and a ZIP is a DOCX, PPTX, or XLSX by its
`[Content_Types].xml`, or a Squisq container (`dbk`) when it has none. Anything else is read as UTF-8
Markdown.

## Formats

The default registry ships ten formats. Pass the id as the `to` argument, or as `from` to skip
detection.

| Id        | Import | Export | Output                                      | Template annotations |
| --------- | ------ | ------ | ------------------------------------------- | -------------------- |
| `md`      | Yes    | Yes    | Markdown text                               | Preserved            |
| `docx`    | Yes    | Yes    | Word document                               | Ignored              |
| `pdf`     | Yes    | Yes    | PDF                                         | Ignored              |
| `pptx`    | Yes    | Yes    | PowerPoint deck, one slide per block        | Rendered             |
| `xlsx`    | Yes    | Yes    | Excel workbook — tables only                | Preserved            |
| `csv`     | Yes    | Yes    | CSV text — one table                        | Ignored              |
| `html`    | Yes    | Yes    | One self-contained HTML file with a player  | Rendered             |
| `htmlzip` | No     | Yes    | ZIP of HTML, player script, and media       | Rendered             |
| `epub`    | No     | Yes    | EPUB 3 e-book                               | Ignored              |
| `dbk`     | Yes    | Yes    | ZIP of the Squisq container (`.dbk`/`.zip`) | Preserved            |

The last column is each format's `templateAnnotationHandling`: **rendered** formats draw blocks the
way the slideshow does, **preserved** formats keep `{[…]}` annotations for a lossless round trip,
and **ignored** formats export the semantic content (headings, prose, lists, tables) and drop the
visual treatment.

> [!NOTE]
> Conversions keep structure and most formatting, but they are not lossless round trips. PDF import
> is heuristic, XLSX export writes only tables, and CSV export writes only one table. Every loss
> `convert()` can detect is reported in `warnings`.

## Options

The third argument is `ConvertOptions`. Every field is optional.

| Option                | Type                                   | Effect                                                                                                  |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `themeId`             | `string`                               | Theme for exporters that style output (DOCX, PDF, PPTX, EPUB, HTML). Wins over the document's own theme |
| `themeRegistry`       | `ThemeRegistry`                        | Your own themes, resolved after the document's custom themes and before the built-ins                   |
| `transformStyle`      | style id or `TransformStyleConfig`     | Restyle the document with a slideshow transform (such as `'documentary'`) before export                 |
| `transformRegistry`   | `TransformStyleRegistry`               | Your own transform styles                                                                               |
| `autoTemplates`       | `boolean`                              | Content-aware template picking for unannotated headings (default on)                                    |
| `title`               | `string`                               | Title for formats with document metadata                                                                |
| `from`                | format id                              | Source format of a bytes source; skips detection                                                        |
| `registry`            | `FormatRegistry`                       | Resolve formats here instead of `defaultRegistry()`                                                     |
| `resolvePlayerScript` | `() => Promise<string>`                | Supplies the standalone player; required for `html` and `htmlzip` export                                |
| `formatOptions`       | object keyed by format id              | Per-format import and export options (below)                                                            |
| `limits`              | `Partial<ConversionLimits>` or `false` | Safety limits; `false` turns them off for trusted input                                                 |
| `signal`              | `AbortSignal`                          | Cancels normalization, transformation, or export                                                        |

### Per-format options

`formatOptions` is keyed by format id. Each entry takes the options of that format's importer and
exporter, so one bag serves both directions. The ones you'll reach for most:

| Key       | Options worth knowing                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `md`      | `parse`, `stringify` — Markdown parser and serializer options                                                                      |
| `docx`    | `author`, `description`, `defaultFont`, `defaultFontSize`, `images` (extra image bytes), `extractImages`                           |
| `pdf`     | `pageSize` (`'letter'` or `'a4'`), `margin`, `images`, `unicodeFonts`; import `detectTables` and friends                           |
| `pptx`    | `inferTheme`, `inferLayouts` (both default on for import), `includeCoverSlide`, `diagramImages`, `images`                          |
| `xlsx`    | Import `regions`, `formulas`, `sheet`, `sidecar`, `maxInlineRows`, `maxInlineCells`, `sourceName`; export `inferNumericCells`      |
| `csv`     | `delimiter`, `hasHeader`, `sidecar`, `sourceName`; export `tableIndex`, `formulaHandling`                                          |
| `html`    | `mode` (`'static'`, `'slideshow'`, or `'video'`), `captionStyle`, `autoPlay`, `images`, `audio`; import `sanitize`, `headMetadata` |
| `htmlzip` | Same export options as `html`                                                                                                      |
| `epub`    | `author`, `language`, `publisher`, `coverImage`, `audio`                                                                           |
| `dbk`     | `compression`, `compressionLevel`, and the ZIP safety limits                                                                       |

```ts
const result = await convert({ kind: 'bytes', data, filename: 'budget.xlsx' }, 'md', {
  formatOptions: { xlsx: { regions: false } }, // one whole-sheet table per worksheet
});
```

The full option interfaces are in the [formats API reference](../../API.md#bendylinesquisq-formats).

### Export one source to several formats

`prepareConversion(source, options)` parses, normalizes, and transforms the source once, then
exports that snapshot to as many targets as you like:

```ts
import { prepareConversion } from '@bendyline/squisq-formats/registry';

const prepared = await prepareConversion(
  { kind: 'markdown', markdown, baseName: 'harbor-survey' },
  { themeId: 'documentary' },
);
for (const target of ['docx', 'pdf', 'pptx', 'epub']) {
  const result = await prepared.convert(target);
  await writeFile(result.suggestedFilename, result.bytes);
}
```

`prepared.convert(to, options?)` takes the target-side options only: `signal`, `title`,
`resolvePlayerScript`, and `formatOptions` (merged over the ones you prepared with).

### HTML needs the player

The `html` and `htmlzip` exports embed the standalone player, which `convert()` does not bundle.
Pass `resolvePlayerScript`, or the export fails with a `missing-dependency` error:

```ts
const result = await convert(source, 'html', {
  resolvePlayerScript: () =>
    import('@bendyline/squisq-react/standalone-source').then((m) => m.PLAYER_BUNDLE),
  formatOptions: { html: { mode: 'slideshow' } },
});
```

`PLAYER_BUNDLE` is the light player, which can't draw Mermaid diagrams. For documents with
` ```mermaid ` fences, import `PLAYER_BUNDLE_FULL` from
`@bendyline/squisq-react/standalone-source/full` instead.

Through `convert()`, both HTML formats default to `mode: 'static'` — the scrollable page rendition.
Set `mode: 'slideshow'` for the interactive slideshow, but note that `convert()` embeds the document
as `markdownToDoc` produced it, without the editor's slide projection (`buildPreviewDoc`): a
heading with no template tag shows as a bare section header and its paragraphs are left out. For a
slideshow that matches the editor, project the document yourself and call `docToHtml`, as
[Standalone player](standalone-player.md#the-batteries-included-path-doctohtml) shows. See
[Static sites](static-sites.md) for HTML without a player.

## Containers and media

A Markdown string has no room for pictures, so media travels in a `ContentContainer`: a small
virtual file system holding the document and the files it references. When you convert Markdown
that has images, put both in a container and pass it with the source:

```ts
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { convert } from '@bendyline/squisq-formats/registry';

const container = new MemoryContentContainer();
await container.writeDocument(markdown, 'harbor-survey.md');
await container.writeFile('images/breakwater.png', pngBytes, 'image/png');

const docx = await convert(
  { kind: 'markdown', markdown, container, baseName: 'harbor-survey' },
  'docx',
);
```

The DOCX, PDF, PPTX, EPUB, and HTML exporters read image bytes from the container by the path the
Markdown uses. An image they can't find exports as a placeholder or alt text.

Importing works the other way: DOCX, PDF, PPTX, XLSX, CSV, and DBK imports produce a container with
the Markdown and every extracted file. Export to `md` and you get only the Markdown text — its
image links point at files that aren't in the output. To keep everything, export to `dbk` and open
the archive with `zipToContainer`:

```ts
import { zipToContainer } from '@bendyline/squisq-formats/container';

const archive = await convert({ kind: 'bytes', data: docxBytes, filename: 'report.docx' }, 'dbk');
const container = await zipToContainer(archive.bytes);
for (const entry of await container.listFiles()) console.log(entry.path);
// index.md
// images/image1.png
```

`containerToZip(container, options?)` goes the other way and returns a ZIP `Blob`. Both live at
`@bendyline/squisq-formats/container`; `zipToContainer` enforces the same archive safety limits as
the Office importers and throws a `ZipSafetyError` when an archive breaks them.

Large spreadsheets get special treatment: the XLSX and CSV container importers keep a table past
the inline size thresholds as a data sidecar under `<docname>_files/data/` and reference it from
the Markdown. [Data and calc](../../data-and-calc.md) covers sidecars, and
[Storage](../concepts/storage.md) covers containers.

When you convert a document that references a data file, pass the container that holds it. Formats
that carry the file keep it (`htmlzip` and `dbk`), and XLSX and CSV embed every row. The rest show
its first rows: Word, PDF, and EPUB the first 100, followed by a "Showing N of M rows" note, and
single-file HTML and PowerPoint the 50 the editor preview shows. A file the container doesn't hold
is reported in the result's `warnings`.

## Per-format functions

Each format also has its own subpath with direct functions. They work on core's `MarkdownDocument`
(from `parseMarkdown` in `@bendyline/squisq/markdown`) or on a `Doc`.

| Subpath                               | Import                                                                 | Export                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@bendyline/squisq-formats/docx`      | `docxToMarkdownDoc`, `docxToDoc`, `docxToContainer`                    | `markdownDocToDocx`, `docToDocx`                                       |
| `@bendyline/squisq-formats/pdf`       | `pdfToMarkdownDoc`, `pdfToDoc`, `pdfToContainer`                       | `markdownDocToPdf`, `docToPdf`                                         |
| `@bendyline/squisq-formats/pptx`      | `pptxToMarkdownDoc`, `pptxToDoc`, `pptxToContainer`                    | `docToPptx`, `markdownDocToPptx`                                       |
| `@bendyline/squisq-formats/xlsx`      | `xlsxToMarkdownDoc`, `xlsxToDoc`, `xlsxToContainer`, `xlsxToCellGrids` | `markdownDocToXlsx`, `docToXlsx`                                       |
| `@bendyline/squisq-formats/csv`       | `csvToMarkdownDoc`, `csvToDoc`, `csvToContainer`, `parseCsv`           | `markdownDocToCsv`                                                     |
| `@bendyline/squisq-formats/html`      | `htmlToMarkdownDoc`, `htmlToMarkdownDocSync`, `htmlToMarkdown`         | `docToHtml`, `docToHtmlZip`, `markdownDocToPlainHtml`, and the bundles |
| `@bendyline/squisq-formats/epub`      | —                                                                      | `markdownDocToEpub`, `docToEpub`                                       |
| `@bendyline/squisq-formats/container` | `zipToContainer`                                                       | `containerToZip`                                                       |

```ts
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { markdownDocToDocx, docxToMarkdownDoc } from '@bendyline/squisq-formats/docx';
import { docToPptx } from '@bendyline/squisq-formats/pptx';

const markdownDoc = parseMarkdown(markdown);

// Markdown → Word, and back (images inlined as data URIs)
const docx = await markdownDocToDocx(markdownDoc, {
  title: 'Harbor Survey 2026',
  themeId: 'documentary',
});
const roundTrip = await docxToMarkdownDoc(docx, { extractImages: true });

// Markdown → PowerPoint, through the slideshow projection
const deck = await docToPptx(markdownToDoc(markdownDoc), { themeId: 'bold' });
```

Two things to know when you call these directly:

- **The exporters don't read a container.** Pass image bytes yourself through the `images` option,
  keyed by the path the Markdown uses. `convert()` does this for you.
- **Use `docToPptx` for decks.** It runs the same slideshow projection as the player, so the deck
  has one slide per block, matching the browser. `markdownDocToPptx` is a simpler fallback that
  splits slides at headings only.

## Diagrams in document formats

Word, PDF, and EPUB can't draw Mermaid or Squisq diagrams, so on their own they export a diagram as
its source text. In the browser, `rasterizeDiagrams` from `@bendyline/squisq-formats/diagrams`
replaces each diagram with a PNG drawn by `createDiagramPictureRenderer` from
`@bendyline/squisq-react/diagram-pictures`:

```ts
import { rasterizeDiagrams } from '@bendyline/squisq-formats/diagrams';
import { markdownDocToDocx } from '@bendyline/squisq-formats/docx';
import { createDiagramPictureRenderer } from '@bendyline/squisq-react/diagram-pictures';

const pictured = await rasterizeDiagrams(markdownDoc, createDiagramPictureRenderer());
const docx = await markdownDocToDocx(pictured.markdownDoc, { images: pictured.images });
```

A diagram the renderer can't draw stays as source; the export never fails on it.

`kinds` chooses what gets pictured. By default it's Mermaid, ASCII diagrams, timelines, file trees,
drawing, layout, and diagram blocks, and charts. A chart's picture takes the place of its table, as
the player shows the chart alone; with `showTable=true` the table stays beneath it. Add `'svg'` to
picture SVG islands too (PDF has no vector picture of its own). For a plain HTML page,
`prepareMarkdownDocForPlainHtml` makes these choices for you; see
[Static sites](static-sites.md#diagrams-charts-and-data-tables). A file whose diagrams change one
at a time, regenerated on every save, can wrap the renderer in `cachingDiagramRasterizer` so each
pass redraws only what changed.

Block tags don't print: Word, PDF, and EPUB leave out a paragraph that is only a `{[…]}` tag, and
the single tag at the end of an unannotated section, on its own line or glued to its last sentence.
The player reads those as templates, and a document has nothing to type.

## Node and the browser

The converters need no native code, and each format's code loads lazily, so importing the registry
doesn't pull in the PDF or Office writers until you use them.

PDF **import** runs on Mozilla's pdf.js (`pdfjs-dist`, a dependency of the formats package), which
wants a worker. In the browser, give it the worker script's URL once, before the first import. With
Vite:

```ts
import { configurePdfWorker } from '@bendyline/squisq-formats/pdf';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

configurePdfWorker(workerUrl);
```

Other bundlers have their own asset-URL imports, or you can point at a copy of the worker you host.
If your package manager doesn't hoist dependencies, add `pdfjs-dist` to your own `package.json` so
the import resolves.

In Node, pdf.js falls back to running in the same thread when no worker is configured, and may
print warnings about optional canvas polyfills. To configure one anyway, pass a `file://` URL:

```ts
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { configurePdfWorker } from '@bendyline/squisq-formats/pdf';

const require = createRequire(import.meta.url);
configurePdfWorker(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href);
```

PDF **export** uses pdf-lib and needs no setup.

## Theme inference on import

A PowerPoint import infers the deck's theme and slide layouts by default. The theme rides into the
Markdown as `squisq-custom-themes` and `squisq-theme` frontmatter, and slide headings get matching
`{[…]}` template annotations. Turn either off per conversion:

```ts
await convert({ kind: 'bytes', data, filename: 'deck.pptx' }, 'md', {
  formatOptions: { pptx: { inferTheme: true, inferLayouts: false } },
});
```

To borrow a theme from any Word, PowerPoint, or Excel file without importing its content, use
`inferThemeFromFile` from `@bendyline/squisq-formats/infer`. It returns a compiled, validated
`Theme` you can apply to another conversion:

```ts
import { createThemeRegistry } from '@bendyline/squisq/schemas';
import { inferThemeFromFile } from '@bendyline/squisq-formats/infer';

const { theme, warnings } = await inferThemeFromFile(brandDeckBytes, { nameHint: 'Harbor brand' });
const report = await convert({ kind: 'markdown', markdown, baseName: 'report' }, 'docx', {
  themeId: theme.id,
  themeRegistry: createThemeRegistry([theme]),
});
```

With `inferLayouts: true`, a PowerPoint file also yields `layouts`: custom templates built from its
distinctive slide layouts. A PDF throws `unsupported-input`, since PDFs carry no theme. See
[Themes](../concepts/themes.md) for how themes resolve.

## Errors and warnings

Everything `convert()` and `prepareConversion()` throw is a `ConversionError` with a stable `code`,
so branch on the code rather than the message:

```ts
import { convert, ConversionError } from '@bendyline/squisq-formats/registry';

try {
  await convert(source, 'html');
} catch (err: unknown) {
  if (!(err instanceof ConversionError)) throw err;
  console.error(`${err.code}: ${err.message}`);
  if (err.hint) console.error(err.hint);
}
```

| `code`               | When                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `unknown-format`     | The target (or `from`) id isn't registered                             |
| `unsupported-input`  | The source format is export-only, such as `epub` or `htmlzip`          |
| `unsupported-output` | The target format is import-only                                       |
| `invalid-input`      | The source couldn't be read or parsed, or broke a safety limit         |
| `missing-dependency` | Something the export needs wasn't supplied, such as the player script  |
| `conversion-failed`  | The transform or the exporter failed; the original error is on `cause` |

`err.format` names the format involved, and `err.hint` suggests a fix when there is one. Aborting
through `signal` rejects with the signal's reason instead.

Input is untrusted by default. `limits` caps input size, Markdown size, nesting, table cells, block
count, and duration (`DEFAULT_CONVERSION_LIMITS` holds the defaults), and ZIP-based formats enforce
their own archive limits. Pass `limits: false` only for input you trust.

## Adding your own format

A format is a `FormatDefinition`: an id, a label, a MIME type, extensions, and whichever of
`importDoc`, `importContainer`, and `exportDoc` it supports. Register it on a registry and pass that
registry to `convert()`:

```ts
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import { docToMarkdown } from '@bendyline/squisq/doc';
import {
  convert,
  defaultRegistry,
  type FormatDefinition,
} from '@bendyline/squisq-formats/registry';

const plainText: FormatDefinition = {
  id: 'txt',
  label: 'Plain text',
  mimeType: 'text/plain',
  extensions: ['.txt'],
  async exportDoc(input) {
    const markdown = input.markdownDoc ?? docToMarkdown(input.doc);
    const text = stringifyMarkdown(markdown).replace(/[#*_`>]/g, '');
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
const notes = await convert({ kind: 'markdown', markdown, baseName: 'notes' }, 'txt', { registry });
```

`convert()` fills in `suggestedFilename` from the base name and the first extension. The command
line uses exactly this mechanism to add its `mp4`, `gif`, and `png` formats — see
[CLI programmatic API](cli-api.md).

## Related

- [Formats](../concepts/formats.md) — how the Markdown pivot and the converters fit together
- [Import and export](../../guide/import-export.md) — what each format keeps, from an author's view
- [Static sites](static-sites.md) — HTML pages without the player
- [CLI programmatic API](cli-api.md) — the same conversions from Node, plus video and images
- API reference: [registry and `convert()`](../../API.md#subpath-registry--convert),
  [DOCX](../../API.md#subpath-docx), [PDF](../../API.md#subpath-pdf),
  [PPTX](../../API.md#subpath-pptx), [XLSX](../../API.md#subpath-xlsx),
  [CSV](../../API.md#subpath-csv), [HTML](../../API.md#subpath-html),
  [EPUB](../../API.md#subpath-epub), [Container](../../API.md#subpath-container)

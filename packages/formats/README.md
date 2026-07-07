# @bendyline/squisq-formats

Document format converters for Squisq. Import and export between Squisq's Markdown-based document model and common file formats — DOCX, PDF, HTML, EPUB, PPTX, XLSX, and CSV. All converters run in the browser or Node with no server or native binaries required.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-formats)](https://www.npmjs.com/package/@bendyline/squisq-formats)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq-formats @bendyline/squisq
```

## How Conversion Works

All converters use Squisq's `MarkdownDocument` AST (from `@bendyline/squisq/markdown`) as the pivot format:

- **Import** parses a file into a `MarkdownDocument`. The `xxxToContainer` variants (DOCX, PDF, PPTX) also extract embedded images into a `ContentContainer` alongside the markdown.
- **Export** serializes a `MarkdownDocument` out to the target format. Each format also has a `docToXxx` / `xxxToDoc` wrapper that converts through `MarkdownDocument` internally.

Conversions preserve document structure and most of the flavor of the source — headings, text formatting, lists, tables, links, images — but they are **not lossless round-trips**. Per-format fidelity limits are listed below.

All exports that accept a `themeId` (DOCX, PDF, EPUB, PPTX, plain HTML) apply Squisq theme colors/typography, and fall back to the doc's frontmatter theme (`squisq-theme` / `themeId` / `theme` keys) when the option is omitted.

For a uniform, format-agnostic entry point over every converter, use the **format registry** and `convert()` (`@bendyline/squisq-formats/registry`, also re-exported from the root) — see [Programmatic `convert()`](#programmatic-convert) below.

## Supported Formats

| Format                | Import | Export | Theme | Subpath                               |
| --------------------- | ------ | ------ | ----- | ------------------------------------- |
| **DOCX** (Word)       | ✅     | ✅     | ✅    | `@bendyline/squisq-formats/docx`      |
| **PDF**               | ✅     | ✅     | ✅    | `@bendyline/squisq-formats/pdf`       |
| **HTML**              | ✅     | ✅     | ✅    | `@bendyline/squisq-formats/html`      |
| **EPUB** (e-book)     | —      | ✅     | ✅    | `@bendyline/squisq-formats/epub`      |
| **PPTX** (PowerPoint) | ✅     | ✅     | ✅    | `@bendyline/squisq-formats/pptx`      |
| **XLSX** (Excel)      | ✅     | ✅¹    | —     | `@bendyline/squisq-formats/xlsx`      |
| **CSV**               | ✅     | ✅     | —     | `@bendyline/squisq-formats/csv`       |
| **Container ZIP**     | ✅     | ✅     | —     | `@bendyline/squisq-formats/container` |

¹ XLSX export is **tables-only** (v1.5) — see the [XLSX](#xlsx) section.

## Quick Examples

### DOCX

```ts
import {
  markdownDocToDocx,
  docxToMarkdownDoc,
  docxToContainer,
} from '@bendyline/squisq-formats/docx';

// Export: MarkdownDocument → DOCX (ArrayBuffer)
const docxBytes = await markdownDocToDocx(markdownDoc, { title: 'Report', themeId: 'documentary' });

// Import: DOCX (ArrayBuffer | Blob) → MarkdownDocument
const imported = await docxToMarkdownDoc(docxBuffer, { extractImages: true });

// Import with assets: DOCX → ContentContainer (markdown + images/ files)
const container = await docxToContainer(docxBuffer);
```

**Fidelity:** import covers headings, paragraphs, inline formatting (bold, italic, strikethrough, inline code), hyperlinks, lists, tables, blockquotes, code blocks, footnotes, and embedded images (opt-in via `extractImages`; always on for `docxToContainer`). Export embeds images only when provided via `options.images`; otherwise they appear as placeholder text.

### PDF

```ts
import {
  markdownDocToPdf,
  pdfToMarkdownDoc,
  pdfToContainer,
  configurePdfWorker,
} from '@bendyline/squisq-formats/pdf';

// Configure the PDF.js worker (needed for import in some environments)
configurePdfWorker('/pdf.worker.min.mjs');

// Export: MarkdownDocument → PDF (ArrayBuffer)
const pdfBytes = await markdownDocToPdf(markdownDoc, { pageSize: 'a4' });

// Import: PDF → MarkdownDocument (heuristic structure detection)
const imported = await pdfToMarkdownDoc(pdfBuffer);

// Import with assets: PDF → ContentContainer (markdown + extracted images)
const container = await pdfToContainer(pdfBuffer);
```

**Fidelity:** export uses pdf-lib's standard 14 fonts (`themeId` affects colors only). PDF has no semantic structure, so import is heuristic and best-effort: headings are detected by font size, and tables / code blocks / blockquotes / links via the `detectTables` / `detectCodeBlocks` / `detectBlockquotes` / `detectLinks` options (all default true). `pdfToMarkdownDoc` is text-only; `pdfToContainer` also extracts embedded images, placed **by page** — each image is inserted after the last content block from its page (image-only pages fall back to the nearest preceding page with content, else the document end). Placement is page-level only. Image extraction needs a browser canvas to encode PNG — **under Node it is skipped** (with a `console.warn`) and no images are emitted.

### HTML

```ts
import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';
import {
  docToHtml,
  docToHtmlZip,
  markdownDocToPlainHtml,
  htmlToMarkdownDoc,
} from '@bendyline/squisq-formats/html';

// Interactive player export: Doc → single self-contained HTML string
// (player inlined, images as data URIs, timer-based playback — no audio)
const html = docToHtml(doc, { playerScript: PLAYER_BUNDLE, images });

// Interactive player export: Doc → ZIP Blob (external assets + optional audio)
const zipBlob = await docToHtmlZip(doc, { playerScript: PLAYER_BUNDLE, images, audio });

// Static export: MarkdownDocument → semantic HTML page (no player)
const page = markdownDocToPlainHtml(markdownDoc, { themeId: 'warm-earth' });

// Import: HTML → MarkdownDocument (sanitized by default)
const imported = await htmlToMarkdownDoc(htmlString);
```

The subpath also exports `markdownDocsToPlainHtmlBundle` / `markdownDocsToHtmlBundle` (recursive multi-doc ZIP bundles with `.md` links rewritten to `.html`), `htmlToMarkdownDocSync` / `htmlToMarkdown`, and helpers (`collectImagePaths`, `collectLinkRefs`, `inferMimeType`).

### EPUB

```ts
import { markdownDocToEpub } from '@bendyline/squisq-formats/epub';

// Export: MarkdownDocument → EPUB 3 (ArrayBuffer). No import path.
const epubBytes = await markdownDocToEpub(markdownDoc, {
  title: 'My Book',
  author: 'Jane Doe',
  images, // Map<string, ArrayBuffer> — embedded when provided
  coverImage, // optional JPEG/PNG
});
```

Chapters split at H1/H2 boundaries. Providing `audio` + `audioSegments` generates EPUB 3 Media Overlays (SMIL) for synchronized narration.

### PPTX

```ts
import {
  markdownDocToPptx,
  pptxToMarkdownDoc,
  pptxToContainer,
} from '@bendyline/squisq-formats/pptx';

// Export: MarkdownDocument → PPTX (ArrayBuffer)
// slideBreak: 'h1' | 'h2' (default — H1 and H2 both break) | 'heading'
const pptxBytes = await markdownDocToPptx(markdownDoc, { slideBreak: 'h2', images });

// Import: PPTX → MarkdownDocument (add { extractImages: true } to reference slide images)
const imported = await pptxToMarkdownDoc(pptxBuffer);

// Import with assets: PPTX → ContentContainer (markdown + extracted slide images)
const container = await pptxToContainer(pptxBuffer);
```

**Fidelity:** export preserves inline formatting as DrawingML runs and embeds images when provided via `options.images`. Import reads slide order from `ppt/presentation.xml` and converts each slide's title (→ H2), body text (→ bullet list), and tables. **Slide-image extraction (v1.5):** import can now extract slide-level `<p:pic>` bitmaps into `images/` — `pptxToContainer` returns a container with those files and forces `extractImages: true`, while `pptxToMarkdownDoc` leaves it off by default. Honest limit: only slide-level `<p:pic>` bitmaps are extracted — layout/master images, charts, SmartArt, and picture-fills are **not**.

### CSV

```ts
import { csvToMarkdownDoc, markdownDocToCsv, parseCsv } from '@bendyline/squisq-formats/csv';

// Import: CSV (string | ArrayBuffer | Blob) → single-table MarkdownDocument
const tableDoc = await csvToMarkdownDoc(csvText, { delimiter: ',', hasHeader: true });

// Export: serializes one table node to CSV text (the first by default)
const csv = markdownDocToCsv(markdownDoc);
// Pick another table in a multi-table document:
const second = markdownDocToCsv(markdownDoc, { tableIndex: 1 });
```

Self-contained RFC-4180 parser/serializer (not OOXML). Cell formatting is flattened to plain text on export. Export emits a single table — the first, or `tableIndex` (zero-based). An out-of-range `tableIndex` throws; a table-less document exports to an empty string.

### XLSX

```ts
import { xlsxToMarkdownDoc, markdownDocToXlsx } from '@bendyline/squisq-formats/xlsx';

// Import: XLSX → MarkdownDocument (one table per sheet; or pick one via `sheet`)
const imported = await xlsxToMarkdownDoc(xlsxBuffer, { sheet: 0 });

// Export: MarkdownDocument → XLSX (ArrayBuffer) — one worksheet per markdown table
const xlsxBytes = await markdownDocToXlsx(markdownDoc);
```

**Export is implemented (v1.5) with tables-only fidelity:** every markdown `table` becomes one worksheet, named after the nearest preceding heading (auto-named `Sheet1`, `Sheet2`, … otherwise). All non-table content is dropped. Numeric-looking cells are written as numbers; everything else as inline strings. A document with no tables yields a single empty (but valid) sheet — export never throws. `markdownDocToXlsx` / `docToXlsx` now return `Promise<ArrayBuffer>` (previously threw / returned `Blob`).

### Container ZIP

```ts
import { containerToZip, zipToContainer } from '@bendyline/squisq-formats/container';

// ContentContainer → ZIP Blob (paths preserved)
const zipBlob = await containerToZip(container);

// ZIP → MemoryContentContainer (directories skipped, path traversal rejected)
const container2 = await zipToContainer(zipData);
```

### Doc-level Convenience Functions

Each format also exports `Doc`-level wrappers that handle the Markdown ↔ Doc conversion internally:

```ts
import { docToDocx, docxToDoc } from '@bendyline/squisq-formats/docx';
import { docToPdf, pdfToDoc } from '@bendyline/squisq-formats/pdf';
import { docToPptx, pptxToDoc } from '@bendyline/squisq-formats/pptx';
import { docToEpub } from '@bendyline/squisq-formats/epub';
import { csvToDoc } from '@bendyline/squisq-formats/csv';
import { xlsxToDoc, docToXlsx } from '@bendyline/squisq-formats/xlsx';
```

## Programmatic `convert()`

`@bendyline/squisq-formats/registry` (also re-exported from the package root) is a uniform, format-agnostic front door over every converter. Each format is a `FormatDefinition` that knows how to import raw bytes into the `MarkdownDocument` pivot and/or export back out; `convert()` normalizes any source into a `Doc`, optionally applies a theme/transform, and hands off to the target exporter. Every result comes back as the same `ConversionResult` (`bytes` + `mimeType` + `suggestedFilename` + `warnings`). Converter modules load lazily, so importing the registry never eagerly bundles a heavy converter.

```ts
import { convert } from '@bendyline/squisq-formats/registry';

const result = await convert(
  { kind: 'markdown', markdown: '# Hello', baseName: 'greeting' },
  'docx',
);
// result.bytes, result.mimeType, result.suggestedFilename === 'greeting.docx'
```

Sources are `{ kind: 'bytes' | 'markdown' | 'doc', … }`; byte sources are format-sniffed by magic bytes + extension (pass `from` to skip). Failures throw a structured `ConversionError` with a stable `code` (`unknown-format`, `unsupported-input`, `unsupported-output`, `invalid-input`, `missing-dependency`, `conversion-failed`) plus a `hint`.

**Player-embedding HTML export (`html` / `htmlzip`)** needs the standalone player bundle. Pass `resolvePlayerScript`, or you'll get a `missing-dependency` error:

```ts
const html = await convert({ kind: 'markdown', markdown: src }, 'html', {
  resolvePlayerScript: () =>
    import('@bendyline/squisq-react/standalone-source').then((m) => m.PLAYER_BUNDLE),
});
```

Also exported: `createRegistry` / `defaultRegistry` / `defaultFormats`, `BUILTIN_FORMAT_IDS`, `ConversionError`, and the `ConvertSource` / `ConvertOptions` / `ConversionResult` / `FormatDefinition` / `FormatRegistry` types.

## Subpath Exports

| Subpath                               | Contents                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `@bendyline/squisq-formats/docx`      | DOCX import/export (+ `docxToContainer`)                                       |
| `@bendyline/squisq-formats/pdf`       | PDF import/export (+ `pdfToContainer`, `configurePdfWorker`)                   |
| `@bendyline/squisq-formats/html`      | Player HTML export, static plain-HTML export + bundles, HTML import            |
| `@bendyline/squisq-formats/epub`      | EPUB 3 e-book export (with optional Media Overlays)                            |
| `@bendyline/squisq-formats/pptx`      | PPTX export + import (text/lists/tables + slide images)                        |
| `@bendyline/squisq-formats/xlsx`      | XLSX import + tables-only export                                               |
| `@bendyline/squisq-formats/csv`       | CSV import/export (RFC 4180)                                                   |
| `@bendyline/squisq-formats/ooxml`     | Shared OOXML infrastructure (package reader/writer, XML utilities, namespaces) |
| `@bendyline/squisq-formats/container` | `ContentContainer` ↔ ZIP serialization                                         |
| `@bendyline/squisq-formats/registry`  | Format registry + programmatic `convert()` (also re-exported from the root)    |

The package root re-exports the common converters; `./container`, the plain-HTML/bundle functions, `docxToContainer`, `pdfToContainer`, `PdfPageSize`, and the image utilities are subpath-only.

See the full [API Reference](../../docs/API.md#bendylinesquisq-formats) for every signature and options interface.

## Related Packages

| Package                                                                                        | Description                                                    |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq)                           | Headless core — schemas, templates, spatial, markdown, storage |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react)               | React components for rendering docs (+ `PLAYER_BUNDLE`)        |
| [@bendyline/squisq-cli](https://www.npmjs.com/package/@bendyline/squisq-cli)                   | `squisq` CLI — batch conversion + MP4 rendering                |
| [@bendyline/squisq-editor-react](https://www.npmjs.com/package/@bendyline/squisq-editor-react) | React editor with raw/WYSIWYG/preview modes                    |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

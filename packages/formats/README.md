# @bendyline/squisq-formats

Document format converters for Squisq. Import and export between Squisq's Markdown-based document model and common file formats — DOCX, PDF, and HTML. All converters run entirely in the browser with no server or native binaries required.

Part of the [Squisq](https://github.com/bendyline/squisq) monorepo.

[![npm](https://img.shields.io/npm/v/@bendyline/squisq-formats)](https://www.npmjs.com/package/@bendyline/squisq-formats)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/bendyline/squisq/blob/main/LICENSE)

## Install

```bash
npm install @bendyline/squisq-formats @bendyline/squisq
```

## Supported Formats

| Format | Import | Export | Subpath |
|---|---|---|---|
| **DOCX** (Word) | ✅ | ✅ | `@bendyline/squisq-formats/docx` |
| **PDF** | ✅ | ✅ | `@bendyline/squisq-formats/pdf` |
| **HTML** | — | ✅ | `@bendyline/squisq-formats/html` |
| **PPTX** (PowerPoint) | planned | planned | `@bendyline/squisq-formats/pptx` |
| **XLSX** (Excel) | planned | planned | `@bendyline/squisq-formats/xlsx` |

## Quick Examples

### DOCX

```ts
import { markdownDocToDocx, docxToMarkdownDoc } from '@bendyline/squisq-formats/docx';

// Export: MarkdownDocument → DOCX (Uint8Array)
const docxBytes = await markdownDocToDocx(markdownDoc);

// Import: DOCX (ArrayBuffer) → MarkdownDocument
const markdownDoc = await docxToMarkdownDoc(docxBuffer);
```

### PDF

```ts
import { markdownDocToPdf, pdfToMarkdownDoc, configurePdfWorker } from '@bendyline/squisq-formats/pdf';

// Configure the PDF.js worker (required for import)
configurePdfWorker('/pdf.worker.min.mjs');

// Export: MarkdownDocument → PDF (Uint8Array)
const pdfBytes = await markdownDocToPdf(markdownDoc);

// Import: PDF (ArrayBuffer) → MarkdownDocument
const markdownDoc = await pdfToMarkdownDoc(pdfBuffer);
```

### HTML

```ts
import { docToHtml, docToHtmlZip } from '@bendyline/squisq-formats/html';

// Export: Doc → standalone HTML string
const html = docToHtml(doc);

// Export: Doc → ZIP with HTML + images
const zipBytes = await docToHtmlZip(doc);
```

### Doc-level Convenience Functions

Each format also exports `Doc`-level wrappers that handle the Markdown↔Doc conversion internally:

```ts
import { docToDocx, docxToDoc } from '@bendyline/squisq-formats/docx';
import { docToPdf, pdfToDoc } from '@bendyline/squisq-formats/pdf';
```

## Subpath Exports

| Subpath | Contents |
|---|---|
| `@bendyline/squisq-formats/docx` | DOCX import/export |
| `@bendyline/squisq-formats/pdf` | PDF import/export + worker config |
| `@bendyline/squisq-formats/html` | HTML export |
| `@bendyline/squisq-formats/ooxml` | Shared OOXML infrastructure (ZIP reader/writer, XML utilities) |
| `@bendyline/squisq-formats/pptx` | PPTX stubs (not yet implemented) |
| `@bendyline/squisq-formats/xlsx` | XLSX stubs (not yet implemented) |

## Architecture

All converters use Squisq's `MarkdownDocument` AST as the pivot format. Importing a file parses it into a `MarkdownDocument`; exporting serializes from one. The OOXML subpath provides shared infrastructure for reading and writing Office Open XML packages (used by DOCX, and eventually PPTX/XLSX).

## Related Packages

| Package | Description |
|---|---|
| [@bendyline/squisq](https://www.npmjs.com/package/@bendyline/squisq) | Headless core — schemas, templates, spatial, markdown, storage |
| [@bendyline/squisq-react](https://www.npmjs.com/package/@bendyline/squisq-react) | React components for rendering docs |
| [@bendyline/squisq-editor-react](https://www.npmjs.com/package/@bendyline/squisq-editor-react) | React editor with raw/WYSIWYG/preview modes |

## License

[MIT](https://github.com/bendyline/squisq/blob/main/LICENSE)

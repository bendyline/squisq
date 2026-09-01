/**
 * documentImport — ingest a non-markdown document as markdown for the editor.
 *
 * The site's Upload control accepts more than markdown: anything the shared
 * format registry can import (DOCX, PDF, PPTX, XLSX, CSV, HTML, and squisq
 * containers) is converted here and handed to the editor as markdown source.
 *
 * Two deliberate choices:
 *
 * - **Container first.** When a format defines `importContainer`, that path
 *   wins over `importDoc`: the container carries the document's extracted media
 *   alongside the markdown, so an imported DOCX/PPTX keeps its images instead
 *   of leaving dangling links, and an imported XLSX/CSV keeps its original
 *   bytes as a `_files/data/` sidecar when the data spills past the inline
 *   thresholds. HTML (which inlines images as data URIs) only offers
 *   `importDoc`.
 * - **Staged progress.** Office imports are slow enough (pdfjs parse, OOXML
 *   unzip, region detection) that a silent multi-second freeze reads as a
 *   broken button, so the conversion reports stages the caller can render.
 *
 * The registry itself lazy-loads every converter, so importing this module
 * costs nothing until a file is actually picked.
 */

import type { ContentContainer } from '@bendyline/squisq/storage';
import { ensurePdfWorker } from './pdfWorker';

// ── Types ──────────────────────────────────────────────────────────

/** Coarse phases of an import, in the order they occur. */
export type DocumentImportStage = 'reading' | 'converting' | 'finishing';

export interface DocumentImportProgress {
  stage: DocumentImportStage;
  /** The uploaded file's name, for display. */
  fileName: string;
  /** Human label of the detected format ("Word (DOCX)"), or the bare extension. */
  formatLabel: string;
}

export interface DocumentImportResult {
  /** The converted markdown source. */
  markdown: string;
  /**
   * The container the import produced, when the format extracts media.
   * Null for `importDoc`-only formats — those have no sidecar assets, so the
   * caller should not swap the editor's workspace container for an empty one.
   */
  container: ContentContainer | null;
  formatLabel: string;
}

// ── Supported formats ──────────────────────────────────────────────

/**
 * Extensions the Upload control advertises, beyond plain markdown/text and
 * images. Kept as a literal list (rather than derived from the registry) so it
 * can build the file input's `accept` attribute without loading the formats
 * package; `documentImport.test.ts` asserts every entry really is importable.
 */
export const IMPORTABLE_DOCUMENT_EXTENSIONS = [
  'docx',
  'pptx',
  'xlsx',
  'pdf',
  'csv',
  'tsv',
  'parquet',
  'html',
  'htm',
  'zip',
  'dbk',
] as const;

export type ImportableDocumentExtension = (typeof IMPORTABLE_DOCUMENT_EXTENSIONS)[number];

const IMPORTABLE = new Set<string>(IMPORTABLE_DOCUMENT_EXTENSIONS);

/** Lowercased extension without the leading dot ("Report.DocX" → "docx"). */
export function extensionOf(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Whether {@link importDocumentFile} can handle a file with this name. */
export function isImportableDocument(fileName: string): boolean {
  return IMPORTABLE.has(extensionOf(fileName));
}

// ── Import ─────────────────────────────────────────────────────────

/**
 * Read a File's bytes.
 *
 * Prefers `Blob.arrayBuffer()` — every browser the site targets has it — and
 * falls back to FileReader for environments whose Blob lacks it (jsdom, which
 * is what the unit tests run in). The formats package makes the same
 * accommodation in its own `toBytes`.
 */
async function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Convert an uploaded document file to markdown.
 *
 * @throws {Error} when the extension has no importer registered, or the
 * underlying converter fails. Callers should render {@link describeImportError}.
 */
export async function importDocumentFile(
  file: File,
  onProgress?: (progress: DocumentImportProgress) => void,
): Promise<DocumentImportResult> {
  const ext = extensionOf(file.name);
  const report = (stage: DocumentImportStage, formatLabel: string) =>
    onProgress?.({ stage, fileName: file.name, formatLabel });

  report('reading', ext.toUpperCase());

  // Parquet has no registry importer yet: synthesize the sidecar container
  // directly (the CSV-open-as-document shape — the file IS the content).
  if (ext === 'parquet') {
    const buffer = await readFileBytes(file);
    report('converting', 'Parquet');
    const [{ planDataSidecar, sidecarReferenceMarkdown }, { MemoryContentContainer }] =
      await Promise.all([
        import('@bendyline/squisq-formats/data'),
        import('@bendyline/squisq/storage'),
      ]);
    const plan = planDataSidecar(file.name, 'data.parquet');
    const container = new MemoryContentContainer();
    const markdown = sidecarReferenceMarkdown(plan);
    await container.writeDocument(markdown, plan.markdownFilename);
    await container.writeFile(plan.sidecarPath, buffer, 'application/vnd.apache.parquet');
    report('finishing', 'Parquet');
    return { markdown, container, formatLabel: 'Parquet' };
  }

  const { defaultRegistry } = await import('@bendyline/squisq-formats/registry');
  // `.tsv` rides the CSV importer with a tab delimiter; the registry keeps
  // only `.csv` so export-by-extension semantics stay untouched.
  const definition = defaultRegistry().byExtension(ext === 'tsv' ? 'csv' : ext);
  if (!definition || (!definition.importContainer && !definition.importDoc)) {
    throw new Error(`No importer is registered for .${ext} files.`);
  }
  const formatLabel = definition.label;

  // pdfjs refuses to parse until its worker is registered, and an upload can
  // be the first PDF touch of the session.
  if (definition.id === 'pdf') await ensurePdfWorker();

  const buffer = await readFileBytes(file);
  report('converting', formatLabel);

  // Data imports thread the source file name through so the container's doc
  // and `_files/data/` sidecar are named for the upload. Opening a CSV/TSV
  // always sidecars (the file is the content); XLSX keeps the size threshold.
  const importOptions = {
    formatOptions: {
      xlsx: { sourceName: file.name },
      csv: {
        sourceName: file.name,
        ...(ext === 'tsv' ? { delimiter: '\t' } : {}),
        ...(ext === 'csv' || ext === 'tsv' ? { sidecar: 'always' as const } : {}),
      },
    },
  };

  if (definition.importContainer) {
    const container = await definition.importContainer(buffer, importOptions);
    report('finishing', formatLabel);
    return { markdown: (await container.readDocument()) ?? '', container, formatLabel };
  }

  // importDoc is guaranteed present by the capability guard above.
  const markdownDoc = await definition.importDoc!(buffer, importOptions);
  report('finishing', formatLabel);
  const { stringifyMarkdown } = await import('@bendyline/squisq/markdown');
  return { markdown: stringifyMarkdown(markdownDoc), container: null, formatLabel };
}

// ── Error reporting ────────────────────────────────────────────────

/**
 * A user-facing sentence for an import failure.
 *
 * Registry failures carry a stable `code` (and sometimes a remediation `hint`),
 * which says far more than the raw exception message — so branch on the code
 * where there is one and fall back to the message otherwise.
 */
export function describeImportError(err: unknown, fileName: string): string {
  const code = errorCode(err);
  const detail = err instanceof Error ? err.message : String(err);
  const hint =
    typeof (err as { hint?: unknown })?.hint === 'string'
      ? ` ${(err as { hint: string }).hint}`
      : '';

  switch (code) {
    case 'invalid-input':
      return `${fileName} could not be read — it may be corrupt or not really a document of that type.`;
    case 'unsupported-input':
      return `${fileName} is in a format this site can export to but not import from.`;
    case 'unknown-format':
      return `${fileName} is in an unrecognized format.`;
    case 'missing-dependency':
      return `Importing ${fileName} needs a converter that isn't available here.${hint}`;
    default:
      return `Could not import ${fileName}: ${detail}`;
  }
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Built-in format definitions.
 *
 * Each definition loads its converter module lazily via `import()` inside the
 * method body, so importing the registry never eagerly bundles a heavy
 * converter (pdf-lib, jszip, the OOXML writers, …). The capability of each
 * format — which of import/export it supports — is expressed purely by which
 * methods are present.
 */

import type { ContentContainer } from '@bendyline/squisq/storage';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { ConversionError } from './errors.js';
import { markdownFidelityWarnings } from '../shared/fidelity.js';
import type {
  ConversionResult,
  BuiltinFormatOptions,
  ConvertOptions,
  FormatDefinition,
  NormalizedInput,
} from './types.js';
import { markdownLimitsFromConversion } from './limits.js';

// ── MIME constants ──────────────────────────────────────────────────

const MIME = {
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  html: 'text/html',
  zip: 'application/zip',
  epub: 'application/epub+zip',
} as const;

// ── Small shared helpers ────────────────────────────────────────────

/** Normalize any binary export return shape to Uint8Array. */
async function toBytes(data: ArrayBuffer | Uint8Array | Blob): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // Blob. Prefer the modern arrayBuffer() method; fall back to FileReader for
  // environments (e.g. some jsdom builds) whose Blob lacks it.
  if (typeof data.arrayBuffer === 'function') {
    return new Uint8Array(await data.arrayBuffer());
  }
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(data);
  });
  return new Uint8Array(buffer);
}

/** The theme to apply: explicit option wins, then the doc's own theme. */
function resolveThemeId(input: NormalizedInput, options: ConvertOptions): string | undefined {
  return options.themeId ?? input.doc.themeId;
}

function optionsFor<K extends keyof BuiltinFormatOptions>(
  options: ConvertOptions,
  id: K,
): BuiltinFormatOptions[K] {
  return {
    ...((options.formatOptions?.[id] ?? {}) as object),
    ...(options.signal ? { signal: options.signal } : {}),
  } as BuiltinFormatOptions[K];
}

/** The markdown shape an exporter needs — reuse the source's, else derive it. */
async function markdownOf(input: NormalizedInput): Promise<MarkdownDocument> {
  if (input.markdownDoc) return input.markdownDoc;
  const { docToMarkdown } = await import('@bendyline/squisq/doc');
  return docToMarkdown(input.doc);
}

/**
 * Collect image files from a container, keyed by both their container path and
 * their bare filename. Exporters that resolve by url (PPTX) and the standalone
 * player (HTML) both match against one of those two keys.
 */
async function collectContainerImages(
  container: ContentContainer,
  signal?: AbortSignal,
): Promise<Map<string, ArrayBuffer>> {
  const images = new Map<string, ArrayBuffer>();
  const files = await container.listFiles();
  for (let index = 0; index < files.length; index++) {
    if ((index & 63) === 0) signal?.throwIfAborted();
    const file = files[index]!;
    if (!/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/i.test(file.path)) continue;
    const data = await container.readFile(file.path);
    if (!data) continue;
    images.set(file.path, data);
    const slash = file.path.lastIndexOf('/');
    if (slash !== -1) images.set(file.path.slice(slash + 1), data);
  }
  return images;
}

async function collectContainerDocxImages(
  container: ContentContainer,
  signal?: AbortSignal,
): Promise<Map<string, { data: ArrayBuffer; contentType: string }>> {
  const images = await collectContainerImages(container, signal);
  const { extToMime } = await import('../shared/images.js');
  return new Map(
    [...images].map(([path, data]) => [
      path,
      { data, contentType: extToMime(path.split('.').pop() ?? '') },
    ]),
  );
}

/** Copy a container and make its primary document match the normalized source. */
async function snapshotContainerWithDocument(
  input: NormalizedInput,
  signal?: AbortSignal,
): Promise<ContentContainer> {
  const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
  const snapshot = new MemoryContentContainer();
  const entries = await input.container.listFiles();
  for (let index = 0; index < entries.length; index++) {
    if ((index & 63) === 0) signal?.throwIfAborted();
    const entry = entries[index]!;
    const data = await input.container.readFile(entry.path);
    if (data) await snapshot.writeFile(entry.path, new Uint8Array(data), entry.mimeType);
  }
  const { stringifyMarkdown } = await import('@bendyline/squisq/markdown');
  const documentPath = (await input.container.getDocumentPath()) ?? 'index.md';
  await snapshot.writeDocument(stringifyMarkdown(await markdownOf(input)), documentPath);
  return snapshot;
}

/** Resolve the player IIFE bundle or throw a helpful missing-dependency error. */
async function requirePlayerScript(options: ConvertOptions, format: string): Promise<string> {
  const script = await options.resolvePlayerScript?.();
  if (!script) {
    throw new ConversionError('missing-dependency', 'HTML export needs a player script.', {
      format,
      hint: "pass resolvePlayerScript, e.g. () => import('@bendyline/squisq-react/standalone-source').then(m => m.PLAYER_BUNDLE)",
    });
  }
  return script;
}

function ok(bytes: Uint8Array, mimeType: string, warnings: string[] = []): ConversionResult {
  // suggestedFilename is filled in by convert() once the baseName is known.
  return { bytes, mimeType, suggestedFilename: '', warnings };
}

/**
 * Narrow the untyped per-format escape hatch (`options.formatOptions.pptx`)
 * into the PPTX importer's options. Theme + layout inference default ON;
 * only an explicit `false` disables them.
 */
function pptxImportOptionsFrom(options: ConvertOptions): BuiltinFormatOptions['pptx'] {
  const raw = optionsFor(options, 'pptx');
  return {
    ...raw,
    inferTheme: raw?.inferTheme !== false,
    inferLayouts: raw?.inferLayouts !== false,
  };
}

// ── Definitions ─────────────────────────────────────────────────────

export function defaultFormats(): FormatDefinition[] {
  const md: FormatDefinition = {
    id: 'md',
    templateAnnotationHandling: 'preserved',
    label: 'Markdown',
    mimeType: MIME.md,
    extensions: ['.md', '.markdown'],
    async importDoc(data, options): Promise<MarkdownDocument> {
      const { parseMarkdown } = await import('@bendyline/squisq/markdown');
      const raw = optionsFor(options, 'md').parse ?? {};
      return parseMarkdown(new TextDecoder().decode(data), {
        ...raw,
        signal: options.signal,
        limits: raw.limits ?? markdownLimitsFromConversion(options.limits),
      });
    },
    async exportDoc(input, options): Promise<ConversionResult> {
      const { stringifyMarkdown } = await import('@bendyline/squisq/markdown');
      const raw = optionsFor(options, 'md').stringify ?? {};
      const text = stringifyMarkdown(await markdownOf(input), {
        ...raw,
        signal: options.signal,
        limits: raw.limits ?? markdownLimitsFromConversion(options.limits),
      });
      return ok(new TextEncoder().encode(text), MIME.md);
    },
  };

  const docx: FormatDefinition = {
    id: 'docx',
    templateAnnotationHandling: 'ignored',
    label: 'Word (DOCX)',
    mimeType: MIME.docx,
    extensions: ['.docx'],
    async importContainer(data, options): Promise<ContentContainer> {
      const { docxToContainer } = await import('../docx/index.js');
      return docxToContainer(data, optionsFor(options, 'docx'));
    },
    async importDoc(data, options): Promise<MarkdownDocument> {
      const { docxToMarkdownDoc } = await import('../docx/index.js');
      return docxToMarkdownDoc(data, optionsFor(options, 'docx'));
    },
    async exportDoc(input, options): Promise<ConversionResult> {
      const { markdownDocToDocx } = await import('../docx/index.js');
      const raw = optionsFor(options, 'docx');
      const markdownDoc = await markdownOf(input);
      const containerImages = await collectContainerDocxImages(input.container, options.signal);
      const images = new Map([...containerImages, ...(raw.images ?? new Map())]);
      const buf = await markdownDocToDocx(markdownDoc, {
        ...raw,
        ...(options.title !== undefined ? { title: options.title } : {}),
        themeId: resolveThemeId(input, options),
        themeRegistry: options.themeRegistry ?? raw.themeRegistry,
        images,
      });
      return ok(await toBytes(buf), MIME.docx, markdownFidelityWarnings(markdownDoc, 'docx'));
    },
  };

  const pdf: FormatDefinition = {
    id: 'pdf',
    templateAnnotationHandling: 'ignored',
    label: 'PDF',
    mimeType: MIME.pdf,
    extensions: ['.pdf'],
    async importContainer(data, options): Promise<ContentContainer> {
      const { pdfToContainer } = await import('../pdf/index.js');
      return pdfToContainer(data, optionsFor(options, 'pdf'));
    },
    async importDoc(data, options): Promise<MarkdownDocument> {
      const { pdfToMarkdownDoc } = await import('../pdf/index.js');
      return pdfToMarkdownDoc(data, optionsFor(options, 'pdf'));
    },
    async exportDoc(input, options): Promise<ConversionResult> {
      const { markdownDocToPdf } = await import('../pdf/index.js');
      const raw = optionsFor(options, 'pdf');
      const markdownDoc = await markdownOf(input);
      // PDF export substitutes characters the standard-14 fonts can't encode
      // (emoji/CJK/Cyrillic/…) rather than failing. Route that note into the
      // structured warnings channel instead of letting it hit console.warn.
      const pdfWarnings: string[] = [];
      const buf = await markdownDocToPdf(markdownDoc, {
        ...raw,
        ...(options.title !== undefined ? { title: options.title } : {}),
        themeId: resolveThemeId(input, options),
        themeRegistry: options.themeRegistry ?? raw.themeRegistry,
        onWarning: (message) => pdfWarnings.push(message),
      });
      return ok(await toBytes(buf), MIME.pdf, [
        ...markdownFidelityWarnings(markdownDoc, 'pdf'),
        ...pdfWarnings,
      ]);
    },
  };

  const pptx: FormatDefinition = {
    id: 'pptx',
    templateAnnotationHandling: 'rendered',
    label: 'PowerPoint (PPTX)',
    mimeType: MIME.pptx,
    extensions: ['.pptx'],
    async importContainer(data, options): Promise<ContentContainer> {
      const { pptxToContainer } = await import('../pptx/index.js');
      return pptxToContainer(data, pptxImportOptionsFrom(options));
    },
    async importDoc(data, options): Promise<MarkdownDocument> {
      const { pptxToMarkdownDoc } = await import('../pptx/index.js');
      return pptxToMarkdownDoc(data, pptxImportOptionsFrom(options));
    },
    async exportDoc(input, options): Promise<ConversionResult> {
      // `docToPptx`, not `markdownDocToPptx`: this format declares
      // `templateAnnotationHandling: 'rendered'`, and only the Doc path
      // materializes template layers. The markdown path segments on H1/H2
      // headings alone, so a deck whose slides are `###` headings came out
      // with entire sections collapsed into one slide.
      const { docToPptx } = await import('../pptx/index.js');
      const raw = optionsFor(options, 'pptx');
      const markdownDoc = await markdownOf(input);
      const containerImages = await collectContainerImages(input.container, options.signal);
      const images = new Map([...containerImages, ...(raw.images ?? new Map())]);
      const pptxWarnings: string[] = [];
      const buf = await docToPptx(input.doc, {
        ...raw,
        ...(options.title !== undefined ? { title: options.title } : {}),
        themeId: resolveThemeId(input, options),
        themeRegistry: options.themeRegistry ?? raw.themeRegistry,
        images,
        onWarning: (message) => {
          pptxWarnings.push(message);
          raw.onWarning?.(message);
        },
      });
      return ok(await toBytes(buf), MIME.pptx, [
        ...markdownFidelityWarnings(markdownDoc, 'pptx'),
        ...pptxWarnings,
      ]);
    },
  };

  const xlsx: FormatDefinition = {
    id: 'xlsx',
    // Not 'ignored': a `{[dataTable sheet=… anchor=…]}` annotation decides which
    // worksheet a table lands on and at which cell, so annotations demonstrably
    // affect the exported result.
    templateAnnotationHandling: 'preserved',
    label: 'Excel (XLSX)',
    mimeType: MIME.xlsx,
    extensions: ['.xlsx'],
    async importDoc(data, options): Promise<MarkdownDocument> {
      const { xlsxToMarkdownDoc } = await import('../xlsx/index.js');
      return xlsxToMarkdownDoc(data, optionsFor(options, 'xlsx'));
    },
    async exportDoc(input, options): Promise<ConversionResult> {
      const { markdownDocToXlsx } = await import('../xlsx/index.js');
      const markdownDoc = await markdownOf(input);
      // XLSX fidelity is tables-only: `table` nodes become worksheets and
      // headings name them, but every other top-level block (prose, lists,
      // images, code, …) is dropped. Count those and warn honestly.
      const omitted = markdownDoc.children.filter(
        (n) => n.type !== 'table' && n.type !== 'heading',
      ).length;
      const warnings =
        omitted > 0
          ? [`XLSX export is tables-only; ${omitted} non-table block(s) were omitted.`]
          : [];
      const blob = await markdownDocToXlsx(markdownDoc, {
        ...optionsFor(options, 'xlsx'),
        ...(options.title !== undefined ? { title: options.title } : {}),
        // Placement problems (a bad anchor, overlapping regions) degrade rather
        // than throw, so they have to reach the caller as conversion warnings.
        onWarning: (message) => warnings.push(message),
      });
      return ok(await toBytes(blob), MIME.xlsx, warnings);
    },
  };

  const csv: FormatDefinition = {
    id: 'csv',
    templateAnnotationHandling: 'ignored',
    label: 'CSV',
    mimeType: MIME.csv,
    extensions: ['.csv'],
    async importDoc(data, options): Promise<MarkdownDocument> {
      const { csvToMarkdownDoc } = await import('../csv/index.js');
      return csvToMarkdownDoc(data, optionsFor(options, 'csv'));
    },
    async exportDoc(input, options): Promise<ConversionResult> {
      const { markdownDocToCsv } = await import('../csv/index.js');
      const markdownDoc = await markdownOf(input);
      const raw = optionsFor(options, 'csv');
      const tableCount = markdownDoc.children.filter((n) => n.type === 'table').length;
      const warnings: string[] = [];
      if (tableCount > 1 && raw.tableIndex === undefined) {
        warnings.push(
          `Document has ${tableCount} tables; CSV export emitted only the first. Use the csv converter's tableIndex option to select another.`,
        );
      }
      const text = markdownDocToCsv(markdownDoc, raw);
      return ok(new TextEncoder().encode(text), MIME.csv, warnings);
    },
  };

  const html: FormatDefinition = {
    id: 'html',
    templateAnnotationHandling: 'rendered',
    label: 'HTML (single file)',
    mimeType: MIME.html,
    extensions: ['.html', '.htm'],
    async importDoc(data, options): Promise<MarkdownDocument> {
      const { htmlToMarkdownDoc } = await import('../html/index.js');
      return htmlToMarkdownDoc(data, optionsFor(options, 'html'));
    },
    // importContainer omitted: HTML import already inlines images as data URIs,
    // so there is nothing to extract into a container this wave.
    async exportDoc(input, options): Promise<ConversionResult> {
      const raw = optionsFor(options, 'html');
      if (raw.playerScriptPath) {
        const { generateExternalHtml } = await import('../html/index.js');
        const htmlText = generateExternalHtml(input.doc, {
          ...raw,
          playerScriptPath: raw.playerScriptPath,
          title: options.title ?? input.baseName,
          mode: raw.mode ?? 'static',
          themeId: resolveThemeId(input, options),
          themeRegistry: options.themeRegistry ?? raw.themeRegistry,
        });
        return ok(new TextEncoder().encode(htmlText), MIME.html);
      }

      const playerScript = await requirePlayerScript(options, 'html');
      const { docToHtml } = await import('../html/index.js');
      const containerImages = await collectContainerImages(input.container, options.signal);
      const images = new Map([...containerImages, ...(raw.images ?? new Map())]);
      const htmlText = docToHtml(input.doc, {
        ...raw,
        playerScript,
        images,
        title: options.title ?? input.baseName,
        mode: raw.mode ?? 'static',
        themeId: resolveThemeId(input, options),
        themeRegistry: options.themeRegistry ?? raw.themeRegistry,
      });
      return ok(new TextEncoder().encode(htmlText), MIME.html);
    },
  };

  const htmlzip: FormatDefinition = {
    id: 'htmlzip',
    templateAnnotationHandling: 'rendered',
    label: 'HTML (ZIP archive)',
    mimeType: MIME.zip,
    extensions: ['.html.zip'],
    async exportDoc(input, options): Promise<ConversionResult> {
      const playerScript = await requirePlayerScript(options, 'htmlzip');
      const { docToHtmlZip } = await import('../html/index.js');
      const raw = optionsFor(options, 'htmlzip');
      const containerImages = await collectContainerImages(input.container, options.signal);
      const images = new Map([...containerImages, ...(raw.images ?? new Map())]);
      const blob = await docToHtmlZip(input.doc, {
        ...raw,
        playerScript,
        images,
        title: options.title ?? input.baseName,
        mode: raw.mode ?? 'static',
        themeId: resolveThemeId(input, options),
        themeRegistry: options.themeRegistry ?? raw.themeRegistry,
      });
      return ok(await toBytes(blob), MIME.zip);
    },
  };

  const epub: FormatDefinition = {
    id: 'epub',
    templateAnnotationHandling: 'ignored',
    label: 'EPUB',
    mimeType: MIME.epub,
    extensions: ['.epub'],
    async exportDoc(input, options): Promise<ConversionResult> {
      const { markdownDocToEpub } = await import('../epub/index.js');
      const raw = optionsFor(options, 'epub');
      const markdownDoc = await markdownOf(input);
      const containerImages = await collectContainerImages(input.container, options.signal);
      const images = new Map([...containerImages, ...(raw.images ?? new Map())]);
      const buf = await markdownDocToEpub(markdownDoc, {
        ...raw,
        title: options.title ?? input.baseName,
        themeId: resolveThemeId(input, options),
        themeRegistry: options.themeRegistry ?? raw.themeRegistry,
        images,
      });
      return ok(await toBytes(buf), MIME.epub, markdownFidelityWarnings(markdownDoc, 'epub'));
    },
  };

  const dbk: FormatDefinition = {
    id: 'dbk',
    templateAnnotationHandling: 'preserved',
    label: 'Squisq container (DBK)',
    mimeType: MIME.zip,
    extensions: ['.dbk', '.zip'],
    async importContainer(data, options): Promise<ContentContainer> {
      const { zipToContainer } = await import('../container/index.js');
      return zipToContainer(data, optionsFor(options, 'dbk'));
    },
    async exportDoc(input, options): Promise<ConversionResult> {
      const { containerToZip } = await import('../container/index.js');
      const blob = await containerToZip(
        await snapshotContainerWithDocument(input, options.signal),
        optionsFor(options, 'dbk'),
      );
      return ok(await toBytes(blob), MIME.zip);
    },
  };

  return [md, docx, pdf, pptx, xlsx, csv, html, htmlzip, epub, dbk];
}

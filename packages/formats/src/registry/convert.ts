/**
 * Programmatic `convert()` — the format-registry front door.
 *
 * Normalizes any {@link ConvertSource} into a {@link NormalizedInput} (always
 * yielding a `Doc`, keeping the `MarkdownDocument` when the source was
 * markdown-shaped, and always carrying a `ContentContainer` for media), applies
 * an optional transform, then hands off to the target format's exporter.
 */

import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { TransformStyleInput, TransformStyleRegistry } from '@bendyline/squisq/transform';
import { ConversionError } from './errors.js';
import { defaultRegistry } from './registry.js';
import { openBoundedZipArchive, ZipSafetyError } from '../shared/zipSafety.js';
import type {
  BuiltinFormatOptions,
  ConversionResult,
  ConvertOptions,
  ConvertSource,
  FormatDefinition,
  FormatId,
  FormatRegistry,
  NormalizedInput,
} from './types.js';

function markdownFormatOptions(options: ConvertOptions): BuiltinFormatOptions['md'] {
  return (options.formatOptions?.md ?? {}) as BuiltinFormatOptions['md'];
}

// ── Byte sniffing ───────────────────────────────────────────────────

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

/**
 * Disambiguate a ZIP-based file. OOXML formats (docx/pptx/xlsx) all carry a
 * `[Content_Types].xml` whose content-type strings name the flavor; a squisq
 * container (.dbk) is a plain ZIP with no such part, so absence of the OOXML
 * marker means `dbk`.
 */
async function sniffZip(bytes: Uint8Array): Promise<FormatId> {
  const archive = await openBoundedZipArchive(bytes).catch((cause: unknown) => {
    if (cause instanceof ZipSafetyError && cause.code !== 'invalid-archive') throw cause;
    throw new ConversionError('invalid-input', 'Input is not a readable ZIP archive.', { cause });
  });
  const contentTypes = archive.entries.find((entry) => entry.path === '[Content_Types].xml');
  if (!contentTypes) return 'dbk';
  const maxContentTypesBytes = 1024 * 1024;
  if ((contentTypes.declaredSize ?? 0) > maxContentTypesBytes) {
    throw new ConversionError('invalid-input', 'OOXML content-types metadata is too large.');
  }
  const xmlBytes = await archive.read(contentTypes.path, maxContentTypesBytes);
  if (!xmlBytes) return 'dbk';
  const xml = new TextDecoder().decode(xmlBytes);
  if (xml.includes('wordprocessingml')) return 'docx';
  if (xml.includes('presentationml')) return 'pptx';
  if (xml.includes('spreadsheetml')) return 'xlsx';
  return 'dbk';
}

/** Determine the source format for raw bytes. */
async function detectByteFormat(
  bytes: Uint8Array,
  filename: string | undefined,
  options: ConvertOptions,
  registry: FormatRegistry,
): Promise<FormatId> {
  if (options.from) return options.from;

  const ext = filename ? extractExt(filename) : undefined;
  if (ext) {
    const byExt = registry.byExtension(ext);
    if (byExt) return byExt.id;
  }

  if (hasPrefix(bytes, PDF_MAGIC)) return 'pdf';
  if (hasPrefix(bytes, ZIP_MAGIC)) return sniffZip(bytes);

  // No magic and no recognized extension → assume UTF-8 markdown.
  return 'md';
}

// ── Filename helpers ────────────────────────────────────────────────

/** Lowercased extension without the leading dot (`report.DocX` → `docx`). */
function extractExt(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Basename without its final extension (`a/b/report.docx` → `report`). */
function baseNameOf(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

// ── Normalization ───────────────────────────────────────────────────

interface Normalized {
  input: NormalizedInput;
  warnings: string[];
}

async function normalizeBytes(
  source: Extract<ConvertSource, { kind: 'bytes' }>,
  options: ConvertOptions,
  registry: FormatRegistry,
): Promise<Normalized> {
  const bytes = source.data instanceof Uint8Array ? source.data : new Uint8Array(source.data);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const fromId = await detectByteFormat(bytes, source.filename, options, registry);
  const fromDef = registry.get(fromId);
  if (!fromDef) {
    throw new ConversionError('unknown-format', `Unknown source format "${fromId}".`, {
      format: fromId,
    });
  }
  if (!fromDef.importContainer && !fromDef.importDoc) {
    throw new ConversionError(
      'unsupported-input',
      `Format "${fromDef.label}" cannot be used as a conversion source.`,
      {
        format: fromId,
        hint: 'This format is export-only.',
      },
    );
  }

  const { markdownToDoc } = await import('@bendyline/squisq/doc');
  const { parseMarkdown, stringifyMarkdown } = await import('@bendyline/squisq/markdown');

  const warnings: string[] = [];
  let markdownDoc: MarkdownDocument;
  let container: ContentContainer;

  if (fromDef.importContainer) {
    container = await fromDef.importContainer(buffer, options);
    // PDF embedded-image extraction needs a browser canvas; under Node it's
    // skipped inside pdfToContainer. importContainer has no warnings channel of
    // its own, so surface that degraded path here where warnings are collected.
    if (fromDef.id === 'pdf' && typeof document === 'undefined') {
      warnings.push(
        'PDF embedded images were skipped — image decoding requires a browser canvas (running under Node).',
      );
    }
    const text = await container.readDocument();
    markdownDoc = text
      ? parseMarkdown(text, markdownFormatOptions(options).parse)
      : { type: 'document', children: [] };
  } else {
    // importDoc is guaranteed present by the guard above.
    markdownDoc = await fromDef.importDoc!(buffer, options);
    const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
    const mem = new MemoryContentContainer();
    await mem.writeDocument(stringifyMarkdown(markdownDoc));
    container = mem;
  }

  const doc = markdownToDoc(markdownDoc, { autoTemplates: options.autoTemplates });
  const baseName = source.filename ? baseNameOf(source.filename) : 'document';

  return {
    input: { doc, markdownDoc, container, baseName },
    warnings,
  };
}

async function normalizeMarkdown(
  source: Extract<ConvertSource, { kind: 'markdown' }>,
  options: ConvertOptions,
): Promise<Normalized> {
  const { markdownToDoc } = await import('@bendyline/squisq/doc');
  const { parseMarkdown } = await import('@bendyline/squisq/markdown');

  const { stringifyMarkdown } = await import('@bendyline/squisq/markdown');

  const markdownDoc =
    typeof source.markdown === 'string'
      ? parseMarkdown(source.markdown, markdownFormatOptions(options).parse)
      : source.markdown;

  let container = source.container;
  if (!container) {
    // Seed a fresh container with the document so container-backed exports
    // (dbk) and media resolution have the markdown to serialize.
    const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
    const mem = new MemoryContentContainer();
    await mem.writeDocument(stringifyMarkdown(markdownDoc));
    container = mem;
  }

  const doc = markdownToDoc(markdownDoc, { autoTemplates: options.autoTemplates });
  const baseName = source.baseName ?? 'document';

  return { input: { doc, markdownDoc, container, baseName }, warnings: [] };
}

async function normalizeDoc(source: Extract<ConvertSource, { kind: 'doc' }>): Promise<Normalized> {
  let container = source.container;
  if (!container) {
    const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
    const { docToMarkdown } = await import('@bendyline/squisq/doc');
    const { stringifyMarkdown } = await import('@bendyline/squisq/markdown');
    const mem = new MemoryContentContainer();
    await mem.writeDocument(stringifyMarkdown(docToMarkdown(source.doc)));
    container = mem;
  }
  const baseName = source.baseName ?? 'document';
  // markdownDoc is intentionally omitted — exporters derive it lazily via docToMarkdown.
  return { input: { doc: source.doc, container, baseName }, warnings: [] };
}

async function normalize(
  source: ConvertSource,
  options: ConvertOptions,
  registry: FormatRegistry,
): Promise<Normalized> {
  switch (source.kind) {
    case 'bytes':
      return normalizeBytes(source, options, registry);
    case 'markdown':
      return normalizeMarkdown(source, options);
    case 'doc':
      return normalizeDoc(source);
  }
}

// ── Transform ───────────────────────────────────────────────────────

async function applyTransformStyle(
  input: NormalizedInput,
  transformStyle: TransformStyleInput,
  themeId?: string,
  registry?: TransformStyleRegistry,
): Promise<string[]> {
  const { applyTransform, extractDocImages } = await import('@bendyline/squisq/transform');
  const { docToMarkdown, markdownToDoc } = await import('@bendyline/squisq/doc');
  const images = extractDocImages(input.doc.blocks);
  const result = applyTransform(input.doc, transformStyle, { themeId, images, registry });
  input.doc = result.doc;
  const markdownDoc = docToMarkdown(result.doc);
  input.markdownDoc = markdownDoc;

  // Lossy-path detection: transforms can emit template blocks whose data lives
  // in template inputs rather than in round-trippable markdown `contents`, so
  // `docToMarkdown` silently drops them. Re-parse with auto-templating off (so
  // the comparison stays ~1:1 and isn't confused by content-aware promotion)
  // and compare block counts. Best-effort — most blocks carry `contents` and
  // round-trip fine, so this only fires on a genuine collapse.
  const roundTripped = markdownToDoc(markdownDoc, { autoTemplates: false });
  if (roundTripped.blocks.length < result.doc.blocks.length) {
    return [
      'Transform produced blocks that don’t round-trip to markdown; export may be incomplete.',
    ];
  }
  return [];
}

// ── convert() ───────────────────────────────────────────────────────

/**
 * Convert a source document to a target format.
 *
 * @param source - A bytes / markdown / doc source.
 * @param to - The target format id (must be registered and support export).
 * @param options - Conversion options (registry, theme, transform, …).
 * @throws {@link ConversionError} on any failure, with a stable `code`.
 */
export async function convert(
  source: ConvertSource,
  to: FormatId,
  options: ConvertOptions = {},
): Promise<ConversionResult> {
  const registry = options.registry ?? defaultRegistry();

  const target: FormatDefinition | undefined = registry.get(to);
  if (!target) {
    throw new ConversionError('unknown-format', `Unknown target format "${to}".`, { format: to });
  }
  if (!target.exportDoc) {
    throw new ConversionError(
      'unsupported-output',
      `Format "${target.label}" does not support export.`,
      { format: to, hint: 'This format is import-only.' },
    );
  }

  let normalized: Normalized;
  try {
    normalized = await normalize(source, options, registry);
  } catch (err: unknown) {
    if (err instanceof ConversionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ConversionError('invalid-input', message, {
      format: options.from,
      cause: err,
    });
  }
  const { input, warnings } = normalized;

  // Respect an existing doc theme; only fill it in from options when absent.
  if (options.themeId && !input.doc.themeId) {
    input.doc = { ...input.doc, themeId: options.themeId };
  }

  let result: ConversionResult;
  try {
    if (options.transformStyle) {
      warnings.push(
        ...(await applyTransformStyle(
          input,
          options.transformStyle,
          options.themeId ?? input.doc.themeId,
          options.transformRegistry,
        )),
      );
    }
    result = await target.exportDoc(input, options);
  } catch (err: unknown) {
    if (err instanceof ConversionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ConversionError('conversion-failed', message, { format: to, cause: err });
  }

  const ext = target.extensions[0]?.replace(/^\.+/, '') ?? to;
  return {
    ...result,
    suggestedFilename: `${input.baseName}.${ext}`,
    warnings: [...warnings, ...result.warnings],
  };
}

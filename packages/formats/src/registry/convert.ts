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
import {
  openBoundedZipArchive,
  resolveZipSafetyLimits,
  ZipSafetyError,
  type ZipSafetyLimits,
} from '../shared/zipSafety.js';
import type {
  BuiltinFormatOptions,
  ConversionResult,
  ConvertOptions,
  ConvertSource,
  FormatDefinition,
  FormatId,
  FormatRegistry,
  NormalizedInput,
  PreparedConversion,
  PreparedExportOptions,
} from './types.js';
import {
  assertDocWithinConversionLimits,
  markdownLimitsFromConversion,
  resolveConversionLimits,
} from './limits.js';

function markdownFormatOptions(options: ConvertOptions): BuiltinFormatOptions['md'] {
  return (options.formatOptions?.md ?? {}) as BuiltinFormatOptions['md'];
}

function parseOptions(options: ConvertOptions): BuiltinFormatOptions['md']['parse'] {
  const raw = markdownFormatOptions(options).parse ?? {};
  return {
    ...raw,
    signal: options.signal,
    limits: raw.limits ?? markdownLimitsFromConversion(options.limits),
  };
}

function stringifyOptions(options: ConvertOptions): BuiltinFormatOptions['md']['stringify'] {
  const raw = markdownFormatOptions(options).stringify ?? {};
  return {
    ...raw,
    signal: options.signal,
    limits: raw.limits ?? markdownLimitsFromConversion(options.limits),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error('Document conversion was cancelled.');
  error.name = 'AbortError';
  throw error;
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

/** The ZIP-based formats {@link sniffZip} can resolve to. */
const ZIP_SNIFF_CANDIDATES = ['docx', 'pptx', 'xlsx', 'dbk'] as const;

/**
 * ZIP limits for the sniff pass.
 *
 * Sniffing happens *before* the format is known, so no single format's
 * `ZipSafetyLimits` applies yet. Opening at hard-coded defaults would hand a
 * hostile archive one free pass at default budgets even when the caller
 * tightened every ZIP format.
 *
 * Instead, take the **most permissive** effective limit across the candidate
 * formats: the sniff is then never stricter than the importer that will
 * actually run (so a legitimate file is never falsely rejected), while a caller
 * who tightened *all* ZIP formats gets that tighter budget applied at sniff
 * time too. An unconfigured candidate resolves to the default, which keeps the
 * maximum at the default — matching today's behavior exactly.
 */
function sniffZipLimits(options: ConvertOptions): ZipSafetyLimits {
  const effective = ZIP_SNIFF_CANDIDATES.map((id) =>
    resolveZipSafetyLimits((options.formatOptions?.[id] ?? {}) as ZipSafetyLimits),
  );
  return {
    signal: options.signal,
    maxEntries: Math.max(...effective.map((l) => l.maxEntries)),
    maxUncompressedBytes: Math.max(...effective.map((l) => l.maxUncompressedBytes)),
    maxEntryUncompressedBytes: Math.max(...effective.map((l) => l.maxEntryUncompressedBytes)),
    maxCompressionRatio: Math.max(...effective.map((l) => l.maxCompressionRatio)),
  };
}

/**
 * Disambiguate a ZIP-based file. OOXML formats (docx/pptx/xlsx) all carry a
 * `[Content_Types].xml` whose content-type strings name the flavor; a squisq
 * container (.dbk) is a plain ZIP with no such part, so absence of the OOXML
 * marker means `dbk`.
 */
async function sniffZip(bytes: Uint8Array, options: ConvertOptions): Promise<FormatId> {
  const archive = await openBoundedZipArchive(bytes, sniffZipLimits(options)).catch(
    (cause: unknown) => {
      if (cause instanceof ZipSafetyError && cause.code !== 'invalid-archive') throw cause;
      throw new ConversionError('invalid-input', 'Input is not a readable ZIP archive.', { cause });
    },
  );
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
  if (hasPrefix(bytes, ZIP_MAGIC)) return sniffZip(bytes, options);

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
  if (
    options.limits !== false &&
    bytes.byteLength > resolveConversionLimits(options.limits).maxInputBytes
  ) {
    throw new ConversionError(
      'invalid-input',
      `Input exceeds the ${resolveConversionLimits(options.limits).maxInputBytes}-byte safety limit.`,
    );
  }
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
    const text = await container.readDocument();
    markdownDoc = text
      ? parseMarkdown(text, parseOptions(options))
      : { type: 'document', children: [] };
  } else {
    // importDoc is guaranteed present by the guard above.
    markdownDoc = await fromDef.importDoc!(buffer, options);
    const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
    const mem = new MemoryContentContainer();
    await mem.writeDocument(stringifyMarkdown(markdownDoc, stringifyOptions(options)));
    container = mem;
  }

  const { assertMarkdownDocumentWithinLimits } = await import('@bendyline/squisq/markdown');
  assertMarkdownDocumentWithinLimits(
    markdownDoc,
    markdownLimitsFromConversion(options.limits),
    options.signal,
  );

  const doc = markdownToDoc(markdownDoc, { autoTemplates: options.autoTemplates });
  assertDocWithinConversionLimits(doc, options.limits, options.signal);
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
      ? parseMarkdown(source.markdown, parseOptions(options))
      : source.markdown;
  const { assertMarkdownDocumentWithinLimits } = await import('@bendyline/squisq/markdown');
  assertMarkdownDocumentWithinLimits(
    markdownDoc,
    markdownLimitsFromConversion(options.limits),
    options.signal,
  );

  let container = source.container;
  if (!container) {
    // Seed a fresh container with the document so container-backed exports
    // (dbk) and media resolution have the markdown to serialize.
    const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
    const mem = new MemoryContentContainer();
    await mem.writeDocument(stringifyMarkdown(markdownDoc, stringifyOptions(options)));
    container = mem;
  }

  const doc = markdownToDoc(markdownDoc, { autoTemplates: options.autoTemplates });
  assertDocWithinConversionLimits(doc, options.limits, options.signal);
  const baseName = source.baseName ?? 'document';

  return { input: { doc, markdownDoc, container, baseName }, warnings: [] };
}

async function normalizeDoc(
  source: Extract<ConvertSource, { kind: 'doc' }>,
  options: ConvertOptions,
): Promise<Normalized> {
  assertDocWithinConversionLimits(source.doc, options.limits, options.signal);
  let container = source.container;
  if (!container) {
    const { MemoryContentContainer } = await import('@bendyline/squisq/storage');
    const { docToMarkdown } = await import('@bendyline/squisq/doc');
    const { stringifyMarkdown } = await import('@bendyline/squisq/markdown');
    const mem = new MemoryContentContainer();
    await mem.writeDocument(
      stringifyMarkdown(docToMarkdown(source.doc), stringifyOptions(options)),
    );
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
      return normalizeDoc(source, options);
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

// ── prepare / convert ───────────────────────────────────────────────

/** Normalize and transform a source once, then safely export that snapshot many times. */
export async function prepareConversion(
  source: ConvertSource,
  options: ConvertOptions = {},
): Promise<PreparedConversion> {
  return prepareConversionInternal(source, options);
}

async function prepareConversionInternal(
  source: ConvertSource,
  options: ConvertOptions,
  failureFormat?: FormatId,
): Promise<PreparedConversion> {
  throwIfAborted(options.signal);
  const registry = options.registry ?? defaultRegistry();

  let normalized: Normalized;
  try {
    normalized = await normalize(source, options, registry);
    throwIfAborted(options.signal);
  } catch (err: unknown) {
    throwIfAborted(options.signal);
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
      throwIfAborted(options.signal);
    }
  } catch (err: unknown) {
    throwIfAborted(options.signal);
    if (err instanceof ConversionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ConversionError('conversion-failed', message, {
      format: failureFormat,
      cause: err,
    });
  }

  const preparedWarnings = Object.freeze([...warnings]);
  const preparedInput = { ...input };
  return Object.freeze({
    async convert(to: FormatId, targetOptions: PreparedExportOptions = {}) {
      const target = requireExportTarget(registry, to);
      const exportOptions = mergePreparedExportOptions(options, targetOptions);
      throwIfAborted(exportOptions.signal);
      let result: ConversionResult;
      try {
        result = await target.exportDoc!({ ...preparedInput }, exportOptions);
        throwIfAborted(exportOptions.signal);
      } catch (err: unknown) {
        throwIfAborted(exportOptions.signal);
        if (err instanceof ConversionError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new ConversionError('conversion-failed', message, { format: to, cause: err });
      }

      const ext = target.extensions[0]?.replace(/^\.+/, '') ?? to;
      return {
        ...result,
        suggestedFilename: `${preparedInput.baseName}.${ext}`,
        warnings: [...preparedWarnings, ...result.warnings],
      };
    },
  });
}

function requireExportTarget(registry: FormatRegistry, to: FormatId): FormatDefinition {
  const target = registry.get(to);
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
  return target;
}

function mergePreparedExportOptions(
  prepared: ConvertOptions,
  target: PreparedExportOptions,
): ConvertOptions {
  return {
    ...prepared,
    signal: mergeAbortSignals(prepared.signal, target.signal),
    title: target.title ?? prepared.title,
    resolvePlayerScript: target.resolvePlayerScript ?? prepared.resolvePlayerScript,
    formatOptions:
      target.formatOptions === undefined
        ? prepared.formatOptions
        : { ...(prepared.formatOptions ?? {}), ...target.formatOptions },
  };
}

function mergeAbortSignals(
  preparedSignal?: AbortSignal,
  targetSignal?: AbortSignal,
): AbortSignal | undefined {
  if (!preparedSignal) return targetSignal;
  if (!targetSignal || preparedSignal === targetSignal) return preparedSignal;
  return AbortSignal.any([preparedSignal, targetSignal]);
}

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
  throwIfAborted(options.signal);
  const registry = options.registry ?? defaultRegistry();
  requireExportTarget(registry, to);
  const prepared = await prepareConversionInternal(source, { ...options, registry }, to);
  return prepared.convert(to);
}

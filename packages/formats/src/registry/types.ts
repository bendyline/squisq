/**
 * Format registry — shared types.
 *
 * The registry is the programmatic heart of `convert()`: it maps a small set of
 * format ids (`md`, `docx`, `pdf`, …) to `FormatDefinition`s, each of which
 * knows how to import to / export from squisq's markdown + Doc model. Every
 * converter module is loaded lazily via `import()` inside the definition
 * methods, so pulling in the registry never eagerly bundles heavy converters.
 */

import type { Doc, ThemeRegistry } from '@bendyline/squisq/schemas';
import type { TransformStyleInput, TransformStyleRegistry } from '@bendyline/squisq/transform';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { ParseOptions, StringifyOptions } from '@bendyline/squisq/markdown';
import type { DocxExportOptions } from '../docx/export.js';
import type { DocxImportOptions } from '../docx/import.js';
import type { PptxExportOptions } from '../pptx/export.js';
import type { PptxImportOptions } from '../pptx/import.js';
import type { XlsxExportOptions } from '../xlsx/export.js';
import type { XlsxImportOptions } from '../xlsx/import.js';
import type { CsvExportOptions, CsvImportOptions } from '../csv/index.js';
import type { PdfExportOptions } from '../pdf/export.js';
import type { PdfImportOptions } from '../pdf/import.js';
import type { HtmlExportOptions } from '../html/htmlTemplate.js';
import type { HtmlImportOptions } from '../html/import.js';
import type { EpubExportOptions } from '../epub/export.js';
import type { ContainerToZipOptions } from '../container/index.js';
import type { ZipSafetyLimits } from '../shared/zipSafety.js';
import type { ConversionLimits } from './limits.js';

/** A format identifier (e.g. `'docx'`). Strings so hosts can register their own. */
export type FormatId = string;

/** The built-in formats the default registry ships with. */
export const BUILTIN_FORMAT_IDS = [
  'md',
  'docx',
  'pdf',
  'pptx',
  'xlsx',
  'csv',
  'html',
  'htmlzip',
  'epub',
  'dbk',
] as const;

/** The bytes + metadata produced by a successful export. */
export interface ConversionResult {
  /** Encoded output bytes. */
  bytes: Uint8Array;
  /** MIME type of the output. */
  mimeType: string;
  /** A sensible download filename (`<baseName>.<ext>`). */
  suggestedFilename: string;
  /** Non-fatal notes accumulated during conversion (may be empty). */
  warnings: string[];
}

export interface MarkdownFormatOptions {
  parse?: ParseOptions;
  stringify?: StringifyOptions;
}

/** Resource limits applied when importing a DBK/ZIP container. */
export type DbkFormatOptions = ZipSafetyLimits & ContainerToZipOptions;

/**
 * Strongly typed option bags for built-in formats. Import and export options
 * share a bag because a single conversion may use the format on either side.
 * Custom registries may add arbitrary keys through the intersection used by
 * {@link ConvertOptions.formatOptions}.
 */
export interface BuiltinFormatOptions {
  md: MarkdownFormatOptions;
  docx: DocxImportOptions & DocxExportOptions;
  pptx: PptxImportOptions & PptxExportOptions;
  xlsx: XlsxImportOptions & XlsxExportOptions;
  csv: CsvImportOptions & CsvExportOptions;
  pdf: PdfImportOptions & PdfExportOptions;
  html: HtmlImportOptions & Partial<Omit<HtmlExportOptions, 'playerScript'>>;
  htmlzip: Partial<Omit<HtmlExportOptions, 'playerScript'>>;
  epub: EpubExportOptions;
  dbk: DbkFormatOptions;
}

/**
 * A source normalized into every shape an exporter might need. `doc` is always
 * present; `markdownDoc` is present when the source was markdown-shaped (an
 * exporter that wants markdown but finds none derives it from `doc`).
 */
export interface NormalizedInput {
  doc: Doc;
  markdownDoc?: MarkdownDocument;
  container: ContentContainer;
  baseName: string;
}

/** Options threaded through `convert()` and into every format method. */
export interface ConvertOptions {
  /** Cancel normalization, transformation, or export at the next bounded work boundary. */
  signal?: AbortSignal;
  /** Cross-format safety limits. Pass false only for explicitly trusted input. */
  limits?: Partial<ConversionLimits> | false;
  /** Registry to resolve formats against. Defaults to `defaultRegistry()`. */
  registry?: FormatRegistry;
  /** Explicit source format id (skips extension/byte sniffing). */
  from?: FormatId;
  /** Theme id to apply to the exported document. */
  themeId?: string;
  /** Explicit caller-owned registry for non-document custom themes. */
  themeRegistry?: ThemeRegistry;
  /** Built-in/registry id or call-scoped style to apply before export. */
  transformStyle?: TransformStyleInput;
  /** Explicit caller-owned registry used to resolve transform style ids. */
  transformRegistry?: TransformStyleRegistry;
  /** Content-aware auto-templating when deriving a Doc from markdown. */
  autoTemplates?: boolean;
  /** Title hint for exporters that expose document metadata. */
  title?: string;
  /** Lazily resolve the standalone player IIFE bundle (required for HTML export). */
  resolvePlayerScript?: () => Promise<string>;
  /** Typed per-format options for built-ins; custom format ids remain extensible. */
  formatOptions?: Partial<BuiltinFormatOptions> & Record<FormatId, unknown>;
}

/** Target-only options accepted after a source has already been normalized and transformed. */
export type PreparedExportOptions = Pick<
  ConvertOptions,
  'signal' | 'title' | 'resolvePlayerScript' | 'formatOptions'
>;

/**
 * An opaque normalized conversion snapshot. The source and transform pipeline
 * has already completed; each call exports that same snapshot to one target.
 */
export interface PreparedConversion {
  convert(to: FormatId, options?: PreparedExportOptions): Promise<ConversionResult>;
}

/**
 * How a format's exporter treats Squisq template annotations: `rendered`
 * materializes template visuals into the output, `preserved` keeps annotations
 * intact for round-tripping, and `ignored` flattens blocks to semantic content
 * so annotations have no effect on the exported result.
 */
export type TemplateAnnotationHandling = 'rendered' | 'preserved' | 'ignored';

/** Describes how a single format imports to / exports from the squisq model. */
export interface FormatDefinition {
  id: FormatId;
  label: string;
  mimeType: string;
  extensions: readonly string[];
  /** Exporter treatment of template annotations. Absent means unspecified. */
  templateAnnotationHandling?: TemplateAnnotationHandling;
  /** Import raw bytes to a MarkdownDocument. */
  importDoc?(data: ArrayBuffer, options: ConvertOptions): Promise<MarkdownDocument>;
  /** Import raw bytes to a ContentContainer (markdown + extracted media). */
  importContainer?(data: ArrayBuffer, options: ConvertOptions): Promise<ContentContainer>;
  /** Export a normalized input to bytes. */
  exportDoc?(input: NormalizedInput, options: ConvertOptions): Promise<ConversionResult>;
}

/** A mutable collection of format definitions keyed by id. */
export interface FormatRegistry {
  register(def: FormatDefinition): void;
  get(id: FormatId): FormatDefinition | undefined;
  byExtension(ext: string): FormatDefinition | undefined;
  list(): FormatDefinition[];
}

/** The three shapes `convert()` accepts as a source. */
export type ConvertSource =
  | { kind: 'bytes'; data: ArrayBuffer | Uint8Array; filename?: string }
  | {
      kind: 'markdown';
      markdown: string | MarkdownDocument;
      container?: ContentContainer;
      baseName?: string;
    }
  | { kind: 'doc'; doc: Doc; container?: ContentContainer; baseName?: string };

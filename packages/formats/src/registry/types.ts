/**
 * Format registry — shared types.
 *
 * The registry is the programmatic heart of `convert()`: it maps a small set of
 * format ids (`md`, `docx`, `pdf`, …) to `FormatDefinition`s, each of which
 * knows how to import to / export from squisq's markdown + Doc model. Every
 * converter module is loaded lazily via `import()` inside the definition
 * methods, so pulling in the registry never eagerly bundles heavy converters.
 */

import type { Doc } from '@bendyline/squisq/schemas';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { ContentContainer } from '@bendyline/squisq/storage';

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
  /** Registry to resolve formats against. Defaults to `defaultRegistry()`. */
  registry?: FormatRegistry;
  /** Explicit source format id (skips extension/byte sniffing). */
  from?: FormatId;
  /** Theme id to apply to the exported document. */
  themeId?: string;
  /** Transform style id to apply before export. */
  transformStyle?: string;
  /** Content-aware auto-templating when deriving a Doc from markdown. */
  autoTemplates?: boolean;
  /** Title hint for exporters that support one (epub, html). */
  title?: string;
  /** Lazily resolve the standalone player IIFE bundle (required for HTML export). */
  resolvePlayerScript?: () => Promise<string>;
  /** Per-format escape hatch for extra options. */
  formatOptions?: Record<FormatId, Record<string, unknown>>;
}

/** Describes how a single format imports to / exports from the squisq model. */
export interface FormatDefinition {
  id: FormatId;
  label: string;
  mimeType: string;
  extensions: readonly string[];
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

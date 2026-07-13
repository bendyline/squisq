/**
 * @bendyline/squisq-formats Infer Module
 *
 * "Infer theme and layouts from a file import": read the OOXML theme
 * (colors + fonts) out of a DOCX/PPTX/XLSX file and compile it into a
 * Squisq `Theme`; for PPTX, optionally derive custom layout templates
 * from the deck's slide layouts/masters.
 *
 * Consumers:
 *   - the editor's theme customizer surfaces (upload / drag-drop a file)
 *   - the PPTX importer (theme + layouts ride along as frontmatter)
 *
 * PDF is deliberately unsupported: PDF files carry no theme tables, so
 * inference would produce a mostly-default theme. `inferThemeFromFile`
 * rejects PDF bytes with a clear `ConversionError`.
 */

import type { CustomTemplateDefinition, Theme } from '@bendyline/squisq/schemas';
import { openPackage, throwIfOoxmlAborted } from '../ooxml/reader.js';
import type { OoxmlOpenOptions } from '../ooxml/reader.js';
import type { OoxmlPackage } from '../ooxml/types.js';
import { ConversionError } from '../registry/errors.js';
import type { ExtractedFileTheme, InferSourceFormat } from './types.js';
import { extractDocxTheme, extractPptxTheme, extractXlsxTheme } from './extract.js';
import { colorHintsFromExtraction, compileExtractedTheme } from './mapTheme.js';

export type { ExtractedFileTheme, InferSourceFormat, SchemeSlot } from './types.js';
export { extractDocxTheme, extractPptxTheme, extractXlsxTheme } from './extract.js';
export type { CompileExtractedOptions, MappedThemePartial } from './mapTheme.js';
export {
  colorHintsFromExtraction,
  compileExtractedTheme,
  extractedThemeToPartial,
} from './mapTheme.js';

export interface InferThemeOptions extends OoxmlOpenOptions {
  /** Skip sniffing when the caller already knows the format (e.g. from the extension). */
  format?: InferSourceFormat;
  /** PPTX only: also derive custom layout templates from slide layouts/masters. */
  inferLayouts?: boolean;
  /** Preferred display name for the compiled theme (e.g. the file's basename). */
  nameHint?: string;
}

export interface InferredFileTheme {
  /** Compiled, validated Squisq theme (`custom-<slug>` id, seeds recorded). */
  theme: Theme;
  /** Raw extraction, for callers mapping into their own editing model. */
  extraction: ExtractedFileTheme;
  /** Present only for PPTX with `inferLayouts` and ≥1 non-redundant layout. */
  layouts?: CustomTemplateDefinition[];
  /** Non-fatal notes: sysClr fallbacks, dropped accents, skipped layouts, … */
  warnings: string[];
}

async function looksLikePdf(data: ArrayBuffer | Blob, signal?: AbortSignal): Promise<boolean> {
  throwIfOoxmlAborted(signal);
  // Duck-typed (not instanceof): buffers routinely cross realms in test
  // environments and web workers. Blobs carry `size`; ArrayBuffers carry
  // `byteLength`.
  let head: Uint8Array | null = null;
  const blob = data as Blob;
  if (
    typeof blob.size === 'number' &&
    typeof blob.slice === 'function' &&
    typeof blob.arrayBuffer === 'function'
  ) {
    head = new Uint8Array(await waitForAbortable(blob.slice(0, 5).arrayBuffer(), signal));
  } else if (typeof (data as ArrayBuffer).byteLength === 'number') {
    const buf = data as ArrayBuffer;
    head = new Uint8Array(buf, 0, Math.min(5, buf.byteLength));
  }
  throwIfOoxmlAborted(signal);
  if (!head || head.length < 4) return false;
  // '%PDF'
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

function waitForAbortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfOoxmlAborted(signal);
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      complete();
    };
    const handleAbort = (): void =>
      finish(() => reject(signal.reason ?? new Error('OOXML operation was cancelled')));
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/**
 * Classify an opened package from its already-parsed content types.
 * (Deliberately not the registry's byte sniffer — that re-parses the zip
 * and carries `dbk` semantics this path doesn't want.)
 */
function sniffOoxmlFormat(pkg: OoxmlPackage): InferSourceFormat | undefined {
  const values = [...pkg.contentTypes.overrides.values(), ...pkg.contentTypes.defaults.values()];
  for (const ct of values) {
    if (ct.includes('wordprocessingml')) return 'docx';
    if (ct.includes('presentationml')) return 'pptx';
    if (ct.includes('spreadsheetml')) return 'xlsx';
  }
  return undefined;
}

const EXTRACTORS: Record<
  InferSourceFormat,
  (pkg: OoxmlPackage) => Promise<ExtractedFileTheme | null>
> = {
  docx: extractDocxTheme,
  pptx: extractPptxTheme,
  xlsx: extractXlsxTheme,
};

/**
 * Infer a Squisq theme (and, for PPTX, optionally custom layout templates)
 * from an office file's bytes.
 *
 * Throws `ConversionError`:
 *   - `unsupported-input` for PDF bytes (no theme tables to read)
 *   - `invalid-input` for non-OOXML data or files with no theme part
 */
export async function inferThemeFromFile(
  data: ArrayBuffer | Blob,
  options: InferThemeOptions = {},
): Promise<InferredFileTheme> {
  throwIfOoxmlAborted(options.signal);
  if (await looksLikePdf(data, options.signal)) {
    throw new ConversionError(
      'unsupported-input',
      'PDF theme inference is not supported — PDF files carry no theme color/font tables.',
      { format: 'pdf' },
    );
  }

  let pkg: OoxmlPackage;
  try {
    pkg = await openPackage(data, options);
  } catch (err: unknown) {
    if (options.signal?.aborted) throw options.signal.reason ?? err;
    throw new ConversionError(
      'invalid-input',
      'Could not read this file as a Word, PowerPoint, or Excel document.',
      { cause: err },
    );
  }

  const format = options.format ?? sniffOoxmlFormat(pkg);
  throwIfOoxmlAborted(options.signal);
  if (!format) {
    throw new ConversionError(
      'invalid-input',
      'Not a Word, PowerPoint, or Excel document — no theme to infer.',
    );
  }

  const extraction = await EXTRACTORS[format](pkg);
  throwIfOoxmlAborted(options.signal);
  if (!extraction) {
    throw new ConversionError('invalid-input', 'No theme part found in this file.', { format });
  }

  const { theme, warnings: mapWarnings } = compileExtractedTheme(extraction, {
    nameHint: options.nameHint,
  });
  throwIfOoxmlAborted(options.signal);
  const warnings = [...extraction.warnings, ...mapWarnings];

  let layouts: CustomTemplateDefinition[] | undefined;
  if (options.inferLayouts) {
    if (format !== 'pptx') {
      warnings.push('Layout inference is only available for PowerPoint files; skipped.');
    } else {
      const { analyzePptxLayouts } = await import('../pptx/layouts.js');
      const analysis = await analyzePptxLayouts(pkg, {
        colors: colorHintsFromExtraction(extraction),
        signal: options.signal,
      });
      warnings.push(...analysis.warnings);
      const defs = analysis.layouts
        .map((l) => (l.verdict.kind === 'custom' ? l.verdict.def : null))
        .filter((d): d is CustomTemplateDefinition => d !== null);
      if (defs.length > 0) layouts = defs;
    }
  }

  throwIfOoxmlAborted(options.signal);
  return { theme, extraction, ...(layouts ? { layouts } : {}), warnings };
}

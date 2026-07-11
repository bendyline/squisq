/**
 * Format registry + programmatic `convert()` — @bendyline/squisq-formats/registry
 *
 * A small registry maps format ids (`md`, `docx`, `pdf`, `pptx`, `xlsx`, `csv`,
 * `html`, `htmlzip`, `epub`, `dbk`) to `FormatDefinition`s that know how to
 * import to / export from squisq's markdown + Doc model. `convert()` is the
 * front door: give it a source and a target format id and it returns the
 * encoded bytes plus a suggested filename.
 *
 * @example
 * ```ts
 * import { convert } from '@bendyline/squisq-formats/registry';
 *
 * const result = await convert(
 *   { kind: 'markdown', markdown: '# Hello', baseName: 'greeting' },
 *   'docx',
 * );
 * // result.bytes, result.mimeType, result.suggestedFilename ('greeting.docx')
 * ```
 */

export type {
  FormatId,
  ConversionResult,
  NormalizedInput,
  ConvertOptions,
  FormatDefinition,
  FormatRegistry,
  ConvertSource,
  BuiltinFormatOptions,
  MarkdownFormatOptions,
  DbkFormatOptions,
} from './types.js';
export { BUILTIN_FORMAT_IDS } from './types.js';

export { ConversionError } from './errors.js';
export type { ConversionErrorCode, ConversionErrorOptions } from './errors.js';

export { createRegistry, defaultRegistry } from './registry.js';
export { defaultFormats } from './defaultFormats.js';
export { convert } from './convert.js';

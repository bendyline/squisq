/**
 * Structured error for the format registry / `convert()` pipeline.
 *
 * Every failure path in the registry throws a `ConversionError` with a stable
 * machine-readable `code`, so callers can branch on the failure kind rather
 * than string-matching messages.
 */

import type { FormatId } from './types.js';

/** Machine-readable failure kinds surfaced by the registry / `convert()`. */
export type ConversionErrorCode =
  | 'unknown-format'
  | 'unsupported-input'
  | 'unsupported-output'
  | 'invalid-input'
  | 'missing-dependency'
  | 'conversion-failed';

/** Options for constructing a {@link ConversionError}. */
export interface ConversionErrorOptions {
  /** The format id the error relates to, if any. */
  format?: FormatId;
  /** A human-oriented remediation hint. */
  hint?: string;
  /** The underlying error, preserved on `error.cause`. */
  cause?: unknown;
}

/** An error raised by the format registry or `convert()`. */
export class ConversionError extends Error {
  readonly code: ConversionErrorCode;
  readonly format?: FormatId;
  readonly hint?: string;

  constructor(code: ConversionErrorCode, message: string, opts: ConversionErrorOptions = {}) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    this.format = opts.format;
    this.hint = opts.hint;
    if (opts.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

/**
 * Protected-span masking for proofing.
 *
 * Squisq markdown carries `{[…]}` annotations (block templates, inline
 * icons, media directives) whose contents are machine vocabulary, not
 * prose — a grammar engine flags `src`/`webm`/template ids as spelling
 * errors. The engine's own masking option is unusable (inclusion-mask
 * semantics and silent failure on an invalid pattern), so we blank the
 * spans ourselves: replace each annotation with an equal-length run of
 * spaces — every surrounding offset stays byte-identical — and afterwards
 * drop any finding that intersects a blanked range (which also swallows
 * the whitespace-formatting lints the blank runs themselves can induce).
 */

import type { ProofRange } from './types.js';

/**
 * One `{[…]}` annotation, bounded to a single line. The body match is
 * lazy and terminates at the first `]}`, so a `]` inside a quoted param
 * (`alt="a [bracketed] caption"`) stays inside the span.
 */
const ANNOTATION_RE = /\{\[[^\n]*?\]\}/g;

export interface BlankedText {
  /** Input with every protected span replaced by spaces; same length. */
  text: string;
  /** The replaced ranges, in ascending order. */
  blanked: ProofRange[];
}

/** Blank `{[…]}` annotation spans to equal-length spaces. */
export function blankProtectedSpans(text: string): BlankedText {
  const blanked: ProofRange[] = [];
  const out = text.replace(ANNOTATION_RE, (match, offset: number) => {
    blanked.push({ start: offset, end: offset + match.length });
    return ' '.repeat(match.length);
  });
  return { text: out, blanked };
}

/** Keep only findings whose span does not intersect any blanked range. */
export function dropMaskedFindings<T extends ProofRange>(
  findings: readonly T[],
  blanked: readonly ProofRange[],
): T[] {
  if (blanked.length === 0) return [...findings];
  return findings.filter(
    (finding) => !blanked.some((range) => finding.start < range.end && finding.end > range.start),
  );
}

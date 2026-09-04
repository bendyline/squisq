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
 *
 * MARKDOWN SOURCE carries a second family of machine vocabulary: code.
 * A fence is a program, and an inline span is an identifier or a signature
 * (``raycast(origin, dir, maxDist)`` draws a spelling lint on every one of
 * those words), so `markdownCode` blanks both. It is off by default because
 * it is only meaningful for source text: the Write view lints the editor's
 * PLAIN TEXT, where code is a ProseMirror mark with no backticks to find
 * (`writeViewText.ts` blanks it during collection instead). Newlines are
 * never blanked, so a line/column mapping over the result stays exact.
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

export interface BlankProtectedSpansOptions {
  /**
   * Also blank markdown code: fenced blocks (delimiters and info string
   * included) and inline code spans. Only correct for markdown SOURCE text.
   */
  markdownCode?: boolean;
}

/**
 * Blank protected spans to equal-length runs of spaces: `{[…]}` annotations
 * always, and markdown code when `markdownCode` is set.
 */
export function blankProtectedSpans(
  text: string,
  options: BlankProtectedSpansOptions = {},
): BlankedText {
  const ranges: ProofRange[] = [];
  ANNOTATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANNOTATION_RE.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  if (options.markdownCode) ranges.push(...markdownCodeRanges(text));
  if (ranges.length === 0) return { text, blanked: [] };

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  // A `{[…]}` annotation inside a fence yields two overlapping ranges;
  // merging keeps `blanked` a clean ascending, non-overlapping list.
  const blanked: ProofRange[] = [];
  for (const range of ranges) {
    const last = blanked[blanked.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else blanked.push({ ...range });
  }

  // Sliced rather than indexed by code point, so an astral character stays
  // two UTF-16 units wide and every later offset survives. Newlines survive
  // too: blanking one would shift every later line.
  let out = '';
  let cursor = 0;
  for (const range of blanked) {
    out += text.slice(cursor, range.start);
    out += text.slice(range.start, range.end).replace(/[^\n]/g, ' ');
    cursor = range.end;
  }
  out += text.slice(cursor);
  return { text: out, blanked };
}

/**
 * Every markdown code range in `text`: fenced blocks first, then the inline
 * spans in what is left over.
 */
function markdownCodeRanges(text: string): ProofRange[] {
  const fences = fencedCodeRanges(text);
  const ranges = [...fences];
  let cursor = 0;
  for (const fence of fences) {
    collectInlineCodeRanges(text, cursor, fence.start, ranges);
    cursor = fence.end;
  }
  collectInlineCodeRanges(text, cursor, text.length, ranges);
  return ranges;
}

/** A fence line: up to three spaces of indent, then a run of ``` or ~~~. */
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Fenced code blocks, delimiters and info string included. An unclosed fence
 * runs to the end of the document, which is what CommonMark says it does.
 */
function fencedCodeRanges(text: string): ProofRange[] {
  const ranges: ProofRange[] = [];
  let lineStart = 0;
  let open: { start: number; marker: string } | null = null;
  for (;;) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const match = FENCE_RE.exec(text.slice(lineStart, lineEnd));
    if (!open) {
      if (match) open = { start: lineStart, marker: match[2] };
    } else if (
      match &&
      // A closing fence is the same character, at least as long, and bare.
      match[2][0] === open.marker[0] &&
      match[2].length >= open.marker.length &&
      match[3].trim() === ''
    ) {
      ranges.push({ start: open.start, end: lineEnd });
      open = null;
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  if (open) ranges.push({ start: open.start, end: text.length });
  return ranges;
}

/**
 * Inline code spans in `text[from, to)`, delimiters included. Follows the
 * CommonMark rule that a closing backtick run must be EXACTLY as long as the
 * opener, so a run of a different length is literal content. A span may cross
 * a soft line break but not a blank line, and an opener that never closes is
 * a literal backtick that blanks nothing.
 */
function collectInlineCodeRanges(text: string, from: number, to: number, out: ProofRange[]): void {
  let i = from;
  let openStart = -1;
  let openLength = 0;
  while (i < to) {
    if (text[i] === '`') {
      let run = 1;
      while (i + run < to && text[i + run] === '`') run++;
      if (openStart < 0) {
        openStart = i;
        openLength = run;
      } else if (run === openLength) {
        out.push({ start: openStart, end: i + run });
        openStart = -1;
        openLength = 0;
      }
      i += run;
      continue;
    }
    if (openStart >= 0 && text[i] === '\n' && startsBlankLine(text, i + 1, to)) {
      openStart = -1;
      openLength = 0;
    }
    i++;
  }
}

/** Whether the line beginning at `index` is blank (or the region ends there). */
function startsBlankLine(text: string, index: number, to: number): boolean {
  let i = index;
  while (i < to && (text[i] === ' ' || text[i] === '\t')) i++;
  return i >= to || text[i] === '\n';
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

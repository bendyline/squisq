/**
 * Markdown source transforms
 *
 * One-time, whole-document transforms over markdown SOURCE TEXT (not the
 * AST): unwrap forced line wrapping, wrap prose at a column width, and
 * canonical cleanup — plus detection of a document's prevailing wrap
 * convention. A shared registry drives both the editor's Transform menu and
 * the `squisq transform` CLI command.
 *
 * Wrap and unwrap rewrite ONLY paragraph prose, located by source position:
 * headings, tables, code fences, math, HTML blocks, frontmatter, and link
 * definitions stay byte-identical. Every transform reparses its output and
 * structurally compares it against the input document; on any mismatch it
 * returns the input unchanged (or throws in `strict` mode) rather than risk
 * corrupting a document — the same verify-before-commit contract the ASCII
 * diagram editor uses.
 *
 * Distinct from `@bendyline/squisq/transform` (the slideshow style
 * pipeline): these transforms rewrite markdown text, not docs.
 */

import { parseMarkdown } from './parse.js';
import { stringifyMarkdown } from './stringify.js';
import { getChildren, splitFrontmatterBlock } from './utils.js';
import type { MarkdownDocument, MarkdownNode, MarkdownParagraph } from './types.js';

// ============================================
// Public types
// ============================================

export type MarkdownSourceTransformId = 'unwrap' | 'wrap' | 'cleanup';

export interface MarkdownSourceTransformOptions {
  /** Target column for `wrap` (clamped to 20–500). Default {@link DEFAULT_WRAP_WIDTH}. */
  width?: number;
  /**
   * Throw instead of degrading when the transformed output fails the
   * structural-equivalence check. The editor uses the default (degrade to a
   * no-op + `console.warn`); the CLI and tests run strict.
   */
  strict?: boolean;
}

/** A single source rewrite: replace `[start, end)` with `text`. */
export interface MarkdownSourceEdit {
  start: number;
  end: number;
  text: string;
}

export interface MarkdownSourceTransformResult {
  /** The transformed source (=== the input when `changed` is false). */
  output: string;
  /** True when the transform produced a different source. */
  changed: boolean;
  /**
   * True when the safety net fired: the transform DID produce edits, but the
   * result no longer parsed to an equivalent document, so the input was
   * returned unchanged. Distinct from a genuine no-op (`changed: false,
   * degraded: false`).
   */
  degraded: boolean;
  /**
   * The minimal edits that turn the input into `output`, in DESCENDING
   * `start` order so they can be applied top-of-stack first (offsets stay
   * valid). Present for `unwrap`/`wrap` (one edit per touched paragraph) and
   * `cleanup` (one whole-document edit); empty when nothing changed.
   */
  edits: MarkdownSourceEdit[];
}

export interface MarkdownSourceTransform {
  id: MarkdownSourceTransformId;
  /** Short human label for menus. */
  label: string;
  /** One-line description for menus/help. */
  description: string;
  apply(source: string, options?: MarkdownSourceTransformOptions): MarkdownSourceTransformResult;
}

/** The prevailing wrap convention of a document's paragraph prose. */
export interface MarkdownWrapState {
  /**
   * - `wrapped`: a clear majority of paragraphs that would need wrapping are
   *   hard-wrapped; `width` carries the detected column.
   * - `unwrapped`: paragraph prose is single-line.
   * - `mixed`: contradictory evidence — consumers should leave the doc alone.
   * - `no-prose`: nothing to judge (no paragraphs).
   */
  kind: 'unwrapped' | 'wrapped' | 'mixed' | 'no-prose';
  /** Detected wrap column (present when `kind` is `wrapped`). */
  width?: number;
  totalParagraphs: number;
  wrappedParagraphs: number;
  /** Longest physical line observed across paragraph prose. */
  maxLineLength: number;
}

export const DEFAULT_WRAP_WIDTH = 80;

const MIN_WRAP_WIDTH = 20;
const MAX_WRAP_WIDTH = 500;

/** Common author conventions `detectMarkdownWrapState` snaps to. */
const COMMON_WRAP_WIDTHS = [60, 72, 80, 100, 120];
const WIDTH_SNAP_TOLERANCE = 8;
/**
 * A candidate below this is inconclusive (`mixed`), never `wrapped`: a couple
 * of short soft-wrapped lines is not a convention, and auto-consumers
 * re-wrapping a whole document at a tiny width would be destructive.
 */
const MIN_DETECTED_WRAP_WIDTH = 40;

// ============================================
// Paragraph analysis (shared by wrap/unwrap/detect)
// ============================================

interface Span {
  start: number;
  end: number;
}

interface ParagraphInfo {
  node: MarkdownParagraph;
  /** Offset of the paragraph's first content character. */
  start: number;
  /** Offset just past the paragraph's last character. */
  end: number;
  /** Source bytes from the physical line start to `start` (marker + indent). */
  firstLinePrefix: string;
  /** `firstLinePrefix` with every char except `>`/tab replaced by a space. */
  continuationPrefix: string;
  /** Hard-break marker spans (`"  \n"` / `"\\\n"`, CRLF included), ascending. */
  breakSpans: Span[];
  /**
   * Spans whose bytes are copied verbatim and never joined or broken:
   * inline code/math, inline HTML, images, link resource segments (URL +
   * title). Merged + ascending.
   */
  immovableSpans: Span[];
  /**
   * Spans that additionally must never contain an inserted line break
   * (mentions, text directives, `{[…]}` annotation/icon spans). Superset of
   * `immovableSpans` semantics for wrap; merged + ascending.
   */
  unbreakableSpans: Span[];
}

/**
 * The paragraph's marker prefix must look like ordinary container syntax
 * (quotes, list markers, task checkboxes, footnote labels). Anything else
 * means our geometric assumptions are off — skip the paragraph entirely.
 */
const SANE_PREFIX_RE =
  /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*(?:\[\^[^\]]+\]:[ \t]+)?(?:\[[ xX]\][ \t]+)?$/;

/** Container prefix at the start of a paragraph continuation line. */
const CONTINUATION_PREFIX_RE = /^[ \t]*(?:>[ \t]*)*/;

/**
 * A single-line `{[…]}` template-annotation / inline-icon span, mirroring
 * the quoted-run-aware grammar in stringify.ts (a quoted `]` does not end
 * the span). Kept single-line: a span already broken across lines is
 * something unwrap should be allowed to heal.
 */
const ANNOTATION_SPAN_RE =
  /\{\[(?:"(?:[^"\\\n]|\\[^\n])*"|'(?:[^'\\\n]|\\[^\n])*'|\\[^\n]|[^\]\\\n])*\]\}/g;

function nodeSpan(node: MarkdownNode): Span | null {
  const position = node.position;
  if (!position || position.start.offset == null || position.end.offset == null) return null;
  return { start: position.start.offset, end: position.end.offset };
}

/** Merge overlapping/adjacent spans into an ascending, disjoint list. */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** Clip a span to the paragraph range; null when nothing remains. */
function clipSpan(span: Span, start: number, end: number): Span | null {
  const s = Math.max(span.start, start);
  const e = Math.min(span.end, end);
  return s < e ? { start: s, end: e } : null;
}

function collectInlineSpans(
  source: string,
  paragraph: MarkdownParagraph,
  info: ParagraphInfo,
): void {
  const immovable: Span[] = [];
  const unbreakable: Span[] = [];

  const visit = (node: MarkdownNode): void => {
    const span = nodeSpan(node);
    switch (node.type) {
      case 'break':
        if (span) info.breakSpans.push(span);
        return;
      case 'inlineCode':
      case 'inlineMath':
      case 'htmlInline':
      case 'image':
        if (span) immovable.push(span);
        return;
      case 'link': {
        // The resource segment — `](url "title")` — must not be reflowed
        // (a URL cannot contain a line break; retitling would alter data).
        // Link TEXT (the children region) wraps freely.
        if (span) {
          const children = getChildren(node);
          let segStart = span.start;
          for (const child of children) {
            const childSpan = nodeSpan(child);
            if (childSpan) segStart = Math.max(segStart, childSpan.end);
          }
          if (segStart < span.end) immovable.push({ start: segStart, end: span.end });
        }
        break; // still visit children (nested emphasis etc.)
      }
      case 'mention': {
        // coalesceMentions gives the mention the link's span; the `@` sits
        // one char before it. Display names may contain spaces — atomic.
        if (span) {
          const start =
            span.start > 0 && source[span.start - 1] === '@' ? span.start - 1 : span.start;
          unbreakable.push({ start, end: span.end });
        }
        return;
      }
      case 'textDirective':
        // Attributes may contain quoted spaces; rare in prose — atomic.
        if (span) unbreakable.push(span);
        return;
      case 'inlineIcon':
        // Icon-split text nodes share their parent's position (unreliable);
        // the ANNOTATION_SPAN_RE pass below protects `{[…]}` tokens instead.
        return;
      default:
        break;
    }
    for (const child of getChildren(node)) visit(child);
  };
  for (const child of getChildren(paragraph)) visit(child);

  // `{[…]}` spans by text scan (annotations, icons, unresolved literals).
  const slice = source.slice(info.start, info.end);
  ANNOTATION_SPAN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANNOTATION_SPAN_RE.exec(slice)) !== null) {
    unbreakable.push({
      start: info.start + match.index,
      end: info.start + match.index + match[0].length,
    });
  }

  const clippedImmovable: Span[] = [];
  for (const span of immovable) {
    const clipped = clipSpan(span, info.start, info.end);
    if (clipped) clippedImmovable.push(clipped);
  }
  const clippedUnbreakable: Span[] = [...clippedImmovable];
  for (const span of unbreakable) {
    const clipped = clipSpan(span, info.start, info.end);
    if (clipped) clippedUnbreakable.push(clipped);
  }

  info.immovableSpans = mergeSpans(clippedImmovable);
  info.unbreakableSpans = mergeSpans(clippedUnbreakable);
}

/** Collect every paragraph with trustworthy geometry, in document order. */
function analyzeParagraphs(source: string, doc: MarkdownDocument): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];

  const walk = (node: MarkdownNode): void => {
    if (node.type === 'paragraph') {
      const span = nodeSpan(node);
      if (span) {
        const lineStart = source.lastIndexOf('\n', span.start - 1) + 1;
        const firstLinePrefix = source.slice(lineStart, span.start);
        if (SANE_PREFIX_RE.test(firstLinePrefix)) {
          const info: ParagraphInfo = {
            node,
            start: span.start,
            end: span.end,
            firstLinePrefix,
            continuationPrefix: firstLinePrefix.replace(/[^>\t]/g, ' '),
            breakSpans: [],
            immovableSpans: [],
            unbreakableSpans: [],
          };
          collectInlineSpans(source, node, info);
          info.breakSpans.sort((a, b) => a.start - b.start);
          paragraphs.push(info);
        }
      }
      return; // paragraphs never nest
    }
    for (const child of getChildren(node)) walk(child);
  };
  walk(doc);
  return paragraphs;
}

/** Dominant line ending of the document, used for inserted newlines. */
function dominantEol(source: string): string {
  const crlf = (source.match(/\r\n/g) ?? []).length;
  const lf = (source.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

// ============================================
// Tokenization (segments of atomic tokens)
// ============================================

interface Token {
  text: string;
  /** Contains a verbatim internal newline (multi-line immovable span). */
  multiline: boolean;
}

/** A run of tokens between hard breaks. */
interface Segment {
  /** Verbatim hard-break marker bytes (incl. EOL) that PRECEDE this segment; '' for the first. */
  markerBefore: string;
  tokens: Token[];
}

function spanAt(spans: Span[], offset: number): Span | null {
  for (const span of spans) {
    if (offset < span.start) return null;
    if (offset < span.end) return span;
  }
  return null;
}

/**
 * Scan a paragraph into hard-break-separated segments of atomic tokens.
 * Token boundaries are whitespace runs and soft line breaks OUTSIDE
 * unbreakable spans; unbreakable/immovable bytes are copied verbatim into
 * the current token (so `` `a b` `` or a `{[…]}` span glues to any abutting
 * punctuation as one token).
 */
function tokenizeParagraph(source: string, info: ParagraphInfo): Segment[] {
  const segments: Segment[] = [{ markerBefore: '', tokens: [] }];
  let current = '';
  let currentMultiline = false;
  let i = info.start;

  const flushToken = (): void => {
    if (current.length > 0) {
      segments[segments.length - 1].tokens.push({ text: current, multiline: currentMultiline });
      current = '';
      currentMultiline = false;
    }
  };
  const consumeContinuationPrefix = (): void => {
    const rest = source.slice(i, info.end);
    const match = CONTINUATION_PREFIX_RE.exec(rest);
    if (match) i += match[0].length;
  };

  while (i < info.end) {
    const breakSpan = spanAt(info.breakSpans, i);
    if (breakSpan && breakSpan.start === i) {
      flushToken();
      segments.push({ markerBefore: source.slice(breakSpan.start, breakSpan.end), tokens: [] });
      i = breakSpan.end;
      consumeContinuationPrefix();
      continue;
    }
    const atom = spanAt(info.unbreakableSpans, i);
    if (atom && atom.start === i) {
      const bytes = source.slice(atom.start, Math.min(atom.end, info.end));
      current += bytes;
      if (bytes.includes('\n')) currentMultiline = true;
      i = Math.min(atom.end, info.end);
      continue;
    }
    const ch = source[i];
    if (ch === '\n' || (ch === '\r' && source[i + 1] === '\n')) {
      // Soft line break → token boundary; swallow the container prefix.
      flushToken();
      i += ch === '\r' ? 2 : 1;
      consumeContinuationPrefix();
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      flushToken();
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  flushToken();
  return segments;
}

// ============================================
// Reflow (unwrap + wrap)
// ============================================

/** Continuation-line starts that would be read as new block syntax. */
const FORBIDDEN_LINE_START_RES = [
  /^[-+*](?:[ \t]|$)/, // bullet list
  /^\d{1,9}[.)](?:[ \t]|$)/, // ordered list (all numbers — belt and braces)
  /^#{1,6}(?:[ \t]|$)/, // ATX heading
  /^>/, // blockquote
  /^\|/, // table row
  /^(?:`{3,}|~{3,})/, // code fence
  /^\$\$/, // math flow
  /^::/, // leaf/container directive
  /^\[\^[^\]]*\]:/, // footnote definition
  /^<[a-zA-Z!/?]/, // HTML block types 1–6
];

/** Whole lines that would be read as setext underlines / breaks / delimiters. */
const FORBIDDEN_WHOLE_LINE_RES = [
  /^=+[ \t]*$/, // setext H1
  /^-+[ \t]*$/, // setext H2 / thematic break
  /^([*_-])(?:[ \t]*\1){2,}[ \t]*$/, // thematic break, spaced forms included
  /^[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/, // GFM table delimiter row
];

function isForbiddenLineStart(line: string): boolean {
  return (
    FORBIDDEN_LINE_START_RES.some((re) => re.test(line)) ||
    FORBIDDEN_WHOLE_LINE_RES.some((re) => re.test(line))
  );
}

function firstLineLength(token: Token): number {
  const idx = token.text.indexOf('\n');
  return idx === -1 ? token.text.length : idx;
}

function lastLineLength(token: Token): number {
  const idx = token.text.lastIndexOf('\n');
  return idx === -1 ? token.text.length : token.text.length - idx - 1;
}

/** Greedy-fill one segment's tokens into lines at `width`. */
function fillSegment(
  tokens: Token[],
  width: number,
  firstLinePrefixLen: number,
  continuationPrefixLen: number,
): Token[][] {
  const lines: Token[][] = [[]];
  let column = firstLinePrefixLen;

  for (const token of tokens) {
    const line = lines[lines.length - 1];
    const addition = (line.length > 0 ? 1 : 0) + firstLineLength(token);
    if (line.length > 0 && column + addition > width) {
      lines.push([token]);
      column = continuationPrefixLen + lastLineLength(token);
    } else {
      line.push(token);
      column = token.multiline ? lastLineLength(token) : column + addition;
    }
  }

  // Fix-up pass: a continuation line must never begin with block syntax and
  // never follow a `\`-terminated token (that would fabricate a hard break).
  // Pull offending tokens up onto the previous line (overflow is fine);
  // greedy refill of the result reproduces the same shape, so wrap stays
  // idempotent.
  for (let i = 1; i < lines.length; i++) {
    for (;;) {
      const line = lines[i];
      if (line.length === 0) break;
      const prev = lines[i - 1];
      const prevLast = prev[prev.length - 1];
      const startsForbidden = isForbiddenLineStart(line.map((t) => t.text).join(' '));
      const prevEndsBackslash = prevLast !== undefined && prevLast.text.endsWith('\\');
      if (!startsForbidden && !prevEndsBackslash) break;
      const moved = line.shift();
      if (!moved) break;
      prev.push(moved);
    }
    if (lines[i].length === 0) {
      lines.splice(i, 1);
      i -= 1;
    }
  }
  return lines.filter((line) => line.length > 0);
}

/**
 * Produce the paragraph's new slice text. `width === null` → unwrap (each
 * segment becomes one line); otherwise greedy wrap at `width`.
 */
function reflowParagraphSlice(
  source: string,
  info: ParagraphInfo,
  width: number | null,
  eol: string,
): string {
  const segments = tokenizeParagraph(source, info);
  const contPrefix = info.continuationPrefix;
  const parts: string[] = [];

  segments.forEach((segment, index) => {
    if (index > 0) {
      // Hard-break marker bytes carry their own original EOL.
      parts.push(segment.markerBefore, contPrefix);
    }
    if (width === null) {
      parts.push(segment.tokens.map((t) => t.text).join(' '));
    } else {
      const firstPrefixLen = index === 0 ? info.firstLinePrefix.length : contPrefix.length;
      const lines = fillSegment(segment.tokens, width, firstPrefixLen, contPrefix.length);
      parts.push(
        lines.map((line) => line.map((t) => t.text).join(' ')).join(`${eol}${contPrefix}`),
      );
    }
  });
  return parts.join('');
}

// ============================================
// Structural-equivalence safety net
// ============================================

/** Inline/blank whitespace runs collapse to one space (soft break → space). */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ');
}

const STRICT_VALUE_TYPES = new Set([
  'inlineCode',
  'code',
  'math',
  'inlineMath',
  'htmlInline',
  'htmlBlock',
]);
const COLLAPSE_STRING_KEYS = new Set(['label', 'alt', 'displayName']);

/**
 * Normalize a parsed document for comparison: positions stripped, adjacent
 * text nodes merged, whitespace collapsed in prose text (softbreak ≡ space)
 * — but code/math/HTML/url/title values compared byte-strict, which is safe
 * because those spans are immovable.
 */
function normalizeForCompare(node: MarkdownNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === 'position' || key === 'children' || key === 'htmlChildren') continue;
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && key !== 'type') {
      if (key === 'value') {
        out[key] = STRICT_VALUE_TYPES.has(node.type) ? value : collapseWhitespace(value);
      } else if (COLLAPSE_STRING_KEYS.has(key)) {
        out[key] = collapseWhitespace(value);
      } else {
        out[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      // Non-node structured props (table align, directive attributes).
      out[key] = JSON.parse(JSON.stringify(value)) as unknown;
    } else {
      out[key] = value;
    }
  }

  const children = getChildren(node);
  if ('children' in record) {
    // Merge adjacent text nodes first: icon/mention splitting can fragment
    // text differently across parses of equivalent sources.
    const merged: MarkdownNode[] = [];
    for (const child of children) {
      const prev = merged[merged.length - 1];
      if (child.type === 'text' && prev && prev.type === 'text') {
        merged[merged.length - 1] = { ...prev, value: `${prev.value}${child.value}` };
      } else {
        merged.push(child);
      }
    }
    out.children = merged.map((child) => normalizeForCompare(child));
  }
  return out;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function documentsEquivalent(a: MarkdownDocument, b: MarkdownDocument): boolean {
  return stableStringify(normalizeForCompare(a)) === stableStringify(normalizeForCompare(b));
}

// ============================================
// Transform drivers
// ============================================

function noopResult(source: string, degraded: boolean): MarkdownSourceTransformResult {
  return { output: source, changed: false, degraded, edits: [] };
}

function clampWidth(width: number | undefined): number {
  if (width === undefined || Number.isNaN(width)) return DEFAULT_WRAP_WIDTH;
  return Math.min(MAX_WRAP_WIDTH, Math.max(MIN_WRAP_WIDTH, Math.floor(width)));
}

function degrade(
  id: MarkdownSourceTransformId,
  source: string,
  strict: boolean | undefined,
  reason: string,
): MarkdownSourceTransformResult {
  if (strict) {
    throw new Error(`squisq ${id} transform aborted: ${reason}`);
  }
  console.warn(`[squisq] ${id} transform left the document unchanged: ${reason}`);
  return noopResult(source, true);
}

function reflowTransform(
  id: 'unwrap' | 'wrap',
  source: string,
  options?: MarkdownSourceTransformOptions,
): MarkdownSourceTransformResult {
  const width = id === 'wrap' ? clampWidth(options?.width) : null;

  let doc: MarkdownDocument;
  try {
    doc = parseMarkdown(source, { parseHtml: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return degrade(id, source, options?.strict, `the document could not be parsed (${message})`);
  }

  const eol = dominantEol(source);
  const edits: MarkdownSourceEdit[] = [];
  for (const info of analyzeParagraphs(source, doc)) {
    const oldSlice = source.slice(info.start, info.end);
    if (id === 'unwrap' && !oldSlice.includes('\n')) continue; // already one line
    const newSlice = reflowParagraphSlice(source, info, width, eol);
    if (newSlice !== oldSlice) {
      edits.push({ start: info.start, end: info.end, text: newSlice });
    }
  }
  if (edits.length === 0) return noopResult(source, false);

  edits.sort((a, b) => b.start - a.start); // descending — apply bottom-up
  let output = source;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }

  try {
    const reparsed = parseMarkdown(output, { parseHtml: false });
    if (!documentsEquivalent(doc, reparsed)) {
      return degrade(
        id,
        source,
        options?.strict,
        'the transformed markdown no longer parses to an equivalent document',
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return degrade(
      id,
      source,
      options?.strict,
      `the transformed markdown failed to reparse (${message})`,
    );
  }

  return { output, changed: true, degraded: false, edits };
}

function cleanupTransform(
  source: string,
  options?: MarkdownSourceTransformOptions,
): MarkdownSourceTransformResult {
  const { frontmatter, body } = splitFrontmatterBlock(source);

  let output: string;
  let parsedBody: MarkdownDocument;
  try {
    // `frontmatter: false` is load-bearing: the body may legitimately START
    // with `---` (a thematic break) once the real frontmatter is split off,
    // and the reparse must not eat it as YAML.
    parsedBody = parseMarkdown(body, { frontmatter: false, parseHtml: false });
    const cleanedBody = stringifyMarkdown(parsedBody);
    if (frontmatter !== null) {
      // Reattach the ORIGINAL frontmatter bytes (comments/order preserved);
      // normalize its EOLs to LF to match remark's LF output, and separate
      // it from the body with exactly one blank line.
      let fm = frontmatter.replace(/\r\n?/g, '\n');
      if (!fm.endsWith('\n')) fm += '\n';
      output = cleanedBody.length > 0 ? `${fm}\n${cleanedBody}` : fm;
    } else {
      output = cleanedBody;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return degrade(
      'cleanup',
      source,
      options?.strict,
      `the document could not be re-serialized (${message})`,
    );
  }

  if (output === source) return noopResult(source, false);

  try {
    const reparsed = parseMarkdown(splitFrontmatterBlock(output).body, {
      frontmatter: false,
      parseHtml: false,
    });
    if (!documentsEquivalent(parsedBody, reparsed)) {
      return degrade(
        'cleanup',
        source,
        options?.strict,
        'the cleaned markdown no longer parses to an equivalent document',
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return degrade(
      'cleanup',
      source,
      options?.strict,
      `the cleaned markdown failed to reparse (${message})`,
    );
  }

  return {
    output,
    changed: true,
    degraded: false,
    edits: [{ start: 0, end: source.length, text: output }],
  };
}

// ============================================
// Public API
// ============================================

export const MARKDOWN_SOURCE_TRANSFORMS: readonly MarkdownSourceTransform[] = Object.freeze([
  {
    id: 'unwrap' as const,
    label: 'Unwrap paragraphs',
    description:
      'Remove forced line wrapping so each paragraph is a single line (hard breaks are kept).',
    apply: (source, options) => reflowTransform('unwrap', source, options),
  },
  {
    id: 'wrap' as const,
    label: 'Wrap at width',
    description:
      'Hard-wrap paragraph prose at a column width on word boundaries; code, tables, and headings are untouched.',
    apply: (source, options) => reflowTransform('wrap', source, options),
  },
  {
    id: 'cleanup' as const,
    label: 'Clean up formatting',
    description:
      'Re-serialize through the canonical house style: bullets, emphasis, headings, table padding, spacing.',
    apply: (source, options) => cleanupTransform(source, options),
  },
]);

/** Apply a registered transform by id. Throws on an unknown id. */
export function applyMarkdownSourceTransform(
  id: string,
  source: string,
  options?: MarkdownSourceTransformOptions,
): MarkdownSourceTransformResult {
  const transform = MARKDOWN_SOURCE_TRANSFORMS.find((t) => t.id === id);
  if (!transform) {
    const known = MARKDOWN_SOURCE_TRANSFORMS.map((t) => t.id).join(', ');
    throw new Error(`Unknown markdown source transform "${id}" (known: ${known})`);
  }
  return transform.apply(source, options);
}

/** Remove forced line wrapping; each paragraph becomes a single line. */
export function unwrapMarkdownSource(
  source: string,
  options?: MarkdownSourceTransformOptions,
): string {
  return reflowTransform('unwrap', source, options).output;
}

/** Hard-wrap paragraph prose at a column width on word boundaries. */
export function wrapMarkdownSource(
  source: string,
  options?: MarkdownSourceTransformOptions,
): string {
  return reflowTransform('wrap', source, options).output;
}

/** Normalize the document through the canonical house-style serializer. */
export function cleanupMarkdownSource(
  source: string,
  options?: MarkdownSourceTransformOptions,
): string {
  return cleanupTransform(source, options).output;
}

/**
 * Detect the prevailing wrap convention of a document's paragraph prose.
 *
 * Evidence is the soft (non-hard-break, non-immovable) line breaks inside
 * paragraphs: their non-final line lengths vote for a wrap column, which is
 * snapped up to the nearest common convention (60/72/80/100/120) when close.
 * Hard-break lines (poetry, addresses) are never wrap evidence.
 */
export function detectMarkdownWrapState(source: string): MarkdownWrapState {
  let doc: MarkdownDocument;
  try {
    doc = parseMarkdown(source, { parseHtml: false });
  } catch {
    return { kind: 'no-prose', totalParagraphs: 0, wrappedParagraphs: 0, maxLineLength: 0 };
  }
  const paragraphs = analyzeParagraphs(source, doc);
  if (paragraphs.length === 0) {
    return { kind: 'no-prose', totalParagraphs: 0, wrappedParagraphs: 0, maxLineLength: 0 };
  }

  let wrappedParagraphs = 0;
  let maxLineLength = 0;
  let candidateWidth = 0;
  const approxLengths: Array<{ approxUnwrapped: number; wrapped: boolean }> = [];

  for (const info of paragraphs) {
    // Physical lines of the paragraph, measured from each line's true start
    // (prefixes included — authors wrap counting the whole line).
    const lineStart = info.start - info.firstLinePrefix.length;
    const slice = source.slice(lineStart, info.end);
    const lines = slice.split(/\r?\n/);
    for (const line of lines) maxLineLength = Math.max(maxLineLength, line.length);

    // Classify each newline in the slice: hard-break / immovable / soft.
    const evidenceLengths: number[] = [];
    let offset = lineStart;
    for (let i = 0; i < lines.length - 1; i++) {
      const newlineOffset = offset + lines[i].length;
      const isHard = spanAt(info.breakSpans, newlineOffset) !== null;
      const isImmovable = spanAt(info.immovableSpans, newlineOffset) !== null;
      if (!isHard && !isImmovable) evidenceLengths.push(lines[i].length);
      offset = newlineOffset + (source[newlineOffset] === '\r' ? 2 : 1);
    }

    const wrapped = evidenceLengths.length > 0;
    if (wrapped) {
      wrappedParagraphs += 1;
      candidateWidth = Math.max(candidateWidth, ...evidenceLengths);
    }
    approxLengths.push({
      approxUnwrapped: info.firstLinePrefix.length + (info.end - info.start),
      wrapped,
    });
  }

  if (wrappedParagraphs === 0) {
    return {
      kind: 'unwrapped',
      totalParagraphs: paragraphs.length,
      wrappedParagraphs: 0,
      maxLineLength,
    };
  }

  let width = candidateWidth;
  for (const common of COMMON_WRAP_WIDTHS) {
    if (candidateWidth <= common && common - candidateWidth <= WIDTH_SNAP_TOLERANCE) {
      width = common;
      break;
    }
  }

  // A paragraph is "needy" when its (approximate) unwrapped length exceeds
  // the candidate width — only those can evidence the convention either way.
  let needy = 0;
  for (const p of approxLengths) {
    if (p.wrapped || p.approxUnwrapped > width) needy += 1;
  }
  const kind =
    candidateWidth >= MIN_DETECTED_WRAP_WIDTH && wrappedParagraphs / Math.max(1, needy) >= 0.5
      ? 'wrapped'
      : 'mixed';

  return {
    kind,
    ...(kind === 'wrapped' ? { width } : {}),
    totalParagraphs: paragraphs.length,
    wrappedParagraphs,
    maxLineLength,
  };
}

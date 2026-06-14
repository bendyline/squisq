/**
 * blockRange
 *
 * Source-text-range slicing for the block-at-a-time editing view. Splits a
 * full markdown document into ordered, contiguous slices — one per
 * heading-defined block plus an optional leading preamble — so a single
 * block can be shown in isolation and edits spliced back into the parent.
 *
 * A block runs from its heading line through the character just before the
 * next heading at ANY depth (or EOF). Sub-headings therefore start their own
 * slices — they are NOT folded into their parent — which matches the
 * "don't see child blocks" requirement and the `slicePastHeading` boundary
 * in `blockSlice.ts`. Ranges are half-open `[startOffset, endOffset)` and
 * line-aligned, so trailing blank lines stay with the current block and
 * `spliceBlock(src, range, getBlockSlices(src)[i].text) === src` for every i.
 *
 * These are pure functions over a markdown string — no React, no editor
 * coupling — so any host can reuse them.
 */

import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { frontmatterEndOffset } from './frontmatter';

/** Half-open character range into the full source: `[startOffset, endOffset)`. */
export interface BlockRange {
  startOffset: number;
  endOffset: number;
}

/** One block's source text plus the range it occupies in the full document. */
export interface BlockSlice {
  text: string;
  range: BlockRange;
}

/** Map every line start to its character offset (`lineStarts[line - 1]`). */
function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function makeSlice(source: string, startOffset: number, endOffset: number): BlockSlice {
  return { text: source.slice(startOffset, endOffset), range: { startOffset, endOffset } };
}

/**
 * Split `fullSource` into ordered block slices.
 *
 * - With no headings, the entire post-frontmatter body is a single slice
 *   (so an empty or heading-less document still shows one editable card).
 * - With headings, a leading preamble slice is included only when the text
 *   before the first heading has non-whitespace content. Each heading then
 *   yields one slice spanning up to the next heading (any depth) or EOF.
 *
 * Frontmatter is never part of any slice — slices start at the body offset.
 */
export function getBlockSlices(fullSource: string): BlockSlice[] {
  const bodyStart = frontmatterEndOffset(fullSource);

  let doc: MarkdownDocument;
  try {
    doc = parseMarkdown(fullSource);
  } catch {
    // Unparseable mid-edit — treat the whole body as one slice rather than
    // dropping the user into an empty card.
    return [makeSlice(fullSource, bodyStart, fullSource.length)];
  }

  const lineStarts = computeLineStarts(fullSource);
  const headingOffsets: number[] = [];
  for (const node of doc.children) {
    if (node.type !== 'heading') continue;
    const line = node.position?.start.line;
    if (typeof line !== 'number') continue;
    const off = lineStarts[line - 1];
    if (typeof off === 'number') headingOffsets.push(off);
  }

  if (headingOffsets.length === 0) {
    return [makeSlice(fullSource, bodyStart, fullSource.length)];
  }

  const slices: BlockSlice[] = [];
  const firstHeading = headingOffsets[0];
  if (fullSource.slice(bodyStart, firstHeading).trim().length > 0) {
    slices.push(makeSlice(fullSource, bodyStart, firstHeading));
  }
  for (let i = 0; i < headingOffsets.length; i++) {
    const start = headingOffsets[i];
    const end = i + 1 < headingOffsets.length ? headingOffsets[i + 1] : fullSource.length;
    slices.push(makeSlice(fullSource, start, end));
  }
  return slices;
}

/** Replace the text in `range` with `newText`, returning the new full source. */
export function spliceBlock(fullSource: string, range: BlockRange, newText: string): string {
  return fullSource.slice(0, range.startOffset) + newText + fullSource.slice(range.endOffset);
}

/** Character offset of the start of 1-based `line` (clamps past EOF). */
export function lineToOffset(source: string, line: number): number {
  const starts = computeLineStarts(source);
  return starts[Math.max(0, line - 1)] ?? source.length;
}

/** 1-based line number containing `offset`. */
export function offsetToLine(source: string, offset: number): number {
  const starts = computeLineStarts(source);
  let lo = 0;
  let hi = starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1;
}

/** Index of the slice whose range contains `offset`, or -1. */
export function sliceIndexAtOffset(slices: BlockSlice[], offset: number): number {
  return slices.findIndex((s) => offset >= s.range.startOffset && offset < s.range.endOffset);
}

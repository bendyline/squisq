/**
 * Turn a markdown source into the blocks a review provider receives.
 *
 * A block here is what the editor's own navigation calls one: a
 * heading-delimited section, not a paragraph. That is the better review unit
 * anyway — "does this section make its case?" is a question worth asking, and
 * a provider that wants finer grain can split the text it was given.
 *
 * Two things happen that a provider should not have to redo. Machine
 * vocabulary is masked — `{[…]}` annotations and code, which a reviewer would
 * otherwise "fix" — using the same equal-length blanking proofing uses, so
 * every offset still indexes the real source. And each block carries its
 * heading, because the same paragraph reads differently under a different one.
 */

import { blankProtectedSpans } from '@bendyline/squisq/proof';
import type { ReviewBlockInput, ReviewDocumentRef, ReviewRequest } from '@bendyline/squisq/review';
import { getBlockSlices } from '../blockRange.js';

/** An ATX heading, matched against a block's FIRST line only. */
const HEADING = /^\s{0,3}#{1,6}\s+(.+)$/;

export interface BuildReviewRequestOptions {
  source: string;
  documentRef: ReviewDocumentRef;
  /** Blocks whose text differs from the previous pass, when known. */
  changedBlockKeys?: readonly number[];
  language?: 'plaintext' | 'markdown';
}

export function buildReviewRequest(options: BuildReviewRequestOptions): ReviewRequest {
  const { source, documentRef } = options;
  const masked = blankProtectedSpans(source, { markdownCode: true }).text;
  const slices = getBlockSlices(source);

  const blocks: ReviewBlockInput[] = [];
  let heading: string | null = null;
  let line = 1;
  let consumed = 0;

  for (const [key, slice] of slices.entries()) {
    // Lines are counted from the real source so a block's startLine matches
    // what the editor's own navigation uses.
    line += countNewlines(source.slice(consumed, slice.range.startOffset));
    consumed = slice.range.startOffset;

    // A section block opens with its own heading; one that does not inherits
    // the heading of the section it sits under.
    const firstLine = slice.text.slice(0, indexOfNewline(slice.text));
    const headingMatch = HEADING.exec(firstLine.trimEnd());
    if (headingMatch) heading = headingMatch[1]?.trim() || null;

    const text = masked.slice(slice.range.startOffset, slice.range.endOffset);
    // An all-blank block is whitespace, a masked code fence, or the single
    // empty slice an empty document yields. A provider gains nothing from it.
    if (text.trim().length === 0) continue;

    blocks.push({
      key,
      startLine: line,
      heading,
      text,
      offset: slice.range.startOffset,
    });
  }

  return {
    source,
    blocks,
    documentRef,
    ...(options.changedBlockKeys ? { changedBlockKeys: options.changedBlockKeys } : {}),
    ...(options.language ? { language: options.language } : {}),
  };
}

/** Which blocks changed between two passes, by text identity. */
export function changedBlockKeys(
  previous: readonly ReviewBlockInput[],
  next: readonly ReviewBlockInput[],
): number[] {
  const before = new Map(previous.map((block) => [block.key, block.text]));
  const changed: number[] = [];
  for (const block of next) {
    if (before.get(block.key) !== block.text) changed.push(block.key);
  }
  return changed;
}

function indexOfNewline(text: string): number {
  const index = text.indexOf('\n');
  return index === -1 ? text.length : index;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') count += 1;
  }
  return count;
}

/**
 * Joined-segment linting.
 *
 * The Write view lints many textblocks (paragraphs, headings, list
 * items, table cells) in ONE engine call by joining their texts with a
 * blank-line separator: one RPC per pass instead of one per block, and —
 * measured — the engine treats each segment as its own paragraph while
 * still using sentence context (`Its` → `It's` fires only with context).
 * Findings come back in the joined coordinate space and are mapped back
 * to their segment; a span that touches a separator or crosses segments
 * is dropped rather than guessed at.
 */

import type { ProofRange } from './types.js';

/** Separator between joined segments — a paragraph boundary to the engine. */
export const PROOF_JOIN_SEPARATOR = '\n\n';

export interface JoinedSegments {
  /** All segments joined with {@link PROOF_JOIN_SEPARATOR}. */
  text: string;
  /** Start offset of each segment within `text`, ascending. */
  starts: number[];
  /** Length of each segment. */
  lengths: number[];
}

/** Join segment texts, recording where each lands in the joined string. */
export function buildJoinedText(segments: readonly string[]): JoinedSegments {
  const starts: number[] = [];
  const lengths: number[] = [];
  let text = '';
  for (const segment of segments) {
    if (text.length > 0) text += PROOF_JOIN_SEPARATOR;
    starts.push(text.length);
    lengths.push(segment.length);
    text += segment;
  }
  return { text, starts, lengths };
}

export interface SegmentSpan extends ProofRange {
  /** Index into the segment list handed to {@link buildJoinedText}. */
  segmentIndex: number;
}

/**
 * Map a `[start, end)` span in the joined text back to segment-local
 * coordinates. Returns `null` for an empty span, a span outside every
 * segment, or one that touches a separator / crosses segments.
 */
export function mapJoinedSpanToSegment(
  joined: JoinedSegments,
  start: number,
  end: number,
): SegmentSpan | null {
  if (end <= start) return null;
  const { starts, lengths } = joined;

  // Binary search: last segment whose start is <= span start.
  let lo = 0;
  let hi = starts.length - 1;
  let index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= start) {
      index = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (index < 0) return null;

  const segmentStart = starts[index];
  const segmentEnd = segmentStart + lengths[index];
  if (start >= segmentEnd || end > segmentEnd) return null;

  return { segmentIndex: index, start: start - segmentStart, end: end - segmentStart };
}

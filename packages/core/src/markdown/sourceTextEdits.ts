/**
 * Targeted edits to a markdown source string: `{ start, end, text }` ranges
 * against the original, in ascending order and not overlapping (an insertion
 * may sit at the start of a following range).
 */

export interface SourceTextEdit {
  /** Offset in the original source where the replaced range starts. */
  start: number;
  /** Offset where it ends (equal to `start` for an insertion). */
  end: number;
  /** What replaces it. */
  text: string;
}

/** Apply ascending, non-overlapping edits to `source`. */
export function applySourceTextEdits(source: string, edits: readonly SourceTextEdit[]): string {
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor || edit.end < edit.start || edit.end > source.length)
      throw new Error('Source edits must be in order and must not overlap.');
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}

/** The one edit that turns `before` into `after` (common start and end kept), or null. */
export function minimalSourceTextEdit(before: string, after: string): SourceTextEdit | null {
  if (before === after) return null;
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < shortest - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return {
    start,
    end: before.length - end,
    text: after.slice(start, after.length - end),
  };
}

/** Sort edits ascending (an insertion before a range starting at the same offset). */
export function sortSourceTextEdits(edits: SourceTextEdit[]): SourceTextEdit[] {
  return [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Sorted edits with any that overlap or touch merged into one (removing the
 * last two blocks of a document, several insertions at one offset), so their
 * order is kept and the end of the document can be tidied once.
 */
export function coalesceSourceTextEdits(edits: readonly SourceTextEdit[]): SourceTextEdit[] {
  const out: SourceTextEdit[] = [];
  for (const edit of edits) {
    const last = out[out.length - 1];
    if (last && edit.start <= last.end) {
      last.end = Math.max(last.end, edit.end);
      last.text += edit.text;
    } else {
      out.push({ ...edit });
    }
  }
  return out;
}

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface FindTextMatch {
  from: number;
  to: number;
}

export interface FindOptions {
  /** Match letter case exactly. Default: case-insensitive (Unicode case folding). */
  readonly matchCase?: boolean;
  /**
   * Only match where the query is not part of a longer word. Applies at each
   * end of the query that is itself a word character, so `c++` still matches.
   */
  readonly wholeWord?: boolean;
}

/**
 * A host request to show particular results, e.g. after opening a workspace
 * search hit: the query, its options, and which match to select.
 */
export interface FindRequest extends FindOptions {
  readonly query: string;
  /** 0-based index, in document order, of the match to select. */
  readonly occurrence?: number;
}

const WORD_CHARACTER = /^[\p{L}\p{N}\p{M}_]$/u;
const WORD_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}\\p{M}_])';
const WORD_BOUNDARY_AFTER = '(?![\\p{L}\\p{N}\\p{M}_])';

/** Build the literal matcher for a query, or null when it cannot match. */
export function createFindMatcher(query: string, options: FindOptions = {}): RegExp | null {
  const needle = query.trim().normalize('NFC');
  if (!needle) return null;
  let source = escapeRegExp(needle);
  if (options.wholeWord) {
    const characters = [...needle];
    if (WORD_CHARACTER.test(characters[0]!)) source = WORD_BOUNDARY_BEFORE + source;
    if (WORD_CHARACTER.test(characters[characters.length - 1]!)) source += WORD_BOUNDARY_AFTER;
  }
  return new RegExp(source, options.matchCase ? 'gu' : 'giu');
}

/**
 * Find non-overlapping literal matches. Offsets are UTF-16 code-unit offsets,
 * matching DOM Range, Monaco, and ProseMirror positions.
 */
export function findTextMatches(
  text: string,
  query: string,
  options: FindOptions = {},
): FindTextMatch[] {
  const matcher = text ? createFindMatcher(query, options) : null;
  if (!matcher) return [];

  const matches: FindTextMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    matches.push({ from: match.index, to: match.index + match[0].length });
    // Literal non-empty queries always advance, but retain this guard so a
    // future matcher change cannot create an infinite loop.
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return matches;
}

export function normalizeFindIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/** Index of the first match starting at or after `offset`, wrapping to 0. */
export function nextFindIndexAfter(matches: readonly FindTextMatch[], offset: number): number {
  const index = matches.findIndex((match) => match.from >= offset);
  return index < 0 ? 0 : index;
}

/**
 * Resolve visible text matches to ProseMirror document positions. Text from
 * adjacent marked spans in one text block is searched as one run, so a query
 * can cross a bold/italic boundary without matching across separate blocks.
 */
export function findProseMirrorMatches(
  doc: ProseMirrorNode,
  query: string,
  options: FindOptions = {},
): FindTextMatch[] {
  const matches: FindTextMatch[] = [];

  doc.descendants((node, blockPos) => {
    if (!node.isTextblock) return true;

    const spans: Array<FindTextMatch & { docFrom: number }> = [];
    let text = '';
    node.descendants((child, offset) => {
      if (child.isText && child.text) {
        const from = text.length;
        text += child.text;
        spans.push({ from, to: text.length, docFrom: blockPos + 1 + offset });
      } else if (child.isInline) {
        // Prevent a phrase from matching invisibly across an atom or hard break.
        text += '\u0000';
      }
      return true;
    });

    for (const match of findTextMatches(text, query, options)) {
      const startSpan = spans.find((span) => match.from >= span.from && match.from < span.to);
      const endOffset = match.to - 1;
      const endSpan = spans.find((span) => endOffset >= span.from && endOffset < span.to);
      if (!startSpan || !endSpan) continue;
      matches.push({
        from: startSpan.docFrom + match.from - startSpan.from,
        to: endSpan.docFrom + match.to - endSpan.from,
      });
    }

    return false;
  });

  return matches;
}

// Only regex syntax characters: under the `u` flag, escaping anything else
// (`-`, for instance) is itself a syntax error.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

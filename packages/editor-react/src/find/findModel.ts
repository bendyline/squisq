import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface FindTextMatch {
  from: number;
  to: number;
}

/**
 * Find non-overlapping, case-insensitive literal matches. Offsets are UTF-16
 * code-unit offsets, matching DOM Range, Monaco, and ProseMirror positions.
 */
export function findTextMatches(text: string, query: string): FindTextMatch[] {
  const needle = query.trim();
  if (!needle || !text) return [];

  const matcher = new RegExp(escapeRegExp(needle), 'giu');
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

/**
 * Resolve visible text matches to ProseMirror document positions. Text from
 * adjacent marked spans in one text block is searched as one run, so a query
 * can cross a bold/italic boundary without matching across separate blocks.
 */
export function findProseMirrorMatches(doc: ProseMirrorNode, query: string): FindTextMatch[] {
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

    for (const match of findTextMatches(text, query)) {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

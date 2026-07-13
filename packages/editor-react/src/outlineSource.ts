/**
 * Source-preserving section moves for the document outline.
 *
 * Markdown headings form a flat AST, so a section extends from its heading
 * through the next heading of equal or shallower depth. Reordering only direct
 * siblings keeps heading levels and hierarchy intact; promote/demote remains a
 * separate outline operation.
 */

import { parseMarkdown } from '@bendyline/squisq/markdown';

export type OutlineDropPlacement = 'before' | 'after';

interface SourceHeading {
  line: number;
  depth: number;
  parentLine: number | null;
  start: number;
  end: number;
}

interface SectionSlot extends SourceHeading {
  content: string;
  gap: string;
}

/**
 * Move one heading-rooted section before or after a sibling section.
 *
 * The current source is parsed inside the helper so fenced-code lookalikes and
 * stale/non-heading line numbers are rejected. The moved section includes its
 * body and every descendant heading. Returns `null` for an invalid or no-op
 * move.
 */
export function moveHeadingSectionInSource(
  source: string,
  fromHeadingLine: number,
  targetHeadingLine: number,
  placement: OutlineDropPlacement,
): string | null {
  if (fromHeadingLine === targetHeadingLine || (placement !== 'before' && placement !== 'after')) {
    return null;
  }

  const headings = readSourceHeadings(source);
  if (!headings) return null;

  const from = headings.find((heading) => heading.line === fromHeadingLine);
  const target = headings.find((heading) => heading.line === targetHeadingLine);
  if (!from || !target) return null;

  // A reorder must not silently promote, demote, or re-parent a section.
  if (from.depth !== target.depth || from.parentLine !== target.parentLine) return null;

  const siblings = headings.filter((heading) => heading.parentLine === from.parentLine);
  const fromIndex = siblings.findIndex((heading) => heading.line === fromHeadingLine);
  const targetIndex = siblings.findIndex((heading) => heading.line === targetHeadingLine);
  if (fromIndex < 0 || targetIndex < 0) return null;

  // Direct sibling ranges must be contiguous. Aborting here is safer than
  // rewriting source if a parser ever reports an unexpected position shape.
  for (let i = 0; i < siblings.length - 1; i++) {
    if (siblings[i].end !== siblings[i + 1].start) return null;
  }

  const slots: SectionSlot[] = siblings.map((heading) => {
    const raw = source.slice(heading.start, heading.end);
    const { content, gap } = splitTrailingLineGap(raw);
    return { ...heading, content, gap };
  });

  const reordered = [...slots];
  const [moved] = reordered.splice(fromIndex, 1);
  const targetAfterRemoval = reordered.findIndex((heading) => heading.line === targetHeadingLine);
  if (!moved || targetAfterRemoval < 0) return null;

  const insertionIndex = targetAfterRemoval + (placement === 'after' ? 1 : 0);
  reordered.splice(insertionIndex, 0, moved);

  if (reordered.every((heading, index) => heading.line === slots[index].line)) return null;

  // Whitespace belongs to positions, not to the section being moved. Keeping
  // the original slot gaps preserves blank-line style, CRLF, and the exact
  // final-newline state even when the former EOF section moves earlier.
  const replacement = reordered
    .map((heading, index) => heading.content + slots[index].gap)
    .join('');
  const rangeStart = slots[0].start;
  const rangeEnd = slots[slots.length - 1].end;
  const next = source.slice(0, rangeStart) + replacement + source.slice(rangeEnd);

  // The move should never change the number of authored headings. This also
  // catches any unforeseen boundary issue before the editor source is updated.
  const nextHeadings = readSourceHeadings(next);
  if (!nextHeadings || nextHeadings.length !== headings.length) return null;

  return next;
}

/** Parse source headings and derive their parent + complete-section range. */
function readSourceHeadings(source: string): SourceHeading[] | null {
  try {
    const document = parseMarkdown(source);
    const lineStarts = sourceLineStarts(source);
    const headings: SourceHeading[] = [];
    const stack: SourceHeading[] = [];

    for (const node of document.children) {
      if (node.type !== 'heading' || !node.position) continue;

      const line = node.position.start.line;
      const start = lineStarts[line - 1];
      if (start == null) return null;

      while (stack.length > 0 && stack[stack.length - 1].depth >= node.depth) {
        stack.pop();
      }

      const heading: SourceHeading = {
        line,
        depth: node.depth,
        parentLine: stack[stack.length - 1]?.line ?? null,
        start,
        end: source.length,
      };
      headings.push(heading);
      stack.push(heading);
    }

    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j].depth <= heading.depth) {
          heading.end = headings[j].start;
          break;
        }
      }
    }

    return headings;
  } catch (err: unknown) {
    // Source mutations are best-effort UI operations. A parse failure leaves
    // the current markdown untouched; EditorContext owns user-facing errors.
    void err;
    return null;
  }
}

/** 0-based offsets of every physical line, preserving mixed EOL sequences. */
function sourceLineStarts(source: string): number[] {
  const starts = [0];
  const eol = /\r\n|\r|\n/g;
  let match: RegExpExecArray | null;
  while ((match = eol.exec(source)) != null) {
    starts.push(match.index + match[0].length);
  }
  return starts;
}

/**
 * Split the line-ending separator from a section without stealing spaces
 * before the first newline (which may be an authored Markdown hard break).
 */
function splitTrailingLineGap(value: string): { content: string; gap: string } {
  const match = value.match(/(?:\r\n|\r|\n)(?:[ \t]*(?:\r\n|\r|\n))*[ \t]*$/);
  if (!match || match.index == null) return { content: value, gap: '' };
  return {
    content: value.slice(0, match.index),
    gap: value.slice(match.index),
  };
}

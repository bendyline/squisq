/**
 * sourceEdits
 *
 * Pure helpers behind the editor's undoable source-edit actions
 * (`applySourceEdits`, `insertBlockAfterCursor`) and usable by any host that
 * plans edits against a markdown string:
 *
 * - validating and applying `{ start, end, text }` edits to a source string;
 * - the smallest single edit that turns one source into another;
 * - where a new block may go relative to a cursor, without splitting a
 *   container template (drawing, layout, diagram) or letting a new heading
 *   capture the paragraphs that follow it.
 *
 * Placement is decided on an abstract outline of top-level blocks so the Write
 * view (ProseMirror nodes) and the Source view (markdown AST) share one rule.
 */

import { parseMarkdown, type MarkdownSourceEdit } from '@bendyline/squisq/markdown';
import { isContainerTemplate } from '@bendyline/squisq/doc';
import { frontmatterEndOffset } from './frontmatter';

export type { MarkdownSourceEdit };

/**
 * Where `insertBlockAfterCursor` puts a block.
 *
 * - `afterBlock`: straight after the top-level block holding the cursor. Right
 *   for fences, tables and paragraphs.
 * - `sectionEnd`: at the end of the cursor's section, just before the next
 *   heading. Right for heading-based blocks, which would otherwise capture
 *   the paragraphs after them.
 */
export type BlockPlacement = 'afterBlock' | 'sectionEnd';

/** The heading structure around an insertion point. */
export interface BlockInsertionContext {
  /** Depth of the section the insertion point belongs to; 0 before any heading. */
  sectionDepth: number;
  /** Depth of the first heading after the insertion point, or null at the end. */
  nextHeadingDepth: number | null;
  /**
   * Deepest heading depth a heading-based block may use here. Normally 6;
   * lower straight after a container template, whose children any deeper
   * heading would join.
   */
  maxHeadingDepth: number;
}

/** One top-level block, as an outline sees it. */
export interface OutlineBlock {
  /** Heading depth, or null for any non-heading block. */
  headingDepth: number | null;
  /** True for a heading whose template consumes the headings under it. */
  container: boolean;
}

/** An insertion point in an outline: insert before `blocks[index]`. */
export interface OutlineInsertion extends BlockInsertionContext {
  index: number;
}

/** Validate edits against `source` and sort them by position; null if any is unusable. */
export function normalizeSourceEdits(
  source: string,
  edits: readonly MarkdownSourceEdit[],
): MarkdownSourceEdit[] | null {
  const sorted = edits
    .map((edit, order) => ({ edit, order }))
    .sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end || a.order - b.order)
    .map(({ edit }) => edit);
  let previousEnd = 0;
  for (const edit of sorted) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      typeof edit.text !== 'string' ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length ||
      edit.start < previousEnd
    ) {
      return null;
    }
    previousEnd = edit.end;
  }
  return sorted;
}

/** Apply edits to `source`. Throws on edits `normalizeSourceEdits` rejects. */
export function applySourceEditsToText(
  source: string,
  edits: readonly MarkdownSourceEdit[],
): string {
  const sorted = normalizeSourceEdits(source, edits);
  if (!sorted) throw new RangeError('Source edits are out of range or overlap.');
  let output = '';
  let cursor = 0;
  for (const edit of sorted) {
    output += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return output + source.slice(cursor);
}

/** The smallest single edit turning `previous` into `next`, or null when they are equal. */
export function minimalReplaceEdit(previous: string, next: string): MarkdownSourceEdit | null {
  if (previous === next) return null;
  const limit = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < limit && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  return {
    start: prefix,
    end: previous.length - suffix,
    text: next.slice(prefix, next.length - suffix),
  };
}

/**
 * Index of the container template heading whose subtree holds each block, or
 * -1. A container's subtree runs to the next heading at its depth or shallower.
 */
function containerOwners(blocks: readonly OutlineBlock[]): number[] {
  const owners: number[] = [];
  let active: { index: number; depth: number } | null = null;
  blocks.forEach((block, index) => {
    if (block.headingDepth !== null) {
      if (active && block.headingDepth <= active.depth) active = null;
      if (!active && block.container) active = { index, depth: block.headingDepth };
    }
    owners.push(active ? active.index : -1);
  });
  return owners;
}

/**
 * Decide where a block goes in an outline, given the block holding the cursor
 * (`cursorIndex`, -1 when the cursor is before every block).
 *
 * A cursor inside a container template never puts a block among its children:
 * `afterBlock` moves before the container and `sectionEnd` after its subtree.
 */
export function resolveOutlineInsertion(
  blocks: readonly OutlineBlock[],
  cursorIndex: number,
  placement: BlockPlacement,
): OutlineInsertion {
  const owners = containerOwners(blocks);
  const cursor = Math.min(Math.max(cursorIndex, -1), blocks.length - 1);
  const firstHeadingFrom = (from: number): number => {
    for (let i = Math.max(from, 0); i < blocks.length; i++) {
      if (blocks[i]?.headingDepth !== null) return i;
    }
    return blocks.length;
  };

  let index: number;
  const container = cursor >= 0 ? (owners[cursor] ?? -1) : -1;
  if (container >= 0) {
    const depth = blocks[container]?.headingDepth ?? 1;
    if (placement === 'afterBlock') {
      index = container;
    } else {
      index = blocks.length;
      for (let i = container + 1; i < blocks.length; i++) {
        const headingDepth = blocks[i]?.headingDepth ?? null;
        if (headingDepth !== null && headingDepth <= depth) {
          index = i;
          break;
        }
      }
    }
  } else if (placement === 'afterBlock') {
    index = cursor + 1;
  } else {
    index = firstHeadingFrom(cursor + 1);
  }

  const nextHeading = firstHeadingFrom(index);
  const nextHeadingDepth =
    nextHeading < blocks.length ? (blocks[nextHeading]?.headingDepth ?? null) : null;

  let previousHeading = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (blocks[i]?.headingDepth !== null) {
      previousHeading = i;
      break;
    }
  }
  let sectionDepth = 0;
  let maxHeadingDepth = 6;
  if (previousHeading >= 0) {
    const owner = owners[previousHeading] ?? -1;
    if (owner >= 0) {
      // Straight after a container's subtree: only a heading at the
      // container's depth or shallower closes it rather than joining it.
      const ownerDepth = blocks[owner]?.headingDepth ?? 1;
      sectionDepth = ownerDepth - 1;
      maxHeadingDepth = ownerDepth;
    } else {
      sectionDepth = blocks[previousHeading]?.headingDepth ?? 0;
    }
  }
  return { index, sectionDepth, nextHeadingDepth, maxHeadingDepth };
}

/**
 * Heading depth for a heading-based block inserted at this point, so the
 * heading that follows closes it instead of being captured, and it does not
 * join a preceding container's children. `childLevels` reserves depth for the
 * block's own child headings (1 for drawing and layout). Null when nothing fits.
 */
export function headingDepthForInsertion(
  context: BlockInsertionContext,
  options: { childLevels?: number } = {},
): number | null {
  const deepest = Math.min(context.maxHeadingDepth, 6 - (options.childLevels ?? 0));
  const wanted = Math.max(context.sectionDepth + 1, 2, context.nextHeadingDepth ?? 0);
  const depth = Math.min(wanted, deepest);
  if (depth < 1 || depth < (context.nextHeadingDepth ?? 1)) return null;
  return depth;
}

/** Top-level blocks of a markdown source with their character ranges. */
export function sourceOutline(source: string): {
  blocks: OutlineBlock[];
  ranges: Array<{ start: number; end: number }>;
} {
  const blocks: OutlineBlock[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  const bodyStart = frontmatterEndOffset(source);
  let children;
  try {
    children = parseMarkdown(source).children;
  } catch {
    return { blocks, ranges };
  }
  for (const node of children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (typeof start !== 'number' || typeof end !== 'number' || start < bodyStart) continue;
    if (node.type === 'heading') {
      blocks.push({
        headingDepth: node.depth,
        container: isContainerTemplate(node.templateAnnotation?.template),
      });
    } else {
      blocks.push({ headingDepth: null, container: false });
    }
    ranges.push({ start, end });
  }
  return { blocks, ranges };
}

/**
 * Where a block goes in a markdown source for a cursor at `cursorOffset`.
 * `offset` is the end of the block the new one follows (or the body start);
 * pass it to {@link joinBlockAt}.
 */
export function blockInsertionPoint(
  source: string,
  cursorOffset: number,
  placement: BlockPlacement,
): BlockInsertionContext & { offset: number } {
  const { blocks, ranges } = sourceOutline(source);
  let cursorIndex = -1;
  for (let i = 0; i < ranges.length; i++) {
    if ((ranges[i]?.start ?? Infinity) <= cursorOffset) cursorIndex = i;
    else break;
  }
  const { index, ...context } = resolveOutlineInsertion(blocks, cursorIndex, placement);
  const offset =
    index > 0 ? (ranges[index - 1]?.end ?? source.length) : (ranges[0]?.start ?? source.length);
  return { offset, ...context };
}

/**
 * The edit that puts `block` at `offset` with exactly one blank line on each
 * side, absorbing whatever whitespace already surrounds that point.
 */
export function joinBlockAt(source: string, offset: number, block: string): MarkdownSourceEdit {
  const bodyStart = frontmatterEndOffset(source);
  const isSpace = (char: string | undefined) =>
    char === '\n' || char === '\r' || char === ' ' || char === '\t';
  let start = Math.min(Math.max(offset, bodyStart), source.length);
  while (start > bodyStart && isSpace(source[start - 1])) start--;
  // Forward, absorb only whole blank lines: leading spaces on the next
  // content line can be meaningful (an indented code block).
  let end = Math.max(start, Math.min(offset, source.length));
  while (end < source.length) {
    const newline = source.indexOf('\n', end);
    const lineEnd = newline === -1 ? source.length : newline + 1;
    if (source.slice(end, lineEnd).trim() !== '') break;
    end = lineEnd;
  }
  const body = block.replace(/^\s*\n/, '').replace(/\s+$/, '');
  // Only frontmatter can precede `start` with newlines still attached (the
  // walk-back stops at the body start); top it up to one blank line.
  const before = source.slice(0, start);
  const trailingNewlines = before.endsWith('\n\n') ? 2 : before.endsWith('\n') ? 1 : 0;
  const prefix = before.length === 0 ? '' : '\n'.repeat(2 - trailingNewlines);
  const suffix = end >= source.length ? '\n' : '\n\n';
  return { start, end, text: prefix + body + suffix };
}

/**
 * Replace a Write-view selection so the new content lands as an edit to the
 * selected text, not as new blocks beside it.
 *
 * Tiptap's insertContent inserts a parsed `<p>` as a block, and ProseMirror
 * splits the surrounding paragraph to make room: replacing one word left three
 * paragraphs, and replacing a paragraph's whole text left an empty paragraph
 * above the new one. Here:
 * - one textblock replacing text inside one textblock merges into it, as a
 *   paste does, so the paragraph (or heading, or table cell) stays whole;
 * - a selection of whole blocks is replaced block for block, when their parent
 *   accepts the new blocks;
 * - anything else lands the way a paste would.
 *
 * An empty selection is left to the caller: inserting at the caret keeps its
 * own rules (an empty paragraph is replaced by the inserted blocks).
 */
import { createNodeFromContent, selectionToInsertionEnd } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { AllSelection, Selection, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';

/**
 * A drag past the end of a paragraph stops at the start of the next one. That
 * edge selects no text, and the replacement must not absorb the following
 * paragraph, so it is trimmed; likewise a start at the very end of a block.
 */
function trimEmptyEdges(
  doc: PMNode,
  $from: ResolvedPos,
  $to: ResolvedPos,
): [ResolvedPos, ResolvedPos] {
  let start = $from;
  let end = $to;
  if (!start.sameParent(end) && end.parent.isTextblock && end.parentOffset === 0) {
    const previous = Selection.findFrom(doc.resolve(end.before()), -1, true);
    if (previous && previous.$head.pos >= start.pos) end = previous.$head;
  }
  if (
    !start.sameParent(end) &&
    start.parent.isTextblock &&
    start.parentOffset === start.parent.content.size
  ) {
    const next = Selection.findFrom(doc.resolve(start.after()), 1, true);
    if (next && next.$head.pos <= end.pos) start = next.$head;
  }
  return [start, end];
}

/**
 * The sibling blocks the range covers from the first one's start to the last
 * one's end, when their parent can hold `content` in their place.
 */
function wholeBlocks(
  doc: PMNode,
  $from: ResolvedPos,
  $to: ResolvedPos,
  content: Fragment,
): { from: number; to: number } | null {
  const range = $from.blockRange($to);
  if (!range) return null;
  const first = Selection.findFrom(doc.resolve(range.start), 1, true);
  const last = Selection.findFrom(doc.resolve(range.end), -1, true);
  if (!first || !last || $from.pos > first.from || $to.pos < last.to) return null;
  if (!range.parent.canReplace(range.startIndex, range.endIndex, content)) return null;
  return { from: range.start, to: range.end };
}

/**
 * Replace `tr.selection` with block `content`. Returns false, changing
 * nothing, for an empty selection or one this does not handle (a node or
 * table-cell selection), so the caller can keep its own behaviour there.
 */
export function replaceSelectionWith(tr: Transaction, content: Fragment): boolean {
  const { selection, doc } = tr;
  if (selection.empty) return false;
  if (!(selection instanceof TextSelection || selection instanceof AllSelection)) return false;

  const [$from, $to] = trimEmptyEdges(doc, selection.$from, selection.$to);
  const single = content.childCount === 1 ? content.firstChild : null;

  if (
    single?.isTextblock &&
    !single.type.spec.code &&
    $from.sameParent($to) &&
    $from.parent.isTextblock &&
    !$from.parent.type.spec.code
  ) {
    // Open on both sides, the block's inline content (marks and all) joins the
    // text around the selection, and the block keeps its own type and attrs.
    tr.replace($from.pos, $to.pos, new Slice(Fragment.from(single), 1, 1));
  } else {
    const blocks = wholeBlocks(doc, $from, $to, content);
    if (blocks) {
      tr.replaceWith(blocks.from, blocks.to, content);
    } else {
      tr.replaceRange($from.pos, $to.pos, Slice.maxOpen(content));
    }
  }
  selectionToInsertionEnd(tr, tr.steps.length - 1, -1);
  return true;
}

/**
 * Replace the editor's selection with HTML from the Markdown bridge, as one
 * undoable edit. Returns false when the selection is empty or not one this
 * handles, or the HTML does not parse; the editor is then unchanged.
 */
export function replaceEditorSelection(editor: Editor, html: string): boolean {
  if (editor.state.selection.empty) return false;
  let content: Fragment;
  try {
    // Parse exactly as Tiptap's insertContent does.
    const parsed = createNodeFromContent(html, editor.schema, {
      parseOptions: { preserveWhitespace: 'full', ...editor.options.parseOptions },
    });
    content = parsed instanceof Fragment ? parsed : Fragment.from(parsed);
  } catch {
    return false;
  }
  return editor
    .chain()
    .focus()
    .command(({ tr }) => replaceSelectionWith(tr, content))
    .run();
}

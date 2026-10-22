import type { Editor as TiptapEditor, JSONContent } from '@tiptap/core';
import type { SelectionTaskItem } from '../selectionConversions';
import { TASK_LIST_ITEMS, TASK_LIST_MARKDOWN } from './toolbarButtons';

function paragraphContent(text: string): JSONContent {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
}

export function tableContent(rows: string[][]): JSONContent {
  return {
    type: 'table',
    content: rows.map((row, rowIndex) => ({
      type: 'tableRow',
      content: row.map((cell) => ({
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [paragraphContent(cell)],
      })),
    })),
  };
}

export function taskListContent(
  items: readonly SelectionTaskItem[] = TASK_LIST_ITEMS.map((text) => ({
    checked: false,
    text,
  })),
): JSONContent {
  return {
    type: 'taskList',
    content: items.map((item) => ({
      type: 'taskItem',
      attrs: { checked: item.checked },
      content: [paragraphContent(item.text)],
    })),
  };
}

export function insertTaskList(editor: TiptapEditor): void {
  const supportsTaskList = !!editor.schema.nodes.taskList && !!editor.schema.nodes.taskItem;
  const content = supportsTaskList ? taskListContent() : TASK_LIST_MARKDOWN;
  editor.chain().focus().insertContent(content).run();
}

/**
 * Expand a full-line Tiptap text selection to the surrounding top-level node
 * boundaries. Inserting a list/table at an in-paragraph range makes
 * ProseMirror preserve the emptied paragraph before or after the new block.
 * Partial-line selections deliberately retain their exact range.
 */
export function blockConversionRange(editor: TiptapEditor): { from: number; to: number } {
  const { from, to, $from, $to } = editor.state.selection;
  return {
    from:
      $from.depth === 1 && $from.parent.isTextblock && $from.parentOffset === 0
        ? $from.before(1)
        : from,
    to:
      $to.depth === 1 && $to.parent.isTextblock && $to.parentOffset === $to.parent.content.size
        ? $to.after(1)
        : to,
  };
}

// ─── List nesting ───────────────────────────────────────

type ListItemType = 'listItem' | 'taskItem';

function isListItemType(name: string): name is ListItemType {
  return name === 'listItem' || name === 'taskItem';
}

/** The innermost list item around the caret, and the depth it sits at. */
function innermostListItem(editor: TiptapEditor): { type: ListItemType; depth: number } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (isListItemType(name)) return { type: name, depth };
  }
  return null;
}

/**
 * The innermost list around the caret. Tiptap's `isActive('bulletList')`
 * matches any ancestor, so a numbered list nested under a bullet would light
 * up both list buttons; the bullet / numbered toggles act on the innermost
 * list, so that is the one the buttons reflect.
 */
function innermostListType(editor: TiptapEditor): string | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') return name;
  }
  return null;
}

export interface ListNesting {
  /** The item can become a child of the item above it (Tab). */
  canIndent: boolean;
  /** The item is nested and can move up one level (Shift+Tab). */
  canOutdent: boolean;
}

/**
 * Indent/outdent availability for the list item at the caret, or `null`
 * outside a list. Outdent stops at the top level: lifting a top-level item
 * would turn it into a paragraph, which the bullet / numbered toggle already
 * does — decreasing a level never removes the list.
 */
export function listNesting(editor: TiptapEditor): ListNesting | null {
  const item = innermostListItem(editor);
  if (!item) return null;
  const parentItem = editor.state.selection.$from.node(item.depth - 2);
  return {
    canIndent: editor.can().sinkListItem(item.type),
    canOutdent: isListItemType(parentItem.type.name) && editor.can().liftListItem(item.type),
  };
}

/** Nest the list item at the caret under the item above it. */
export function indentListItem(editor: TiptapEditor): boolean {
  const item = innermostListItem(editor);
  return !!item && editor.chain().focus().sinkListItem(item.type).run();
}

/** Move a nested list item at the caret up one level; top-level items stay put. */
export function outdentListItem(editor: TiptapEditor): boolean {
  const item = innermostListItem(editor);
  if (!item || !listNesting(editor)?.canOutdent) return false;
  return editor.chain().focus().liftListItem(item.type).run();
}

// ─── Tiptap active-state map ────────────────────────────

/** Returns true if the given button id is currently active in Tiptap */
export function isTiptapActive(editor: TiptapEditor, id: string): boolean {
  if (!editor) return false;
  switch (id) {
    case 'bold':
      return editor.isActive('bold');
    case 'italic':
      return editor.isActive('italic');
    case 'strikethrough':
      return editor.isActive('strike');
    case 'superscript':
      return editor.isActive('superscript');
    case 'subscript':
      return editor.isActive('subscript');
    case 'code':
      return editor.isActive('code');
    case 'h1':
      return editor.isActive('heading', { level: 1 });
    case 'h2':
      return editor.isActive('heading', { level: 2 });
    case 'h3':
      return editor.isActive('heading', { level: 3 });
    case 'h4':
      return editor.isActive('heading', { level: 4 });
    case 'h5':
      return editor.isActive('heading', { level: 5 });
    case 'h6':
      return editor.isActive('heading', { level: 6 });
    case 'quote':
      return editor.isActive('blockquote');
    case 'ul':
      return innermostListType(editor) === 'bulletList';
    case 'ol':
      return innermostListType(editor) === 'orderedList';
    case 'codeblock':
      return editor.isActive('codeBlock');
    default:
      return false;
  }
}

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
      return editor.isActive('bulletList');
    case 'ol':
      return editor.isActive('orderedList');
    case 'codeblock':
      return editor.isActive('codeBlock');
    default:
      return false;
  }
}

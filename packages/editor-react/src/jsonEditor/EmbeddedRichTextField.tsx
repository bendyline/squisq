/**
 * Standalone Tiptap-backed rich text field for use inside `<JsonEditor>`.
 * Doesn't share `EditorContext` with the document editor — value is a
 * controlled markdown string. Reuses `markdownToTiptap` /
 * `tiptapToMarkdown` so fidelity matches the WysiwygEditor.
 */

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import { AlignedTableCell, AlignedTableHeader } from '../tiptap/alignedTableCells';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { MarkdownEscape } from '../MarkdownEscape';
import { PlainTextClipboard } from '../PlainTextClipboard';
import { markdownToTiptap, tiptapToMarkdown } from '../tiptapBridge';

export interface EmbeddedRichTextFieldProps {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}

export function EmbeddedRichTextField(props: EmbeddedRichTextFieldProps) {
  const { value, onChange, readOnly = false, placeholder, className } = props;
  const isExternalUpdate = useRef(false);
  const lastValueRef = useRef(value);

  const editor = useEditor({
    // The render reads no editor state; see WysiwygEditor.
    shouldRerenderOnTransaction: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'squisq-code-block' } },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      AlignedTableCell,
      AlignedTableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      MarkdownEscape,
      PlainTextClipboard,
    ],
    content: markdownToTiptap(value),
    onUpdate: ({ editor: ed, transaction }) => {
      // The read-only sync's setEditable() emits `update` with an empty
      // transaction; that is not an edit to report.
      if (!transaction.docChanged || isExternalUpdate.current) return;
      const html = ed.getHTML();
      const md = tiptapToMarkdown(html);
      lastValueRef.current = md;
      onChange(md);
    },
    editorProps: {
      attributes: {
        class: 'squisq-jf-richtext-prose',
      },
    },
  });

  // Sync external value changes back into the editor (e.g., undo at the host level).
  useEffect(() => {
    if (!editor) return;
    if (value === lastValueRef.current) return;
    isExternalUpdate.current = true;
    try {
      editor.commands.setContent(markdownToTiptap(value), false);
      lastValueRef.current = value;
    } finally {
      isExternalUpdate.current = false;
    }
  }, [editor, value]);

  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  const cls = 'squisq-jf-richtext' + (className ? ` ${className}` : '');
  return <EditorContent editor={editor} className={cls} />;
}

/**
 * WysiwygEditor
 *
 * Tiptap-based rich text editor that provides a WYSIWYG editing experience
 * for markdown content. Uses prodcore's parseMarkdown/stringifyMarkdown for
 * conversion rather than Tiptap's built-in HTML serialization, ensuring
 * perfect fidelity with the markdown format.
 *
 * Includes extensions for GFM features: tables, task lists, strikethrough,
 * and code blocks.
 */

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { HeadingWithTemplate } from './TemplateAnnotation';
import { useEditorContext } from './EditorContext';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/prodcore/markdown';
import type { MarkdownDocument } from '@bendyline/prodcore/markdown';
import { markdownToTiptap, tiptapToMarkdown } from './tiptapBridge';

// ── Frontmatter helpers ────────────────────────────────────────────

/** Regex matching a YAML frontmatter block at the start of the document. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Strip YAML frontmatter from markdown, returning both parts. */
function stripFrontmatter(md: string): { body: string; frontmatter: string } {
  const m = md.match(FRONTMATTER_RE);
  if (!m) return { body: md, frontmatter: '' };
  return { body: md.slice(m[0].length), frontmatter: m[0] };
}

export interface WysiwygEditorProps {
  /** Placeholder text when editor is empty */
  placeholder?: string;
  /** Additional class name for the container */
  className?: string;
}

/**
 * Rich WYSIWYG markdown editor built on Tiptap (ProseMirror).
 * Binds to the shared EditorContext for source synchronization.
 */
export function WysiwygEditor({
  placeholder = 'Start typing your markdown…',
  className,
}: WysiwygEditorProps) {
  const { markdownSource, setMarkdownSource, setTiptapEditor } = useEditorContext();
  const isExternalUpdate = useRef(false);
  const lastSourceRef = useRef(markdownSource);
  // Preserve frontmatter across edits — hidden from WYSIWYG but prepended on save
  const frontmatterRef = useRef(stripFrontmatter(markdownSource).frontmatter);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable built-in heading; we use HeadingWithTemplate instead
        heading: false,
        codeBlock: {
          HTMLAttributes: { class: 'prodcore-code-block' },
        },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: markdownToTiptap(stripFrontmatter(markdownSource).body),
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return;
      const html = ed.getHTML();
      const bodyMd = tiptapToMarkdown(html);
      const newSource = frontmatterRef.current + bodyMd;
      lastSourceRef.current = newSource;
      setMarkdownSource(newSource);
    },
    editorProps: {
      attributes: {
        class: 'prodcore-wysiwyg-editor',
        'data-testid': 'wysiwyg-editor',
      },
    },
  });

  // Register / unregister the Tiptap editor instance with the shared context
  useEffect(() => {
    if (editor) {
      setTiptapEditor(editor);
    }
    return () => setTiptapEditor(null);
  }, [editor, setTiptapEditor]);

  // Sync external changes into Tiptap
  useEffect(() => {
    if (!editor) return;
    // Only update if the source changed externally (not from our own onUpdate)
    if (markdownSource !== lastSourceRef.current) {
      isExternalUpdate.current = true;
      const { body, frontmatter } = stripFrontmatter(markdownSource);
      frontmatterRef.current = frontmatter;
      const content = markdownToTiptap(body);
      editor.commands.setContent(content);
      lastSourceRef.current = markdownSource;
      isExternalUpdate.current = false;
    }
  }, [markdownSource, editor]);

  return (
    <div
      className={className}
      style={{ width: '100%', height: '100%', overflow: 'auto' }}
      data-testid="wysiwyg-container"
    >
      <EditorContent
        editor={editor}
        style={{ height: '100%' }}
      />
    </div>
  );
}

/**
 * Hook to access the Tiptap editor instance for toolbar commands.
 * The WysiwygEditor must be mounted as a sibling or descendant.
 */
export { useEditor as useTiptapEditor } from '@tiptap/react';

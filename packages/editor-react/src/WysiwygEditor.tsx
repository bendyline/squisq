/**
 * WysiwygEditor
 *
 * Tiptap-based rich text editor that provides a WYSIWYG editing experience
 * for markdown content. Uses squisq's parseMarkdown/stringifyMarkdown for
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
import { ImageWithMediaProvider } from './ImageNodeView';
import { useEditorContext } from './EditorContext';
import { markdownToTiptap, tiptapToMarkdown } from './tiptapBridge';
import { looksLikeMarkdown } from './detectMarkdown';

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
  const { markdownSource, setMarkdownSource, setTiptapEditor, mediaProvider } = useEditorContext();
  const isExternalUpdate = useRef(false);
  const lastSourceRef = useRef(markdownSource);
  // Keep a ref so the editor's drop/paste handlers (created once) always
  // see the current MediaProvider without needing to recreate the editor.
  const mediaProviderRef = useRef(mediaProvider);
  useEffect(() => {
    mediaProviderRef.current = mediaProvider;
  }, [mediaProvider]);
  // Preserve frontmatter across edits — hidden from WYSIWYG but prepended on save
  const frontmatterRef = useRef(stripFrontmatter(markdownSource).frontmatter);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable built-in heading; we use HeadingWithTemplate instead
        heading: false,
        codeBlock: {
          HTMLAttributes: { class: 'squisq-code-block' },
        },
      }),
      HeadingWithTemplate.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      ImageWithMediaProvider.configure({ inline: false }),
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
        class: 'squisq-wysiwyg-editor',
        'data-testid': 'wysiwyg-editor',
      },
      // When the clipboard's plain-text payload looks like markdown source,
      // convert it via tiptapBridge before pasting. This applies even when
      // the clipboard also contains HTML (most rich-text sources do), since
      // the markdown-looking text is usually what the user actually wants.
      // Without this, pasted markdown shows up as literal "# Heading" text
      // instead of becoming a real heading.
      handlePaste: (view, event) => {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        // Image files in the clipboard → upload via MediaProvider and insert
        const imageFiles = filesFromClipboard(clipboard);
        if (imageFiles.length > 0 && mediaProviderRef.current) {
          event.preventDefault();
          uploadAndInsertImages(view, imageFiles, mediaProviderRef.current);
          return true;
        }

        const text = clipboard.getData('text/plain');
        if (!text || !looksLikeMarkdown(text)) return false;
        const html = markdownToTiptap(text);
        if (!html) return false;
        event.preventDefault();
        view.pasteHTML(html);
        return true;
      },
      // When image files are dropped onto the editor, upload them via the
      // MediaProvider and insert <img> nodes referencing the relative paths.
      // Falls through to default handling for non-image drops or when no
      // MediaProvider is available.
      handleDrop: (view, event, _slice, _moved) => {
        const dt = event.dataTransfer;
        if (!dt) return false;
        const imageFiles = filesFromDataTransfer(dt);
        if (imageFiles.length === 0 || !mediaProviderRef.current) return false;

        event.preventDefault();
        // Position the cursor at the drop location before inserting
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (coords) {
          const tr = view.state.tr.setSelection(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (view.state.selection.constructor as any).near(view.state.doc.resolve(coords.pos)),
          );
          view.dispatch(tr);
        }
        uploadAndInsertImages(view, imageFiles, mediaProviderRef.current);
        return true;
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
      className={`squisq-wysiwyg-container${className ? ` ${className}` : ''}`}
      style={{ width: '100%', height: '100%', overflow: 'auto' }}
      data-testid="wysiwyg-container"
    >
      <EditorContent editor={editor} style={{ height: '100%' }} />
    </div>
  );
}

// ── Image drop / paste helpers ─────────────────────────────────────

/** Extract image File objects from a DataTransfer (drop event). */
function filesFromDataTransfer(dt: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dt.files.length; i++) {
    const file = dt.files[i];
    if (file.type.startsWith('image/')) files.push(file);
  }
  return files;
}

/** Extract image File objects from a clipboard's items (paste event). */
function filesFromClipboard(clipboard: DataTransfer): File[] {
  const files: File[] = [];
  // clipboardData.items is the most reliable source for pasted images
  if (clipboard.items) {
    for (let i = 0; i < clipboard.items.length; i++) {
      const item = clipboard.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }
  return files;
}

/**
 * Upload image files to the MediaProvider and insert <img> nodes at the
 * current selection. Inserts a placeholder name when files lack one
 * (e.g., screenshots from the system clipboard).
 */
async function uploadAndInsertImages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view: any,
  files: File[],
  mediaProvider: import('@bendyline/squisq/schemas').MediaProvider,
): Promise<void> {
  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const mimeType = file.type || 'image/png';
      const name = file.name && file.name !== 'image.png' ? file.name : `pasted-${Date.now()}.${extFromMime(mimeType)}`;
      const relativePath = await mediaProvider.addMedia(name, buffer, mimeType);
      const altText = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

      // Insert <img> via the schema's image node type
      const { schema } = view.state;
      const imageType = schema.nodes.image;
      if (!imageType) continue;
      const node = imageType.create({ src: relativePath, alt: altText });
      const tr = view.state.tr.replaceSelectionWith(node);
      view.dispatch(tr);
    } catch (err) {
      console.error('Failed to upload dropped image:', err);
    }
  }
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  return map[mime.toLowerCase()] ?? 'png';
}

/**
 * Hook to access the Tiptap editor instance for toolbar commands.
 * The WysiwygEditor must be mounted as a sibling or descendant.
 */
// eslint-disable-next-line react-refresh/only-export-components
export { useEditor as useTiptapEditor } from '@tiptap/react';

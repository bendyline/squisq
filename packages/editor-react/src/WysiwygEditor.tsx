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

import { useEffect, useMemo, useRef } from 'react';
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
import { buildMentionExtension } from './MentionExtension';
import { markdownToTiptap, tiptapToMarkdown } from './tiptapBridge';
import { looksLikeMarkdown } from './detectMarkdown';
import { SQUISQ_MEDIA_MIME, parseSquisqMediaPayload } from './mediaDragMime';

// ── Frontmatter helpers ────────────────────────────────────────────

/** Regex matching a YAML frontmatter block at the start of the document. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Strip YAML frontmatter from markdown, returning both parts. */
function stripFrontmatter(md: string): { body: string; frontmatter: string } {
  const m = md.match(FRONTMATTER_RE);
  if (!m) return { body: md, frontmatter: '' };
  return { body: md.slice(m[0].length), frontmatter: m[0] };
}

/**
 * Rotating placeholder prompts shown when the editor is empty. One is
 * picked at random per editor mount. Hosts can override by passing the
 * `placeholder` prop with a fixed string.
 */
const EMPTY_PROMPTS = [
  'Start typing your content, or drop images on top of me…',
  'Write anything — paste markdown, drag in images, or just start typing…',
  'Type away. Markdown syntax works too…',
  'Chapter 1 begins here…',
  'Once upon a time…',
  'A blank page. Exciting, isn\u2019t it?',
  'The first word is always the hardest…',
  'Plot twist: this is where it all starts…',
  'Write something the future you will thank you for…',
  'Begin at the beginning…',
];

function pickEmptyPrompt(): string {
  return EMPTY_PROMPTS[Math.floor(Math.random() * EMPTY_PROMPTS.length)];
}

export interface WysiwygEditorProps {
  /**
   * Placeholder text when the editor is empty. If omitted, one of several
   * rotating prompts is picked at random on mount. Pass a fixed string to
   * override with a host-specific call to action.
   */
  placeholder?: string;
  /** Additional class name for the container */
  className?: string;
  /**
   * If set, a plain Enter keypress fires this callback instead of inserting
   * a newline, and Cmd/Ctrl+Enter inserts a soft break. Chat-composer UX.
   */
  submitOnEnter?: () => void;
  /** Disable Tiptap editing — renders content but blocks input. */
  readOnly?: boolean;
}

/**
 * Rich WYSIWYG markdown editor built on Tiptap (ProseMirror).
 * Binds to the shared EditorContext for source synchronization.
 */
export function WysiwygEditor({
  placeholder,
  className,
  submitOnEnter,
  readOnly = false,
}: WysiwygEditorProps) {
  const { markdownSource, setMarkdownSource, setTiptapEditor, mediaProvider, mentionProvider } =
    useEditorContext();
  // Keep a ref so the mention extension — created once at editor mount —
  // always sees the latest provider. Swapping projects or gezels changes
  // the provider without remounting the editor.
  const mentionProviderRef = useRef(mentionProvider);
  useEffect(() => {
    mentionProviderRef.current = mentionProvider;
  }, [mentionProvider]);
  // Stable per mount: either the host-supplied string, or a random pick
  // from EMPTY_PROMPTS. Re-renders don't reshuffle.
  const resolvedPlaceholder = useMemo(() => placeholder ?? pickEmptyPrompt(), [placeholder]);
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
  // Stash the latest submit callback so the editor's handleKeyDown (bound
  // once at creation) always sees the current value.
  const submitOnEnterRef = useRef(submitOnEnter);
  useEffect(() => {
    submitOnEnterRef.current = submitOnEnter;
  }, [submitOnEnter]);

  const editor = useEditor({
    editable: !readOnly,
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
      Placeholder.configure({ placeholder: resolvedPlaceholder }),
      buildMentionExtension(() => mentionProviderRef.current),
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
      // Chat-composer mode: Enter commits via submitOnEnter(), Cmd/Ctrl+Enter
      // inserts a soft break. When no callback is set, fall through to Tiptap's
      // normal behavior (Enter = paragraph break, Shift+Enter = soft break).
      handleKeyDown: (view, event) => {
        if (event.key !== 'Enter' || !submitOnEnterRef.current) return false;
        if (event.metaKey || event.ctrlKey) {
          // User wants a newline. Insert a hard-break and stop propagation so
          // we don't also create a new paragraph.
          event.preventDefault();
          view.dispatch(
            view.state.tr.replaceSelectionWith(view.state.schema.nodes.hardBreak.create()),
          );
          return true;
        }
        if (event.shiftKey) {
          // Preserve the conventional Shift+Enter soft break.
          return false;
        }
        // Plain Enter — submit.
        event.preventDefault();
        submitOnEnterRef.current();
        return true;
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
      // Also handles drags from the MediaBin, which reference existing
      // entries via a custom MIME type and skip the upload step.
      // Falls through to default handling for non-image drops or when no
      // MediaProvider is available.
      handleDrop: (view, event, _slice, _moved) => {
        const dt = event.dataTransfer;
        if (!dt) return false;

        // In-app drag from the MediaBin — insert without uploading
        const squisqRaw = dt.getData(SQUISQ_MEDIA_MIME);
        if (squisqRaw) {
          const payload = parseSquisqMediaPayload(squisqRaw);
          if (payload && payload.mimeType.startsWith('image/')) {
            event.preventDefault();
            moveSelectionToDropPoint(view, event);
            insertImageNode(view, payload.name, payload.alt);
            return true;
          }
        }

        const imageFiles = filesFromDataTransfer(dt);
        if (imageFiles.length === 0 || !mediaProviderRef.current) return false;

        event.preventDefault();
        moveSelectionToDropPoint(view, event);
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

  // Tiptap reads `editable` only at creation; mirror later changes via
  // setEditable so flipping readOnly from the host takes effect without
  // remounting the editor.
  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

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
      const name =
        file.name && file.name !== 'image.png'
          ? file.name
          : `pasted-${uniquePasteToken()}.${extFromMime(mimeType)}`;
      const relativePath = await mediaProvider.addMedia(name, buffer, mimeType);
      const altText = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      insertImageNode(view, relativePath, altText);
    } catch (err) {
      console.error('Failed to upload dropped image:', err);
    }
  }
}

/** Insert an image node at the current selection using the schema image type. */
function insertImageNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view: any,
  src: string,
  alt: string,
): void {
  const { schema } = view.state;
  const imageType = schema.nodes.image;
  if (!imageType) return;
  const node = imageType.create({ src, alt });
  const tr = view.state.tr.replaceSelectionWith(node);
  view.dispatch(tr);
}

/** Move the selection to the document position under the drop event's coordinates. */
function moveSelectionToDropPoint(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view: any,
  event: DragEvent,
): void {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return;
  const tr = view.state.tr.setSelection(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (view.state.selection.constructor as any).near(view.state.doc.resolve(coords.pos)),
  );
  view.dispatch(tr);
}

/**
 * Produce a unique token for a pasted-file name. `Date.now()` alone can
 * collide when a user pastes several clipboard images in the same tick
 * (multi-image paste from a screenshot grid, for example), which would make
 * `MediaProvider.addMedia` overwrite or reject later entries. Prefer
 * `crypto.randomUUID()` when available and fall back to a counter so the
 * helper stays pure-JS-everywhere.
 */
let pasteCounter = 0;
function uniquePasteToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  pasteCounter = (pasteCounter + 1) % 1_000_000;
  return `${Date.now()}-${pasteCounter.toString(36)}`;
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

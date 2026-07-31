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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Selection } from '@tiptap/pm/state';
import type { EditorView as ProseMirrorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { resolveFontFamily, FONT_FALLBACKS, VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { DEFAULT_THEME, flattenBlocks, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownWrapState } from '@bendyline/squisq/markdown';
import { HeadingWithTemplate } from './TemplateAnnotation';
import { AsciiDiagramExtension } from './asciiDiagram/AsciiDiagramExtension';
import { RepairableDiagramExtension } from './asciiDiagram/RepairableDiagramExtension';
import { applyRepairCommand } from './asciiDiagram/asciiDiagramCommands';
import { shouldPasteAsAsciiFence } from './asciiDiagram/asciiPaste';
import { MermaidDiagramExtension } from './mermaid/MermaidDiagramExtension';
import { createMermaidThemeStore, type MermaidThemeStore } from './mermaid/mermaidThemeStore';
import { CodeSnippetExtension } from './codeSnippet/CodeSnippetExtension';
import { HostFenceExtension } from './fenceWidgets/HostFenceExtension';
import { fenceRendererLangs } from '@bendyline/squisq/fence';
import { TreeViewExtension } from './treeview/TreeViewExtension';
import { shouldPasteAsTreeFence } from './treeview/treePaste';
import { TimelineViewExtension } from './timeline/TimelineViewExtension';
import { shouldPasteAsTimelineFence } from './timeline/timelinePaste';
import { BlockTagActivityExtension } from './blockTagActivity';
import { SceneBlockExtension } from './scene/SceneBlockExtension';
import { InlineIcon } from './InlineIcon';
import { ImageWithMediaProvider } from './ImageNodeView';
import { TiptapVideo } from './tiptap/TiptapVideo';
import { TiptapAudio } from './tiptap/TiptapAudio';
import { TemplateBadgePopover, TEMPLATE_NAMES } from './TemplatePicker';
import { BlockPropertiesPopover } from './BlockPropertiesPopover';
import {
  CustomTemplateProvider,
  TemplateDesigner,
  type DesignerSaveTarget,
} from './customTemplates';
import { saveLibraryTemplate } from './customTemplates/library';
import { useDocCustomTemplates } from './customTemplates/useDocCustomTemplates';
import type { CustomTemplateDefinition } from '@bendyline/squisq/schemas';
import { profileBlockContents, recommendTemplatesForBlock } from '@bendyline/squisq/recommend';
import { findBlockSliceByHeadingIndex } from './blockSlice';
import { stripFrontmatter } from './frontmatter';
import { ingestForWrite, persistFromWrite } from './wrapPolicy';
import { useEditorContext } from './EditorContext';
import { buildMentionExtension } from './MentionExtension';
import { markdownToTiptap, tiptapToMarkdown } from './tiptapBridge';
import { looksLikeMarkdown } from './detectMarkdown';
import {
  SQUISQ_MEDIA_MIME,
  parseSquisqMediaPayload,
  squisqMediaKind,
  type SquisqMediaDragPayload,
} from './mediaDragMime';
import { usePreviewSettingsOptional } from './PreviewControls';
import { uploadAndInsertImages } from './wysiwygImageUpload';
import { writeCanvasSettingsStyle, type WriteCanvasSettings } from './writeCanvasSettings';
import { FindHighlightExtension } from './find/FindHighlightExtension';

type MediaMutationView = Pick<ProseMirrorView, 'state' | 'dispatch'>;

/**
 * Rotating placeholder prompts shown when the editor is empty. One is
 * picked at random per editor mount. Hosts can override by passing the
 * `placeholder` prop with a fixed string.
 */

/**
 * `@tiptap/extension-link`'s default attributes are href/target/rel/class —
 * a markdown link title (`[a](url "T")`) has nowhere to live and is dropped
 * on the way through the editor, so an author's title silently disappears the
 * first time a document is opened in WYSIWYG. `tiptapBridge` round-trips the
 * title on both sides; this is the node-schema half of that contract.
 */
export const LinkWithTitle = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: { default: null },
    };
  },
});

const EMPTY_PROMPTS = [
  'Start typing your content, or drop files on top of me...',
  'Write anything -- paste markdown, drag in media, or just start typing...',
  'Type away. Markdown syntax works too...',
  'Chapter 1 begins here...',
  'Once upon a time...',
  "A blank page. Exciting, isn't it?",
  'The first word is always the hardest...',
  'Plot twist: this is where it all starts...',
];

const BLOCK_TAG_DATA_VALUES = {
  none: 'hidden',
  active: 'active',
  always: 'visible',
} as const;

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
  /** Host-controlled base text size and line spacing for the Write canvas. */
  writeCanvasSettings?: WriteCanvasSettings;
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
  writeCanvasSettings,
}: WysiwygEditorProps) {
  const {
    editorSource,
    setEditorSource,
    setTiptapEditor,
    mediaProvider,
    mentionProvider,
    fenceRenderers,
    blockTagVisibility,
    themeInheritance,
    colorScheme,
    bumpMediaRevision,
    sceneTextChannel,
    preserveSourceWrapping,
    layoutMode,
  } = useEditorContext();
  // The wrap policy only makes sense over the whole document: block/timeline
  // slices are fragments whose "convention" is the document's, not their own.
  const wrapPolicyEnabled = preserveSourceWrapping && layoutMode === 'document';
  const previewSettings = usePreviewSettingsOptional();
  // Tiptap creates its `onUpdate` callback once. Layout changes replace the
  // editor source channel (whole-document passthrough vs active-block splice),
  // so read the current writer through a ref instead of retaining the channel
  // that happened to exist when this editor instance mounted.
  const setEditorSourceRef = useRef(setEditorSource);
  setEditorSourceRef.current = setEditorSource;
  const activeTheme = previewSettings?.activeTheme;
  const mermaidThemeStoreRef = useRef<MermaidThemeStore | null>(null);
  if (mermaidThemeStoreRef.current === null) {
    mermaidThemeStoreRef.current = createMermaidThemeStore(activeTheme ?? DEFAULT_THEME);
  }
  const mermaidThemeStore = mermaidThemeStoreRef.current;
  useEffect(() => {
    mermaidThemeStore.setTheme(activeTheme ?? DEFAULT_THEME);
  }, [activeTheme, mermaidThemeStore]);
  // Custom templates inlined in the active doc's frontmatter + the
  // persist callback that writes a new list back into the source.
  const { docTemplates, onDocTemplatesChange } = useDocCustomTemplates();
  // Designer modal visibility. `null` when closed; `{ initial }` when
  // open. `initial` is undefined for a "+ New" flow or set to an
  // existing template to edit it.
  const [designerState, setDesignerState] = useState<{ initial?: CustomTemplateDefinition } | null>(
    null,
  );
  const handleDesignerSave = useCallback(
    (def: CustomTemplateDefinition, target: DesignerSaveTarget) => {
      if (target === 'doc') {
        const existingIdx = docTemplates.findIndex((t) => t.name === def.name);
        const next =
          existingIdx >= 0
            ? docTemplates.map((t, i) => (i === existingIdx ? def : t))
            : [...docTemplates, def];
        onDocTemplatesChange(next);
      } else {
        saveLibraryTemplate(def);
      }
    },
    [docTemplates, onDocTemplatesChange],
  );
  // Keep a ref so the mention extension — created once at editor mount —
  // always sees the latest provider. Swapping projects changes
  // the provider without remounting the editor.
  const mentionProviderRef = useRef(mentionProvider);
  useEffect(() => {
    mentionProviderRef.current = mentionProvider;
  }, [mentionProvider]);
  // Same getter-ref pattern for the host fence registry: renderer
  // implementations stay live without an editor remount. The *set* of
  // claimed languages (CodeSnippet's reserved list) is captured at
  // creation — see EditorShellProps.fenceRenderers.
  const fenceRenderersRef = useRef(fenceRenderers);
  useEffect(() => {
    fenceRenderersRef.current = fenceRenderers;
  }, [fenceRenderers]);
  const activeThemeRef = useRef(activeTheme);
  useEffect(() => {
    activeThemeRef.current = activeTheme;
  }, [activeTheme]);
  // Stable per mount: either the host-supplied string, or a random pick
  // from EMPTY_PROMPTS. Re-renders don't reshuffle.
  const resolvedPlaceholder = useMemo(() => placeholder ?? pickEmptyPrompt(), [placeholder]);
  const isExternalUpdate = useRef(false);
  const lastSourceRef = useRef(editorSource);
  // React may commit several rapid editor updates one at a time. Remember
  // every locally emitted value so an intermediate commit is not mistaken
  // for an external replacement and fed back through setContent(), which
  // resets the selection (most visibly in Firefox during fast typing).
  const pendingLocalSourcesRef = useRef<string[]>([]);
  // Keep a ref so the editor's drop/paste handlers (created once) always
  // see the current MediaProvider without needing to recreate the editor.
  const mediaProviderRef = useRef(mediaProvider);
  useEffect(() => {
    mediaProviderRef.current = mediaProvider;
  }, [mediaProvider]);
  // Preserve frontmatter across edits — hidden from WYSIWYG but prepended on
  // save. In block mode the bound slice carries no frontmatter, so this is an
  // empty string and the splice in `setEditorSource` keeps the doc's real
  // frontmatter intact.
  const frontmatterRef = useRef(stripFrontmatter(editorSource).frontmatter);
  // The document's detected wrap convention — the wrapping sibling of
  // frontmatterRef. When set, Tiptap edits the UNWRAPPED body and every
  // serialize re-applies the convention (`persistFromWrite`); when null the
  // policy is a pass-through. Refreshed on every EXTERNAL source ingest.
  const wrapStateRef = useRef<MarkdownWrapState | null>(null);
  // Lazily ingest the mount-time body exactly once (same pattern as the
  // mermaid theme store above): the initial Tiptap content must already be
  // the display form or the first render shows chopped per-line paragraphs.
  const initialDisplayBodyRef = useRef<string | undefined>(undefined);
  if (initialDisplayBodyRef.current === undefined) {
    const body = stripFrontmatter(editorSource).body;
    if (wrapPolicyEnabled) {
      const ingest = ingestForWrite(body);
      wrapStateRef.current = ingest.state;
      initialDisplayBodyRef.current = ingest.displayBody;
    } else {
      initialDisplayBodyRef.current = body;
    }
  }
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
      BlockTagActivityExtension,
      AsciiDiagramExtension.configure({ textChannel: sceneTextChannel }),
      MermaidDiagramExtension.configure({ themeStore: mermaidThemeStore }),
      CodeSnippetExtension.configure({
        reservedLanguages: fenceRendererLangs(fenceRenderers ?? undefined),
      }),
      HostFenceExtension.configure({
        renderers: () => fenceRenderersRef.current ?? undefined,
        theme: () => activeThemeRef.current ?? undefined,
      }),
      RepairableDiagramExtension.configure({ onRepair: applyRepairCommand }),
      TimelineViewExtension,
      TreeViewExtension,
      SceneBlockExtension.configure({ textChannel: sceneTextChannel }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      LinkWithTitle.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      ImageWithMediaProvider.configure({ inline: false }),
      TiptapVideo,
      TiptapAudio,
      Placeholder.configure({ placeholder: resolvedPlaceholder }),
      buildMentionExtension(() => mentionProviderRef.current),
      InlineIcon,
      FindHighlightExtension,
    ],
    content: markdownToTiptap(initialDisplayBodyRef.current),
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return;
      // Keep the source channel synchronous with Tiptap. Structural actions
      // such as block navigation/addition may run in the very next browser
      // event; deferring this write lets a stale callback serialize the newly
      // selected block into the previous block's range. The expensive full-doc
      // parse remains debounced in EditorContext, so correctness here does not
      // reintroduce parse-on-every-keystroke work.
      const bodyMd = persistFromWrite(tiptapToMarkdown(ed.getHTML()), wrapStateRef.current);
      const newSource = frontmatterRef.current + bodyMd;
      pendingLocalSourcesRef.current.push(newSource);
      lastSourceRef.current = newSource;
      setEditorSourceRef.current(newSource);
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
        // Defer Enter to an open mention/suggestion popover so the user
        // can pick the highlighted candidate. ProseMirror plugins fire
        // AFTER editorProps.handleKeyDown, so without this short-circuit
        // plain Enter submits the message and the popover closes
        // without inserting the mention. The MentionExtension marks
        // its container with `display: block` while items are showing
        // and `display: none` when empty — only short-circuit when
        // there's actually a candidate to pick.
        const popover = view.dom
          .closest('.squisq-editor-shell')
          ?.querySelector<HTMLElement>('.squisq-mention-popover');
        if (popover && popover.style.display !== 'none') {
          return false;
        }
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
          uploadAndInsertImages(view, imageFiles, mediaProviderRef.current, bumpMediaRevision);
          return true;
        }

        const text = clipboard.getData('text/plain');
        if (!text) return false;

        // Bare (unfenced) ASCII diagram art → verbatim into a fresh code
        // block, which AsciiDiagramExtension turns into an interactive
        // canvas. Must run BEFORE the markdown branch: `| x |` art rows
        // false-positive as GFM table rows and would be mangled.
        if (shouldPasteAsAsciiFence(text)) {
          const codeBlockType = view.state.schema.nodes.codeBlock;
          if (codeBlockType) {
            event.preventDefault();
            // Tag the fence `diagram` so its identity survives a later
            // flatten → markdown → re-import round-trip (the language class
            // round-trips; fence meta does not).
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                codeBlockType.create({ language: 'diagram' }, view.state.schema.text(text)),
              ),
            );
            return true;
          }
        }

        // Bare (unfenced) marker rails → an explicit timeline code block.
        // Run before the tree gate because timeline callout elbows can look
        // like nested tree connectors to a deliberately lenient parser.
        if (shouldPasteAsTimelineFence(text)) {
          const codeBlockType = view.state.schema.nodes.codeBlock;
          if (codeBlockType) {
            event.preventDefault();
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                codeBlockType.create({ language: 'timeline' }, view.state.schema.text(text)),
              ),
            );
            return true;
          }
        }

        // Bare (unfenced) ASCII tree art → a fresh code block that the
        // TreeViewExtension turns into an outline. After the diagram gate,
        // before markdown (the `├──` lines must not be mangled as prose).
        if (shouldPasteAsTreeFence(text)) {
          const codeBlockType = view.state.schema.nodes.codeBlock;
          if (codeBlockType) {
            event.preventDefault();
            // Tag the fence `tree` so its identity survives round-trips.
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                codeBlockType.create({ language: 'tree' }, view.state.schema.text(text)),
              ),
            );
            return true;
          }
        }

        if (!looksLikeMarkdown(text)) return false;
        const html = markdownToTiptap(text);
        if (!html) return false;
        event.preventDefault();
        view.pasteHTML(html);
        return true;
      },
      // When image files are dropped onto the editor, upload them via the
      // MediaProvider and insert <img> nodes referencing the relative paths.
      // Drags from the MediaBin can also insert existing image, video, audio,
      // or generic-file references without uploading them again.
      // Falls through to default handling for non-image drops or when no
      // MediaProvider is available.
      handleDrop: (view, event, _slice, moved) => {
        const dt = event.dataTransfer;
        if (!dt) return false;

        // Internal node move (the user dragged an existing node within
        // the document). ProseMirror's `moved` flag is true in this
        // case; let it handle the reposition natively so width/height
        // attributes are preserved and the source node is removed.
        // Without this short-circuit, the browser also exposes the
        // dragged `<img>` as a virtual file in `dataTransfer`, so the
        // upload-and-insert path below would fire — producing a
        // dimension-less duplicate next to the original.
        if (moved) return false;

        // In-app drag from the MediaBin — insert without uploading
        const squisqRaw = dt.getData(SQUISQ_MEDIA_MIME);
        if (squisqRaw) {
          const payload = parseSquisqMediaPayload(squisqRaw);
          if (payload) {
            event.preventDefault();
            moveSelectionToDropPoint(view, event);
            return insertExistingMediaReference(view, payload);
          }
        }

        const imageFiles = filesFromDataTransfer(dt);
        if (imageFiles.length === 0) {
          // Nothing image-like in the drop. Let the browser / ProseMirror
          // handle it (links, text, etc.). Log enough to debug if the user
          // expected this to be an image drop — Windows/browser combos
          // sometimes deliver image drags without a usable File payload.
          if (dt.files.length > 0 || dt.items.length > 0) {
            console.warn(
              '[squisq-editor] Drop received with no recognizable image File. Types:',
              Array.from(dt.types ?? []),
              'files:',
              Array.from(dt.files).map((f) => `${f.name} (${f.type || 'no-type'})`),
            );
          }
          return false;
        }
        if (!mediaProviderRef.current) {
          console.warn(
            '[squisq-editor] Image drop received but no MediaProvider is wired up; cannot persist the image. Pass `mediaProvider` to EditorShell / EditorProvider.',
          );
          return false;
        }

        event.preventDefault();
        moveSelectionToDropPoint(view, event);
        uploadAndInsertImages(view, imageFiles, mediaProviderRef.current, bumpMediaRevision);
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

  // ── Template badge → popover ─────────────────────────────────────
  // The HeadingWithTemplate extension renders an inert `.squisq-template-badge`
  // span inside templated headings. We delegate clicks at the container
  // level so we can locate the heading position and open the gallery
  // anchored at that badge.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [badgeMenu, setBadgeMenu] = useState<{
    rect: DOMRect;
    template: string;
    headingPos: number;
    headingIndex: number;
  } | null>(null);
  const [propsMenu, setPropsMenu] = useState<{
    rect: DOMRect;
    headingPos: number;
    blockAttrs: string | null;
    templateParams: string | null;
  } | null>(null);

  const closeBadgeMenu = useCallback(() => {
    setBadgeMenu(null);
    // The portaled gallery moves focus into its search field. Restore the
    // document's preserved ProseMirror selection after React has unmounted the
    // dialog, so the caret resumes blinking where the author left it.
    requestAnimationFrame(() => {
      if (editor && !editor.isDestroyed) editor.commands.focus();
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const root = containerRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const propsBadge = target.closest('.squisq-props-badge') as HTMLElement | null;
      const templateBadge = target.closest('.squisq-template-badge') as HTMLElement | null;
      const badge = propsBadge ?? templateBadge;
      if (!badge || !root.contains(badge)) return;
      e.preventDefault();
      e.stopPropagation();
      // Find the parent heading element and resolve its document position.
      const headingEl = badge.closest('h1,h2,h3,h4,h5,h6') as HTMLElement | null;
      if (!headingEl) return;
      let pos: number | null = null;
      try {
        pos = editor.view.posAtDOM(headingEl, 0);
      } catch {
        pos = null;
      }
      if (pos == null) return;
      // posAtDOM returns the position *inside* the heading; subtract 1
      // to land on the heading node itself so setNodeMarkup targets it.
      const headingPos = Math.max(0, pos - 1);
      const node = editor.state.doc.nodeAt(headingPos);
      if (!node || node.type.name !== 'heading') return;

      // Block-properties badge → open the properties palette.
      if (propsBadge) {
        setBadgeMenu(null);
        setPropsMenu({
          rect: badge.getBoundingClientRect(),
          headingPos,
          blockAttrs: (node.attrs.dataBlockAttrs as string | null) ?? null,
          templateParams: (node.attrs.dataTemplateParams as string | null) ?? null,
        });
        return;
      }

      // Template badge → open the template gallery. Count how many headings
      // precede this one so the markdown-source slice helper can locate the
      // matching heading by index.
      let headingIndex = 0;
      let count = 0;
      editor.state.doc.descendants((n, p) => {
        if (n.type.name !== 'heading') return;
        if (p === headingPos) {
          headingIndex = count;
          return false;
        }
        count++;
      });
      setPropsMenu(null);
      setBadgeMenu({
        rect: badge.getBoundingClientRect(),
        template: (node.attrs.dataTemplate as string | null) ?? '',
        headingPos,
        headingIndex,
      });
    };
    root.addEventListener('mousedown', onClick);
    return () => root.removeEventListener('mousedown', onClick);
  }, [editor]);

  // Sync external changes into Tiptap. `editorSource` also changes when the
  // user navigates to a different block in block-at-a-time mode, so this same
  // path reloads the card with the newly selected block's slice.
  useEffect(() => {
    if (!editor) return;
    const pendingIndex = pendingLocalSourcesRef.current.lastIndexOf(editorSource);
    if (pendingIndex >= 0) {
      // This state value came from Tiptap itself. Drop it and every older
      // emission; any later entries still describe edits React has not
      // committed yet, so keep lastSourceRef pointing at the newest one.
      pendingLocalSourcesRef.current.splice(0, pendingIndex + 1);
      if (pendingLocalSourcesRef.current.length === 0) {
        lastSourceRef.current = editorSource;
      }
      return;
    }
    if (editorSource === lastSourceRef.current) return;
    // In block/timeline mode `setEditorSource` normalizes the slice's trailing
    // whitespace (a `\n\n` before the next block) before splicing, so the
    // re-extracted `editorSource` differs from what we just emitted by trailing
    // whitespace only. Re-setting content for that would reset the caret to the
    // end on every keystroke — so only reload when the body actually changed.
    if (editorSource.replace(/\s+$/, '') === lastSourceRef.current.replace(/\s+$/, '')) {
      lastSourceRef.current = editorSource;
      return;
    }
    isExternalUpdate.current = true;
    const { body, frontmatter } = stripFrontmatter(editorSource);
    pendingLocalSourcesRef.current = [];
    frontmatterRef.current = frontmatter;
    // Re-detect the wrap convention on every external ingest (echoes of our
    // own writes were dropped above, so a manual Wrap/Unwrap transform or a
    // Source-view edit updates the convention we persist with).
    let displayBody = body;
    if (wrapPolicyEnabled) {
      const ingest = ingestForWrite(body);
      wrapStateRef.current = ingest.state;
      displayBody = ingest.displayBody;
    } else {
      wrapStateRef.current = null;
    }
    const content = markdownToTiptap(displayBody);
    editor.commands.setContent(content);
    lastSourceRef.current = editorSource;
    isExternalUpdate.current = false;
  }, [editorSource, editor, wrapPolicyEnabled]);

  // Match the WYSIWYG editor's appearance to the active Squisq theme when one
  // is set in frontmatter or picked in the preview dropdown. The block-props
  // affordance always carries the theme's primary as UI accent (like the
  // outline); document-content inheritance is driven by the View menu setting:
  //   - 'none'         → don't inherit anything
  //   - 'fonts'        → body + heading fonts only (historical default)
  //   - 'fonts-colors' → fonts plus the theme's canvas / text colors
  // Pushed as CSS custom properties on the container so the stylesheet
  // can pick them up (with sensible fallbacks for hosts that don't have
  // a PreviewSettingsProvider in scope).
  const badgePreviewSource = useMemo(() => {
    if (!badgeMenu) return undefined;
    try {
      const previewDoc = markdownToDoc(parseMarkdown(editorSource), { autoTemplates: false });
      const block = flattenBlocks(previewDoc.blocks)[badgeMenu.headingIndex];
      if (!block) return undefined;
      return {
        block,
        theme: previewSettings?.activeTheme ?? DEFAULT_THEME,
        viewport: previewSettings?.activeViewport ?? VIEWPORT_PRESETS.landscape,
        basePath: '/',
        mediaProvider,
        customTemplates: docTemplates,
      };
    } catch {
      return undefined;
    }
  }, [
    badgeMenu,
    docTemplates,
    editorSource,
    mediaProvider,
    previewSettings?.activeTheme,
    previewSettings?.activeViewport,
  ]);
  const themeStyle = useMemo<CSSProperties>(() => {
    if (!activeTheme) return {};
    const out: Record<string, string> = {
      '--squisq-block-props-accent': activeTheme.colors.primary,
    };
    if (themeInheritance === 'none') return out as CSSProperties;
    Object.assign(out, {
      '--squisq-theme-body-font': resolveFontFamily(
        activeTheme.typography.bodyFont,
        FONT_FALLBACKS.sans,
      ),
      '--squisq-theme-title-font': resolveFontFamily(
        activeTheme.typography.titleFont,
        FONT_FALLBACKS.sans,
      ),
    });
    if (themeInheritance === 'fonts-colors') {
      const colors = activeTheme.colors;
      out['--squisq-theme-bg'] = colors.background;
      // backgroundLight gives a subtle on-canvas surface for inline emphasis
      // (inline `code`, code blocks). Themes always define it.
      out['--squisq-theme-bg-muted'] = colors.backgroundLight;
      out['--squisq-theme-text'] = colors.text;
      out['--squisq-theme-text-muted'] = colors.textMuted;
      out['--squisq-theme-primary'] = colors.primary;
    }
    return out as CSSProperties;
  }, [activeTheme, themeInheritance]);

  return (
    <CustomTemplateProvider docTemplates={docTemplates} onDocTemplatesChange={onDocTemplatesChange}>
      <div
        className={`squisq-wysiwyg-container${className ? ` ${className}` : ''}`}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'auto',
          ...themeStyle,
          ...writeCanvasSettingsStyle(writeCanvasSettings),
        }}
        data-testid="wysiwyg-container"
        data-block-tags={BLOCK_TAG_DATA_VALUES[blockTagVisibility]}
        data-theme-inheritance={themeInheritance}
        ref={containerRef}
      >
        <EditorContent editor={editor} style={{ height: '100%' }} />
        {badgeMenu && (
          <TemplateBadgePopover
            anchorRect={badgeMenu.rect}
            value={badgeMenu.template}
            colorScheme={colorScheme}
            recommended={(() => {
              // `headingIndex` is counted within the mounted Tiptap doc, which
              // reflects `editorSource` — the active block's slice in block
              // mode, the full document otherwise.
              const slice = findBlockSliceByHeadingIndex(editorSource, badgeMenu.headingIndex);
              if (!slice) return undefined;
              const profile = profileBlockContents(slice);
              return recommendTemplatesForBlock(profile, TEMPLATE_NAMES).recommended;
            })()}
            previewSource={badgePreviewSource}
            onOpenDesigner={() => {
              setBadgeMenu(null);
              setDesignerState({});
            }}
            onChange={(name) => {
              if (!editor) return;
              const tr = editor.state.tr.setNodeMarkup(badgeMenu.headingPos, undefined, {
                ...editor.state.doc.nodeAt(badgeMenu.headingPos)?.attrs,
                dataTemplate: name === '' ? null : name,
              });
              editor.view.dispatch(tr);
            }}
            onClose={closeBadgeMenu}
          />
        )}
        {propsMenu && (
          <BlockPropertiesPopover
            anchorRect={propsMenu.rect}
            blockAttrs={propsMenu.blockAttrs}
            templateParams={propsMenu.templateParams}
            colorScheme={colorScheme}
            accentColor={activeTheme?.colors.primary}
            onChange={(nextInner) => {
              if (!editor) return;
              const current = editor.state.doc.nodeAt(propsMenu.headingPos);
              if (!current || current.type.name !== 'heading') return;
              const tr = editor.state.tr.setNodeMarkup(propsMenu.headingPos, undefined, {
                ...current.attrs,
                dataBlockAttrs: nextInner,
              });
              editor.view.dispatch(tr);
            }}
            onAnnotationChange={(next) => {
              if (!editor) return;
              const current = editor.state.doc.nodeAt(propsMenu.headingPos);
              if (!current || current.type.name !== 'heading') return;
              const tr = editor.state.tr.setNodeMarkup(propsMenu.headingPos, undefined, {
                ...current.attrs,
                dataBlockAttrs: next.blockAttrsInner,
                dataTemplateParams: next.templateParams,
              });
              editor.view.dispatch(tr);
            }}
            onClose={() => setPropsMenu(null)}
          />
        )}
        {designerState && (
          <TemplateDesigner
            initial={designerState.initial}
            onSave={handleDesignerSave}
            onClose={() => setDesignerState(null)}
            mediaProvider={mediaProvider}
            colorScheme={colorScheme}
          />
        )}
      </div>
    </CustomTemplateProvider>
  );
}

// ── Image drop / paste helpers ─────────────────────────────────────

/** Extension-based fallback when a dragged file has no `type` set (rare
 *  but happens when sources omit the MIME — e.g. some screenshot tools). */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

function looksLikeImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(file.name);
}

/** Extract image File objects from a DataTransfer (drop event). Reads
 *  from both `dt.files` and `dt.items`; some drag sources (cross-tab
 *  drags, certain native apps) populate only one of the two. */
function filesFromDataTransfer(dt: DataTransfer): File[] {
  const files: File[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < dt.files.length; i++) {
    const file = dt.files[i];
    if (looksLikeImageFile(file)) {
      files.push(file);
      seen.add(`${file.name}|${file.size}`);
    }
  }

  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (!looksLikeImageFile(file)) continue;
      const key = `${file.name}|${file.size}`;
      if (seen.has(key)) continue;
      files.push(file);
      seen.add(key);
    }
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

/** Insert an image node at the current selection using the schema image type. */
function insertImageNode(view: MediaMutationView, src: string, alt: string): void {
  const { schema } = view.state;
  const imageType = schema.nodes.image;
  if (!imageType) return;
  const node = imageType.create({ src, alt });
  const tr = view.state.tr.replaceSelectionWith(node);
  view.dispatch(tr);
}

/** Insert an existing Files-panel entry using its native editable node type. */
function insertExistingMediaReference(
  view: MediaMutationView,
  payload: SquisqMediaDragPayload,
): boolean {
  const kind = squisqMediaKind(payload.mimeType);
  if (kind === 'image') {
    insertImageNode(view, payload.name, payload.alt);
    return true;
  }

  const { state } = view;
  if (kind === 'video' || kind === 'audio') {
    const nodeType = state.schema.nodes[kind];
    if (!nodeType) return false;
    const attrs =
      kind === 'video'
        ? { src: payload.name, controls: true, width: 480 }
        : { src: payload.name, controls: true };
    const node = nodeType.create(attrs);
    const { $from } = state.selection;
    const pos = $from.depth >= 1 ? $from.after(1) : state.doc.content.size;
    view.dispatch(state.tr.insert(pos, node).scrollIntoView());
    return true;
  }

  const linkType = state.schema.marks.link;
  if (!linkType) return false;
  const label = payload.alt || payload.name;
  const node = state.schema.text(label, [linkType.create({ href: payload.name })]);
  view.dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  return true;
}

/** Move the selection to the document position under the drop event's coordinates. */
function moveSelectionToDropPoint(view: ProseMirrorView, event: DragEvent): void {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return;
  const tr = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(coords.pos)));
  view.dispatch(tr);
}

/**
 * Hook to access the Tiptap editor instance for toolbar commands.
 * The WysiwygEditor must be mounted as a sibling or descendant.
 */
// eslint-disable-next-line react-refresh/only-export-components
export { useEditor as useTiptapEditor } from '@tiptap/react';

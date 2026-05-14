/**
 * EditorShell
 *
 * Top-level shell component that composes the Toolbar, ViewSwitcher, editor
 * views, and StatusBar into a complete editing experience. Wraps everything
 * in an EditorProvider for shared state.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  EditorProvider,
  useEditorContext,
  type EditorView,
  type ImageDisplayMode,
  type MentionProvider,
  type ViewPreferences,
} from './EditorContext';
import { Toolbar } from './Toolbar';
import { StatusBar } from './StatusBar';
import { RawEditor } from './RawEditor';
import { WysiwygEditor } from './WysiwygEditor';
import { InlinePreviewGutter } from './InlinePreviewGutter';
import { OutlinePanel } from './OutlinePanel';
import { PreviewPanel } from './PreviewPanel';
import { ImageViewer } from './ImageViewer';
import { ImageEditor } from './ImageEditor';
import { PreviewSettingsProvider, PreviewToolbarControls } from './PreviewControls';
import { MediaBin } from './MediaBin';
import { DropZoneOverlay } from './DropZoneOverlay';
import { TooltipLayer } from './Tooltip';
import { useFileDrop, type DropTarget } from './hooks/useFileDrop';
import {
  partitionFiles,
  processMediaFiles,
  processTextFile,
  processTextFiles,
} from './utils/dropUtils';
import type { MediaProvider, Theme } from '@bendyline/squisq/schemas';
import { DARK_SURFACE, LIGHT_SURFACE } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import {
  MemoryContentContainer,
  scopeContainer,
  createMediaProviderFromContainer,
} from '@bendyline/squisq/storage';
import type { PrunePolicy, SaveVersionResult } from '@bendyline/squisq/versions';
import type { CSSProperties, ReactNode } from 'react';

export type { EditorTheme } from './EditorContext';

export interface EditorShellProps {
  /** Initial markdown content */
  initialMarkdown?: string;
  /** Initial active view */
  /** Initial active view (default: 'wysiwyg') */
  initialView?: EditorView;
  /** Article ID for Doc generation */
  articleId?: string;
  /** Base path for media URLs in preview */
  basePath?: string;
  /** Called when markdown source changes */
  onChange?: (source: string) => void;
  /** Color theme: 'light' or 'dark' (default: 'light') */
  theme?: 'light' | 'dark';
  /** Additional class name */
  className?: string;
  /** CSS height for the shell container (default: '100vh') */
  height?: string;
  /**
   * Minimum CSS height for the shell. When either `minHeight` or
   * `maxHeight` is set, the shell switches to **auto-grow mode**:
   * `height` is ignored, the root becomes `height: auto` between the
   * bounds, and the content area scrolls internally when content
   * exceeds `maxHeight`. Useful for chat composers that should grow
   * with content up to some cap.
   */
  minHeight?: string;
  /** See `minHeight`. Upper bound of the auto-grow range. */
  maxHeight?: string;
  /** Optional MediaProvider for the Files panel. When set (even to null), a Files toggle appears in the toolbar. */
  mediaProvider?: MediaProvider | null;
  /** Optional ContentContainer for audio mapping (MP3 discovery + timing.json reading). */
  container?: ContentContainer | null;
  /**
   * Enable version history. Snapshots are stored at
   * `.versions/<basename>.<timestamp>.md` inside the same `container`,
   * so they ride along with the document when the host serializes.
   *
   * Snapshots fire on idle (controlled by `versioningAutoSaveIdleMs`)
   * and can also be triggered host-side via the manager exposed in the
   * context (`useEditorContext().versioning`). Has no effect without a
   * `container` — a `console.warn` flags the misconfiguration in dev.
   */
  allowVersioning?: boolean;
  /**
   * Override the document basename used in version filenames. Defaults
   * to the basename of the container's primary document path.
   */
  versionBasename?: string;
  /**
   * Prune policy applied after each successful save. Defaults to
   * `{ type: 'keep-last-n', n: 50 }` so the snapshot count stays bounded.
   */
  versioningPrunePolicy?: PrunePolicy;
  /**
   * Idle delay (ms) before the editor auto-saves a version. `0` disables
   * auto-save entirely (snapshots are then only saved when the host
   * calls `versioning.saveVersion()` from the context). Default: 5000.
   */
  versioningAutoSaveIdleMs?: number;
  /**
   * Notified after each `saveVersion` attempt. Fires for both successful
   * saves (`reason: 'saved'`) and skips (`'unchanged'`, `'no-document'`,
   * `'empty'`). Useful for hosts that want a "Last saved" indicator.
   */
  onSaveVersion?: (result: SaveVersionResult) => void;
  /** Show the Files toggle in the toolbar. Defaults to true when mediaProvider is passed. */
  showFilesToggle?: boolean;
  /** Content rendered at the left edge of the toolbar, before the view tabs. */
  toolbarSlotLeft?: ReactNode;
  /** Content rendered after the formatting controls (in the middle area of the toolbar). */
  toolbarSlotAfterActions?: ReactNode;
  /** Content rendered at the rightmost end of the toolbar, after all other elements. */
  toolbarSlotRight?: ReactNode;
  /**
   * Whether to show the "Play" (preview) tab in the toolbar. When false, the
   * tab and its preview panel are hidden, and ⌘3 becomes a no-op. Use this
   * when embedding the editor somewhere the slideshow preview doesn't make
   * sense (e.g. editing free-form prompt documents). Defaults to true.
   */
  showPlayTab?: boolean;
  /**
   * Optional "submit on Enter" callback. When provided, a plain Enter
   * keypress fires this callback instead of inserting a newline, and
   * Cmd/Ctrl+Enter inserts a newline instead. Matches chat-composer UX
   * (Slack, Discord). When omitted, the editor behaves normally.
   */
  submitOnEnter?: () => void;
  /**
   * Let the WYSIWYG editing surface fill its container instead of rendering
   * as a centered 800px "page" column. Useful when embedding in chat
   * composers, side panels, or any layout where the page metaphor doesn't
   * fit. Defaults to false (page mode).
   */
  fullWidth?: boolean;
  /**
   * Font-family stack applied to the editor **chrome** — toolbar buttons,
   * tabs, status bar, and control surfaces. The actual editing areas
   * (Tiptap / Monaco) keep their own fonts so document editing isn't
   * affected. Use this when the editor is embedded in a larger product
   * that has its own UX type system and you want the controls to blend in.
   *
   * @example
   * ```tsx
   * <EditorShell uxFont="'Hanken Grotesk', system-ui, sans-serif" ... />
   * ```
   */
  uxFont?: string;
  /**
   * Drop the editor's generous page-style padding in favor of a tight
   * layout that hugs its container. The default WYSIWYG surface uses
   * 16×24px padding suitable for editing long-form documents; chat
   * composers want much less. Applies to the editing area only — the
   * toolbar, tabs, and status bar keep their normal sizing.
   */
  thinMargins?: boolean;
  /**
   * Render the bottom status bar (word / character / line / block counts
   * and parse-state indicator). Defaults to `true`. Set to `false` in
   * embedded surfaces — chat composers and other short-form inputs —
   * where the stats are noise.
   */
  showStatusBar?: boolean;
  /**
   * How images should be displayed in the WYSIWYG view. `'inline'`
   * (default) flows them at natural size up to the container width;
   * `'thumbnail'` constrains each image to a 100×100 box with
   * aspect-preserving containment — useful for chat composers and other
   * dense surfaces where a full-resolution paste would dominate the
   * layout. Storage bytes are unchanged either way.
   */
  imageDisplayMode?: ImageDisplayMode;
  /**
   * File name (e.g. `foo.ts`) or bare extension that the content
   * represents. When set to a non-markdown/text extension, the shell
   * enters **code mode**: Monaco picks the right language based on the
   * extension, the WYSIWYG and Preview tabs disappear, and the toolbar
   * drops its markdown-specific formatting buttons. Markdown-ish
   * extensions (`.md`, `.markdown`, `.mdown`, `.txt`) keep the full
   * experience. Omit to get today's markdown behavior unchanged.
   */
  fileName?: string;
  /**
   * Explicit Monaco language ID override (e.g. `'typescript'`,
   * `'python'`, `'json'`). Wins over the language derived from
   * `fileName`. Anything other than `'markdown'` or `'plaintext'`
   * switches the shell into code mode.
   */
  language?: string;
  /**
   * Optional async provider for `@`-mention suggestions. When supplied,
   * typing `@` inside the editor opens a popover of candidates; selecting
   * one inserts a `@[Label](scheme:id)` mention token. Used by chat
   * composers and any other surface that wants to address named entities
   * inline. Omit to disable mentions entirely.
   */
  mentionProvider?: MentionProvider | null;
  /**
   * Placeholder text shown in the WYSIWYG editor while the document is
   * empty. When omitted, the editor rotates through its own generic
   * "start typing…" prompts; pass a value here to override with copy
   * that fits the embedding surface (e.g. a chat composer knows who
   * the message is going to and can say so).
   */
  placeholder?: string;
  /**
   * When true, both editing surfaces become non-editable: Monaco runs in
   * `readOnly` mode and Tiptap is set to `editable: false`. The toolbar
   * still renders — hide it from the host side if you want a pure preview.
   * Useful for reference panels that show file content without inviting
   * accidental edits.
   */
  readOnly?: boolean;
  /**
   * Image source URL used when the resolved file mode is `image` (PNG,
   * JPEG, GIF, WebP, BMP, ICO, AVIF). When this prop is set, the shell
   * replaces its text-editing surfaces with a dedicated `ImageViewer`.
   *
   * Lifecycle of the URL is the caller's responsibility — when fed a
   * `blob:` URL, the host should `URL.revokeObjectURL` on unmount or
   * src change.
   */
  imageSrc?: string;
  /** Alt text passed through to the underlying ImageViewer. */
  imageAlt?: string;
  /**
   * Whether the image surface should render as a read-only viewer
   * (`'view'`, default) or as the editable {@link ImageEditor}
   * (`'edit'`). Editing requires {@link EditorShellProps.imageEditorContainer}
   * — without it the shell falls back to view mode and logs a warning.
   */
  imageMode?: 'view' | 'edit';
  /**
   * Sidecar `ContentContainer` for the image being edited. Conventionally
   * scoped to `<basename>_files/` via
   * `scopeContainer(parentContainer, basename + '_files')`. The image
   * editor persists `state.json`, layer assets in `assets/`, and (when
   * `allowVersioning` is true) snapshots in `.versions/` inside it.
   */
  imageEditorContainer?: ContentContainer;
  /**
   * Called after the user clicks Export in the image editor and the
   * raster blob is produced. When omitted, the editor triggers a
   * default browser download.
   */
  onImageExport?: (blob: Blob, format: 'png' | 'jpeg' | 'webp') => void;
  /**
   * Show an inline preview gutter to the right of the WYSIWYG editor.
   * The gutter renders one small SVG card per template-annotated block in
   * the document, letting authors see their rendered output without
   * leaving Edit mode. Auto-hidden via container query when the editor
   * body is narrower than ~720px. Defaults to `false`.
   */
  inlinePreview?: boolean;
  /**
   * Width in pixels for the inline preview gutter. Defaults to 320.
   * Only takes effect when {@link EditorShellProps.inlinePreview} is true.
   */
  inlinePreviewWidth?: number;
  /**
   * Show an outline pane on the left of the WYSIWYG editor — a
   * hierarchical tree of the document's headings (h1 → h2 → h3) with
   * click-to-scroll. Auto-hidden via container query on narrow editors.
   * Defaults to `false`. The toolbar's View menu can toggle this at
   * runtime regardless of the initial value.
   */
  outline?: boolean;
  /**
   * Width in pixels for the outline pane. Defaults to 240. Only takes
   * effect when {@link EditorShellProps.outline} is true (or the View
   * menu has toggled it on).
   */
  outlineWidth?: number;
  /**
   * Initial visibility of inline block-template tags on headings — the
   * chip rendered next to each heading in the WYSIWYG view that opens
   * the block-template picker. Defaults to true; the View menu can
   * toggle it at runtime regardless of the initial value.
   */
  blockTags?: boolean;
  /**
   * Bundled view preferences — a serializable JSON blob covering the
   * runtime-toggleable view options surfaced in the View menu. When
   * provided, fields here override the corresponding individual props
   * (`outline`, `inlinePreview`, `showStatusBar`). Pair with
   * {@link onViewPreferencesChange} to externalize storage of these
   * preferences in the host.
   */
  viewPreferences?: ViewPreferences;
  /**
   * Notified after each user-driven toggle in the View menu. The
   * argument is a full snapshot of all view preferences — hosts can
   * persist it as-is. Not called when {@link viewPreferences} is
   * changed externally.
   */
  onViewPreferencesChange?: (prefs: ViewPreferences) => void;
  /**
   * Override the preview theme with an explicit `Theme` object. When set,
   * `Doc.themeId` and the user's theme dropdown selection are ignored for
   * the preview surface. Used by the theme customizer to live-preview an
   * in-progress theme without mutating the document.
   */
  themeOverride?: Theme | null;
}

/**
 * Complete markdown editor shell with toolbar, view switcher, and three
 * editing modes: Raw (Monaco), WYSIWYG (Tiptap), and Preview.
 */
export function EditorShell({
  initialMarkdown = '',
  initialView = 'wysiwyg',
  articleId = 'untitled',
  basePath = '/',
  onChange,
  theme = 'light',
  className,
  height = '100vh',
  minHeight,
  maxHeight,
  mediaProvider,
  container,
  allowVersioning = false,
  versionBasename,
  versioningPrunePolicy,
  versioningAutoSaveIdleMs,
  onSaveVersion,
  showFilesToggle,
  toolbarSlotLeft,
  toolbarSlotAfterActions,
  toolbarSlotRight,
  showPlayTab = true,
  submitOnEnter,
  fullWidth = false,
  uxFont,
  thinMargins = false,
  showStatusBar = true,
  imageDisplayMode = 'inline',
  fileName,
  language,
  mentionProvider,
  placeholder,
  readOnly = false,
  imageSrc,
  imageAlt,
  imageMode = 'view',
  imageEditorContainer,
  onImageExport,
  inlinePreview = false,
  inlinePreviewWidth = 320,
  outline = false,
  outlineWidth = 240,
  blockTags = true,
  viewPreferences,
  onViewPreferencesChange,
  themeOverride = null,
}: EditorShellProps) {
  // If the host gave us a `container` but no explicit `mediaProvider`,
  // derive one automatically. Without this, drag-and-drop of an image
  // into the editor silently failed (no provider \u2192 nothing to upload to)
  // even though we had a perfectly good ContentContainer to write into.
  const effectiveMediaProvider = useMemo<MediaProvider | null | undefined>(() => {
    if (mediaProvider !== undefined) return mediaProvider;
    if (container) return createMediaProviderFromContainer(container);
    return undefined;
  }, [mediaProvider, container]);

  // Show the toggle when explicitly opted in, or when mediaProvider prop was passed at all
  const filesToggleEnabled = showFilesToggle ?? effectiveMediaProvider !== undefined;

  // If the host hides the Play tab but asked for it as the initial view,
  // fall back to wysiwyg so we don't boot into a tab the user can't leave.
  const effectiveInitialView: EditorView =
    !showPlayTab && initialView === 'preview' ? 'wysiwyg' : initialView;

  return (
    <EditorProvider
      initialMarkdown={initialMarkdown}
      initialView={effectiveInitialView}
      articleId={articleId}
      theme={theme}
      container={container ?? null}
      allowVersioning={allowVersioning}
      versionBasename={versionBasename}
      versioningPrunePolicy={versioningPrunePolicy}
      versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
      onSaveVersion={onSaveVersion}
      mediaProvider={effectiveMediaProvider}
      imageDisplayMode={imageDisplayMode}
      mentionProvider={mentionProvider}
      fileName={fileName}
      language={language}
      inlinePreview={inlinePreview}
      showStatusBar={showStatusBar}
      outline={outline}
      blockTags={blockTags}
      viewPreferences={viewPreferences}
      onViewPreferencesChange={onViewPreferencesChange}
    >
      <EditorShellInner
        basePath={basePath}
        onChange={onChange}
        className={className}
        height={height}
        minHeight={minHeight}
        maxHeight={maxHeight}
        placeholder={placeholder}
        mediaProvider={effectiveMediaProvider ?? null}
        container={container}
        filesToggleEnabled={filesToggleEnabled}
        toolbarSlotLeft={toolbarSlotLeft}
        toolbarSlotAfterActions={toolbarSlotAfterActions}
        toolbarSlotRight={toolbarSlotRight}
        showPlayTab={showPlayTab}
        submitOnEnter={submitOnEnter}
        fullWidth={fullWidth}
        uxFont={uxFont}
        thinMargins={thinMargins}
        readOnly={readOnly}
        imageSrc={imageSrc}
        imageAlt={imageAlt}
        imageMode={imageMode}
        imageEditorContainer={imageEditorContainer}
        onImageExport={onImageExport}
        allowVersioning={allowVersioning}
        versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
        inlinePreviewWidth={inlinePreviewWidth}
        outlineWidth={outlineWidth}
        themeOverride={themeOverride}
      />
    </EditorProvider>
  );
}

interface EditorShellInnerProps {
  basePath: string;
  onChange?: (source: string) => void;
  className?: string;
  height: string;
  minHeight?: string;
  maxHeight?: string;
  placeholder?: string;
  mediaProvider: MediaProvider | null;
  container?: ContentContainer | null;
  filesToggleEnabled: boolean;
  toolbarSlotLeft?: ReactNode;
  toolbarSlotAfterActions?: ReactNode;
  toolbarSlotRight?: ReactNode;
  showPlayTab: boolean;
  submitOnEnter?: () => void;
  fullWidth: boolean;
  uxFont?: string;
  thinMargins: boolean;
  readOnly: boolean;
  imageSrc?: string;
  imageAlt?: string;
  imageMode: 'view' | 'edit';
  imageEditorContainer?: ContentContainer;
  onImageExport?: (blob: Blob, format: 'png' | 'jpeg' | 'webp') => void;
  allowVersioning: boolean;
  versioningAutoSaveIdleMs?: number;
  inlinePreviewWidth: number;
  outlineWidth: number;
  themeOverride: Theme | null;
}

function EditorShellInner({
  basePath,
  onChange,
  className,
  height,
  minHeight,
  maxHeight,
  placeholder,
  mediaProvider,
  container,
  filesToggleEnabled,
  toolbarSlotLeft,
  toolbarSlotAfterActions,
  toolbarSlotRight,
  showPlayTab,
  submitOnEnter,
  fullWidth,
  uxFont,
  thinMargins,
  readOnly,
  imageSrc,
  imageAlt,
  imageMode,
  imageEditorContainer,
  onImageExport,
  allowVersioning,
  versioningAutoSaveIdleMs,
  inlinePreviewWidth,
  outlineWidth,
  themeOverride,
}: EditorShellInnerProps) {
  const {
    activeView,
    markdownSource,
    doc,
    theme,
    editorMode,
    insertAtCursor,
    replaceAll,
    tiptapEditor,
    monacoEditor,
    setMarkdownSource,
    inlinePreviewVisible,
    statusBarVisible,
    outlineVisible,
    imageEditTarget,
    closeImageEdit,
    bumpMediaRevision,
  } = useEditorContext();
  const isPreview = activeView === 'preview';
  const isCodeMode = editorMode === 'code';
  const isImageMode = editorMode === 'image';
  const isMarkdownMode = editorMode === 'markdown';
  const [showFiles, setShowFiles] = useState(false);
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);
  // Persistent fallback container for image-edit sidecars when the host
  // didn't supply one. Lifted to shell scope so opening the same image
  // multiple times sees the same `.imageEdits/<sanitized>/.versions/...`
  // snapshots — otherwise each modal mount would start from an empty
  // in-memory container and history would vanish on close.
  const imageEditFallbackContainerRef = useRef<MemoryContentContainer | null>(null);
  if (imageEditFallbackContainerRef.current === null) {
    imageEditFallbackContainerRef.current = new MemoryContentContainer();
  }
  const imageEditFallbackContainer = imageEditFallbackContainerRef.current;
  const isDark = theme === 'dark';

  const handleToggleFiles = useCallback(() => {
    setShowFiles((prev) => !prev);
  }, []);

  // ── Drag-and-drop file handling ──

  /**
   * Insert an uploaded media file at the editor's current cursor.
   *
   * - In **WYSIWYG** mode, insert an actual tiptap image node via
   *   `setImage({src, alt})` (images) or a link mark (non-images).
   *   Going through `setImage` directly mirrors the Toolbar's image
   *   button and avoids the round-trip through `markdownToTiptap`
   *   that historically lost `<img>` tags to tag-strip passes.
   * - In **raw (Monaco)** or **preview** mode, fall back to
   *   `insertAtCursor` which emits the markdown snippet.
   *
   * Without this, upload-via-MediaBin and upload-via-drop both
   * added the file to the bin and nowhere else — the composer sent
   * an empty body and the downstream gezel reported "nothing came
   * through."
   */
  const insertMediaRef = useCallback(
    (relativePath: string, name: string, mimeType: string) => {
      const alt = name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const isImage = mimeType.startsWith('image/');
      const snippet = isImage ? `![${alt}](${relativePath})` : `[${alt}](${relativePath})`;

      if (activeView === 'wysiwyg' && tiptapEditor) {
        if (isImage) {
          tiptapEditor.chain().focus().setImage({ src: relativePath, alt }).run();
        } else {
          tiptapEditor
            .chain()
            .focus()
            .insertContent([
              {
                type: 'text',
                marks: [{ type: 'link', attrs: { href: relativePath } }],
                text: alt,
              },
            ])
            .run();
        }
        return;
      }
      if (activeView === 'raw' && monacoEditor) {
        insertAtCursor(snippet);
        return;
      }
      // Preview mode — no interactive editor to insert into. Append
      // to markdown source so the ref is still in the buffer.
      setMarkdownSource(markdownSource ? `${markdownSource}\n\n${snippet}` : snippet);
    },
    [activeView, tiptapEditor, monacoEditor, insertAtCursor, markdownSource, setMarkdownSource],
  );

  const handleFileDrop = useCallback(
    async (files: File[], target: DropTarget) => {
      try {
        const { media, text } = partitionFiles(files);

        // Process media files
        if (media.length > 0 && mediaProvider) {
          const paths = await processMediaFiles(media, mediaProvider);
          setMediaRefreshKey((k) => k + 1);
          // Auto-open the media bin so the user sees the new files
          if (!showFiles) setShowFiles(true);
          // Insert each uploaded file as a markdown ref at the cursor so
          // the body actually contains the attachment. Without this the
          // bin holds the file but the serialized markdown stays empty,
          // and anything downstream (chat send, document save) sees no
          // reference to the upload.
          for (let i = 0; i < media.length; i++) {
            const file = media[i];
            const path = paths[i];
            if (!file || !path) continue;
            insertMediaRef(path, file.name, file.type || 'application/octet-stream');
          }
        }

        // Process text files
        if (text.length > 0) {
          if (target === 'replace') {
            // Replace with first text file
            const content = await processTextFile(text[0]);
            replaceAll(content);
          } else {
            // Insert all text files concatenated
            const content = await processTextFiles(text);
            insertAtCursor(content);
          }
        }
      } catch (err: unknown) {
        console.error('Failed to process dropped files:', err instanceof Error ? err.message : err);
      }
    },
    [mediaProvider, showFiles, replaceAll, insertAtCursor, insertMediaRef],
  );

  const { isDragging, dragContentType, containerProps, zoneProps } = useFileDrop({
    onDrop: handleFileDrop,
  });

  // Notify parent of changes
  useEffect(() => {
    onChange?.(markdownSource);
  }, [markdownSource, onChange]);

  // Keyboard shortcuts for view switching
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case '1':
            e.preventDefault();
            document.querySelector<HTMLButtonElement>('[data-view="wysiwyg"]')?.click();
            break;
          case '2':
            e.preventDefault();
            document.querySelector<HTMLButtonElement>('[data-view="raw"]')?.click();
            break;
          case '3':
            if (!showPlayTab) return;
            e.preventDefault();
            document.querySelector<HTMLButtonElement>('[data-view="preview"]')?.click();
            break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPlayTab]);

  const autoGrow = minHeight !== undefined || maxHeight !== undefined;

  return (
    <div
      className={`squisq-editor-shell ${className || ''}`}
      data-theme={theme}
      data-full-width={fullWidth ? 'true' : undefined}
      data-thin-margins={thinMargins ? 'true' : undefined}
      data-outline-visible={isMarkdownMode && outlineVisible ? 'true' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...(autoGrow ? { minHeight, maxHeight } : { height }),
        // When a consumer supplies a UX font stack, expose it to the
        // editor CSS via this custom property. Chrome elements (toolbar,
        // tabs, status bar) consume `--squisq-ux-font` as their
        // `font-family`, falling back to the system stack when unset.
        ...(uxFont ? ({ '--squisq-ux-font': uxFont } as CSSProperties) : {}),
        // Exposed so the toolbar's view-tabs section can match the outline
        // pane's width, lining up its right-edge separator with the
        // outline's right edge. The variable is set unconditionally so the
        // outline pane itself can also read it if needed; the
        // `data-outline-visible` gate above keeps the toolbar override
        // scoped to the case where alignment matters.
        ...({ '--squisq-outline-width': `${outlineWidth}px` } as CSSProperties),
      }}
      {...containerProps}
    >
      <PreviewSettingsProvider doc={doc} themeOverride={themeOverride}>
        {/* Header. In image mode the full markdown/code Toolbar is replaced
            with a minimal slot bar — view tabs, formatting, and preview
            controls don't apply to a binary asset. */}
        {isImageMode ? (
          (toolbarSlotLeft || toolbarSlotRight) && (
            <div className="squisq-editor-header squisq-editor-header--image">
              {toolbarSlotLeft}
              <div style={{ flex: 1 }} />
              {toolbarSlotRight}
            </div>
          )
        ) : (
          <div className="squisq-editor-header">
            <Toolbar
              showFiles={showFiles}
              onToggleFiles={!isCodeMode && filesToggleEnabled ? handleToggleFiles : undefined}
              slotLeft={toolbarSlotLeft}
              slotAfterActions={
                <>
                  {toolbarSlotAfterActions}
                  {!isCodeMode && isPreview && <PreviewToolbarControls />}
                </>
              }
              slotRight={toolbarSlotRight}
              showPlayTab={showPlayTab}
            />
          </div>
        )}

        {/* Main content area */}
        <div
          className="squisq-editor-content"
          style={{
            flex: autoGrow ? '1 1 auto' : 1,
            overflowY: autoGrow ? 'auto' : 'hidden',
            overflowX: 'hidden',
            minHeight: 0,
            position: 'relative',
            display: 'flex',
          }}
        >
          <div
            style={{
              flex: autoGrow ? '1 1 auto' : 1,
              overflow: autoGrow ? 'visible' : 'hidden',
              minHeight: 0,
              position: 'relative',
            }}
          >
            {isImageMode &&
              imageSrc &&
              (imageMode === 'edit' && imageEditorContainer ? (
                <ImageEditor
                  filesContainer={imageEditorContainer}
                  initialSrc={imageSrc}
                  allowVersioning={allowVersioning}
                  versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
                  onExport={onImageExport}
                />
              ) : (
                <ImageViewer src={imageSrc} alt={imageAlt} theme={theme} />
              ))}
            {/* Raw (Monaco) view. Always wrapped in `.squisq-editor-with-gutter`
                so toggling a pane on/off doesn't change the editor's tree
                position — Monaco stays mounted and `monacoEditor` in
                context stays stable, which is what `useHeadingLayout` needs
                to compute positions. */}
            {!isImageMode && activeView === 'raw' && (
              <div className="squisq-editor-with-gutter" key="raw-shell">
                {isMarkdownMode && outlineVisible && (
                  <OutlinePanel key="outline" width={outlineWidth} />
                )}
                <div key="raw-editor" className="squisq-raw-editor-container">
                  <RawEditor
                    theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                    submitOnEnter={submitOnEnter}
                    readOnly={readOnly}
                  />
                </div>
                {isMarkdownMode && inlinePreviewVisible && (
                  <InlinePreviewGutter
                    key="inline"
                    width={inlinePreviewWidth}
                    basePath={basePath}
                    mediaProvider={mediaProvider}
                  />
                )}
              </div>
            )}
            {/* WYSIWYG + Preview are markdown-only surfaces — skip them
                entirely in code or image mode so Tiptap never initializes
                and the preview pipeline stays idle. Same always-wrapped
                pattern as the Raw branch above so pane toggles don't
                remount Tiptap. */}
            {isMarkdownMode && activeView === 'wysiwyg' && (
              <div className="squisq-editor-with-gutter" key="wysiwyg-shell">
                {outlineVisible && <OutlinePanel key="outline" width={outlineWidth} />}
                <WysiwygEditor
                  key="wysiwyg-editor"
                  submitOnEnter={submitOnEnter}
                  placeholder={placeholder}
                  readOnly={readOnly}
                />
                {inlinePreviewVisible && (
                  <InlinePreviewGutter
                    key="inline"
                    width={inlinePreviewWidth}
                    basePath={basePath}
                    mediaProvider={mediaProvider}
                  />
                )}
              </div>
            )}
            {isMarkdownMode && isPreview && (
              <PreviewPanel basePath={basePath} container={container} />
            )}
          </div>

          {isMarkdownMode && showFiles && (
            <MediaBin
              mediaProvider={mediaProvider}
              isDark={isDark}
              refreshKey={mediaRefreshKey}
              onMediaUploaded={insertMediaRef}
            />
          )}

          {/* Drop zone overlay — image / text drop UX is markdown-specific.
              In WYSIWYG, image drops are handled directly by Tiptap's
              `handleDrop` (uploads to the MediaProvider and inserts an
              image node at the mouse position). The overlay would sit on
              top with z-index: 50 and intercept the drop, so we skip it
              when the dragged content is media-only on the WYSIWYG view —
              the user gets a one-step "drop where you want it" flow
              instead of a two-step "drop in bin, then insert" flow. */}
          {isMarkdownMode &&
            isDragging &&
            !(activeView === 'wysiwyg' && dragContentType === 'media') && (
              <DropZoneOverlay
                dragContentType={dragContentType}
                zoneProps={zoneProps}
                hasMediaProvider={mediaProvider !== null}
              />
            )}
        </div>

        {/* Status bar — word / char / line / block counts. Host can
            suppress via `showStatusBar={false}` for embedded chat-style
            composers where the stats are noise. The image viewer has its
            own dimension/zoom status row, so suppress here too. */}
        {statusBarVisible && !isImageMode && <StatusBar />}
      </PreviewSettingsProvider>
      <TooltipLayer />
      {imageEditTarget !== null && mediaProvider && (
        <ImageEditModal
          relativePath={imageEditTarget}
          container={container ?? imageEditFallbackContainer}
          mediaProvider={mediaProvider}
          onClose={closeImageEdit}
          onSaved={() => {
            bumpMediaRevision();
            closeImageEdit();
          }}
          allowVersioning={allowVersioning}
          versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
          shellTheme={theme}
        />
      )}
    </div>
  );
}

// ─── ImageEditModal ────────────────────────────────────────

interface ImageEditModalProps {
  relativePath: string;
  /**
   * Host's `ContentContainer`. When non-null the editor's per-image
   * sidecar is scoped underneath it as `.imageEdits/<sanitized>/` so
   * version snapshots travel with the doc. When null (host wired only a
   * `mediaProvider`) the modal creates a fresh in-memory container for
   * the edit session — export still writes the result back through
   * `mediaProvider`.
   */
  container: ContentContainer | null;
  mediaProvider: MediaProvider;
  onClose: () => void;
  onSaved: () => void;
  allowVersioning: boolean;
  versioningAutoSaveIdleMs?: number;
  /** EditorShell's `theme` prop — 'light' or 'dark'. Threaded through so
   *  the image editor chrome matches the host shell. */
  shellTheme?: 'light' | 'dark';
}

/**
 * Modal overlay that mounts a full `<ImageEditor>` against a sidecar
 * container scoped under `.imageEdits/<sanitized-path>/` of the document's
 * `ContentContainer`. Opens when a user clicks the "Edit" affordance on an
 * image in the WYSIWYG view; on Export, rewrites the original image bytes
 * via `mediaProvider.addMedia(relativePath, blob, mime)` and bumps
 * `mediaRevision` so live `<img>` nodes pick up the new content.
 */
function ImageEditModal({
  relativePath,
  container,
  mediaProvider,
  onClose,
  onSaved,
  allowVersioning,
  versioningAutoSaveIdleMs,
  shellTheme,
}: ImageEditModalProps) {
  // Each unique image path gets its own sidecar so multiple images in the
  // same doc can be edited independently without colliding state. When the
  // host didn't supply a `container`, fall back to a fresh in-memory one
  // — the edit session is transient anyway and the final raster is what
  // gets written back through `mediaProvider`.
  const sidecar = useMemo(() => {
    const sanitized = relativePath.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const parent: ContentContainer = container ?? new MemoryContentContainer();
    return scopeContainer(parent, `.imageEdits/${sanitized}`);
  }, [container, relativePath]);

  const [initialSrc, setInitialSrc] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    mediaProvider.resolveUrl(relativePath).then(
      (url) => {
        if (!cancelled) setInitialSrc(url);
      },
      (err: unknown) => {
        if (!cancelled) {
          setResolveError(err instanceof Error ? err.message : String(err));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mediaProvider, relativePath]);

  const handleExport = useCallback(
    (blob: Blob, format: 'png' | 'jpeg' | 'webp') => {
      const mime = `image/${format}`;
      mediaProvider.addMedia(relativePath, blob, mime).then(
        () => onSaved(),
        (err: unknown) => {
          console.error('Failed to write image back:', err instanceof Error ? err.message : err);
        },
      );
    },
    [mediaProvider, relativePath, onSaved],
  );

  // Close on Escape — global listener so it works regardless of focus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="squisq-image-edit-modal"
      data-testid="image-edit-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${relativePath}`}
      onClick={(e) => {
        // Click on the dim backdrop (but not on the surface) → close.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="squisq-image-edit-modal__surface">
        <header className="squisq-image-edit-modal__header">
          <span className="squisq-image-edit-modal__title">Edit image</span>
          <span className="squisq-image-edit-modal__path">{relativePath}</span>
          <button
            type="button"
            className="squisq-image-edit-modal__close"
            data-testid="image-edit-modal-close"
            onClick={onClose}
            aria-label="Close image editor"
          >
            ×
          </button>
        </header>
        <div className="squisq-image-edit-modal__body">
          {resolveError ? (
            <div className="squisq-image-edit-modal__error">
              Failed to load image: {resolveError}
            </div>
          ) : !initialSrc ? (
            <div className="squisq-image-edit-modal__loading">Loading image…</div>
          ) : (
            <ImageEditor
              filesContainer={sidecar}
              initialSrc={initialSrc}
              allowVersioning={allowVersioning}
              versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
              onExport={handleExport}
              saveBehavior="export"
              saveFormat="png"
              saveLabel="Save and close"
              saveTitle="Save changes back to the image and close"
              surface={shellTheme === 'dark' ? DARK_SURFACE : LIGHT_SURFACE}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * EditorShell
 *
 * Top-level shell component that composes the Toolbar, ViewSwitcher, editor
 * views, and StatusBar into a complete editing experience. Wraps everything
 * in an EditorProvider for shared state.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  EditorProvider,
  useEditorContext,
  type EditorView,
  type ImageDisplayMode,
  type MentionProvider,
} from './EditorContext';
import { Toolbar } from './Toolbar';
import { StatusBar } from './StatusBar';
import { RawEditor } from './RawEditor';
import { WysiwygEditor } from './WysiwygEditor';
import { PreviewPanel } from './PreviewPanel';
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
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
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
  /** Optional MediaProvider for the Files panel. When set (even to null), a Files toggle appears in the toolbar. */
  mediaProvider?: MediaProvider | null;
  /** Optional ContentContainer for audio mapping (MP3 discovery + timing.json reading). */
  container?: ContentContainer | null;
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
  mediaProvider,
  container,
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
}: EditorShellProps) {
  // Show the toggle when explicitly opted in, or when mediaProvider prop was passed at all
  const filesToggleEnabled = showFilesToggle ?? mediaProvider !== undefined;

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
      mediaProvider={mediaProvider}
      imageDisplayMode={imageDisplayMode}
      mentionProvider={mentionProvider}
      fileName={fileName}
      language={language}
    >
      <EditorShellInner
        basePath={basePath}
        onChange={onChange}
        className={className}
        height={height}
        mediaProvider={mediaProvider ?? null}
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
        showStatusBar={showStatusBar}
      />
    </EditorProvider>
  );
}

interface EditorShellInnerProps {
  basePath: string;
  onChange?: (source: string) => void;
  className?: string;
  height: string;
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
  showStatusBar: boolean;
}

function EditorShellInner({
  basePath,
  onChange,
  className,
  height,
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
  showStatusBar,
}: EditorShellInnerProps) {
  const { activeView, markdownSource, doc, theme, editorMode, insertAtCursor, replaceAll } =
    useEditorContext();
  const isPreview = activeView === 'preview';
  const isCodeMode = editorMode === 'code';
  const [showFiles, setShowFiles] = useState(false);
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);
  const isDark = theme === 'dark';

  const handleToggleFiles = useCallback(() => {
    setShowFiles((prev) => !prev);
  }, []);

  // ── Drag-and-drop file handling ──

  const handleFileDrop = useCallback(
    async (files: File[], target: DropTarget) => {
      try {
        const { media, text } = partitionFiles(files);

        // Process media files
        if (media.length > 0 && mediaProvider) {
          await processMediaFiles(media, mediaProvider);
          setMediaRefreshKey((k) => k + 1);
          // Auto-open the media bin so the user sees the new files
          if (!showFiles) setShowFiles(true);
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
    [mediaProvider, showFiles, replaceAll, insertAtCursor],
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

  return (
    <div
      className={`squisq-editor-shell ${className || ''}`}
      data-theme={theme}
      data-full-width={fullWidth ? 'true' : undefined}
      data-thin-margins={thinMargins ? 'true' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height,
        overflow: 'hidden',
        // When a consumer supplies a UX font stack, expose it to the
        // editor CSS via this custom property. Chrome elements (toolbar,
        // tabs, status bar) consume `--squisq-ux-font` as their
        // `font-family`, falling back to the system stack when unset.
        ...(uxFont ? ({ '--squisq-ux-font': uxFont } as CSSProperties) : {}),
      }}
      {...containerProps}
    >
      <PreviewSettingsProvider doc={doc}>
        {/* Header: Toolbar (includes view tabs + preview controls) */}
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

        {/* Main content area */}
        <div
          className="squisq-editor-content"
          style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex' }}
        >
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {activeView === 'raw' && (
              <RawEditor
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                submitOnEnter={submitOnEnter}
              />
            )}
            {/* WYSIWYG + Preview are markdown-only surfaces — skip them
                entirely in code mode so Tiptap never initializes and the
                preview pipeline stays idle. */}
            {!isCodeMode && activeView === 'wysiwyg' && (
              <WysiwygEditor submitOnEnter={submitOnEnter} />
            )}
            {!isCodeMode && isPreview && <PreviewPanel basePath={basePath} container={container} />}
          </div>

          {!isCodeMode && showFiles && (
            <MediaBin mediaProvider={mediaProvider} isDark={isDark} refreshKey={mediaRefreshKey} />
          )}

          {/* Drop zone overlay — image / text drop UX is markdown-specific. */}
          {!isCodeMode && isDragging && (
            <DropZoneOverlay
              dragContentType={dragContentType}
              zoneProps={zoneProps}
              hasMediaProvider={mediaProvider !== null}
            />
          )}
        </div>

        {/* Status bar — word / char / line / block counts. Host can
            suppress via `showStatusBar={false}` for embedded chat-style
            composers where the stats are noise. */}
        {showStatusBar && <StatusBar />}
      </PreviewSettingsProvider>
      <TooltipLayer />
    </div>
  );
}

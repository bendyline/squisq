/**
 * EditorShell
 *
 * Top-level shell component that composes the Toolbar, ViewSwitcher, editor
 * views, and StatusBar into a complete editing experience. Wraps everything
 * in an EditorProvider for shared state.
 */

import { useEffect, useState, useCallback } from 'react';
import { EditorProvider, useEditorContext, type EditorView } from './EditorContext';
import { Toolbar } from './Toolbar';
import { StatusBar } from './StatusBar';
import { RawEditor } from './RawEditor';
import { WysiwygEditor } from './WysiwygEditor';
import { PreviewPanel } from './PreviewPanel';
import { MediaBin } from './MediaBin';
import { DropZoneOverlay } from './DropZoneOverlay';
import { useFileDrop, type DropTarget } from './hooks/useFileDrop';
import {
  partitionFiles,
  processMediaFiles,
  processTextFile,
  processTextFiles,
} from './utils/dropUtils';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import type { ReactNode } from 'react';

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
  /** Show the Files toggle in the toolbar. Defaults to true when mediaProvider is passed. */
  showFilesToggle?: boolean;
  /** Content rendered at the left edge of the toolbar, before the view tabs. */
  toolbarSlotLeft?: ReactNode;
  /** Content rendered after the formatting controls (in the middle area of the toolbar). */
  toolbarSlotAfterActions?: ReactNode;
  /** Content rendered at the rightmost end of the toolbar, after all other elements. */
  toolbarSlotRight?: ReactNode;
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
  showFilesToggle,
  toolbarSlotLeft,
  toolbarSlotAfterActions,
  toolbarSlotRight,
}: EditorShellProps) {
  // Show the toggle when explicitly opted in, or when mediaProvider prop was passed at all
  const filesToggleEnabled = showFilesToggle ?? mediaProvider !== undefined;

  return (
    <EditorProvider
      initialMarkdown={initialMarkdown}
      initialView={initialView}
      articleId={articleId}
      theme={theme}
    >
      <EditorShellInner
        basePath={basePath}
        onChange={onChange}
        className={className}
        height={height}
        mediaProvider={mediaProvider ?? null}
        filesToggleEnabled={filesToggleEnabled}
        toolbarSlotLeft={toolbarSlotLeft}
        toolbarSlotAfterActions={toolbarSlotAfterActions}
        toolbarSlotRight={toolbarSlotRight}
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
  filesToggleEnabled: boolean;
  toolbarSlotLeft?: ReactNode;
  toolbarSlotAfterActions?: ReactNode;
  toolbarSlotRight?: ReactNode;
}

function EditorShellInner({
  basePath,
  onChange,
  className,
  height,
  mediaProvider,
  filesToggleEnabled,
  toolbarSlotLeft,
  toolbarSlotAfterActions,
  toolbarSlotRight,
}: EditorShellInnerProps) {
  const { activeView, markdownSource, theme, insertAtCursor, replaceAll } = useEditorContext();
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
            e.preventDefault();
            document.querySelector<HTMLButtonElement>('[data-view="preview"]')?.click();
            break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      className={`squisq-editor-shell ${className || ''}`}
      data-theme={theme}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height,
        overflow: 'hidden',
      }}
      {...containerProps}
    >
      {/* Header: Toolbar (includes view tabs) */}
      <div className="squisq-editor-header">
        <Toolbar
          showFiles={showFiles}
          onToggleFiles={filesToggleEnabled ? handleToggleFiles : undefined}
          slotLeft={toolbarSlotLeft}
          slotAfterActions={toolbarSlotAfterActions}
          slotRight={toolbarSlotRight}
        />
      </div>

      {/* Main content area */}
      <div
        className="squisq-editor-content"
        style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex' }}
      >
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {activeView === 'raw' && <RawEditor theme={theme === 'dark' ? 'vs-dark' : 'vs'} />}
          {activeView === 'wysiwyg' && <WysiwygEditor />}
          {activeView === 'preview' && <PreviewPanel basePath={basePath} />}
        </div>

        {showFiles && (
          <MediaBin mediaProvider={mediaProvider} isDark={isDark} refreshKey={mediaRefreshKey} />
        )}

        {/* Drop zone overlay */}
        {isDragging && (
          <DropZoneOverlay
            dragContentType={dragContentType}
            zoneProps={zoneProps}
            hasMediaProvider={mediaProvider !== null}
          />
        )}
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

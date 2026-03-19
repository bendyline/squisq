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
import type { MediaProvider } from '@bendyline/squisq/schemas';

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
}: EditorShellProps) {
  // Show the toggle when explicitly opted in, or when mediaProvider prop was passed at all
  const filesToggleEnabled = showFilesToggle ?? (mediaProvider !== undefined);

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
}

function EditorShellInner({ basePath, onChange, className, height, mediaProvider, filesToggleEnabled }: EditorShellInnerProps) {
  const { activeView, markdownSource, theme } = useEditorContext();
  const [showFiles, setShowFiles] = useState(false);
  const isDark = theme === 'dark';

  const handleToggleFiles = useCallback(() => {
    setShowFiles((prev) => !prev);
  }, []);

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
    >
      {/* Header: Toolbar (includes view tabs) */}
      <div className="squisq-editor-header">
        <Toolbar
          showFiles={showFiles}
          onToggleFiles={filesToggleEnabled ? handleToggleFiles : undefined}
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
          <MediaBin mediaProvider={mediaProvider} isDark={isDark} />
        )}
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

/**
 * EditorShell
 *
 * Top-level shell component that composes the Toolbar, ViewSwitcher, editor
 * views, and StatusBar into a complete editing experience. Wraps everything
 * in an EditorProvider for shared state.
 */

import { useCallback, useEffect } from 'react';
import { EditorProvider, useEditorContext, type EditorView, type EditorProviderProps } from './EditorContext';
import { ViewSwitcher } from './ViewSwitcher';
import { Toolbar } from './Toolbar';
import { StatusBar } from './StatusBar';
import { RawEditor } from './RawEditor';
import { WysiwygEditor } from './WysiwygEditor';
import { PreviewPanel } from './PreviewPanel';

export type { EditorTheme } from './EditorContext';

export interface EditorShellProps {
  /** Initial markdown content */
  initialMarkdown?: string;
  /** Initial active view */
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
}

/**
 * Complete markdown editor shell with toolbar, view switcher, and three
 * editing modes: Raw (Monaco), WYSIWYG (Tiptap), and Preview.
 */
export function EditorShell({
  initialMarkdown = '',
  initialView = 'raw',
  articleId = 'untitled',
  basePath = '/',
  onChange,
  theme = 'light',
  className,
  height = '100vh',
}: EditorShellProps) {
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
      />
    </EditorProvider>
  );
}

interface EditorShellInnerProps {
  basePath: string;
  onChange?: (source: string) => void;
  className?: string;
  height: string;
}

function EditorShellInner({
  basePath,
  onChange,
  className,
  height,
}: EditorShellInnerProps) {
  const { activeView, markdownSource, theme } = useEditorContext();

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
            document.querySelector<HTMLButtonElement>('[data-view="raw"]')?.click();
            break;
          case '2':
            e.preventDefault();
            document.querySelector<HTMLButtonElement>('[data-view="wysiwyg"]')?.click();
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
      {/* Header: ViewSwitcher + Toolbar */}
      <div className="squisq-editor-header">
        <div className="squisq-editor-header-row">
          <ViewSwitcher />
        </div>
        <Toolbar />
      </div>

      {/* Main content area */}
      <div
        className="squisq-editor-content"
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
      >
        {activeView === 'raw' && <RawEditor theme={theme === 'dark' ? 'vs-dark' : 'vs'} />}
        {activeView === 'wysiwyg' && <WysiwygEditor />}
        {activeView === 'preview' && <PreviewPanel basePath={basePath} />}
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}

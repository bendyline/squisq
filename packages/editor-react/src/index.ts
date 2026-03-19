/**
 * @bendyline/squisq-editor-react
 *
 * React component library for editing markdown content with three views:
 * - Raw (Monaco) — Full markdown source editing
 * - WYSIWYG (Tiptap) — Rich text editing
 * - Preview — Rendered block preview
 *
 * @example
 * ```tsx
 * import { EditorShell } from '@bendyline/squisq-editor-react';
 * import '@bendyline/squisq-editor-react/styles';
 *
 * function App() {
 *   return <EditorShell initialMarkdown="# Hello World" />;
 * }
 * ```
 */

// Shell (top-level component)
export { EditorShell } from './EditorShell.js';
export type { EditorShellProps, EditorTheme } from './EditorShell.js';

// Context
export { EditorProvider, useEditorContext } from './EditorContext.js';
export type {
  EditorView,
  EditorState,
  EditorActions,
  EditorContextValue,
  EditorProviderProps,
} from './EditorContext.js';

// Individual editors (for custom layouts)
export { RawEditor } from './RawEditor.js';
export type { RawEditorProps } from './RawEditor.js';

export { WysiwygEditor } from './WysiwygEditor.js';
export type { WysiwygEditorProps } from './WysiwygEditor.js';

export { PreviewPanel } from './PreviewPanel.js';
export type { PreviewPanelProps } from './PreviewPanel.js';

// Chrome (for custom layouts)
export { ViewSwitcher } from './ViewSwitcher.js';
export type { ViewSwitcherProps } from './ViewSwitcher.js';

export { Toolbar } from './Toolbar.js';
export type { ToolbarProps } from './Toolbar.js';

export { MediaBin } from './MediaBin.js';
export type { MediaBinProps } from './MediaBin.js';

export { StatusBar } from './StatusBar.js';
export type { StatusBarProps } from './StatusBar.js';

// Bridge utilities
export { markdownToTiptap, tiptapToMarkdown } from './tiptapBridge.js';

// Tiptap extension: Heading with template annotation support
export { HeadingWithTemplate } from './TemplateAnnotation.js';

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
  EditorMode,
  EditorState,
  EditorActions,
  EditorContextValue,
  EditorProviderProps,
  ImageDisplayMode,
} from './EditorContext.js';

// File-kind detection — useful for hosts that want to pre-decide chrome
// around the editor based on whether a file is markdown or code.
export { resolveFileKind, detectLanguageFromFileName } from './fileKind.js';
export type { FileKind } from './fileKind.js';

// Individual editors (for custom layouts)
export { RawEditor } from './RawEditor.js';
export type { RawEditorProps } from './RawEditor.js';

export { WysiwygEditor } from './WysiwygEditor.js';
export type { WysiwygEditorProps } from './WysiwygEditor.js';

export { PreviewPanel } from './PreviewPanel.js';
export type { PreviewPanelProps } from './PreviewPanel.js';
export {
  PreviewSettingsProvider,
  PreviewToolbarControls,
  usePreviewSettings,
} from './PreviewControls.js';
export type { PreviewSettings } from './PreviewControls.js';

// Chrome (for custom layouts)
export { ViewSwitcher } from './ViewSwitcher.js';
export type { ViewSwitcherProps } from './ViewSwitcher.js';

export { Toolbar } from './Toolbar.js';
export type { ToolbarProps } from './Toolbar.js';

export { MediaBin } from './MediaBin.js';
export type { MediaBinProps } from './MediaBin.js';

export { StatusBar } from './StatusBar.js';
export type { StatusBarProps } from './StatusBar.js';

export { TooltipLayer } from './Tooltip.js';

// Drag-and-drop
export { DropZoneOverlay } from './DropZoneOverlay.js';
export type { DropZoneOverlayProps } from './DropZoneOverlay.js';

export { useFileDrop, classifyFile } from './hooks/useFileDrop.js';
export type {
  FileCategory,
  DragContentType,
  DropTarget,
  UseFileDropOptions,
  UseFileDropResult,
} from './hooks/useFileDrop.js';

export {
  partitionFiles,
  processMediaFiles,
  processTextFile,
  processTextFiles,
} from './utils/dropUtils.js';

// Bridge utilities
export { markdownToTiptap, tiptapToMarkdown } from './tiptapBridge.js';

// Slideshow builder (shared between PreviewPanel and export flows)
export { buildPreviewDoc } from './buildPreviewDoc.js';

// Tiptap extension: Heading with template annotation support
export { HeadingWithTemplate } from './TemplateAnnotation.js';

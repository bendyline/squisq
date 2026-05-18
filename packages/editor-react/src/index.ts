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
  MentionCandidate,
  MentionProvider,
  DocumentLinkCandidate,
  DocumentLinkProvider,
  ViewPreferences,
  ThemeInheritance,
} from './EditorContext.js';

// File-kind detection — useful for hosts that want to pre-decide chrome
// around the editor based on whether a file is markdown or code.
export { resolveFileKind, detectLanguageFromFileName } from './fileKind.js';
export type { FileKind } from './fileKind.js';

// Image viewer — exported standalone so hosts can use it without the
// full EditorShell when they already have their own chrome.
export { ImageViewer } from './ImageViewer.js';
export type { ImageViewerProps } from './ImageViewer.js';

// Individual editors (for custom layouts)
export { RawEditor } from './RawEditor.js';
export type { RawEditorProps } from './RawEditor.js';

export { WysiwygEditor } from './WysiwygEditor.js';
export type { WysiwygEditorProps } from './WysiwygEditor.js';

export { PreviewPanel } from './PreviewPanel.js';
export type { PreviewPanelProps } from './PreviewPanel.js';
export { PlainHtmlPreview } from './PlainHtmlPreview.js';
export type { PlainHtmlPreviewProps } from './PlainHtmlPreview.js';
export { EmojiPicker } from './EmojiPicker.js';
export type { EmojiPickerProps } from './EmojiPicker.js';
export { DocumentSettingsDialog } from './DocumentSettingsDialog.js';
export type { DocumentSettingsDialogProps } from './DocumentSettingsDialog.js';
export { ThemePicker } from './ThemePicker.js';
export type { ThemePickerProps } from './ThemePicker.js';
export { EMOJI_CATEGORIES, ALL_EMOJIS, searchEmojis } from './emojiData.js';
export type { EmojiEntry, EmojiCategory } from './emojiData.js';
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

export { VersionHistoryPanel } from './VersionHistoryPanel.js';
export { ViewMenuPanel } from './ViewMenuPanel.js';
export { OutlinePanel } from './OutlinePanel.js';
export type { OutlinePanelProps } from './OutlinePanel.js';
export { ThemeCustomizerPanel } from './ThemeCustomizerPanel.js';
export type { ThemeCustomizerPanelProps } from './ThemeCustomizerPanel.js';
export { TemplatePicker, templateLabel } from './TemplatePicker.js';
export { InlinePreviewGutter } from './InlinePreviewGutter.js';
export type { InlinePreviewGutterProps } from './InlinePreviewGutter.js';

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

// JSON Form — editable component
export { JsonEditor } from './jsonEditor/index.js';
export type { JsonEditorProps } from './jsonEditor/index.js';

// Recorder — browser-based audio/camera/screen capture. Components and
// hooks for capturing media via `MediaRecorder` and persisting the
// resulting blob into a `ContentContainer` through the host's
// `MediaProvider`. Previously published as `@bendyline/squisq-recorder-react`;
// folded into editor-react so it ships with the editor it's wired into.
export { RecorderModal } from './recorder/RecorderModal.js';
export type { RecorderModalProps, RecorderSaveResult } from './recorder/RecorderModal.js';
export { RecorderButton } from './recorder/RecorderButton.js';
export type { RecorderButtonProps } from './recorder/RecorderButton.js';
export { RecorderPanel } from './recorder/RecorderPanel.js';
export type { RecorderPanelProps } from './recorder/RecorderPanel.js';
export { useMediaRecorder, getCaptureKind } from './recorder/hooks/useMediaRecorder.js';
export type {
  UseMediaRecorderOptions,
  UseMediaRecorderResult,
  RecorderSource,
  RecorderState,
} from './recorder/hooks/useMediaRecorder.js';
export { useStreamPreview } from './recorder/hooks/useStreamPreview.js';
export { requestMicStream } from './recorder/sources/micStream.js';
export { requestCameraStream } from './recorder/sources/cameraStream.js';
export type { CameraStreamOptions } from './recorder/sources/cameraStream.js';
export { requestScreenStream } from './recorder/sources/screenStream.js';
export type { ScreenStreamOptions, ScreenStreamHandle } from './recorder/sources/screenStream.js';
export {
  resolveFormat,
  supportsMediaRecorder,
  supportsUserMedia,
  supportsDisplayMedia,
  buildFilename,
} from './recorder/formats.js';
export type { CaptureKind, ResolvedFormat } from './recorder/formats.js';
export { buildTimingJson, encodeTimingJson, timingPathFor } from './recorder/timingJson.js';
export type { TimingJson, RecordedBookmark } from './recorder/timingJson.js';

// Image editor — layered, sidecar-persisted raster authoring surface.
// Pairs with `ImageViewer` and the `<basename>_files/` sidecar convention.
export { ImageEditor } from './ImageEditor.js';
export type { ImageEditorProps } from './ImageEditor.js';
export { useImageEditor } from './imageEditor/useImageEditor.js';
export type { UseImageEditorOptions, UseImageEditorReturn } from './imageEditor/useImageEditor.js';
export { imageEditorReducer, initialImageEditorState } from './imageEditor/state.js';
export type {
  ImageEditorState,
  ImageEditorAction,
  ImageEditorTool,
  CanvasRect,
} from './imageEditor/state.js';

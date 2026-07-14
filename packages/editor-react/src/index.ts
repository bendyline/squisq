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
export type { EditorShellProps, EditorColorScheme } from './EditorShell.js';

// Code-context sections (host-supplied markdown injected into the code surface)
export { CodeContextZones } from './codeContext/CodeContextZones.js';
export type { CodeContext, CodeContextSection } from './codeContext/types.js';

// FolderView — standalone folder browser surface (companion to the shell)
export { FolderView } from './FolderView.js';
export type { FolderViewProps, FolderEntry } from './FolderView.js';

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
  BlockTagVisibility,
  LayoutMode,
} from './EditorContext.js';

// Block-at-a-time primitives — reusable outside EditorShell. `useBlockNavigator`
// drives a one-block-at-a-time editing channel from any `(source, setSource)`
// pair; `BlockCardView` is the matching card chrome; the `blockRange` utilities
// are pure source-slicing helpers.
export { useBlockNavigator } from './useBlockNavigator.js';
export type { BlockNavigator, UseBlockNavigatorOptions } from './useBlockNavigator.js';
export { BlockCardView } from './BlockCardView.js';
export type { BlockCardViewProps } from './BlockCardView.js';
export {
  getBlockSlices,
  spliceBlock,
  lineToOffset,
  offsetToLine,
  sliceIndexAtOffset,
} from './blockRange.js';
export type { BlockRange, BlockSlice } from './blockRange.js';

// Timeline view — the horizontal block + media track and the line-level
// markdown write-back helpers it commits edits through.
export { TimelineTrack } from './TimelineTrack.js';
export type { TimelineTrackProps } from './TimelineTrack.js';
export { formatSeconds, setBlockDurationInSource, setMediaClipInSource } from './timelineSource.js';
export type { MediaClipPatch } from './timelineSource.js';

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
export type { WriteCanvasSettings } from './writeCanvasSettings.js';

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
export { PICKER_CATEGORIES, ALL_PICKER_ENTRIES, searchPickerEntries } from './emojiData.js';
export type { PickerEntry, PickerCategory } from './emojiData.js';
export {
  PreviewSettingsProvider,
  PreviewToolbarControls,
  PreviewModeMenu,
  PreviewModeSwitch,
  PreviewFormatSwitch,
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
export { TransitionPicker } from './TransitionPicker.js';
export type { TransitionPickerProps } from './TransitionPicker.js';
export {
  TRANSITION_GROUPS,
  TRANSITION_ENTRIES,
  transitionLabel,
  findTransitionEntry,
} from './transitionCatalog.js';
export type {
  TransitionGroup,
  TransitionCatalogEntry,
  DirectionModel,
} from './transitionCatalog.js';
export {
  readHeadingLineTransition,
  setHeadingLineTransition,
  readBlockAttrsTransition,
  setHeadingAttrsTransition,
  EMPTY_TRANSITION,
} from './headingTransition.js';
export type { HeadingTransitionAttrs, TransitionFields } from './headingTransition.js';
export {
  readBlockAttrsParams,
  readBlockAttrsValue,
  setBlockAttrsValue,
  summarizeBlockProps,
} from './blockProperties.js';
export { BlockPropertiesPopover } from './BlockPropertiesPopover.js';
export type { BlockPropertiesPopoverProps } from './BlockPropertiesPopover.js';
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

// Monaco lazy loader — exported so hosts embedding RawEditor-like surfaces
// can share the same load-once Monaco bootstrap.
export { useMonacoLoader } from './useMonacoLoader.js';
export type { UseMonacoLoaderResult } from './useMonacoLoader.js';

// Monaco language-service worker wiring — the host supplies the `?worker`
// constructors, this owns the label→worker mapping. See monacoWorkers.ts.
export { configureMonacoWorkers } from './monacoWorkers.js';
export type { MonacoWorkerConstructor, MonacoWorkerConstructors } from './monacoWorkers.js';

// Custom themes — provider stack (doc frontmatter + browser-local library)
export {
  CustomThemeProvider,
  useCustomThemes,
  useDocCustomThemes,
  ImportThemeSection,
  draftPatchFromImportedTheme,
} from './customThemes/index.js';
export type {
  CustomThemeContextValue,
  CustomThemeProviderProps,
  DocCustomThemes,
  ImportThemeSectionProps,
  ImportedThemeResult,
  ThemeSaveExtras,
} from './customThemes/index.js';

// Custom templates — provider stack (doc frontmatter + browser-local library)
export {
  CustomTemplateProvider,
  useCustomTemplates,
  useDocCustomTemplates,
} from './customTemplates/index.js';
export type {
  CustomTemplateContextValue,
  CustomTemplateProviderProps,
  DocCustomTemplates,
} from './customTemplates/index.js';

// Bridge utilities
export { markdownToTiptap, tiptapToMarkdown } from './tiptapBridge.js';

// Slideshow builder (shared between PreviewPanel and export flows)
export { buildPreviewDoc } from './buildPreviewDoc.js';

// Tiptap extension: Heading with template annotation support
export { HeadingWithTemplate } from './TemplateAnnotation.js';

// Diagram editor — ASCII fences are the authored diagram format. The
// AsciiDiagramExtension turns code fences containing box-and-line art
// into interactive canvases; edits re-render the art (the fence stays the
// source of truth). Legacy `{[diagram]}` heading sections still RENDER in
// preview/player via core, but heading-based canvas editing was removed
// (BREAKING: DiagramExtension / DiagramWidget / useDiagramData / the
// heading command helpers are gone).
export { DiagramCanvas } from './diagram/DiagramCanvas.js';
export type { DiagramCommand } from './diagram/DiagramCanvas.js';
export type { DiagramData, DiagramNode, DiagramEdge } from './diagram/types.js';
export {
  AsciiDiagramExtension,
  findAsciiDiagramBlockPos,
  isAsciiSourceVisible,
  toggleAsciiSource,
} from './asciiDiagram/AsciiDiagramExtension.js';
export type {
  AsciiDiagramBlockEntry,
  AsciiDiagramExtensionOptions,
  AsciiDiagramPluginState,
} from './asciiDiagram/AsciiDiagramExtension.js';
export { AsciiDiagramWidget } from './asciiDiagram/AsciiDiagramWidget.js';
export { useAsciiDiagramData, asciiDiagramToCanvas } from './asciiDiagram/asciiDiagramData.js';
export type { AsciiDiagramView } from './asciiDiagram/asciiDiagramData.js';
export {
  applyAsciiDiagramCommand,
  applyRepairCommand,
  replaceAsciiFenceText,
} from './asciiDiagram/asciiDiagramCommands.js';
export type { ApplyAsciiDiagramCommandOptions } from './asciiDiagram/asciiDiagramCommands.js';
// RepairableDiagramExtension mounts an inline "Repair as diagram" button on
// code fences holding BROKEN box art — art too misaligned for clean detection
// (so it renders as a faithful code block). One click reconstructs it into
// clean `diagram`-tagged art that the AsciiDiagramExtension turns into a
// canvas. Peer to the diagram/tree editors; claims the fences neither does.
export {
  RepairableDiagramExtension,
  findRepairableBlockPos,
  isRepairableFence,
  REPAIRABLE_KEY,
} from './asciiDiagram/RepairableDiagramExtension.js';
export type {
  RepairableBlockEntry,
  RepairableDiagramExtensionOptions,
  RepairablePluginState,
} from './asciiDiagram/RepairableDiagramExtension.js';
export {
  addEdgeOp,
  addNodeOp,
  moveNodeOp,
  removeEdgeOp,
  removeNodeOp,
  renameNodeOp,
  resizeNodeOp,
  sanitizeAsciiLabel,
  translateDiagramOp,
} from './asciiDiagram/asciiDiagramOps.js';
export { shouldPasteAsAsciiFence } from './asciiDiagram/asciiPaste.js';

// Complex diagram editor — every explicit `mermaid` fence is rendered through
// Mermaid's public renderer inside the shared diagram chrome. Flowcharts add
// source-backed node/edge gestures and the full Mermaid shape catalog; every
// other diagram family remains lossless render + source editing.
export {
  MermaidDiagramExtension,
  MERMAID_DIAGRAM_KEY,
  findMermaidDiagramBlockPos,
  isMermaidDiagramNode,
  isMermaidSourceVisible,
  toggleMermaidSource,
} from './mermaid/MermaidDiagramExtension.js';
export type {
  MermaidDiagramBlockEntry,
  MermaidDiagramExtensionOptions,
  MermaidDiagramPluginState,
} from './mermaid/MermaidDiagramExtension.js';
export { MermaidDiagramWidget } from './mermaid/MermaidDiagramWidget.js';
export type { MermaidDiagramWidgetProps } from './mermaid/MermaidDiagramWidget.js';
export { MermaidDiagramCanvas } from './mermaid/MermaidDiagramCanvas.js';
export type {
  MermaidDiagramCanvasProps,
  MermaidNodeCanvasAction,
} from './mermaid/MermaidDiagramCanvas.js';
export { useMermaidDiagramData } from './mermaid/mermaidData.js';
export type { MermaidDiagramData } from './mermaid/mermaidData.js';
export {
  renderMermaidDiagram,
  inspectMermaidSource,
  mermaidErrorMessage,
} from './mermaid/mermaidRenderer.js';
export type { MermaidRenderResult } from './mermaid/mermaidRenderer.js';
export { MermaidShapePalette } from './mermaid/MermaidShapePalette.js';
export type { MermaidShapePaletteProps } from './mermaid/MermaidShapePalette.js';
export {
  MERMAID_FLOWCHART_SHAPES,
  isMermaidFlowchartShapeId,
  normalizeMermaidFlowchartShape,
} from './mermaid/mermaidShapes.js';
export type { MermaidFlowchartShape, MermaidFlowchartShapeId } from './mermaid/mermaidShapes.js';
export type {
  MermaidEditableEdge,
  MermaidEditableModel,
  MermaidEditableNode,
  MermaidFlowchartDirection,
  MermaidFlowchartModel,
} from './mermaid/mermaidModel.js';
export {
  DEFAULT_MERMAID_DIAGRAM_TYPE,
  MERMAID_DIAGRAM_TYPES,
  mermaidDiagramMarkdown,
} from './mermaid/mermaidDiagramTypes.js';
export type {
  MermaidDiagramCategory,
  MermaidDiagramPreview,
  MermaidDiagramType,
} from './mermaid/mermaidDiagramTypes.js';
export { MermaidDiagramTypeThumbnail } from './mermaid/MermaidDiagramTypeThumbnail.js';

// Code snippets — every ordinary explicit-language fence is replaced in the
// WYSIWYG surface by a Monaco inset. The fence node remains authoritative, so
// edits preserve the exact language tag and source when serialized to Markdown.
export {
  CodeSnippetExtension,
  CODE_SNIPPET_KEY,
  findCodeSnippetBlockPos,
  isCodeSnippetNode,
} from './codeSnippet/CodeSnippetExtension.js';
export type {
  CodeSnippetBlockEntry,
  CodeSnippetExtensionOptions,
  CodeSnippetPluginState,
} from './codeSnippet/CodeSnippetExtension.js';
export { CodeSnippetWidget } from './codeSnippet/CodeSnippetWidget.js';
export type { CodeSnippetWidgetProps } from './codeSnippet/CodeSnippetWidget.js';
export { replaceCodeSnippetText } from './codeSnippet/codeSnippetCommands.js';
export { useCodeSnippetData } from './codeSnippet/codeSnippetData.js';
export type { CodeSnippetData } from './codeSnippet/codeSnippetData.js';
export {
  CODE_SNIPPET_LANGUAGES,
  codeSnippetFenceLanguageToken,
  codeSnippetLanguageLabel,
  codeSnippetMarkdown,
  isCodeSnippetFenceLanguage,
  monacoLanguageForFence,
} from './codeSnippet/codeSnippetLanguages.js';
export type { CodeSnippetLanguage } from './codeSnippet/codeSnippetLanguages.js';

// Treeview editor — ASCII file-tree / outline fences get an interactive
// outline widget; edits re-render the tree art (the fence stays the source
// of truth). Peer to the ASCII diagram editor; mutually exclusive with it
// (a fence with boxes is a diagram, not a tree).
export { TreeViewExtension, findTreeBlockPos } from './treeview/TreeViewExtension.js';
export type {
  TreeBlockEntry,
  TreeViewExtensionOptions,
  TreeViewPluginState,
} from './treeview/TreeViewExtension.js';
export { TreeOutlineWidget } from './treeview/TreeOutlineWidget.js';
export { useTreeViewData } from './treeview/treeViewData.js';
export type { TreeViewData } from './treeview/treeViewData.js';
export { applyTreeCommand, replaceTreeFenceText } from './treeview/treeViewCommands.js';
export type { TreeCommand } from './treeview/treeViewCommands.js';
export {
  addItemOp,
  indentItemOp,
  moveItemDownOp,
  moveItemUpOp,
  outdentItemOp,
  removeItemOp,
  renameItemOp,
  sanitizeTreeLabel,
  toggleDirOp,
} from './treeview/treeOps.js';
export { shouldPasteAsTreeFence } from './treeview/treePaste.js';

// Timeline editor — authored marker-rail fences become an accessible canvas
// with add-point affordances and a selected-point inspector. Semantic edits
// re-render the canonical `timeline` fence in one undoable transaction.
export {
  TimelineViewExtension,
  TIMELINE_VIEW_KEY,
  findTimelineBlockPos,
  getTimelineForNode,
  parseTimelineForNode,
} from './timeline/TimelineViewExtension.js';
export type {
  TimelineBlockEntry,
  TimelineViewExtensionOptions,
  TimelineViewPluginState,
} from './timeline/TimelineViewExtension.js';
export { TimelineEditorWidget } from './timeline/TimelineEditorWidget.js';
export type { TimelineEditorWidgetProps } from './timeline/TimelineEditorWidget.js';
export { useTimelineData } from './timeline/timelineData.js';
export type { TimelineViewData } from './timeline/timelineData.js';
export {
  applyTimelineCommand,
  isTimelineSourceSafeForSemanticEdit,
} from './timeline/timelineCommands.js';
export type { TimelineCommand, TimelineCommandResult } from './timeline/timelineCommands.js';
export {
  addTimelineEventOp,
  nextTimelineEventId,
  removeTimelineEventOp,
  sanitizeTimelineText,
  updateTimelineEventOp,
} from './timeline/timelineOps.js';
export type {
  AddTimelineEventOptions,
  AddTimelineEventResult,
  TimelineEventPatch,
} from './timeline/timelineOps.js';
export { shouldPasteAsTimelineFence } from './timeline/timelinePaste.js';

// JSON Form — editable component
export { JsonEditor } from './jsonEditor/index.js';
export type { JsonEditorProps } from './jsonEditor/index.js';

// Recorder — browser-based audio/camera/screen capture. Components and
// hooks for capturing media via `MediaRecorder` and persisting the
// resulting blob into a `ContentContainer` through the host's
// `MediaProvider`. Previously published as `@bendyline/squisq-recorder-react`;
// folded into editor-react so it ships with the editor it's wired into.
export { RecorderModal } from './recorder/RecorderModal.js';
export type {
  RecorderColorScheme,
  RecorderModalProps,
  RecorderSaveResult,
} from './recorder/RecorderModal.js';
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

// Teleprompter — the Narrate display mode under the Use tab: voice-paced
// prompter surface, floating-window tiers, and the mic analysis pipeline.
export {
  TeleprompterView,
  TeleprompterSurface,
  TeleprompterControls,
  useTeleprompter,
  useNarrationRecorder,
  buildNarrationSavePlan,
  executeNarrationSave,
  insertNarrationPreamble,
  narrationAnnotationLine,
  cameraVideoLine,
  vadConfigForSensitivity,
  useMicAnalysis,
  PCM_WORKLET_SOURCE,
  PCM_WORKLET_NAME,
  registerPcmWorklet,
  createFloatingWindowManager,
  detectFloatTiers,
  useFloatingWindow,
  measureTokenLines,
  targetOffsetFor,
  stepScroll,
  EYE_LINE_FRACTION,
  TELEPROMPTER_CSS,
  ensureTeleprompterStyles,
  prompterVarsFromTheme,
  DEFAULT_TELEPROMPTER_PREFS,
} from './teleprompter/index.js';
export type {
  TeleprompterViewProps,
  TeleprompterSurfaceProps,
  TeleprompterControlsProps,
  TeleprompterController,
  TeleprompterRecordingDeps,
  NarrationRecorderController,
  NarrationRecorderState,
  NarrationTake,
  NarrationSavePlan,
  NarrationSaveResult,
  MicAnalysisHandle,
  MicAnalysisStatus,
  FloatingWindowManager,
  FloatOpenOptions,
  CanvasSink,
  FloatingWindowHandle,
  TokenLineMap,
  TeleprompterPrefs,
  PrompterTransport,
  FloatTier,
} from './teleprompter/index.js';

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

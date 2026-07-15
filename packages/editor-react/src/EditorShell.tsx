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
  type DocumentLinkProvider,
  type ViewPreferences,
  type ThemeInheritance,
  type BlockTagVisibility,
} from './EditorContext';
import { Toolbar } from './Toolbar';
import { StatusBar } from './StatusBar';
import { RawEditor } from './RawEditor';
import { WysiwygEditor } from './WysiwygEditor';
import { InlinePreviewGutter } from './InlinePreviewGutter';
import { BlockPreviewPanel } from './BlockPreviewPanel';
import { OutlinePanel, OUTLINE_RESPONSIVE_WIDTH } from './OutlinePanel';
import { CodeContextZones } from './codeContext/CodeContextZones';
import type { CodeContext } from './codeContext/types';
import { BlockCardView } from './BlockCardView';
import { TimelineTrack } from './TimelineTrack';
import { PreviewPanel } from './PreviewPanel';
import { ImageViewer } from './ImageViewer';
import { ImageEditor } from './ImageEditor';
import {
  PreviewSettingsProvider,
  PreviewToolbarControls,
  ThemeDesignerDock,
} from './PreviewControls';
import { PresentationModeControl, PresentationModeProvider } from './presentation/PresentationMode';
import {
  PrintModeControl,
  PrintModeProvider,
  PrintPreviewToolbar,
  usePrintMode,
} from './print/PrintMode';
import { CustomThemeProvider, useDocCustomThemes } from './customThemes';
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
import {
  collectMediaReferencesFromMarkdown,
  removeMediaReferencesFromMarkdown,
} from './mediaReferences';
import { filterVisibleMediaEntries } from './mediaEntries';
import type { MediaProvider, Theme } from '@bendyline/squisq/schemas';
import { DARK_SURFACE, LIGHT_SURFACE } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import {
  MemoryContentContainer,
  scopeContainer,
  createMediaProviderFromContainer,
} from '@bendyline/squisq/storage';
import type { PrunePolicy, SaveVersionResult } from '@bendyline/squisq/versions';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from 'react';
import { MediaContext } from '@bendyline/squisq-react';
import { writeCanvasSettingsStyle, type WriteCanvasSettings } from './writeCanvasSettings';
import { useModalDialog } from './modal/useModalDialog';

export type { EditorColorScheme } from './EditorContext';

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
  /**
   * Light/dark chrome color scheme for the editor shell — toolbar, tabs,
   * status bar, and side panes (default: `'light'`). This is the editor's
   * UI mode, **not** a Squisq `Theme` object; the rendered document's
   * styling is controlled separately via `themeOverride` / `Doc.themeId`.
   */
  colorScheme?: 'light' | 'dark';
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
  /**
   * The workspace-scoped `ContentContainer` for this document — the
   * folder that contains the doc, its `_files/` sidecar, sibling
   * documents, and any version snapshots. Used for:
   *  - audio mapping (MP3 discovery + timing.json reading);
   *  - version history snapshots (when `allowVersioning` is true);
   *  - reading sibling `.md` files for the recursive HTML export;
   *  - resolving per-document scoped views (e.g. the image-edit
   *    sidecar derived via `scopeContainer`).
   * Doc-scoped concerns (per-doc media URLs, per-doc asset writes)
   * flow through `mediaProvider` instead — typically derived from
   * this container via `createMediaProviderFromContainer`.
   */
  workspaceContainer?: ContentContainer | null;
  /**
   * Enable version history. Snapshots are stored at
   * `.versions/<basename>.<timestamp>.md` inside the same
   * `workspaceContainer`, so they ride along with the document when
   * the host serializes.
   *
   * Snapshots fire on idle (controlled by `versioningAutoSaveIdleMs`)
   * and can also be triggered host-side via the manager exposed in the
   * context (`useEditorContext().versioning`). Has no effect without a
   * `workspaceContainer` — a `console.warn` flags the misconfiguration
   * in dev.
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
  /** Host-supplied content rendered at the right edge of the bottom status bar. */
  statusBarSlotRight?: ReactNode;
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
   * Host-supplied context dictionary rendered inside the Monaco (raw / code)
   * surface: collapsible markdown sections injected above anchor lines, plus
   * an optional file-top summary. See {@link CodeContext}. Ignored in
   * WYSIWYG / preview / image surfaces.
   */
  codeContext?: CodeContext;
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
   * Host-controlled typography for the markdown Write canvas. `textSize` is
   * measured in CSS pixels and `lineSpacing` is a unitless line-height
   * multiplier. This is presentation-only and does not modify the markdown.
   */
  writeCanvasSettings?: WriteCanvasSettings;
  /**
   * Render the bottom status bar (word / character / line / block counts,
   * parse errors, and optional host status). Defaults to `true`. Set to `false` in
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
   * Controlled Find-mode state. Find has no built-in trigger button; hosts
   * opt in by setting this prop (or by calling `setFindMode` from a toolbar
   * slot rendered inside the editor context).
   */
  findMode?: boolean;
  /** Called when Find mode requests a state change, including its X button. */
  onFindModeChange?: (active: boolean) => void;
  /**
   * Optional async provider for `@`-mention suggestions. When supplied,
   * typing `@` inside the editor opens a popover of candidates; selecting
   * one inserts a `@[Label](scheme:id)` mention token. Used by chat
   * composers and any other surface that wants to address named entities
   * inline. Omit to disable mentions entirely.
   */
  mentionProvider?: MentionProvider | null;
  /**
   * Optional async provider for sibling-document suggestions in the
   * link insert dialog. When supplied, the dialog gains a "Browse
   * documents" picker so authors can pick a neighbor `.md` by name and
   * insert a relative-path link without typing the URL by hand. Hosts
   * that organize docs in a workspace (file-system, IndexedDB slot,
   * remote API, …) implement this; the editor stays agnostic.
   */
  documentLinkProvider?: DocumentLinkProvider | null;
  /**
   * Extra link schemes this host resolves itself (e.g. an app-internal
   * navigation protocol). The link dialog validates typed URLs against
   * core's `sanitizeUrl` with these allowed, so an author isn't told a
   * scheme the host DOES handle is unsupported. Executable schemes
   * (`javascript:`, `vbscript:`, `data:`) are refused regardless.
   */
  linkSchemes?: readonly string[];
  /**
   * Whether the in-editor media recorder is surfaced in the toolbar.
   * Defaults to true — when a `mediaProvider` is wired, a record
   * button appears next to the version history. Pass `false` to
   * suppress it (read-only embeds, surfaces where camera/screen
   * permission prompts would be jarring). Without a `mediaProvider`,
   * the button is hidden regardless of this prop.
   */
  allowRecording?: boolean;
  /**
   * Whether the Narrate (teleprompter) display mode is offered under the
   * Use tab. Defaults to true. Orthogonal to `allowRecording` — the
   * prompter is useful without capture (reading for external recording
   * software), and the in-mode Record affordance additionally requires
   * `allowRecording` + a `mediaProvider`.
   */
  allowNarrate?: boolean;
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
   * Fixed width in pixels for the outline pane. When omitted, the pane sizes
   * responsively — never narrower than 260px, growing with the window and
   * capped at 460px — so it stretches out when there's horizontal space to
   * spare. Only takes effect when {@link EditorShellProps.outline} is true (or
   * the View menu has toggled it on).
   */
  outlineWidth?: number;
  /**
   * Legacy initial visibility of inline block-template tags on headings.
   * `true` maps to always visible and `false` maps to hidden. When omitted,
   * {@link blockTagVisibility} defaults to `'active'`.
   */
  blockTags?: boolean;
  /**
   * Initial block-tag visibility mode. Takes precedence over `blockTags`.
   * Defaults to `'active'` (selected/hovered block only).
   */
  blockTagVisibility?: BlockTagVisibility;
  /**
   * How much of the active Squisq theme the WYSIWYG editing surface
   * mirrors. Defaults to `'fonts'` — the historical behavior of
   * inheriting body / heading fonts only. The View menu can change it
   * at runtime.
   */
  themeInheritance?: ThemeInheritance;
  /**
   * Bundled view preferences — a serializable JSON blob covering the
   * runtime-toggleable view options surfaced in the View menu. When
   * provided, fields here override the corresponding individual props
   * (`outline`, `inlinePreview`, `showStatusBar`, `blockTagVisibility`,
   * `blockTags`). Pair with
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
  colorScheme = 'light',
  className,
  height = '100vh',
  minHeight,
  maxHeight,
  mediaProvider,
  workspaceContainer,
  allowVersioning = false,
  versionBasename,
  versioningPrunePolicy,
  versioningAutoSaveIdleMs,
  onSaveVersion,
  showFilesToggle,
  toolbarSlotLeft,
  toolbarSlotAfterActions,
  toolbarSlotRight,
  statusBarSlotRight,
  showPlayTab = true,
  submitOnEnter,
  codeContext,
  fullWidth = false,
  uxFont,
  thinMargins = false,
  writeCanvasSettings,
  showStatusBar = true,
  imageDisplayMode = 'inline',
  fileName,
  language,
  findMode,
  onFindModeChange,
  mentionProvider,
  documentLinkProvider,
  linkSchemes,
  allowRecording = true,
  allowNarrate = true,
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
  outlineWidth,
  blockTags,
  blockTagVisibility,
  themeInheritance = 'fonts',
  viewPreferences,
  onViewPreferencesChange,
  themeOverride = null,
}: EditorShellProps) {
  const effectiveContainer = workspaceContainer ?? null;

  // If the host gave us a `workspaceContainer` but no explicit `mediaProvider`,
  // derive one automatically. Without this, drag-and-drop of an image
  // into the editor silently failed (no provider \u2192 nothing to upload to)
  // even though we had a perfectly good ContentContainer to write into.
  const effectiveMediaProvider = useMemo<MediaProvider | null | undefined>(() => {
    if (mediaProvider !== undefined) return mediaProvider;
    if (effectiveContainer) return createMediaProviderFromContainer(effectiveContainer);
    return undefined;
  }, [mediaProvider, effectiveContainer]);

  // Show the toggle when explicitly opted in, or when mediaProvider prop was passed at all
  const filesToggleEnabled = showFilesToggle ?? effectiveMediaProvider !== undefined;

  // If the host hides the Play tab but asked for it as the initial view,
  // fall back to wysiwyg so we don't boot into a tab the user can't leave.
  const effectiveInitialView: EditorView =
    !showPlayTab && initialView === 'preview' ? 'wysiwyg' : initialView;

  return (
    <MediaContext.Provider value={effectiveMediaProvider ?? null}>
      <EditorProvider
        initialMarkdown={initialMarkdown}
        initialView={effectiveInitialView}
        articleId={articleId}
        colorScheme={colorScheme}
        workspaceContainer={effectiveContainer}
        allowVersioning={allowVersioning}
        versionBasename={versionBasename}
        versioningPrunePolicy={versioningPrunePolicy}
        versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
        onSaveVersion={onSaveVersion}
        mediaProvider={effectiveMediaProvider}
        imageDisplayMode={imageDisplayMode}
        mentionProvider={mentionProvider}
        documentLinkProvider={documentLinkProvider}
        linkSchemes={linkSchemes}
        allowRecording={allowRecording}
        allowNarrate={allowNarrate}
        fileName={fileName}
        language={language}
        findMode={findMode}
        onFindModeChange={onFindModeChange}
        inlinePreview={inlinePreview}
        showStatusBar={showStatusBar}
        outline={outline}
        blockTags={blockTags}
        blockTagVisibility={blockTagVisibility}
        themeInheritance={themeInheritance}
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
          workspaceContainer={effectiveContainer}
          filesToggleEnabled={filesToggleEnabled}
          toolbarSlotLeft={toolbarSlotLeft}
          toolbarSlotAfterActions={toolbarSlotAfterActions}
          toolbarSlotRight={toolbarSlotRight}
          statusBarSlotRight={statusBarSlotRight}
          showPlayTab={showPlayTab}
          submitOnEnter={submitOnEnter}
          codeContext={codeContext}
          fullWidth={fullWidth}
          uxFont={uxFont}
          thinMargins={thinMargins}
          writeCanvasSettings={writeCanvasSettings}
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
    </MediaContext.Provider>
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
  workspaceContainer?: ContentContainer | null;
  filesToggleEnabled: boolean;
  toolbarSlotLeft?: ReactNode;
  toolbarSlotAfterActions?: ReactNode;
  toolbarSlotRight?: ReactNode;
  statusBarSlotRight?: ReactNode;
  showPlayTab: boolean;
  submitOnEnter?: () => void;
  codeContext?: CodeContext;
  fullWidth: boolean;
  uxFont?: string;
  thinMargins: boolean;
  writeCanvasSettings?: WriteCanvasSettings;
  readOnly: boolean;
  imageSrc?: string;
  imageAlt?: string;
  imageMode: 'view' | 'edit';
  imageEditorContainer?: ContentContainer;
  onImageExport?: (blob: Blob, format: 'png' | 'jpeg' | 'webp') => void;
  allowVersioning: boolean;
  versioningAutoSaveIdleMs?: number;
  inlinePreviewWidth: number;
  outlineWidth?: number;
  themeOverride: Theme | null;
}

function UseModeToolbarControls() {
  const printMode = usePrintMode();
  if (printMode.active) return <PrintPreviewToolbar />;
  return (
    <>
      <PreviewToolbarControls />
      <PresentationModeControl />
      <PrintModeControl />
    </>
  );
}

function UseModeProviders({
  rootRef,
  children,
}: {
  rootRef: RefObject<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <PresentationModeProvider rootRef={rootRef}>
      <PrintModeProvider rootRef={rootRef}>{children}</PrintModeProvider>
    </PresentationModeProvider>
  );
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
  workspaceContainer,
  filesToggleEnabled,
  toolbarSlotLeft,
  toolbarSlotAfterActions,
  toolbarSlotRight,
  statusBarSlotRight,
  showPlayTab,
  submitOnEnter,
  codeContext,
  fullWidth,
  uxFont,
  thinMargins,
  writeCanvasSettings,
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
  const shellRef = useRef<HTMLDivElement>(null);
  const {
    activeView,
    markdownSource,
    doc,
    colorScheme,
    editorMode,
    insertAtCursor,
    replaceAll,
    tiptapEditor,
    monacoEditor,
    setMarkdownSource,
    inlinePreviewVisible,
    statusBarVisible,
    outlineVisible,
    layoutMode,
    blockCount,
    activeBlockKey,
    prevBlock,
    nextBlock,
    addBlock,
    imageEditTarget,
    closeImageEdit,
    bumpMediaRevision,
    mediaRevision,
  } = useEditorContext();
  // Dual-catalog custom themes (doc + browser library), mirroring how
  // CustomTemplateProvider is fed. Wraps the preview subtree so the theme
  // picker + designer can read/write both pools.
  const { docThemes, onDocThemesChange } = useDocCustomThemes();
  const isPreview = activeView === 'preview';
  const isCodeMode = editorMode === 'code';
  const isImageMode = editorMode === 'image';
  const isMarkdownMode = editorMode === 'markdown';
  // The block card (one block at a time) applies to the editing surfaces (raw /
  // wysiwyg) in markdown mode — never to preview, code, or image. Both the
  // block-at-a-time and timeline layouts scope the editor to a single block.
  const isCardMode =
    isMarkdownMode && (layoutMode === 'block' || layoutMode === 'timeline') && !isPreview;
  // Timeline mode additionally shows the horizontal timeline track below.
  const isTimelineMode = isMarkdownMode && layoutMode === 'timeline' && !isPreview;
  const [showFiles, setShowFiles] = useState(false);
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);
  const [mediaCount, setMediaCount] = useState(0);
  const mediaListRefreshKey = mediaRefreshKey + mediaRevision;
  const usedMediaPaths = useMemo(
    () => collectMediaReferencesFromMarkdown(markdownSource),
    [markdownSource],
  );
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
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    if (!mediaProvider) {
      setMediaCount(0);
      return;
    }

    let cancelled = false;
    mediaProvider.listMedia().then(
      (entries) => {
        if (!cancelled) setMediaCount(filterVisibleMediaEntries(entries).length);
      },
      (err: unknown) => {
        if (!cancelled) {
          setMediaCount(0);
          console.warn(
            '[squisq-editor] Failed to read media list:',
            err instanceof Error ? err.message : err,
          );
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [mediaProvider, mediaListRefreshKey]);

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
   * an empty body and the downstream consumer reported "nothing came
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

  const handleMediaUploaded = useCallback(
    (relativePath: string, name: string, mimeType: string) => {
      insertMediaRef(relativePath, name, mimeType);
      setMediaRefreshKey((k) => k + 1);
    },
    [insertMediaRef],
  );

  const handleMediaRemoved = useCallback(
    (relativePath: string) => {
      const nextSource = removeMediaReferencesFromMarkdown(markdownSource, relativePath);
      if (nextSource !== markdownSource) replaceAll(nextSource);
      setMediaRefreshKey((k) => k + 1);
      bumpMediaRevision();
    },
    [bumpMediaRevision, markdownSource, replaceAll],
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
    enabled: !readOnly,
  });

  // Notify parent of changes
  useEffect(() => {
    onChange?.(markdownSource);
  }, [markdownSource, onChange]);

  // View shortcuts bubble only through the editor that currently owns focus.
  const handleShellKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const view =
        e.key === '1' ? 'wysiwyg' : e.key === '2' ? 'raw' : e.key === '3' ? 'preview' : null;
      if (!view || (view === 'preview' && !showPlayTab)) return;
      const button = shellRef.current?.querySelector<HTMLButtonElement>(`[data-view="${view}"]`);
      if (!button) return;
      e.preventDefault();
      e.stopPropagation();
      button.click();
    },
    [showPlayTab],
  );

  const autoGrow = minHeight !== undefined || maxHeight !== undefined;

  return (
    <div
      ref={shellRef}
      onKeyDown={handleShellKeyDown}
      className={`squisq-editor-shell ${className || ''}`}
      data-theme={colorScheme}
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
        ...writeCanvasSettingsStyle(writeCanvasSettings),
        // Exposed so the toolbar's view-tabs section AND the outline pane read
        // one shared width, lining up the view-tabs' right-edge separator with
        // the outline's right edge. A fixed `outlineWidth` pins it to px;
        // otherwise it's the responsive clamp so the pane stretches when
        // there's room. The `data-outline-visible` gate above keeps the
        // toolbar override scoped to the case where alignment matters.
        ...({
          '--squisq-outline-width':
            outlineWidth != null ? `${outlineWidth}px` : OUTLINE_RESPONSIVE_WIDTH,
        } as CSSProperties),
      }}
      {...containerProps}
    >
      <CustomThemeProvider docThemes={docThemes} onDocThemesChange={onDocThemesChange}>
        <PreviewSettingsProvider doc={doc} themeOverride={themeOverride}>
          <UseModeProviders rootRef={shellRef}>
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
                  fileCount={mediaCount}
                  onToggleFiles={!isCodeMode && filesToggleEnabled ? handleToggleFiles : undefined}
                  slotLeft={toolbarSlotLeft}
                  slotAfterTabs={!isCodeMode && isPreview && <UseModeToolbarControls />}
                  slotAfterActions={toolbarSlotAfterActions}
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
                      surface={colorScheme === 'dark' ? DARK_SURFACE : LIGHT_SURFACE}
                    />
                  ) : (
                    <ImageViewer src={imageSrc} alt={imageAlt} theme={colorScheme} />
                  ))}
                {/* Raw (Monaco) view. Always wrapped in `.squisq-editor-with-gutter`
                so toggling a pane on/off doesn't change the editor's tree
                position — Monaco stays mounted and `monacoEditor` in
                context stays stable, which is what `useHeadingLayout` needs
                to compute positions. */}
                {!isImageMode && activeView === 'raw' && (
                  <div className="squisq-editor-with-gutter" key="raw-shell">
                    {isMarkdownMode && outlineVisible && (
                      <OutlinePanel key="outline" width={outlineWidth} readOnly={readOnly} />
                    )}
                    {isCardMode ? (
                      <BlockCardView
                        key="raw-card"
                        blockCount={blockCount}
                        activeBlockKey={activeBlockKey}
                        onPrev={prevBlock}
                        onNext={nextBlock}
                        onAdd={addBlock}
                      >
                        <div key="raw-editor" className="squisq-raw-editor-container">
                          <RawEditor
                            monacoTheme={colorScheme === 'dark' ? 'vs-dark' : 'vs'}
                            submitOnEnter={submitOnEnter}
                            readOnly={readOnly}
                          />
                        </div>
                      </BlockCardView>
                    ) : (
                      <div key="raw-editor" className="squisq-raw-editor-container">
                        <RawEditor
                          monacoTheme={colorScheme === 'dark' ? 'vs-dark' : 'vs'}
                          submitOnEnter={submitOnEnter}
                          readOnly={readOnly}
                        />
                      </div>
                    )}
                    {/* Renders nothing in normal flow — portals context
                    sections into Monaco view zones via the context's
                    monacoEditor. Code mode only. */}
                    {isCodeMode && codeContext && (
                      <CodeContextZones key="code-context" options={codeContext} />
                    )}
                    {isMarkdownMode && isCardMode && inlinePreviewVisible && (
                      <BlockPreviewPanel key="block-preview" basePath={basePath} />
                    )}
                    {isMarkdownMode && !isCardMode && inlinePreviewVisible && (
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
                    {outlineVisible && (
                      <OutlinePanel key="outline" width={outlineWidth} readOnly={readOnly} />
                    )}
                    {isCardMode ? (
                      <BlockCardView
                        key="wysiwyg-card"
                        blockCount={blockCount}
                        activeBlockKey={activeBlockKey}
                        onPrev={prevBlock}
                        onNext={nextBlock}
                        onAdd={addBlock}
                      >
                        <WysiwygEditor
                          key="wysiwyg-editor"
                          submitOnEnter={submitOnEnter}
                          placeholder={placeholder}
                          readOnly={readOnly}
                        />
                      </BlockCardView>
                    ) : (
                      <WysiwygEditor
                        key="wysiwyg-editor"
                        submitOnEnter={submitOnEnter}
                        placeholder={placeholder}
                        readOnly={readOnly}
                      />
                    )}
                    {isCardMode && inlinePreviewVisible && (
                      <BlockPreviewPanel key="block-preview" basePath={basePath} />
                    )}
                    {!isCardMode && inlinePreviewVisible && (
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
                  <PreviewPanel basePath={basePath} workspaceContainer={workspaceContainer} />
                )}
              </div>

              {isMarkdownMode && showFiles && (
                <MediaBin
                  mediaProvider={mediaProvider}
                  isDark={isDark}
                  refreshKey={mediaListRefreshKey}
                  usedMediaPaths={usedMediaPaths}
                  onMediaUploaded={handleMediaUploaded}
                  onMediaRemoved={handleMediaRemoved}
                  onCountChange={setMediaCount}
                />
              )}

              {/* Docked custom-theme designer — a flex sibling of the preview, so
              opening it reflows the preview narrower. Renders nothing when the
              designer is closed. */}
              {isMarkdownMode && <ThemeDesignerDock />}

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

            {/* Timeline track — horizontal strip of block + media bars shown
            below the editor in Timeline view. The card editor above (driven by
            the block navigator) shows whichever block is selected here. */}
            {isTimelineMode && <TimelineTrack />}

            {/* Status bar — word / char / line / block counts. Host can
            suppress via `showStatusBar={false}` for embedded chat-style
            composers where the stats are noise. The image viewer has its
            own dimension/zoom status row, so suppress here too. */}
            {statusBarVisible && !isImageMode && <StatusBar slotRight={statusBarSlotRight} />}
          </UseModeProviders>
        </PreviewSettingsProvider>
      </CustomThemeProvider>
      <TooltipLayer />
      {imageEditTarget !== null && mediaProvider && (
        <ImageEditModal
          relativePath={imageEditTarget}
          container={workspaceContainer ?? imageEditFallbackContainer}
          mediaProvider={mediaProvider}
          onClose={closeImageEdit}
          onSaved={() => {
            bumpMediaRevision();
            closeImageEdit();
          }}
          allowVersioning={allowVersioning}
          versioningAutoSaveIdleMs={versioningAutoSaveIdleMs}
          shellTheme={colorScheme}
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
  /** EditorShell's `colorScheme` prop — 'light' or 'dark'. Threaded through
   *  so the image editor chrome matches the host shell. */
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
  const modalRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  useModalDialog({ rootRef: modalRef, dialogRef: surfaceRef, onClose });
  const extension = relativePath.split(/[?#]/, 1)[0]?.split('.').pop()?.toLowerCase();
  const saveFormat: 'png' | 'jpeg' | 'webp' | null =
    extension === 'png'
      ? 'png'
      : extension === 'jpg' || extension === 'jpeg'
        ? 'jpeg'
        : extension === 'webp'
          ? 'webp'
          : null;
  // Each unique image path gets its own sidecar so multiple images in the
  // same doc can be edited independently without colliding state. When the
  // host didn't supply a `container`, fall back to a fresh in-memory one
  // — the edit session is transient anyway and the final raster is what
  // gets written back through `mediaProvider`.
  const sidecar = useMemo(() => {
    const sanitized = relativePath.replace(/[^a-zA-Z0-9._-]+/g, '_');
    let hash = 2166136261;
    for (let i = 0; i < relativePath.length; i++) {
      hash ^= relativePath.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const scopedName = `${sanitized}-${(hash >>> 0).toString(36)}`;
    const parent: ContentContainer = container ?? new MemoryContentContainer();
    return scopeContainer(parent, `.imageEdits/${scopedName}`);
  }, [container, relativePath]);

  const [initialSrc, setInitialSrc] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setInitialSrc(null);
    setResolveError(null);
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

  return (
    <div
      ref={modalRef}
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
      <div ref={surfaceRef} className="squisq-image-edit-modal__surface">
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
          ) : !saveFormat ? (
            <div className="squisq-image-edit-modal__error">
              Editing supports PNG, JPEG, and WebP images without changing the asset type.
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
              saveFormat={saveFormat}
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
